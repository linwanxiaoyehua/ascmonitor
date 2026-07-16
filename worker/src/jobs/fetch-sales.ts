// ASC 销售报告抓取（每日 cron + 手动触发回填）
// 报告约有 1 天延迟；从昨天起往前补，最多回填 30 天，已入库的日期跳过

import { loadAscCredentials, fetchSalesReport } from '../lib/asc-api'

const BACKFILL_DAYS = 30
const MAX_REPORTS_PER_RUN = 25 // 子请求预算保护

function dateStr(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86400_000).toISOString().slice(0, 10)
}

export async function fetchSalesJob(db: D1Database): Promise<{ fetched: number; skipped: string }> {
  const creds = await loadAscCredentials(db)
  if (!creds) return { fetched: 0, skipped: 'ASC 凭证未配置（Key ID / Issuer ID / 私钥）' }
  const vendorRow = await db.prepare("SELECT value FROM config WHERE key = 'asc_vendor_number'").first<{ value: string }>()
  if (!vendorRow?.value?.trim()) {
    return { fetched: 0, skipped: '缺少 Vendor Number：登录 App Store Connect → 付款与财务报告，页面左上角的 8 开头数字，填入设置页保存后重试' }
  }
  const vendor = vendorRow.value.trim()

  // 已入库日期 + 确认过无数据的日期都跳过
  const doneRows = await db.prepare('SELECT DISTINCT date FROM sales_daily').all<{ date: string }>()
  const done = new Set(doneRows.results.map((r) => r.date))
  const emptyRow = await db.prepare("SELECT value FROM config WHERE key = 'sales_empty_dates'").first<{ value: string }>()
  const emptyDates = new Set<string>(emptyRow ? JSON.parse(emptyRow.value) : [])

  let fetched = 0
  for (let d = 1; d <= BACKFILL_DAYS && fetched < MAX_REPORTS_PER_RUN; d++) {
    const date = dateStr(d)
    if (done.has(date) || emptyDates.has(date)) continue

    const rows = await fetchSalesReport(creds, vendor, date)
    fetched++
    if (rows === null || rows.length === 0) {
      // 昨天的报告可能还没出，之前的日期则是确实无销售
      if (d > 1) emptyDates.add(date)
      continue
    }

    // 按 (apple_id, country, type, currency) 聚合入库
    const agg = new Map<string, { units: number; proceeds: number }>()
    for (const r of rows) {
      const key = `${r.appleId}\t${r.country}\t${r.productType}\t${r.currency}`
      const cur = agg.get(key) ?? { units: 0, proceeds: 0 }
      cur.units += r.units
      cur.proceeds += r.developerProceeds * r.units
      agg.set(key, cur)
    }
    for (const [key, v] of agg) {
      const [appleId, country, productType, currency] = key.split('\t')
      await db
        .prepare(
          `INSERT INTO sales_daily (date, apple_id, country, product_type, units, proceeds_milli, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(date, apple_id, country, product_type, currency) DO UPDATE SET
             units = excluded.units, proceeds_milli = excluded.proceeds_milli`
        )
        .bind(date, appleId, country, productType, v.units, Math.round(v.proceeds * 1000), currency)
        .run()
    }
  }

  // 保留最近 60 天的空日期标记，防止无限增长
  const cutoff = dateStr(60)
  await db
    .prepare("INSERT INTO config (key, value) VALUES ('sales_empty_dates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify([...emptyDates].filter((d) => d >= cutoff)))
    .run()

  return { fetched, skipped: '' }
}
