// 每日摘要推送（日报卡片）：昨日收入 / 订阅动态 / 新评论，daily cron 调用
// config.daily_digest = '0' 可关闭；无任何数据时不打扰

import { notify } from './notify'

export async function sendDailyDigest(db: D1Database, yesterdayDate: string): Promise<void> {
  const enabled = await db.prepare("SELECT value FROM config WHERE key = 'daily_digest'").first<{ value: string }>()
  if (enabled?.value === '0') return

  // 昨日指标（rollup 已写入 metrics_daily）
  const m = await db
    .prepare(
      `SELECT SUM(revenue_milli) AS revenue, SUM(new_subs) AS new_subs,
              SUM(renewals) AS renewals, SUM(refunds) AS refunds
       FROM metrics_daily WHERE date = ?`
    )
    .bind(yesterdayDate)
    .first<{ revenue: number | null; new_subs: number | null; renewals: number | null; refunds: number | null }>()

  // 前 7 天日均（不含昨日），用于环比
  const avg = await db
    .prepare(`SELECT AVG(day_total) AS avg FROM (
       SELECT SUM(revenue_milli) AS day_total FROM metrics_daily
       WHERE date < ? AND date >= date(?, '-7 days') GROUP BY date)`)
    .bind(yesterdayDate, yesterdayDate)
    .first<{ avg: number | null }>()

  // 昨日新评论
  const dayStart = Date.parse(`${yesterdayDate}T00:00:00Z`)
  const r = await db
    .prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE created_at >= ? AND created_at < ?')
    .bind(dayStart, dayStart + 86400_000)
    .first<{ n: number; avg: number | null }>()

  const revenue = m?.revenue ?? 0
  const hasActivity = revenue > 0 || (m?.new_subs ?? 0) > 0 || (m?.refunds ?? 0) > 0 || (r?.n ?? 0) > 0
  if (!hasActivity) return // 完全没动静就不推

  const lines: string[] = []

  let revLine = `💰 收入 $${(revenue / 1000).toFixed(2)}`
  if (avg?.avg && avg.avg > 0) {
    const pct = ((revenue - avg.avg) / avg.avg) * 100
    revLine += `（较 7 日均值 ${pct >= 0 ? '↑' : '↓'}${Math.abs(pct).toFixed(0)}%）`
  }
  lines.push(revLine)

  const subParts: string[] = []
  if (m?.new_subs) subParts.push(`🆕 新订 ${m.new_subs}`)
  if (m?.renewals) subParts.push(`♻️ 续费 ${m.renewals}`)
  if (m?.refunds) subParts.push(`⚠️ 退款 ${m.refunds}`)
  if (subParts.length) lines.push(subParts.join(' · '))

  if (r?.n) lines.push(`💬 新评论 ${r.n} 条，均分 ${(r.avg ?? 0).toFixed(1)} ★`)

  const [, mo, d] = yesterdayDate.split('-')
  await notify(db, 'daily_digest', `📊 昨日日报 · ${Number(mo)}月${Number(d)}日`, lines.join('\n'))
}
