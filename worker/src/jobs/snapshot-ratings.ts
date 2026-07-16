// 评分快照作业（每日）：各 App × 各国家的评分均值与总数

import { fetchRatingSummary } from '../lib/itunes'

const DEFAULT_COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de']

export async function snapshotRatingsJob(db: D1Database): Promise<void> {
  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  const countriesRow = await db.prepare("SELECT value FROM config WHERE key = 'review_countries'").first<{ value: string }>()
  const countries: string[] = countriesRow ? JSON.parse(countriesRow.value) : DEFAULT_COUNTRIES
  const date = new Date().toISOString().slice(0, 10)

  let requests = 0
  for (const app of apps.results) {
    for (const country of countries) {
      if (++requests > 40) return // 子请求上限保护，明日继续
      try {
        const summary = await fetchRatingSummary(app.asc_app_id, country)
        if (!summary) continue
        await db
          .prepare(
            `INSERT INTO ratings_snapshots (app_id, country, date, avg_rating, ratings_count)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(app_id, country, date) DO UPDATE SET
               avg_rating = excluded.avg_rating, ratings_count = excluded.ratings_count`
          )
          .bind(app.id, country, date, summary.averageUserRating, summary.userRatingCount)
          .run()
      } catch (err) {
        console.error(`snapshot-ratings failed (${app.asc_app_id} ${country}):`, err)
      }
    }
  }
}
