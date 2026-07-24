// ASSN V2 事件处理：原始通知 → transactions / subscriptions 状态更新
// buildTxStatement / buildSubStatement 是纯语句构造（webhook 实时处理与 reprocess 回放共用，可进 db.batch）

import type { NotificationPayload, TransactionInfo, RenewalInfo } from './assn'
import { countryDisplay, money, periodLabel, productDisplay } from './humanize'
import { enrichApp } from './app-enrich'

export interface ProcessedEvent {
  /** 用于通知展示的摘要 */
  title: string
  body: string
  /** App 图标（推送通知展示用） */
  icon: string | null
  /** 是否值得实时推送 */
  notify: boolean
}

/** 免费试用交易判定：介绍性优惠且价格为 0 */
export function isTrialTx(tx: TransactionInfo | null): boolean {
  return !!tx && tx.offerType === 1 && (tx.price ?? 0) === 0
}

/** 事件映射表：notificationType(+subtype) → 订阅状态；null = 不改状态 */
export function resolveStatus(
  type: string,
  subtype: string | undefined,
  tx: TransactionInfo | null,
  renewal: RenewalInfo | null,
  now = Date.now()
): string | null {
  switch (type) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
      return isTrialTx(tx) ? 'trial' : 'active'
    case 'DID_CHANGE_RENEWAL_PREF':
      // UPGRADE 立即生效（新交易），订阅保持活跃；DOWNGRADE 下期生效不改状态
      return subtype === 'UPGRADE' ? 'active' : null
    case 'DID_FAIL_TO_RENEW':
      return subtype === 'GRACE_PERIOD' ? 'grace_period' : 'billing_retry'
    case 'GRACE_PERIOD_EXPIRED':
      return 'billing_retry'
    case 'EXPIRED':
      return 'expired'
    case 'REVOKE':
      return 'revoked'
    case 'REFUND':
      return renewal ? 'revoked' : null // 一次性购买退款不影响订阅状态
    case 'REFUND_REVERSED':
      // 退款撤销：订阅复活（未到期恢复 active，已到期归 expired）
      if (!renewal && tx?.type !== 'Auto-Renewable Subscription') return null
      return tx?.expiresDate && tx.expiresDate > now ? 'active' : 'expired'
    default:
      return null
  }
}

const NOTIFY_TITLES: Record<string, (subtype?: string) => string | null> = {
  SUBSCRIBED: (s) => (s === 'RESUBSCRIBE' ? '♻️ 重新订阅' : '🎉 新订阅'),
  DID_RENEW: () => '♻️ 自动续费',
  ONE_TIME_CHARGE: () => '💰 新购买',
  OFFER_REDEEMED: () => '🎁 优惠兑换',
  REFUND: () => '⚠️ 退款',
  REFUND_REVERSED: () => '↩️ 退款撤销',
  REVOKE: () => '❌ 共享购买撤销',
  DID_CHANGE_RENEWAL_STATUS: (s) => (s === 'AUTO_RENEW_DISABLED' ? '📉 取消自动续费' : null),
  DID_CHANGE_RENEWAL_PREF: (s) => (s === 'UPGRADE' ? '⬆️ 订阅升级' : s === 'DOWNGRADE' ? '⬇️ 订阅降级（下期生效）' : null),
  DID_FAIL_TO_RENEW: (s) => (s === 'GRACE_PERIOD' ? '⏳ 进入宽限期' : '🚨 扣款失败'),
  GRACE_PERIOD_EXPIRED: () => '🚨 宽限期结束',
  PRICE_INCREASE: (s) => (s === 'ACCEPTED' ? '💵 用户接受涨价' : null),
  EXPIRED: () => '❌ 订阅过期',
}

/** Apple 交易不直接给订阅周期，从购买时间与过期时间推断 */
function inferPeriod(tx: TransactionInfo): string | null {
  if (!tx.expiresDate || !tx.purchaseDate) return null
  const days = (tx.expiresDate - tx.purchaseDate) / 86400_000
  if (days <= 10) return 'P1W'
  if (days <= 45) return 'P1M'
  if (days <= 135) return 'P3M'
  if (days <= 270) return 'P6M'
  return 'P1Y'
}

/** 交易明细 upsert（纯语句，可 batch）。REFUND_REVERSED 时 refunded 会随 revocationDate 消失而复位 */
export function buildTxStatement(
  db: D1Database,
  tx: TransactionInfo,
  type: string,
  subtype: string | undefined,
  appId: number | null,
  rawUuid: string
): D1PreparedStatement {
  const refunded = type === 'REFUND' || tx.revocationDate != null ? 1 : 0
  return db
    .prepare(
      `INSERT INTO transactions (transaction_id, original_transaction_id, app_id, product_id, type,
         price_milli, currency, country, purchase_date, expires_date,
         event_type, event_subtype, offer_type, offer_discount_type, is_trial, refunded, raw_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO UPDATE SET
         refunded = excluded.refunded,
         -- 退款/撤销是状态修正，不覆盖"创建"该交易的事件类型（否则退款撤销后不再匹配收入口径）
         event_type = CASE
           WHEN excluded.event_type IN ('REFUND', 'REFUND_REVERSED', 'REFUND_DECLINED') THEN transactions.event_type
           ELSE excluded.event_type END,
         event_subtype = CASE
           WHEN excluded.event_type IN ('REFUND', 'REFUND_REVERSED', 'REFUND_DECLINED') THEN transactions.event_subtype
           ELSE excluded.event_subtype END,
         offer_type = COALESCE(excluded.offer_type, transactions.offer_type),
         offer_discount_type = COALESCE(excluded.offer_discount_type, transactions.offer_discount_type),
         is_trial = MAX(excluded.is_trial, transactions.is_trial)`
    )
    .bind(
      tx.transactionId,
      tx.originalTransactionId,
      appId,
      tx.productId,
      tx.type,
      tx.price ?? null,
      tx.currency ?? null,
      tx.storefront ?? null,
      tx.purchaseDate ?? null,
      tx.expiresDate ?? null,
      type,
      subtype ?? null,
      tx.offerType ?? null,
      tx.offerDiscountType ?? null,
      isTrialTx(tx) ? 1 : 0,
      refunded,
      rawUuid
    )
}

/** 订阅状态 upsert（纯语句，可 batch）；非订阅事件返回 null */
export function buildSubStatement(
  db: D1Database,
  tx: TransactionInfo,
  renewal: RenewalInfo | null,
  type: string,
  subtype: string | undefined,
  appId: number | null,
  now = Date.now()
): D1PreparedStatement | null {
  const isSubscription = tx.type === 'Auto-Renewable Subscription' || renewal != null
  if (!isSubscription) return null

  const status = resolveStatus(type, subtype, tx, renewal, now)
  const autoRenew = renewal ? (renewal.autoRenewStatus === 1 ? 1 : 0) : null
  const trial = isTrialTx(tx) ? 1 : 0
  // 降级：记录下期生效产品；续费/升级发生时清除（换期已生效）
  const isDowngrade = type === 'DID_CHANGE_RENEWAL_PREF' && subtype === 'DOWNGRADE' ? 1 : 0
  const clearPending = type === 'DID_RENEW' || (type === 'DID_CHANGE_RENEWAL_PREF' && subtype === 'UPGRADE') ? 1 : 0
  const pendingProduct = isDowngrade ? renewal?.autoRenewProductId ?? null : null
  const priceIncrease = type === 'PRICE_INCREASE' ? subtype ?? null : null
  const expIntent = type === 'EXPIRED' ? subtype ?? 'UNKNOWN' : null
  const purchaseDate = tx.purchaseDate ?? now

  return db
    .prepare(
      `INSERT INTO subscriptions (original_transaction_id, app_id, product_id, status, auto_renew,
         period, price_milli, currency, country, started_at, expires_at, updated_at,
         pending_product_id, price_increase_status, trial_started_at, converted_at, expiration_intent)
       VALUES (?1, ?2, ?3, COALESCE(?4, 'active'), COALESCE(?5, 1), ?6, ?7, ?8, ?9, ?10, ?11, ?12,
         ?13, ?14, CASE WHEN ?15 THEN ?16 ELSE NULL END, NULL, ?17)
       ON CONFLICT(original_transaction_id) DO UPDATE SET
         product_id = excluded.product_id,
         status = COALESCE(?4, subscriptions.status),
         auto_renew = COALESCE(?5, subscriptions.auto_renew),
         period = COALESCE(excluded.period, subscriptions.period),
         price_milli = COALESCE(excluded.price_milli, subscriptions.price_milli),
         currency = COALESCE(excluded.currency, subscriptions.currency),
         expires_at = COALESCE(excluded.expires_at, subscriptions.expires_at),
         updated_at = excluded.updated_at,
         pending_product_id = CASE
           WHEN ?18 THEN ?13
           WHEN ?19 THEN NULL
           ELSE subscriptions.pending_product_id END,
         price_increase_status = COALESCE(?14, subscriptions.price_increase_status),
         trial_started_at = CASE
           WHEN ?15 AND subscriptions.trial_started_at IS NULL THEN ?16
           ELSE subscriptions.trial_started_at END,
         converted_at = CASE
           WHEN subscriptions.status = 'trial' AND ?4 = 'active' AND subscriptions.converted_at IS NULL THEN ?16
           ELSE subscriptions.converted_at END,
         expiration_intent = CASE
           WHEN ?17 IS NOT NULL THEN ?17
           WHEN ?4 IN ('active', 'trial') THEN NULL
           ELSE subscriptions.expiration_intent END`
    )
    .bind(
      tx.originalTransactionId, // 1
      appId, // 2
      tx.productId, // 3
      status, // 4
      autoRenew, // 5
      inferPeriod(tx), // 6
      tx.price ?? null, // 7
      tx.currency ?? null, // 8
      tx.storefront ?? null, // 9
      tx.originalPurchaseDate ?? null, // 10
      tx.expiresDate ?? null, // 11
      now, // 12
      pendingProduct, // 13
      priceIncrease, // 14
      trial, // 15
      purchaseDate, // 16
      expIntent, // 17
      isDowngrade, // 18
      clearPending // 19
    )
}

/** 推送正文：App 名 · 产品 周期 金额 · 🇨🇳 中国 */
function buildBody(
  appName: string | null,
  bundleId: string | undefined,
  tx: TransactionInfo | null,
  productName: string | null
): string {
  const parts: string[] = []
  // App 名可读（非 bundleId 占位）就用名字，否则退回 bundleId 末段
  const app = appName && appName !== bundleId ? appName : bundleId?.split('.').pop() ?? ''
  if (app) parts.push(app)

  const product = [
    // products 目录里的正式名优先，未同步到时回退 product_id 末段
    productName ?? productDisplay(tx?.productId, bundleId ?? tx?.bundleId),
    periodLabel(tx ? inferPeriod(tx) : null),
    // 金额已提到通知标题，正文不再重复
  ]
    .filter(Boolean)
    .join(' ')
  if (product) parts.push(product)

  const country = countryDisplay(tx?.storefront)
  if (country) parts.push(country)
  return parts.join(' · ')
}

export async function processNotification(
  db: D1Database,
  payload: NotificationPayload,
  tx: TransactionInfo | null,
  renewal: RenewalInfo | null,
  rawUuid: string
): Promise<ProcessedEvent> {
  const { notificationType: type, subtype } = payload

  // App 归属（按 bundleId 自动注册，首次事件即建档）
  let appId: number | null = null
  let appName: string | null = null
  let appIcon: string | null = null
  const bundleId = payload.data?.bundleId ?? tx?.bundleId
  if (bundleId) {
    const existing = await db
      .prepare('SELECT id, name, icon_url FROM apps WHERE bundle_id = ?')
      .bind(bundleId)
      .first<{ id: number; name: string; icon_url: string | null }>()
    if (existing) {
      appId = existing.id
      appName = existing.name
      appIcon = existing.icon_url
    } else {
      const inserted = await db
        .prepare('INSERT INTO apps (bundle_id, name, asc_app_id) VALUES (?, ?, ?) RETURNING id')
        .bind(bundleId, bundleId, payload.data?.appAppleId?.toString() ?? null)
        .first<{ id: number }>()
      appId = inserted?.id ?? null
      // 首次建档时顺便补全图标与正式名称（一次性，失败静默）
      if (inserted) {
        await enrichApp(db, {
          id: inserted.id,
          bundle_id: bundleId,
          name: bundleId,
          asc_app_id: payload.data?.appAppleId?.toString() ?? null,
          icon_url: null,
        })
        const fresh = await db
          .prepare('SELECT name, icon_url FROM apps WHERE id = ?')
          .bind(inserted.id)
          .first<{ name: string; icon_url: string | null }>()
        appName = fresh?.name ?? null
        appIcon = fresh?.icon_url ?? null
      }
    }
  }
  await db.prepare('UPDATE notifications_raw SET app_id = ? WHERE uuid = ?').bind(appId, rawUuid).run()

  // 交易明细 + 订阅状态（同一批语句）
  if (tx) {
    const stmts = [buildTxStatement(db, tx, type, subtype, appId, rawUuid)]
    const subStmt = buildSubStatement(db, tx, renewal, type, subtype, appId)
    if (subStmt) stmts.push(subStmt)
    await db.batch(stmts)
  }

  // 产品正式名（fetch-products 每日同步的 ASC referenceName）
  let productName: string | null = null
  if (tx?.productId) {
    const row = await db
      .prepare('SELECT name FROM products WHERE product_id = ?')
      .bind(tx.productId)
      .first<{ name: string }>()
    productName = row?.name ?? null
  }

  const titleFn = NOTIFY_TITLES[type]
  const baseTitle = titleFn?.(subtype) ?? null
  // 金额提到标题（带正负号）——推送弹窗一眼看清进/出多少；退款、撤销为负
  const neg = type === 'REFUND' || type === 'REVOKE'
  const amt = tx?.price != null && tx.price > 0 ? money(tx.price, tx.currency) : null
  const title = baseTitle != null && amt ? `${baseTitle} ${neg ? '−' : '+'}${amt}` : baseTitle
  const body = buildBody(appName, bundleId, tx, productName)
  return {
    title: title ?? `${type}${subtype ? `/${subtype}` : ''}`,
    body,
    icon: appIcon,
    notify: baseTitle != null,
  }
}
