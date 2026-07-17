// 评论抓取作业（每 15 分钟）
// - 首次遇到新 App/国家：翻页回填历史评论（RSS 最多 10 页 / ASC 逐页翻完）
// - 之后增量：第一页无新评论即停止
// 免费层单次调用 ≤50 子请求：全局请求预算 40，游标轮转分片，下次续跑

import { loadAscCredentials, fetchCustomerReviews, type AscCredentials } from '../lib/asc-api'
import { fetchRssReviews } from '../lib/itunes'
import { tagReview } from '../lib/tagger'
import { evaluateNewReview } from '../lib/alerts'
import { backfillAppInfo } from '../lib/app-enrich'

const REQUEST_BUDGET = 40
const RSS_MAX_PAGES = 10
const DEFAULT_COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de']

interface FetchUnit {
  appId: number
  ascAppId: string
  source: 'asc' | 'rss'
  country?: string
}

interface NewReview {
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

/** 入库；返回是否为新评论 */
async function saveReview(db: D1Database, r: NewReview): Promise<boolean> {
  const exists = await db.prepare('SELECT 1 FROM reviews WHERE id = ?').bind(r.id).first()
  await db
    .prepare(
      `INSERT INTO reviews (id, app_id, source, country, rating, title, body, reviewer, review_version, created_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rating = excluded.rating, title = excluded.title, body = excluded.body,
         updated_at = excluded.fetched_at`
    )
    .bind(r.id, r.app_id, r.source, r.country, r.rating, r.title, r.body, r.reviewer, r.version, r.created_at, Date.now())
    .run()
  if (!exists) {
    await tagReview(db, r.id, r.title, r.body)
    await evaluateNewReview(db, { app_id: r.app_id, rating: r.rating, country: r.country, title: r.title, body: r.body })
  }
  return !exists
}

export async function fetchReviewsJob(db: D1Database): Promise<void> {
  // 顺带回填缺失的 App 图标 / 名称（每轮最多 3 个，控制子请求预算）
  await backfillAppInfo(db, 3)

  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  if (!apps.results.length) return

  const countriesRow = await db.prepare("SELECT value FROM config WHERE key = 'review_countries'").first<{ value: string }>()
  const countries: string[] = countriesRow ? JSON.parse(countriesRow.value) : DEFAULT_COUNTRIES
  const creds = await loadAscCredentials(db)

  // 抓取单元：每个 App 1 个 ASC 源 + N 个国家 RSS 源
  const units: FetchUnit[] = []
  for (const app of apps.results) {
    if (creds) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'asc' })
    for (const country of countries) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'rss', country })
  }

  const cursorRow = await db.prepare("SELECT value FROM config WHERE key = 'review_fetch_cursor'").first<{ value: string }>()
  const start = cursorRow ? Number(cursorRow.value) % units.length : 0

  let budget = REQUEST_BUDGET
  let processed = 0
  for (let i = 0; i < units.length && budget > 0; i++) {
    const unit = units[(start + i) % units.length]
    try {
      budget -= await fetchUnit(db, unit, creds, budget)
    } catch (err) {
      budget -= 1
      console.error(`fetch-reviews unit failed (${unit.source} ${unit.country ?? ''}):`, err)
    }
    processed++
  }

  await db
    .prepare("INSERT INTO config (key, value) VALUES ('review_fetch_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String((start + processed) % units.length))
    .run()
}

/** 抓取一个单元，返回消耗的请求数 */
async function fetchUnit(db: D1Database, unit: FetchUnit, creds: AscCredentials | null, budget: number): Promise<number> {
  let used = 0

  if (unit.source === 'asc' && creds) {
    // ASC：逐页翻，直到没有新评论或翻完（历史回填 + 增量共用）
    let cursor: string | undefined
    while (used < budget) {
      const { reviews, nextCursor } = await fetchCustomerReviews(creds, unit.ascAppId, cursor)
      used++
      let fresh = 0
      for (const r of reviews) {
        const isNew = await saveReview(db, {
          id: `asc:${r.id}`,
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
        if (isNew) fresh++
      }
      if (!nextCursor || fresh === 0) break // 增量模式：这一页全是旧评论就停
      cursor = nextCursor
    }
  } else if (unit.source === 'rss' && unit.country) {
    for (let page = 1; page <= RSS_MAX_PAGES && used < budget; page++) {
      const reviews = await fetchRssReviews(unit.ascAppId, unit.country, page)
      used++
      if (!reviews.length) break
      let fresh = 0
      for (const r of reviews) {
        const isNew = await saveReview(db, {
          id: `rss:${unit.country}:${r.id}`,
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
        if (isNew) fresh++
      }
      if (fresh === 0) break // 本页无新评论 → 后面都是旧的
    }
  }

  return Math.max(used, 1)
}
