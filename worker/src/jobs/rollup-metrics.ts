// 历史指标重算：对「有交易的每一天」跑 rollupDaily，重建 metrics_daily
// （reprocess 只重建 transactions/subscriptions，不碰 metrics_daily —— 曲线/当月收入靠这里补）
// 按天游标分片（config.metrics_rollup_cursor），前端循环调用直到 done。预算友好。

import { rollupDaily } from '../lib/metrics'
import { Budget } from '../lib/budget'

export async function rollupMetricsJob(
  db: D1Database,
  reset = false,
  budget = new Budget(45)
): Promise<{ processed: number; done: boolean; remaining: number }> {
  if (reset) {
    await db.prepare("DELETE FROM config WHERE key = 'metrics_rollup_cursor'").run()
    budget.spend(1)
  }

  const appRow = await db.prepare('SELECT COUNT(*) AS n FROM apps').first<{ n: number }>()
  budget.spend(1)
  const appCount = Math.max(1, appRow?.n ?? 1)
  // rollupDaily 每天约 fx(1)+apps(1)+每 App(tx+conv+subs+snapshot+upsert≈5) 个子请求
  const perDate = 3 + appCount * 5

  const cursorRow = reset ? null : await db.prepare("SELECT value FROM config WHERE key = 'metrics_rollup_cursor'").first<{ value: string }>()
  budget.spend(1)
  const cursor = cursorRow?.value ?? ''

  // 只取「有交易且晚于游标」的自然日（UTC），避免空跑。
  // 这里刻意不排除沙盒：只有沙盒交易的那天同样要进列表，
  // 才能被 rollupDaily（内部已过滤沙盒）重算成 0 —— 否则旧的含沙盒值会永远残留。
  const dateRows = await db
    .prepare(
      `SELECT DISTINCT date(purchase_date / 1000, 'unixepoch') AS d FROM transactions
       WHERE purchase_date IS NOT NULL AND date(purchase_date / 1000, 'unixepoch') > ?
       ORDER BY d`
    )
    .bind(cursor)
    .all<{ d: string }>()
  budget.spend(1)
  const dates = dateRows.results.map((r) => r.d)

  if (!dates.length) {
    await db.prepare("DELETE FROM config WHERE key = 'metrics_rollup_cursor'").run()
    budget.spend(1)
    return { processed: 0, done: true, remaining: 0 }
  }

  let processed = 0
  let last = cursor
  for (const d of dates) {
    if (budget.remaining <= perDate) break
    await rollupDaily(db, d)
    budget.spend(perDate)
    processed++
    last = d
  }

  const done = processed === dates.length
  if (done) {
    await db.prepare("DELETE FROM config WHERE key = 'metrics_rollup_cursor'").run()
  } else {
    await db
      .prepare("INSERT INTO config (key, value) VALUES ('metrics_rollup_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(last)
      .run()
  }
  budget.spend(1)

  return { processed, done, remaining: done ? 0 : dates.length - processed }
}
