// 评论抓取作业（每 15 分钟）
// - 首次遇到新 App/国家：翻页回填历史评论（RSS 最多 10 页 / ASC 逐页翻完）
// - 之后增量：第一页无新评论即停止
// - 预算（Budget）：外部 fetch 与 D1 语句统一记账，超支写游标下轮续跑
// - 双源去重：同 (app_id, reviewer, rating, title) 的 asc/rss 评论，rss 侧标 dup_of 指向 asc（canonical）

import { loadAscCredentials, fetchCustomerReviews, type AscCredentials } from '../lib/asc-api'
import { fetchRssReviews } from '../lib/itunes'
import { tagReview } from '../lib/tagger'
import { evaluateNewReview } from '../lib/alerts'
import { backfillAppInfo } from '../lib/app-enrich'
import { Budget } from '../lib/budget'

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
  responseBody?: string | null
  responseState?: string | null
}

/** 入库（含双源去重标记）；返回是否为新评论 */
async function saveReview(db: D1Database, r: NewReview, budget: Budget): Promise<boolean> {
  const exists = await db.prepare('SELECT 1 FROM reviews WHERE id = ?').bind(r.id).first()
  budget.spend(1)

  // 双源关联：canonical 恒为 asc 源
  let dupOf: string | null = null
  if (!exists && r.reviewer) {
    if (r.source === 'rss') {
      const canonical = await db
        .prepare("SELECT id FROM reviews WHERE app_id = ? AND source = 'asc' AND reviewer = ? AND rating = ? AND title = ? LIMIT 1")
        .bind(r.app_id, r.reviewer, r.rating, r.title)
        .first<{ id: string }>()
      budget.spend(1)
      dupOf = canonical?.id ?? null
    }
  }

  // asc 抓取会同步开发者回复状态（本地平台内回复后，下次抓取确认 PUBLISHED）
  const respondedAt = r.responseState ? Date.now() : null
  await db
    .prepare(
      `INSERT INTO reviews (id, app_id, source, country, rating, title, body, reviewer, review_version, created_at, fetched_at, dup_of, response_body, response_state, responded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rating = excluded.rating, title = excluded.title, body = excluded.body,
         updated_at = excluded.fetched_at,
         response_body = excluded.response_body,
         response_state = excluded.response_state,
         responded_at = COALESCE(reviews.responded_at, excluded.responded_at)`
    )
    .bind(r.id, r.app_id, r.source, r.country, r.rating, r.title, r.body, r.reviewer, r.version, r.created_at, Date.now(), dupOf, r.responseBody ?? null, r.responseState ?? null, respondedAt)
    .run()
  budget.spend(1)

  if (!exists) {
    // asc 入库后反向把已存在的 rss 同评论标为重复
    if (r.source === 'asc' && r.reviewer) {
      await db
        .prepare("UPDATE reviews SET dup_of = ? WHERE app_id = ? AND source = 'rss' AND reviewer = ? AND rating = ? AND title = ? AND dup_of IS NULL")
        .bind(r.id, r.app_id, r.reviewer, r.rating, r.title)
        .run()
      budget.spend(1)
    }
    await tagReview(db, r.id, r.title, r.body)
    budget.spend(2)
    // 重复评论不再次触发差评告警
    if (!dupOf) {
      await evaluateNewReview(db, { app_id: r.app_id, rating: r.rating, country: r.country, title: r.title, body: r.body })
      budget.spend(2)
    }
  }
  return !exists
}

export async function fetchReviewsJob(db: D1Database, budget = new Budget(40)): Promise<void> {
  // 顺带回填缺失的 App 图标 / 名称（每轮最多 3 个，控制子请求预算）
  await backfillAppInfo(db, 3)
  budget.spend(4)

  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  budget.spend(1)
  if (!apps.results.length) return

  const countriesRow = await db.prepare("SELECT value FROM config WHERE key = 'review_countries'").first<{ value: string }>()
  const countries: string[] = countriesRow ? JSON.parse(countriesRow.value) : DEFAULT_COUNTRIES
  const creds = await loadAscCredentials(db)
  budget.spend(2)

  // 抓取单元：每个 App 1 个 ASC 源 + N 个国家 RSS 源
  const units: FetchUnit[] = []
  for (const app of apps.results) {
    if (creds) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'asc' })
    for (const country of countries) units.push({ appId: app.id, ascAppId: app.asc_app_id, source: 'rss', country })
  }

  const cursorRow = await db.prepare("SELECT value FROM config WHERE key = 'review_fetch_cursor'").first<{ value: string }>()
  budget.spend(1)
  const start = cursorRow ? Number(cursorRow.value) % units.length : 0

  let processed = 0
  for (let i = 0; i < units.length && !budget.exhausted; i++) {
    const unit = units[(start + i) % units.length]
    try {
      await fetchUnit(db, unit, creds, budget)
    } catch (err) {
      budget.spend(1)
      console.error(`fetch-reviews unit failed (${unit.source} ${unit.country ?? ''}):`, err)
    }
    processed++
  }

  await db
    .prepare("INSERT INTO config (key, value) VALUES ('review_fetch_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String((start + processed) % units.length))
    .run()
  budget.spend(1)
}

/** 抓取一个单元 */
async function fetchUnit(db: D1Database, unit: FetchUnit, creds: AscCredentials | null, budget: Budget): Promise<void> {
  if (unit.source === 'asc' && creds) {
    // ASC：逐页翻，直到没有新评论或翻完（历史回填 + 增量共用）
    let cursor: string | undefined
    while (!budget.exhausted) {
      const { reviews, nextCursor } = await fetchCustomerReviews(creds, unit.ascAppId, cursor)
      budget.spend(1)
      let fresh = 0
      for (const r of reviews) {
        if (budget.exhausted) return
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
          responseBody: r.responseBody,
          responseState: r.responseState,
        }, budget)
        if (isNew) fresh++
      }
      if (!nextCursor || fresh === 0) break // 增量模式：这一页全是旧评论就停
      cursor = nextCursor
    }
  } else if (unit.source === 'rss' && unit.country) {
    for (let page = 1; page <= RSS_MAX_PAGES && !budget.exhausted; page++) {
      const reviews = await fetchRssReviews(unit.ascAppId, unit.country, page)
      budget.spend(1)
      if (!reviews.length) break
      let fresh = 0
      for (const r of reviews) {
        if (budget.exhausted) return
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
        }, budget)
        if (isNew) fresh++
      }
      if (fresh === 0) break // 本页无新评论 → 后面都是旧的
    }
  }
}
