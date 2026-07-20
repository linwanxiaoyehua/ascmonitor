// ASSN 事件 → 订阅状态映射（P2 全事件解读）

import { describe, expect, it } from 'vitest'
import { isTrialTx, resolveStatus } from '../src/lib/events'
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
