// LTV 月 cohort 物化（weekly cron）：全量重算（单用户数据量小，重算比增量简单可靠）
// cohort = 订阅 started_at 所在 UTC 月；revenue_milli_cum = 该批订阅至今的累计收入（USD 毫）
// D1 成本：2 读 + 1 batch 写 ≈ 3 子请求

import { fxRates, prodOnly } from '../lib/metrics'
import { Budget } from '../lib/budget'

const REVENUE_EVENTS = new Set(['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED'])

export async function rollupCohortsJob(db: D1Database, budget = new Budget(40)): Promise<void> {
  const fx = await fxRates(db)
  budget.spend(1)

  const subs = await db
    .prepare(`SELECT original_transaction_id, app_id, started_at FROM subscriptions
       WHERE started_at IS NOT NULL AND ${prodOnly()}`)
    .all<{ original_transaction_id: string; app_id: number | null; started_at: number }>()
  const txs = await db
    .prepare(
      `SELECT original_transaction_id, price_milli, currency, event_type, event_subtype FROM transactions
       WHERE refunded = 0 AND type = 'Auto-Renewable Subscription' AND ${prodOnly()}`
    )
    .all<{ original_transaction_id: string; price_milli: number | null; currency: string | null; event_type: string; event_subtype: string | null }>()
  budget.spend(2)

  // 每个订阅的累计收入
  const revenueByOtid = new Map<string, number>()
  for (const t of txs.results) {
    const isRevenue = REVENUE_EVENTS.has(t.event_type) || (t.event_type === 'DID_CHANGE_RENEWAL_PREF' && t.event_subtype === 'UPGRADE')
    if (!isRevenue) continue
    const usd = (t.price_milli ?? 0) * (fx[t.currency ?? 'USD'] ?? 0)
    revenueByOtid.set(t.original_transaction_id, (revenueByOtid.get(t.original_transaction_id) ?? 0) + usd)
  }

  // 按 (app, cohort 月) 聚合
  const agg = new Map<string, { appId: number; subs: number; revenue: number }>()
  for (const s of subs.results) {
    if (s.app_id == null) continue
    const month = new Date(s.started_at).toISOString().slice(0, 7)
    const key = `${s.app_id}\t${month}`
    const cur = agg.get(key) ?? { appId: s.app_id, subs: 0, revenue: 0 }
    cur.subs++
    cur.revenue += revenueByOtid.get(s.original_transaction_id) ?? 0
    agg.set(key, cur)
  }

  const stmts = [...agg.entries()].map(([key, v]) => {
    const month = key.split('\t')[1]
    return db
      .prepare(
        `INSERT INTO cohorts (app_id, cohort_month, subs, revenue_milli_cum, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(app_id, cohort_month) DO UPDATE SET
           subs = excluded.subs, revenue_milli_cum = excluded.revenue_milli_cum, updated_at = excluded.updated_at`
      )
      .bind(v.appId, month, v.subs, Math.round(v.revenue), Date.now())
  })
  if (stmts.length) {
    await db.batch(stmts)
    budget.spend(1)
  }
}
