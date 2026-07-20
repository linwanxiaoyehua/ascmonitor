// 指标聚合计算。多币种统一折算 USD：
//   汇率合并顺序 DEFAULT < fx_rates_auto（daily cron 自动拉取）< fx_rates（手动覆盖）
// 收入口径（REVENUE_COND）：SUBSCRIBED / DID_RENEW / ONE_TIME_CHARGE / OFFER_REDEEMED
//   + 升级立即扣款（DID_CHANGE_RENEWAL_PREF + UPGRADE）

const DEFAULT_FX_TO_USD: Record<string, number> = {
  USD: 1, EUR: 1.09, GBP: 1.27, JPY: 0.0066, CNY: 0.14, HKD: 0.128, TWD: 0.031,
  KRW: 0.00073, CAD: 0.73, AUD: 0.66, INR: 0.012, BRL: 0.18, RUB: 0.011, MXN: 0.055,
}

const PERIOD_MONTHS: Record<string, number> = { P1W: 0.23, P1M: 1, P3M: 3, P6M: 6, P1Y: 12 }

export async function fxRates(db: D1Database): Promise<Record<string, number>> {
  const rows = await db
    .prepare("SELECT key, value FROM config WHERE key IN ('fx_rates', 'fx_rates_auto')")
    .all<{ key: string; value: string }>()
  const auto = rows.results.find((r) => r.key === 'fx_rates_auto')
  const manual = rows.results.find((r) => r.key === 'fx_rates')
  return {
    ...DEFAULT_FX_TO_USD,
    ...(auto ? JSON.parse(auto.value) : {}),
    ...(manual ? JSON.parse(manual.value) : {}), // 手动覆盖优先
  }
}

/** daily cron：拉取最新汇率（X→USD 系数）。失败静默沿用上次快照 */
export async function updateFxRates(db: D1Database): Promise<boolean> {
  const sources: Array<() => Promise<Record<string, number>>> = [
    // 主源：免费无 key、160+ 币种、日更；rates 是 USD→X，取倒数
    async () => {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
      if (json.result !== 'success' || !json.rates) throw new Error('er-api failed')
      return invertRates(json.rates)
    },
    // 备源：jsDelivr CDN 上的 currency-api（键为小写）
    async () => {
      const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')
      const json = (await res.json()) as { usd?: Record<string, number> }
      if (!json.usd) throw new Error('currency-api failed')
      return invertRates(Object.fromEntries(Object.entries(json.usd).map(([k, v]) => [k.toUpperCase(), v])))
    },
  ]
  for (const source of sources) {
    try {
      const rates = await source()
      if (Object.keys(rates).length < 20) continue // 数据可疑，换源
      await db.batch([
        db.prepare("INSERT INTO config (key, value) VALUES ('fx_rates_auto', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(rates)),
        db.prepare("INSERT INTO config (key, value) VALUES ('fx_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Date.now())),
      ])
      return true
    } catch (err) {
      console.error('fx source failed:', err)
    }
  }
  return false
}

function invertRates(usdToX: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [code, rate] of Object.entries(usdToX)) {
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      out[code] = 1 / rate
    }
  }
  return out
}

export function toUsd(priceMilli: number | null, currency: string | null, fx: Record<string, number>): number {
  if (priceMilli == null) return 0
  return priceMilli * (fx[currency ?? 'USD'] ?? 0)
}

function utcDayStart(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function utcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** 产生收入的交易条件（含升级立即扣款） */
const REVENUE_COND = `(event_type IN ('SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE', 'OFFER_REDEEMED')
  OR (event_type = 'DID_CHANGE_RENEWAL_PREF' AND event_subtype = 'UPGRADE'))`

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
       WHERE purchase_date >= ? AND ${REVENUE_COND} ${appFilter}`
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

  // 今日新评论（排除双源重复）
  const todayReviews = await bindApp(
    db.prepare(`SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE created_at >= ? AND dup_of IS NULL ${appFilter}`),
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

/**
 * 每日快照物化（cron daily 调用，date 为要快照的 UTC 日期）。
 * active_subs / mrr 按区间重建（started_at ≤ 日末 且未到期），可安全回填历史日期；
 * 有 ASC 订阅快照的日期以快照为准。禁止用「当前时刻」的值覆写历史。
 */
export async function rollupDaily(db: D1Database, date: string): Promise<void> {
  const fx = await fxRates(db)
  const dayStart = Date.parse(`${date}T00:00:00Z`)
  const dayEnd = dayStart + 86400_000

  const apps = await db.prepare('SELECT id, asc_app_id FROM apps').all<{ id: number; asc_app_id: string | null }>()
  for (const app of apps.results) {
    // 1. 当日交易聚合：收入 / 新订 / 续费 / 退款 / 试用开始
    const tx = await db
      .prepare(
        `SELECT price_milli, currency, refunded, event_type, event_subtype, is_trial FROM transactions
         WHERE app_id = ? AND purchase_date >= ? AND purchase_date < ?`
      )
      .bind(app.id, dayStart, dayEnd)
      .all<{ price_milli: number | null; currency: string | null; refunded: number; event_type: string; event_subtype: string | null; is_trial: number }>()

    let revenue = 0
    let newSubs = 0
    let renewals = 0
    let refunds = 0
    let trialStarts = 0
    for (const t of tx.results) {
      const isRevenue =
        ['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE', 'OFFER_REDEEMED'].includes(t.event_type) ||
        (t.event_type === 'DID_CHANGE_RENEWAL_PREF' && t.event_subtype === 'UPGRADE')
      if (t.event_type === 'REFUND' || t.refunded) refunds++
      else if (isRevenue) {
        revenue += toUsd(t.price_milli, t.currency, fx)
        if (t.event_type === 'SUBSCRIBED') {
          newSubs++
          if (t.is_trial) trialStarts++
        }
        if (t.event_type === 'DID_RENEW') renewals++
      }
    }

    // 2. 试用转正（converted_at 落在当日）
    const conversions = await db
      .prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE app_id = ? AND converted_at >= ? AND converted_at < ?')
      .bind(app.id, dayStart, dayEnd)
      .first<{ n: number }>()

    // 3. 当日活跃订阅 / MRR：按区间重建（该日结束时仍在有效期内的订阅）
    const subs = await db
      .prepare(
        `SELECT period, price_milli, currency, trial_started_at, converted_at FROM subscriptions
         WHERE app_id = ? AND status != 'revoked'
           AND started_at IS NOT NULL AND started_at < ?
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .bind(app.id, dayEnd, dayEnd)
      .all<{ period: string | null; price_milli: number | null; currency: string | null; trial_started_at: number | null; converted_at: number | null }>()

    let activeSubs = 0
    let mrr = 0
    for (const s of subs.results) {
      // 该日仍处于试用期的不计 active / MRR
      const trialOnDay =
        s.trial_started_at != null && s.trial_started_at < dayEnd && (s.converted_at == null || s.converted_at > dayEnd)
      if (trialOnDay) continue
      activeSubs++
      mrr += toUsd(s.price_milli, s.currency, fx) / (PERIOD_MONTHS[s.period ?? 'P1M'] ?? 1)
    }

    // 有 ASC 订阅快照的日期以快照为准（webhook 上线前的存量补全）
    if (app.asc_app_id) {
      const snapshot = await db
        .prepare('SELECT SUM(active) AS active FROM subs_snapshot_daily WHERE date = ? AND apple_id = ?')
        .bind(date, app.asc_app_id)
        .first<{ active: number | null }>()
      if (snapshot?.active != null && snapshot.active > activeSubs) activeSubs = snapshot.active
    }

    await db
      .prepare(
        `INSERT INTO metrics_daily (app_id, date, revenue_milli, new_subs, renewals, refunds, active_subs, mrr_milli, trial_starts, trial_conversions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, date) DO UPDATE SET
           revenue_milli = excluded.revenue_milli, new_subs = excluded.new_subs,
           renewals = excluded.renewals, refunds = excluded.refunds,
           active_subs = excluded.active_subs, mrr_milli = excluded.mrr_milli,
           trial_starts = excluded.trial_starts, trial_conversions = excluded.trial_conversions`
      )
      .bind(app.id, date, Math.round(revenue), newSubs, renewals, refunds, activeSubs, Math.round(mrr), trialStarts, conversions?.n ?? 0)
      .run()
  }
}
