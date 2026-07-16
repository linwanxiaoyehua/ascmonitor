// 评论抓取作业（每 15 分钟）
// 免费层单次调用 ≤50 子请求：用 config.review_fetch_cursor 轮转分片，每次最多 40 个抓取单元

import { loadAscCredentials, fetchCustomerReviews } from '../lib/asc-api'
import { fetchRssReviews } from '../lib/itunes'
import { tagReview } from '../lib/tagger'
import { evaluateNewReview } from '../lib/alerts'

const MAX_UNITS_PER_RUN = 40
const DEFAULT_COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de']

interface FetchUnit {
  appId: number
  ascAppId: string
  source: 'asc' | 'rss'
  country?: string
}

async function upsertReview(
  db: D1Database,
  review: {
    id: string
    app_id: number
    source: string
    country: string | null
    rating: number
    title: string
    body: string
    reviewer: string
    version: string | null
    created_at: number | null
  }
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO reviews (id, app_id, source, country, rating, title, body, reviewer, review_version, created_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rating = excluded.rating, title = excluded.title, body = excluded.body,
         updated_at = excluded.fetched_at
       WHERE reviews.rating != excluded.rating OR reviews.body != excluded.body`
    )
    .bind(
      review.id,
      review.app_id,
      review.source,
      review.country,
      review.rating,
      review.title,
      review.body,
      review.reviewer,
      review.version,
      review.created_at,
      Date.now()
    )
    .run()
  // changes=1 且 last_row_id 变化说明是新插入；简化：查 fetched_at == updated_at 为空判断新旧
  return result.meta.changes > 0 && result.meta.last_row_id != null
}

export async function fetchReviewsJob(db: D1Database): Promise<void> {
  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  if (!apps.results.length) return

  const countriesRow = await db.prepare("SELECT value FROM config WHERE key = 'review_countries'").first<{ value: string }>()
  const countries: string[] = countriesRow ? JSON.parse(countriesRow.value) : DEFAULT_COUNTRIES
  const creds = await loadAscCredentials(db)

  // 构建抓取单元列表：每个 App 1 个 ASC 源 + N 个国家 RSS 源
  const units: FetchUnit[] = []
  for (const app of apps.results) {
    if (creds) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'asc' })
    for (const country of countries) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'rss', country })
  }

  // 轮转游标分片
  const cursorRow = await db.prepare("SELECT value FROM config WHERE key = 'review_fetch_cursor'").first<{ value: string }>()
  const start = cursorRow ? Number(cursorRow.value) % units.length : 0
  const batch = Math.min(MAX_UNITS_PER_RUN, units.length)

  for (let i = 0; i < batch; i++) {
    const unit = units[(start + i) % units.length]
    try {
      await fetchUnit(db, unit, creds)
    } catch (err) {
      console.error(`fetch-reviews unit failed (${unit.source} ${unit.country ?? ''}):`, err)
    }
  }

  await db
    .prepare("INSERT INTO config (key, value) VALUES ('review_fetch_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String((start + batch) % units.length))
    .run()
}

async function fetchUnit(db: D1Database, unit: FetchUnit, creds: Awaited<ReturnType<typeof loadAscCredentials>>): Promise<void> {
  if (unit.source === 'asc' && creds) {
    const { reviews } = await fetchCustomerReviews(creds, unit.ascAppId)
    for (const r of reviews) {
      const id = `asc:${r.id}`
      const exists = await db.prepare('SELECT 1 FROM reviews WHERE id = ?').bind(id).first()
      const isNew = !exists
      await upsertReview(db, {
        id,
        app_id: unit.appId,
        source: 'asc',
        country: r.attributes.territory,
        rating: r.attributes.rating,
        title: r.attributes.title ?? '',
        body: r.attributes.body ?? '',
        reviewer: r.attributes.reviewerNickname ?? '',
        version: null,
        created_at: Date.parse(r.attributes.createdDate),
      })
      if (isNew) {
        await tagReview(db, id, r.attributes.title ?? '', r.attributes.body ?? '')
        await evaluateNewReview(db, {
          app_id: unit.appId,
          rating: r.attributes.rating,
          country: r.attributes.territory,
          title: r.attributes.title ?? '',
          body: r.attributes.body ?? '',
        })
      }
    }
  } else if (unit.source === 'rss' && unit.country) {
    const reviews = await fetchRssReviews(unit.ascAppId, unit.country)
    for (const r of reviews) {
      const id = `rss:${unit.country}:${r.id}`
      const exists = await db.prepare('SELECT 1 FROM reviews WHERE id = ?').bind(id).first()
      const isNew = !exists
      await upsertReview(db, {
        id,
        app_id: unit.appId,
        source: 'rss',
        country: unit.country,
        rating: r.rating,
        title: r.title,
        body: r.body,
        reviewer: r.reviewer,
        version: r.version,
        created_at: r.updated ? Date.parse(r.updated) : Date.now(),
      })
      if (isNew) {
        await tagReview(db, id, r.title, r.body)
        await evaluateNewReview(db, {
          app_id: unit.appId,
          rating: r.rating,
          country: unit.country,
          title: r.title,
          body: r.body,
        })
      }
    }
  }
}
