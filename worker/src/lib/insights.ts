// P3 收入深化指标：全部即时计算（设计原则：能即时算的不物化）
// 依赖 P2 落库字段：is_trial / trial_started_at / converted_at / expiration_intent / event_subtype

import { fxRates } from './metrics'

/** 产生收入的交易条件（与 metrics.ts REVENUE_COND 同口径） */
const REVENUE_COND = `(event_type IN ('SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE', 'OFFER_REDEEMED')
  OR (event_type = 'DID_CHANGE_RENEWAL_PREF' AND event_subtype = 'UPGRADE'))`

export interface SubHealth {
  windowDays: number
  /** 续订率 = 续费 / (续费 + 过期)；按首续/多续分层 */
  renewals: number
  firstRenewals: number
  repeatRenewals: number
  expirations: number
  renewalRate: number | null
  /** Churn = 窗口内结束订阅 / 窗口起点活跃数；按主动（VOLUNTARY）/ 被动拆分 */
  churnedVoluntary: number
  churnedInvoluntary: number
  activeAtStart: number
  churnRate: number | null
  /** 退款率 = 退款笔数 / 成交笔数 */
  refunds: number
  purchases: number
  refundRate: number | null
}

export async function subHealth(db: D1Database, days = 30, appId?: number): Promise<SubHealth> {
  const since = Date.now() - days * 86400_000
  const appFilter = appId ? 'AND app_id = ?' : ''
  const bind = (stmt: D1PreparedStatement, ...args: unknown[]) =>
    appId ? stmt.bind(...args, appId) : stmt.bind(...args)

  // 续费交易 + 序数（该订阅下此前已有几笔交易；=1 即首次续订）
  const renewalRows = await bind(
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM transactions t2
          WHERE t2.original_transaction_id = t.original_transaction_id AND t2.purchase_date < t.purchase_date) AS seq
       FROM transactions t
       WHERE t.event_type = 'DID_RENEW' AND t.purchase_date >= ? ${appFilter}`
    ),
    since
  ).all<{ seq: number }>()
  const renewals = renewalRows.results.length
  const firstRenewals = renewalRows.results.filter((r) => r.seq <= 1).length

  const expired = await bind(
    db.prepare(`SELECT COUNT(*) AS n FROM notifications_raw WHERE type = 'EXPIRED' AND received_at >= ? ${appFilter}`),
    since
  ).first<{ n: number }>()
  const expirations = expired?.n ?? 0

  // Churn：窗口内结束的订阅（expired/revoked 且 updated_at 落在窗口），主动 = VOLUNTARY
  const churned = await bind(
    db.prepare(
      `SELECT SUM(CASE WHEN expiration_intent = 'VOLUNTARY' THEN 1 ELSE 0 END) AS voluntary,
              COUNT(*) AS total
       FROM subscriptions
       WHERE status IN ('expired', 'revoked') AND updated_at >= ? ${appFilter}`
    ),
    since
  ).first<{ voluntary: number | null; total: number }>()
  const churnedTotal = churned?.total ?? 0
  const churnedVoluntary = churned?.voluntary ?? 0

  // 窗口起点活跃数：区间法（与 rollup 同口径）
  const atStart = await bind(
    db.prepare(
      `SELECT COUNT(*) AS n FROM subscriptions
       WHERE status != 'revoked' AND started_at IS NOT NULL AND started_at < ?
         AND (expires_at IS NULL OR expires_at > ?) ${appFilter}`
    ),
    since,
    since
  ).first<{ n: number }>()
  // 起点活跃 + 窗口内结束的才是完整分母基数
  const activeAtStart = (atStart?.n ?? 0) + churnedTotal

  const refundsRow = await bind(
    db.prepare(`SELECT COUNT(*) AS n FROM notifications_raw WHERE type = 'REFUND' AND received_at >= ? ${appFilter}`),
    since
  ).first<{ n: number }>()
  const purchasesRow = await bind(
    db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE purchase_date >= ? AND ${REVENUE_COND} ${appFilter}`),
    since
  ).first<{ n: number }>()
  const refunds = refundsRow?.n ?? 0
  const purchases = purchasesRow?.n ?? 0

  return {
    windowDays: days,
    renewals,
    firstRenewals,
    repeatRenewals: renewals - firstRenewals,
    expirations,
    renewalRate: renewals + expirations > 0 ? renewals / (renewals + expirations) : null,
    churnedVoluntary,
    churnedInvoluntary: churnedTotal - churnedVoluntary,
    activeAtStart,
    churnRate: activeAtStart > 0 ? churnedTotal / activeAtStart : null,
    refunds,
    purchases,
    refundRate: purchases > 0 ? refunds / purchases : null,
  }
}

export interface TrialCohort {
  /** 周一（UTC）日期 YYYY-MM-DD */
  weekStart: string
  starts: number
  converted: number
  rate: number
}

/** Trial 转化漏斗：按开始试用的周 cohort */
export async function trialCohorts(db: D1Database, weeks = 12, appId?: number): Promise<TrialCohort[]> {
  const since = Date.now() - weeks * 7 * 86400_000
  const rows = await (appId
    ? db.prepare('SELECT trial_started_at, converted_at FROM subscriptions WHERE trial_started_at >= ? AND app_id = ?').bind(since, appId)
    : db.prepare('SELECT trial_started_at, converted_at FROM subscriptions WHERE trial_started_at >= ?').bind(since)
  ).all<{ trial_started_at: number; converted_at: number | null }>()

  const byWeek = new Map<string, { starts: number; converted: number }>()
  for (const r of rows.results) {
    const d = new Date(r.trial_started_at)
    // 周一为一周起点（UTC）
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)))
    const key = monday.toISOString().slice(0, 10)
    const agg = byWeek.get(key) ?? { starts: 0, converted: 0 }
    agg.starts++
    if (r.converted_at != null) agg.converted++
    byWeek.set(key, agg)
  }
  return [...byWeek.entries()]
    .map(([weekStart, v]) => ({ weekStart, ...v, rate: v.starts > 0 ? v.converted / v.starts : 0 }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface BreakdownRow {
  key: string
  /** 产品维度：products 表的名称（无则回落 key） */
  label: string | null
  usdMilli: number
  count: number
}

/** 收入维度切分（国家/产品），事件口径·客户价；估算净得由前端 ×proceeds_rate 换算 */
export async function revenueBreakdown(
  db: D1Database,
  by: 'country' | 'product',
  days = 30,
  appId?: number
): Promise<BreakdownRow[]> {
  const fx = await fxRates(db)
  const since = Date.now() - days * 86400_000
  const col = by === 'country' ? 't.country' : 't.product_id'
  const appFilter = appId ? 'AND t.app_id = ?' : ''
  const nameCol = by === 'product' ? 'p.name' : 'NULL'
  const join = by === 'product' ? 'LEFT JOIN products p ON p.product_id = t.product_id' : ''
  const rows = await (appId
    ? db.prepare(
        `SELECT ${col} AS k, ${nameCol} AS label, t.price_milli, t.currency FROM transactions t ${join}
         WHERE t.purchase_date >= ? AND t.refunded = 0 AND ${REVENUE_COND} ${appFilter}`
      ).bind(since, appId)
    : db.prepare(
        `SELECT ${col} AS k, ${nameCol} AS label, t.price_milli, t.currency FROM transactions t ${join}
         WHERE t.purchase_date >= ? AND t.refunded = 0 AND ${REVENUE_COND}`
      ).bind(since)
  ).all<{ k: string | null; label: string | null; price_milli: number | null; currency: string | null }>()

  const agg = new Map<string, { label: string | null; usd: number; count: number }>()
  for (const r of rows.results) {
    const key = r.k ?? '未知'
    const cur = agg.get(key) ?? { label: r.label, usd: 0, count: 0 }
    cur.usd += (r.price_milli ?? 0) * (fx[r.currency ?? 'USD'] ?? 0)
    cur.count++
    agg.set(key, cur)
  }
  return [...agg.entries()]
    .map(([key, v]) => ({ key, label: v.label, usdMilli: Math.round(v.usd), count: v.count }))
    .sort((a, b) => b.usdMilli - a.usdMilli)
    .slice(0, 12)
}
