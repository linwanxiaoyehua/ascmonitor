// ASC 销售报告抓取（每日 cron + 手动触发回填）
// 报告约有 1 天延迟；从昨天起往前补，最多回填 30 天，已入库的日期跳过
// 预算共享：每份报告 fetch 1 + batch 入库 1；超预算下轮续跑（done-set 幂等）

import { loadAscCredentials, fetchSalesReport, fetchSubscriptionReport, type AscCredentials } from '../lib/asc-api'
import { Budget } from '../lib/budget'

// 账单报告回填窗口：ASC 最早可取约一年内。历史收入曲线用它，故拉深到一年。
// 预算分片 + 已入库/空日期缓存：单次只补一部分，多次触发（或每日 cron）逐步填满。
const BACKFILL_DAYS = 365

function dateStr(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86400_000).toISOString().slice(0, 10)
}

export async function fetchSalesJob(db: D1Database, budget = new Budget(40)): Promise<{ fetched: number; skipped: string }> {
  const creds = await loadAscCredentials(db)
  budget.spend(1)
  if (!creds) return { fetched: 0, skipped: 'ASC 凭证未配置（Key ID / Issuer ID / 私钥）' }
  const vendorRow = await db.prepare("SELECT value FROM config WHERE key = 'asc_vendor_number'").first<{ value: string }>()
  budget.spend(1)
  if (!vendorRow?.value?.trim()) {
    return { fetched: 0, skipped: '缺少 Vendor Number：登录 App Store Connect → 付款与财务报告，页面左上角的 8 开头数字，填入设置页保存后重试' }
  }
  const vendor = vendorRow.value.trim()

  // 已入库日期 + 确认过无数据的日期都跳过
  const doneRows = await db.prepare('SELECT DISTINCT date FROM sales_daily').all<{ date: string }>()
  const done = new Set(doneRows.results.map((r) => r.date))
  const emptyRow = await db.prepare("SELECT value FROM config WHERE key = 'sales_empty_dates'").first<{ value: string }>()
  budget.spend(2)
  const emptyDates = new Set<string>(emptyRow ? JSON.parse(emptyRow.value) : [])

  let fetched = 0
  for (let d = 1; d <= BACKFILL_DAYS && budget.remaining > 4; d++) {
    const date = dateStr(d)
    if (done.has(date) || emptyDates.has(date)) continue

    const rows = await fetchSalesReport(creds, vendor, date)
    budget.spend(1)
    fetched++
    if (rows === null || rows.length === 0) {
      // 昨天的报告可能还没出，之前的日期则是确实无销售
      if (d > 1) emptyDates.add(date)
      continue
    }

    // 按 (apple_id, country, type, currency) 聚合，整日一个 batch 入库（计 1 子请求）
    const agg = new Map<string, { units: number; proceeds: number }>()
    for (const r of rows) {
      const key = `${r.appleId}\t${r.country}\t${r.productType}\t${r.currency}`
      const cur = agg.get(key) ?? { units: 0, proceeds: 0 }
      cur.units += r.units
      cur.proceeds += r.developerProceeds * r.units
      agg.set(key, cur)
    }
    const stmts = [...agg.entries()].map(([key, v]) => {
      const [appleId, country, productType, currency] = key.split('\t')
      return db
        .prepare(
          `INSERT INTO sales_daily (date, apple_id, country, product_type, units, proceeds_milli, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(date, apple_id, country, product_type, currency) DO UPDATE SET
             units = excluded.units, proceeds_milli = excluded.proceeds_milli`
        )
        .bind(date, appleId, country, productType, v.units, Math.round(v.proceeds * 1000), currency)
    })
    if (stmts.length) {
      await db.batch(stmts)
      budget.spend(1)
    }
  }

  // 订阅状态快照：取最近一份可用的（报告约 1 天延迟，最多回看 3 天）
  if (!budget.exhausted) await fetchSubsSnapshot(db, creds, vendor, budget)

  // 保留最近 60 天的空日期标记，防止无限增长
  const cutoff = dateStr(60)
  await db
    .prepare("INSERT INTO config (key, value) VALUES ('sales_empty_dates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify([...emptyDates].filter((d) => d >= cutoff)))
    .run()
  budget.spend(1)

  return { fetched, skipped: '' }
}

async function fetchSubsSnapshot(db: D1Database, creds: AscCredentials, vendor: string, budget: Budget): Promise<void> {
  for (let d = 1; d <= 3 && budget.remaining > 3; d++) {
    const date = dateStr(d)
    const exists = await db.prepare('SELECT 1 FROM subs_snapshot_daily WHERE date = ? LIMIT 1').bind(date).first()
    budget.spend(1)
    if (exists) return
    try {
      const rows = await fetchSubscriptionReport(creds, vendor, date)
      budget.spend(1)
      if (!rows?.length) continue
      const stmts = rows.map((r) =>
        db
          .prepare(
            `INSERT INTO subs_snapshot_daily (date, apple_id, subscription_name, active, trials)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(date, apple_id, subscription_name) DO UPDATE SET
               active = excluded.active, trials = excluded.trials`
          )
          .bind(date, r.appAppleId, r.subscriptionName, r.activeStandard + r.activeIntroPaid, r.activeTrial)
      )
      await db.batch(stmts)
      budget.spend(1)
      return
    } catch (err) {
      budget.spend(1)
      console.error(`subs snapshot ${date} failed:`, err)
    }
  }
}
