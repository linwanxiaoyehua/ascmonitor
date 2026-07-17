// 指标聚合计算。多币种统一折算 USD（汇率表存 config.fx_rates，可自行更新）

const DEFAULT_FX_TO_USD: Record<string, number> = {
  USD: 1, EUR: 1.09, GBP: 1.27, JPY: 0.0066, CNY: 0.14, HKD: 0.128, TWD: 0.031,
  KRW: 0.00073, CAD: 0.73, AUD: 0.66, INR: 0.012, BRL: 0.18, RUB: 0.011, MXN: 0.055,
}

const PERIOD_MONTHS: Record<string, number> = { P1W: 0.23, P1M: 1, P3M: 3, P6M: 6, P1Y: 12 }

export async function fxRates(db: D1Database): Promise<Record<string, number>> {
  const row = await db.prepare("SELECT value FROM config WHERE key = 'fx_rates'").first<{ value: string }>()
  return row ? { ...DEFAULT_FX_TO_USD, ...JSON.parse(row.value) } : DEFAULT_FX_TO_USD
}

function toUsd(priceMilli: number | null, currency: string | null, fx: Record<string, number>): number {
  if (priceMilli == null) return 0
  return priceMilli * (fx[currency ?? 'USD'] ?? 0)
}

function utcDayStart(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function utcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

const REVENUE_EVENTS = "('SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE')"

export interface Overview {
  todayRevenueUsdMilli: number
  mrrUsdMilli: number
  activeSubs: number
  trialSubs: number
  todayNewSubs: number
  todayRenewals: number
  todayRefunds: number
  autoRenewOffCount: number
  /** 宽限期 + 扣款重试中的订阅数（即将被动流失） */
  riskSubs: number
  /** 今日新评论数与均分 */
  todayReviews: number
  todayReviewAvg: number | null
}

export async function getOverview(db: D1Database, appId?: number): Promise<Overview> {
  const fx = await fxRates(db)
  const dayStart = utcDayStart()
  const appFilter = appId ? 'AND app_id = ?' : ''
  const bindApp = (stmt: D1PreparedStatement, ...args: unknown[]) =>
    appId ? stmt.bind(...args, appId) : stmt.bind(...args)

  // 今日收入交易（净额：扣除今日退款）
  const todayTx = await bindApp(
    db.prepare(
      `SELECT price_milli, currency, refunded, event_type FROM transactions
       WHERE purchase_date >= ? AND event_type IN ${REVENUE_EVENTS} ${appFilter}`
    ),
    dayStart
  ).all<{ price_milli: number | null; currency: string | null; refunded: number; event_type: string }>()

  let todayRevenue = 0
  let todayNewSubs = 0
  let todayRenewals = 0
  for (const t of todayTx.results) {
    if (!t.refunded) todayRevenue += toUsd(t.price_milli, t.currency, fx)
    if (t.event_type === 'SUBSCRIBED') todayNewSubs++
    if (t.event_type === 'DID_RENEW') todayRenewals++
  }

  const todayRefunds = await bindApp(
    db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE event_type = 'REFUND' AND raw_uuid IN
      (SELECT uuid FROM notifications_raw WHERE received_at >= ?) ${appFilter}`),
    dayStart
  ).first<{ n: number }>()

  // MRR：active/grace/billing_retry 的订阅按月度化价格折算
  const activeRows = await bindApp(
    db.prepare(
      `SELECT status, period, price_milli, currency, auto_renew FROM subscriptions
       WHERE status IN ('trial', 'active', 'grace_period', 'billing_retry') ${appFilter}`
    )
  ).all<{ status: string; period: string | null; price_milli: number | null; currency: string | null; auto_renew: number }>()

  let mrr = 0
  let activeSubs = 0
  let trialSubs = 0
  let autoRenewOff = 0
  let riskSubs = 0
  for (const s of activeRows.results) {
    if (s.status === 'trial') trialSubs++
    else activeSubs++
    if (!s.auto_renew) autoRenewOff++
    if (s.status === 'grace_period' || s.status === 'billing_retry') riskSubs++
    if (s.status !== 'trial') {
      mrr += toUsd(s.price_milli, s.currency, fx) / (PERIOD_MONTHS[s.period ?? 'P1M'] ?? 1)
    }
  }

  // 今日新评论（按抓取到的 created_at 计）
  const todayReviews = await bindApp(
    db.prepare(`SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE created_at >= ? ${appFilter}`),
    dayStart
  ).first<{ n: number; avg: number | null }>()

  return {
    todayRevenueUsdMilli: Math.round(todayRevenue),
    mrrUsdMilli: Math.round(mrr),
    activeSubs,
    trialSubs,
    todayNewSubs,
    todayRenewals,
    todayRefunds: todayRefunds?.n ?? 0,
    autoRenewOffCount: autoRenewOff,
    riskSubs,
    todayReviews: todayReviews?.n ?? 0,
    todayReviewAvg: todayReviews?.avg ?? null,
  }
}

/** 每日快照物化（cron daily 调用，date 为要快照的 UTC 日期） */
export async function rollupDaily(db: D1Database, date: string): Promise<void> {
  const fx = await fxRates(db)
  const dayStart = Date.parse(`${date}T00:00:00Z`)
  const dayEnd = dayStart + 86400_000

  const apps = await db.prepare('SELECT id FROM apps').all<{ id: number }>()
  for (const app of apps.results) {
    const tx = await db
      .prepare(
        `SELECT price_milli, currency, refunded, event_type FROM transactions
         WHERE app_id = ? AND purchase_date >= ? AND purchase_date < ?`
      )
      .bind(app.id, dayStart, dayEnd)
      .all<{ price_milli: number | null; currency: string | null; refunded: number; event_type: string }>()

    let revenue = 0
    let newSubs = 0
    let renewals = 0
    let refunds = 0
    for (const t of tx.results) {
      if (t.event_type === 'REFUND' || t.refunded) refunds++
      else if (['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE'].includes(t.event_type)) {
        revenue += toUsd(t.price_milli, t.currency, fx)
        if (t.event_type === 'SUBSCRIBED') newSubs++
        if (t.event_type === 'DID_RENEW') renewals++
      }
    }

    const overview = await getOverview(db, app.id)
    await db
      .prepare(
        `INSERT INTO metrics_daily (app_id, date, revenue_milli, new_subs, renewals, refunds, active_subs, mrr_milli)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, date) DO UPDATE SET
           revenue_milli = excluded.revenue_milli, new_subs = excluded.new_subs,
           renewals = excluded.renewals, refunds = excluded.refunds,
           active_subs = excluded.active_subs, mrr_milli = excluded.mrr_milli`
      )
      .bind(app.id, date, Math.round(revenue), newSubs, renewals, refunds, overview.activeSubs, overview.mrrUsdMilli)
      .run()
  }
}
