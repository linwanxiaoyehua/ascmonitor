// 告警规则引擎 v1
// 规则类型：new_bad_review（新差评即时告警）| bad_review_rate（24h 差评率）
//         | revenue_drop（日收入低于 7 日均值）| webhook_silent（管道自检）

import { notify } from './notify'

export interface AlertRule {
  id: number
  app_id: number | null
  kind: string
  params_json: string
  channels_json: string
  silence_min: number
  enabled: number
  last_fired_at: number | null
}

async function fire(db: D1Database, rule: AlertRule, title: string, body: string): Promise<void> {
  const now = Date.now()
  if (rule.last_fired_at && now - rule.last_fired_at < rule.silence_min * 60_000) return // 静默期内
  await db.prepare('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?').bind(now, rule.id).run()
  await notify(db, rule.kind, title, body, rule.id)

  // Telegram 可选渠道
  const channels: string[] = JSON.parse(rule.channels_json)
  if (channels.includes('telegram')) {
    const tg = await db.prepare("SELECT value FROM config WHERE key = 'telegram'").first<{ value: string }>()
    if (tg) {
      const { botToken, chatId } = JSON.parse(tg.value)
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `${title}\n${body}` }),
      }).catch(() => {})
    }
  }
}

async function rulesOf(db: D1Database, kind: string): Promise<AlertRule[]> {
  const rows = await db.prepare('SELECT * FROM alert_rules WHERE kind = ? AND enabled = 1').bind(kind).all<AlertRule>()
  return rows.results
}

/** 新评论入库时调用（fetch-reviews 作业内） */
export async function evaluateNewReview(
  db: D1Database,
  review: { app_id: number; rating: number; country: string | null; title: string; body: string }
): Promise<void> {
  for (const rule of await rulesOf(db, 'new_bad_review')) {
    if (rule.app_id && rule.app_id !== review.app_id) continue
    const params = JSON.parse(rule.params_json) as { max_rating?: number }
    if (review.rating > (params.max_rating ?? 2)) continue
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)
    await fire(db, rule, `😞 新差评 ${stars}`, `[${review.country ?? '?'}] ${review.title}\n${review.body.slice(0, 200)}`)
  }
}

/** 每 15 分钟评估：差评率 + Webhook 静默 */
export async function evaluateFrequent(db: D1Database): Promise<void> {
  const now = Date.now()

  for (const rule of await rulesOf(db, 'bad_review_rate')) {
    const params = JSON.parse(rule.params_json) as { threshold_pct?: number; min_count?: number; max_rating?: number }
    const since = now - 86400_000
    const appFilter = rule.app_id ? 'AND app_id = ?' : ''
    const stmt = db.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN rating <= ? THEN 1 ELSE 0 END) AS bad
       FROM reviews WHERE fetched_at >= ? ${appFilter}`
    )
    const row = await (rule.app_id
      ? stmt.bind(params.max_rating ?? 2, since, rule.app_id)
      : stmt.bind(params.max_rating ?? 2, since)
    ).first<{ total: number; bad: number }>()
    if (!row || row.total < (params.min_count ?? 5)) continue
    const pct = (row.bad / row.total) * 100
    if (pct >= (params.threshold_pct ?? 30)) {
      await fire(db, rule, '📉 差评率告警', `24h 内 ${row.total} 条评论中 ${row.bad} 条差评（${pct.toFixed(0)}%）`)
    }
  }

  for (const rule of await rulesOf(db, 'webhook_silent')) {
    const params = JSON.parse(rule.params_json) as { hours?: number }
    const last = await db
      .prepare('SELECT MAX(received_at) AS t FROM notifications_raw')
      .first<{ t: number | null }>()
    if (!last?.t) continue // 从未收到过，不告警
    const silentHours = (now - last.t) / 3600_000
    if (silentHours >= (params.hours ?? 24)) {
      await fire(db, rule, '🔇 Webhook 静默', `已 ${silentHours.toFixed(1)} 小时未收到 App Store 通知，请检查配置`)
    }
  }
}

/** 每日 rollup 后评估：收入下降（比较昨天与之前 7 天均值） */
export async function evaluateDaily(db: D1Database, yesterdayDate: string): Promise<void> {
  for (const rule of await rulesOf(db, 'revenue_drop')) {
    const params = JSON.parse(rule.params_json) as { drop_pct?: number }
    const appFilter = rule.app_id ? 'AND app_id = ?' : ''
    const stmt = db.prepare(
      `SELECT
         SUM(CASE WHEN date = ? THEN revenue_milli ELSE 0 END) AS yesterday,
         AVG(CASE WHEN date < ? THEN revenue_milli END) AS avg7
       FROM metrics_daily WHERE date >= date(?, '-7 days') AND date <= ? ${appFilter}`
    )
    const row = await (rule.app_id
      ? stmt.bind(yesterdayDate, yesterdayDate, yesterdayDate, yesterdayDate, rule.app_id)
      : stmt.bind(yesterdayDate, yesterdayDate, yesterdayDate, yesterdayDate)
    ).first<{ yesterday: number | null; avg7: number | null }>()
    if (!row || row.avg7 == null || row.avg7 <= 0) continue
    const dropPct = (1 - (row.yesterday ?? 0) / row.avg7) * 100
    if (dropPct >= (params.drop_pct ?? 30)) {
      await fire(
        db,
        rule,
        '🚨 收入下降',
        `${yesterdayDate} 收入 $${(((row.yesterday ?? 0)) / 1000).toFixed(2)}，较 7 日均值下降 ${dropPct.toFixed(0)}%`
      )
    }
  }
}
