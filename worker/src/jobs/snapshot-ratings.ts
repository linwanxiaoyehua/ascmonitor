// 评分快照作业（每日）：各 App × 各国家的评分均值与总数
// 预算共享：外部 Lookup 1 + 入库 1 每单元

import { fetchRatingSummary } from '../lib/itunes'
import { Budget } from '../lib/budget'

const DEFAULT_COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de']

export async function snapshotRatingsJob(db: D1Database, budget = new Budget(40)): Promise<void> {
  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  const countriesRow = await db.prepare("SELECT value FROM config WHERE key = 'review_countries'").first<{ value: string }>()
  budget.spend(2)
  const countries: string[] = countriesRow ? JSON.parse(countriesRow.value) : DEFAULT_COUNTRIES
  const date = new Date().toISOString().slice(0, 10)

  for (const app of apps.results) {
    let releaseRecorded = false
    for (const country of countries) {
      if (budget.exhausted) return // 超预算，明日 cron 继续（upsert 幂等）
      try {
        const summary = await fetchRatingSummary(app.asc_app_id, country)
        budget.spend(1)
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
        budget.spend(1)
        // 版本对比：首个可用国家的当前版本记入 app_releases（0 额外请求，new 版本才写）
        if (!releaseRecorded && summary.version) {
          releaseRecorded = true
          await db
            .prepare(
              `INSERT INTO app_releases (app_id, version, released_at, first_seen_at)
               VALUES (?, ?, ?, ?) ON CONFLICT(app_id, version) DO NOTHING`
            )
            .bind(app.id, summary.version, summary.currentVersionReleaseDate ? Date.parse(summary.currentVersionReleaseDate) : null, Date.now())
            .run()
          budget.spend(1)
        }
      } catch (err) {
        budget.spend(1)
        console.error(`snapshot-ratings failed (${app.asc_app_id} ${country}):`, err)
      }
    }
  }
}
