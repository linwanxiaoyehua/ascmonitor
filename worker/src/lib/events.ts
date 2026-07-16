// ASSN V2 事件处理：原始通知 → transactions / subscriptions 状态更新

import type { NotificationPayload, TransactionInfo, RenewalInfo } from './assn'

export interface ProcessedEvent {
  /** 用于通知展示的摘要 */
  title: string
  body: string
  /** 是否值得实时推送 */
  notify: boolean
}

/** 事件映射表：notificationType(+subtype) → 订阅状态 */
function resolveStatus(
  type: string,
  subtype: string | undefined,
  tx: TransactionInfo | null,
  renewal: RenewalInfo | null
): string | null {
  switch (type) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
      // offerType 1 = introductory offer；免费试用价格为 0
      return tx && tx.offerType === 1 && (tx.price ?? 0) === 0 ? 'trial' : 'active'
    case 'DID_FAIL_TO_RENEW':
      return subtype === 'GRACE_PERIOD' ? 'grace_period' : 'billing_retry'
    case 'EXPIRED':
      return 'expired'
    case 'REVOKE':
      return 'revoked'
    case 'REFUND':
      return renewal ? 'revoked' : null // 一次性购买退款不影响订阅状态
    default:
      return null
  }
}

const NOTIFY_TITLES: Record<string, (subtype?: string) => string | null> = {
  SUBSCRIBED: (s) => (s === 'RESUBSCRIBE' ? '♻️ 重新订阅' : '🎉 新订阅'),
  DID_RENEW: () => '♻️ 自动续费',
  ONE_TIME_CHARGE: () => '💰 新购买',
  REFUND: () => '⚠️ 退款',
  DID_CHANGE_RENEWAL_STATUS: (s) => (s === 'AUTO_RENEW_DISABLED' ? '📉 取消自动续费' : null),
  DID_FAIL_TO_RENEW: (s) => (s === 'GRACE_PERIOD' ? '⏳ 进入宽限期' : '🚨 扣款失败'),
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

function formatPrice(tx: TransactionInfo | null): string {
  if (!tx || tx.price == null || !tx.currency) return ''
  return ` ${(tx.price / 1000).toFixed(2)} ${tx.currency}`
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
  const bundleId = payload.data?.bundleId ?? tx?.bundleId
  if (bundleId) {
    const existing = await db.prepare('SELECT id FROM apps WHERE bundle_id = ?').bind(bundleId).first<{ id: number }>()
    if (existing) {
      appId = existing.id
    } else {
      const inserted = await db
        .prepare('INSERT INTO apps (bundle_id, name, asc_app_id) VALUES (?, ?, ?) RETURNING id')
        .bind(bundleId, bundleId, payload.data?.appAppleId?.toString() ?? null)
        .first<{ id: number }>()
      appId = inserted?.id ?? null
    }
  }
  await db.prepare('UPDATE notifications_raw SET app_id = ? WHERE uuid = ?').bind(appId, rawUuid).run()

  // 交易明细
  if (tx) {
    const refunded = type === 'REFUND' || tx.revocationDate != null ? 1 : 0
    await db
      .prepare(
        `INSERT INTO transactions (transaction_id, original_transaction_id, app_id, product_id, type,
           price_milli, currency, country, purchase_date, expires_date, event_type, refunded, raw_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(transaction_id) DO UPDATE SET refunded = excluded.refunded, event_type = excluded.event_type`
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
        refunded,
        rawUuid
      )
      .run()
  }

  // 订阅状态物化（仅自动续订订阅）
  const isSubscription = tx?.type === 'Auto-Renewable Subscription' || renewal != null
  if (isSubscription && tx) {
    const status = resolveStatus(type, subtype, tx, renewal)
    const autoRenew = renewal ? (renewal.autoRenewStatus === 1 ? 1 : 0) : null
    await db
      .prepare(
        `INSERT INTO subscriptions (original_transaction_id, app_id, product_id, status, auto_renew,
           period, price_milli, currency, country, started_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, 1), ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(original_transaction_id) DO UPDATE SET
           product_id = excluded.product_id,
           status = COALESCE(?, subscriptions.status),
           auto_renew = COALESCE(?, subscriptions.auto_renew),
           period = COALESCE(excluded.period, subscriptions.period),
           price_milli = COALESCE(excluded.price_milli, subscriptions.price_milli),
           currency = COALESCE(excluded.currency, subscriptions.currency),
           expires_at = COALESCE(excluded.expires_at, subscriptions.expires_at),
           updated_at = excluded.updated_at`
      )
      .bind(
        tx.originalTransactionId,
        appId,
        tx.productId,
        status ?? 'active',
        autoRenew,
        inferPeriod(tx),
        tx.price ?? null,
        tx.currency ?? null,
        tx.storefront ?? null,
        tx.originalPurchaseDate ?? null,
        tx.expiresDate ?? null,
        Date.now(),
        status,
        autoRenew
      )
      .run()
  }

  const titleFn = NOTIFY_TITLES[type]
  const title = titleFn?.(subtype) ?? null
  const body = `${bundleId ?? ''} ${tx?.productId ?? ''}${formatPrice(tx)} ${tx?.storefront ?? ''}`.trim()
  return {
    title: title ?? `${type}${subtype ? `/${subtype}` : ''}`,
    body,
    notify: title != null,
  }
}
