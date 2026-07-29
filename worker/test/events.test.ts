// ASSN 事件 → 订阅状态映射（P2 全事件解读）

import { describe, expect, it } from 'vitest'
import { buildSubStatement, buildTxStatement, isTrialTx, resolveStatus, txEnvironment } from '../src/lib/events'
import type { TransactionInfo, RenewalInfo } from '../src/lib/assn'

const NOW = Date.parse('2026-07-17T00:00:00Z')

function tx(over: Partial<TransactionInfo> = {}): TransactionInfo {
  return {
    transactionId: 't1',
    originalTransactionId: 'ot1',
    bundleId: 'com.demo.app',
    productId: 'com.demo.app.pro.monthly',
    purchaseDate: NOW - 86400_000,
    originalPurchaseDate: NOW - 30 * 86400_000,
    expiresDate: NOW + 20 * 86400_000,
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    environment: 'Production',
    price: 9990,
    currency: 'USD',
    ...over,
  }
}

const renewal: RenewalInfo = {
  originalTransactionId: 'ot1',
  productId: 'com.demo.app.pro.monthly',
  autoRenewStatus: 1,
}

describe('isTrialTx', () => {
  it('介绍性优惠且价格 0 判定为试用', () => {
    expect(isTrialTx(tx({ offerType: 1, price: 0 }))).toBe(true)
  })
  it('付费介绍价不是免费试用', () => {
    expect(isTrialTx(tx({ offerType: 1, price: 4990 }))).toBe(false)
  })
  it('无优惠不是试用', () => {
    expect(isTrialTx(tx())).toBe(false)
  })
})

/** 只记录 SQL 与绑定值的假 D1 —— 这两个 build*Statement 是纯语句构造，不需要真库 */
function fakeDb() {
  const calls: Array<{ sql: string; binds: unknown[] }> = []
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds })
        return {} as D1PreparedStatement
      },
    }),
  } as unknown as D1Database
  return { db, calls }
}

describe('沙盒环境落库', () => {
  it('只有 Sandbox 判为沙盒，环境缺失按生产处理', () => {
    expect(txEnvironment(tx({ environment: 'Sandbox' }))).toBe('Sandbox')
    expect(txEnvironment(tx({ environment: 'Production' }))).toBe('Production')
    expect(txEnvironment(tx({ environment: undefined as unknown as string }))).toBe('Production')
  })

  it('交易 INSERT 的列数与占位符数一致，且带上环境', () => {
    const { db, calls } = fakeDb()
    buildTxStatement(db, tx({ environment: 'Sandbox' }), 'SUBSCRIBED', 'INITIAL_BUY', 1, 'uuid-1')
    const { sql, binds } = calls[0]
    const columns = sql.match(/INSERT INTO transactions \(([\s\S]*?)\)\s*VALUES/)![1].split(',').length
    const placeholders = sql.match(/VALUES \(([^)]*)\)/)![1].split(',').length
    expect(columns).toBe(placeholders)
    expect(binds).toHaveLength(columns)
    expect(binds[binds.length - 1]).toBe('Sandbox')
  })

  it('订阅 INSERT 带上环境（编号参数 ?20）', () => {
    const { db, calls } = fakeDb()
    buildSubStatement(db, tx({ environment: 'Sandbox' }), renewal, 'SUBSCRIBED', 'INITIAL_BUY', 1, NOW)
    const { sql, binds } = calls[0]
    expect(sql).toContain('environment')
    expect(binds[19]).toBe('Sandbox')
  })
})

describe('交易的 event_type 不被后续事件改写', () => {
  // 取消续费 / 降级 / 扣款失败 / 过期都带着同一份 signedTransactionInfo 回来，
  // 一旦 upsert 覆盖了 event_type，那笔续费就不再匹配收入口径 —— 收入、MRR、LTV 全少算
  it('ON CONFLICT 分支不更新 event_type / event_subtype', () => {
    const { db, calls } = fakeDb()
    buildTxStatement(db, tx(), 'DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', 1, 'uuid-2')
    const update = calls[0].sql.split('DO UPDATE SET')[1]
    expect(update).toBeDefined()
    expect(update).not.toMatch(/^\s*event_type\s*=/m)
    expect(update).not.toMatch(/^\s*event_subtype\s*=/m)
  })
})

describe('resolveStatus', () => {
  it('SUBSCRIBED → active；试用交易 → trial', () => {
    expect(resolveStatus('SUBSCRIBED', 'INITIAL_BUY', tx(), renewal, NOW)).toBe('active')
    expect(resolveStatus('SUBSCRIBED', 'INITIAL_BUY', tx({ offerType: 1, price: 0 }), renewal, NOW)).toBe('trial')
  })

  it('UPGRADE 立即生效 → active；DOWNGRADE 下期生效不改状态', () => {
    expect(resolveStatus('DID_CHANGE_RENEWAL_PREF', 'UPGRADE', tx(), renewal, NOW)).toBe('active')
    expect(resolveStatus('DID_CHANGE_RENEWAL_PREF', 'DOWNGRADE', tx(), renewal, NOW)).toBeNull()
  })

  it('GRACE_PERIOD_EXPIRED → billing_retry', () => {
    expect(resolveStatus('GRACE_PERIOD_EXPIRED', undefined, tx(), renewal, NOW)).toBe('billing_retry')
  })

  it('EXPIRED / REVOKE', () => {
    expect(resolveStatus('EXPIRED', 'VOLUNTARY', tx(), renewal, NOW)).toBe('expired')
    expect(resolveStatus('REVOKE', undefined, tx(), renewal, NOW)).toBe('revoked')
  })

  it('REFUND：订阅退款 revoked，一次性购买不改状态', () => {
    expect(resolveStatus('REFUND', undefined, tx(), renewal, NOW)).toBe('revoked')
    expect(resolveStatus('REFUND', undefined, tx({ type: 'Non-Consumable', expiresDate: undefined }), null, NOW)).toBeNull()
  })

  it('REFUND_REVERSED：未到期复活 active，已到期归 expired，一次性购买不改状态', () => {
    expect(resolveStatus('REFUND_REVERSED', undefined, tx({ expiresDate: NOW + 86400_000 }), renewal, NOW)).toBe('active')
    expect(resolveStatus('REFUND_REVERSED', undefined, tx({ expiresDate: NOW - 86400_000 }), renewal, NOW)).toBe('expired')
    expect(resolveStatus('REFUND_REVERSED', undefined, tx({ type: 'Non-Consumable', expiresDate: undefined }), null, NOW)).toBeNull()
  })

  it('PRICE_INCREASE / OFFER_REDEEMED 等不直接改状态', () => {
    expect(resolveStatus('PRICE_INCREASE', 'PENDING', tx(), renewal, NOW)).toBeNull()
    expect(resolveStatus('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', tx(), renewal, NOW)).toBeNull()
  })
})
