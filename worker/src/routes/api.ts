import { Hono } from 'hono'
import type { Env } from '../types'
import { getOverview, fxRates, toUsd } from '../lib/metrics'
import { fetchReviewsJob } from '../jobs/fetch-reviews'
import { snapshotRatingsJob } from '../jobs/snapshot-ratings'
import { fetchSalesJob } from '../jobs/fetch-sales'
import { reprocessJob } from '../jobs/reprocess'
import { fetchProductsJob } from '../jobs/fetch-products'
import { rollupCohortsJob } from '../jobs/rollup-cohorts'
import { revenueBreakdown, subHealth, trialCohorts } from '../lib/insights'
import { loadAscCredentials, postReviewResponse } from '../lib/asc-api'
import { enrichApp, type AppLite } from '../lib/app-enrich'

export const api = new Hono<{ Bindings: Env }>()

// Bearer token 鉴权（token 存 config.access_token，首次通过 setup 生成）
api.use('*', async (c, next) => {
  const row = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'access_token'").first<{ value: string }>()
  if (!row) {
    // 未初始化时仅放行 setup
    if (c.req.path.endsWith('/setup')) return next()
    return c.json({ error: 'not_initialized' }, 401)
  }
  const auth = c.req.header('Authorization')
  if (auth !== `Bearer ${row.value}`) return c.json({ error: 'unauthorized' }, 401)
  return next()
})

// 首次初始化：生成 access token（只能执行一次）
api.post('/setup', async (c) => {
  const existing = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'access_token'").first()
  if (existing) return c.json({ error: 'already_initialized' }, 409)
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await c.env.DB.prepare("INSERT INTO config (key, value) VALUES ('access_token', ?)").bind(token).run()
  return c.json({ token })
})

api.get('/apps', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM apps ORDER BY id').all()
  return c.json(rows.results)
})

api.get('/overview', async (c) => {
  const appId = c.req.query('app_id')
  const overview = await getOverview(c.env.DB, appId ? Number(appId) : undefined)
  // 最近一份 ASC 订阅快照（补全 Webhook 上线前的存量订阅）
  const snapshot = await c.env.DB.prepare(
    `SELECT date, SUM(active) AS active, SUM(trials) AS trials FROM subs_snapshot_daily
     WHERE date = (SELECT MAX(date) FROM subs_snapshot_daily) GROUP BY date`
  ).first<{ date: string; active: number; trials: number }>()
  return c.json({ ...overview, snapshot: snapshot ?? null })
})

// 多 App 分列概览（总览「全部 Apps」模式下每 App 一行关键数）
api.get('/overview/apps', async (c) => {
  const apps = await c.env.DB.prepare('SELECT id, name, icon_url FROM apps ORDER BY id').all<{ id: number; name: string; icon_url: string | null }>()
  const out = []
  for (const app of apps.results) {
    const ov = await getOverview(c.env.DB, app.id)
    out.push({
      id: app.id,
      name: app.name,
      icon: app.icon_url,
      todayRevenueUsdMilli: ov.todayRevenueUsdMilli,
      activeSubs: ov.activeSubs,
      trialSubs: ov.trialSubs,
      riskSubs: ov.riskSubs,
      todayReviews: ov.todayReviews,
      todayReviewAvg: ov.todayReviewAvg,
    })
  }
  return c.json(out)
})

// 事件流（分页，基于 received_at 游标）
api.get('/events', async (c) => {
  const before = Number(c.req.query('before') ?? Date.now() + 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const appId = c.req.query('app_id')
  const rows = await c.env.DB.prepare(
    `SELECT n.uuid, n.app_id, n.type, n.subtype, n.decoded_json, n.received_at,
            a.name AS app_name, a.bundle_id AS app_bundle_id, a.icon_url AS app_icon,
            t.product_id, t.price_milli, t.currency, t.country
     FROM notifications_raw n
     LEFT JOIN apps a ON a.id = n.app_id
     LEFT JOIN transactions t ON t.raw_uuid = n.uuid
     WHERE n.received_at < ? ${appId ? 'AND n.app_id = ?' : ''}
     GROUP BY n.uuid
     ORDER BY n.received_at DESC LIMIT ?`
  )
    .bind(...(appId ? [before, Number(appId), limit] : [before, limit]))
    .all<{
      uuid: string; app_id: number; type: string; subtype: string | null; decoded_json: string; received_at: number
      app_name: string | null; app_bundle_id: string | null; app_icon: string | null
      product_id: string | null; price_milli: number | null; currency: string | null; country: string | null
    }>()

  const events = rows.results.map((r) => {
    const decoded = JSON.parse(r.decoded_json)
    return {
      uuid: r.uuid,
      appId: r.app_id,
      type: r.type,
      subtype: r.subtype,
      environment: decoded.data?.environment,
      bundleId: decoded.data?.bundleId ?? r.app_bundle_id,
      appName: r.app_name,
      appIcon: r.app_icon,
      productId: r.product_id,
      priceMilli: r.price_milli,
      currency: r.currency,
      country: r.country,
      receivedAt: r.received_at,
    }
  })
  return c.json({ events, nextBefore: events.length === limit ? events[events.length - 1].receivedAt : null })
})

// 动态合流：ASSN 事件 ∪ 告警事件，统一时间游标分页
// kinds: revenue | sub_change | refund | alert | system（逗号分隔，缺省=全部）；sandbox=0 排除沙盒事件
const ACTIVITY_KIND_TYPES: Record<string, string[]> = {
  revenue: ['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE', 'OFFER_REDEEMED'],
  sub_change: [
    'DID_CHANGE_RENEWAL_STATUS', 'DID_CHANGE_RENEWAL_PREF', 'EXPIRED', 'DID_FAIL_TO_RENEW',
    'GRACE_PERIOD_EXPIRED', 'PRICE_INCREASE', 'RENEWAL_EXTENDED', 'RENEWAL_EXTENSION',
  ],
  refund: ['REFUND', 'REFUND_DECLINED', 'REFUND_REVERSED', 'REVOKE', 'CONSUMPTION_REQUEST'],
}

// 动态流里「会显示金额」的事件类型。
// 刻意不等于 ACTIVITY_KIND_TYPES.revenue（那份含 OFFER_REDEEMED，但列表行不给它标金额），
// 必须与 web/src/lib/format.ts 的 REVENUE_TYPES 保持一致，否则当日合计对不上各行。
const AMOUNT_EVENT_TYPES = ['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE', 'REFUND']

api.get('/activity', async (c) => {
  const before = Number(c.req.query('before') ?? Date.now() + 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const appId = c.req.query('app_id')
  const includeSandbox = c.req.query('sandbox') !== '0'
  const kinds = (c.req.query('kinds') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const wantAll = kinds.length === 0
  const wantAlerts = wantAll || kinds.includes('alert')
  const eventKinds = kinds.filter((k) => k !== 'alert')
  const wantEvents = wantAll || eventKinds.length > 0

  type Item = Record<string, unknown> & { ts: number }
  const queries: Promise<Item[]>[] = []

  if (wantEvents) {
    const conditions = ['n.received_at < ?']
    const binds: unknown[] = [before]
    if (appId) { conditions.push('n.app_id = ?'); binds.push(Number(appId)) }
    if (!wantAll) {
      // system = 不属于任何已知分类的类型；其余按分类的类型清单过滤
      const typed = eventKinds.flatMap((k) => ACTIVITY_KIND_TYPES[k] ?? [])
      const allTyped = Object.values(ACTIVITY_KIND_TYPES).flat()
      const parts: string[] = []
      if (typed.length) parts.push(`n.type IN (${typed.map(() => '?').join(',')})`)
      if (eventKinds.includes('system')) parts.push(`n.type NOT IN (${allTyped.map(() => '?').join(',')})`)
      if (parts.length) { conditions.push(`(${parts.join(' OR ')})`); binds.push(...typed, ...(eventKinds.includes('system') ? allTyped : [])) }
    }
    if (!includeSandbox) conditions.push(`json_extract(n.decoded_json, '$.data.environment') != 'Sandbox'`)
    binds.push(limit)
    queries.push(
      c.env.DB.prepare(
        `SELECT n.uuid, n.app_id, n.type, n.subtype, n.decoded_json, n.received_at,
                a.name AS app_name, a.icon_url AS app_icon, a.bundle_id AS app_bundle_id,
                t.product_id, t.price_milli, t.currency, t.country, p.name AS product_name
         FROM notifications_raw n
         LEFT JOIN apps a ON a.id = n.app_id
         LEFT JOIN transactions t ON t.raw_uuid = n.uuid
         LEFT JOIN products p ON p.product_id = t.product_id
         WHERE ${conditions.join(' AND ')}
         GROUP BY n.uuid
         ORDER BY n.received_at DESC LIMIT ?`
      )
        .bind(...binds)
        .all<{
          uuid: string; app_id: number; type: string; subtype: string | null; decoded_json: string; received_at: number
          app_name: string | null; app_icon: string | null; app_bundle_id: string | null
          product_id: string | null; price_milli: number | null; currency: string | null; country: string | null
          product_name: string | null
        }>()
        .then((rows) =>
          rows.results.map((r) => {
            const decoded = JSON.parse(r.decoded_json)
            return {
              kind: 'event', id: r.uuid, ts: r.received_at,
              type: r.type, subtype: r.subtype,
              environment: decoded.data?.environment,
              appId: r.app_id, appName: r.app_name, appIcon: r.app_icon,
              bundleId: decoded.data?.bundleId ?? r.app_bundle_id,
              productId: r.product_id, productName: r.product_name,
              priceMilli: r.price_milli, currency: r.currency, country: r.country,
            }
          })
        )
    )
  }

  if (wantAlerts) {
    // 排除 kind='transaction'：那是交易事件的实时推送记录，事件本体已在 raw 流中（否则同一笔交易显示两次）
    queries.push(
      c.env.DB.prepare("SELECT id, kind, title, body, fired_at FROM alert_events WHERE fired_at < ? AND kind != 'transaction' ORDER BY fired_at DESC LIMIT ?")
        .bind(before, limit)
        .all<{ id: number; kind: string; title: string; body: string | null; fired_at: number }>()
        .then((rows) =>
          rows.results.map((r) => ({
            kind: 'alert', id: `alert:${r.id}`, ts: r.fired_at,
            alertKind: r.kind, title: r.title, body: r.body,
          }))
        )
    )
  }

  const merged = (await Promise.all(queries)).flat().sort((a, b) => b.ts - a.ts).slice(0, limit)
  return c.json({ items: merged, nextBefore: merged.length === limit ? merged[merged.length - 1].ts : null })
})

// 动态页按天分组的当日收入合计。
// 刻意不复用 metrics_daily：那张表按 UTC 日 + purchase_date 聚合，而动态流按
// 客户端本地日 + received_at 分组 —— 直接套会错位（UTC+8 早上「今天」几乎为 0）。
// 这里按传入的时区偏移、用与列表完全相同的过滤条件重算，保证表头数字 = 其下各行之和。
api.get('/activity/day-totals', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 90)
  // 客户端传 new Date().getTimezoneOffset()：UTC+8 为 -480（分钟，UTC 之后为负）
  const raw = Number(c.req.query('tz_offset') ?? 0)
  const tzOffsetMin = Number.isFinite(raw) ? Math.max(-840, Math.min(840, raw)) : 0
  const appId = c.req.query('app_id')
  const includeSandbox = c.req.query('sandbox') !== '0'

  const conditions = ['n.received_at >= ?', `n.type IN (${AMOUNT_EVENT_TYPES.map(() => '?').join(',')})`]
  const binds: unknown[] = [Date.now() - days * 86400_000, ...AMOUNT_EVENT_TYPES]
  if (appId) { conditions.push('n.app_id = ?'); binds.push(Number(appId)) }
  if (!includeSandbox) conditions.push(`json_extract(n.decoded_json, '$.data.environment') != 'Sandbox'`)

  const rows = await c.env.DB.prepare(
    `SELECT n.type, n.received_at, t.price_milli, t.currency
     FROM notifications_raw n
     JOIN transactions t ON t.raw_uuid = n.uuid
     WHERE ${conditions.join(' AND ')}`
  )
    .bind(...binds)
    .all<{ type: string; received_at: number; price_milli: number | null; currency: string | null }>()

  const fx = await fxRates(c.env.DB)
  const totals = new Map<string, { usdMilli: number; count: number }>()
  for (const r of rows.results) {
    if (!r.price_milli) continue // 0 元交易（免费试用开始）列表里也不显示金额
    // 位移到本地时区后再取 UTC 日期串，等价于客户端的 dayKey()
    const date = new Date(r.received_at - tzOffsetMin * 60_000).toISOString().slice(0, 10)
    const agg = totals.get(date) ?? { usdMilli: 0, count: 0 }
    const usd = toUsd(r.price_milli, r.currency, fx)
    agg.usdMilli += r.type === 'REFUND' ? -usd : usd
    agg.count++
    totals.set(date, agg)
  }
  return c.json(
    [...totals].map(([date, v]) => ({ date, usdMilli: Math.round(v.usdMilli), count: v.count }))
  )
})

// P3 收入深化：订阅健康（续订率 / Churn / 退款率），即时计算
api.get('/metrics/sub-health', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 90)
  const appId = c.req.query('app_id')
  return c.json(await subHealth(c.env.DB, days, appId ? Number(appId) : undefined))
})

// Trial 转化漏斗（周 cohort）
api.get('/metrics/trials', async (c) => {
  const weeks = Math.min(Number(c.req.query('weeks') ?? 12), 26)
  const appId = c.req.query('app_id')
  return c.json(await trialCohorts(c.env.DB, weeks, appId ? Number(appId) : undefined))
})

// 收入维度切分（国家 / 产品），事件口径·客户价
api.get('/metrics/breakdown', async (c) => {
  const by = c.req.query('by') === 'product' ? 'product' : 'country'
  const days = Math.min(Number(c.req.query('days') ?? 30), 90)
  const appId = c.req.query('app_id')
  return c.json(await revenueBreakdown(c.env.DB, by, days, appId ? Number(appId) : undefined))
})

// LTV 月 cohort（weekly 物化；多 App 时按月合并）
api.get('/metrics/cohorts', async (c) => {
  const appId = c.req.query('app_id')
  const rows = await (appId
    ? c.env.DB.prepare('SELECT cohort_month, subs, revenue_milli_cum FROM cohorts WHERE app_id = ? ORDER BY cohort_month DESC LIMIT 12').bind(Number(appId))
    : c.env.DB.prepare('SELECT cohort_month, SUM(subs) AS subs, SUM(revenue_milli_cum) AS revenue_milli_cum FROM cohorts GROUP BY cohort_month ORDER BY cohort_month DESC LIMIT 12')
  ).all<{ cohort_month: string; subs: number; revenue_milli_cum: number }>()
  return c.json(
    rows.results.map((r) => ({
      month: r.cohort_month,
      subs: r.subs,
      revenueUsdMilli: r.revenue_milli_cum,
      ltvUsdMilli: r.subs > 0 ? Math.round(r.revenue_milli_cum / r.subs) : 0,
    }))
  )
})

// 手动触发 cohort 物化（新装或 reprocess 后不必等 weekly cron）
api.post('/jobs/rollup-cohorts', async (c) => {
  await rollupCohortsJob(c.env.DB)
  return c.json({ ok: true })
})

// 手动同步产品目录（内购/订阅名称；平时 daily cron 自动同步）
api.post('/jobs/fetch-products', async (c) => {
  const result = await fetchProductsJob(c.env.DB)
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>()
  return c.json({ ok: true, ...result, totalProducts: count?.n ?? 0 })
})

api.get('/metrics/daily', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 365)
  const appId = c.req.query('app_id')
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const rows = await c.env.DB.prepare(
    `SELECT * FROM metrics_daily WHERE date >= ? ${appId ? 'AND app_id = ?' : ''} ORDER BY date`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all()
  return c.json(rows.results)
})

// 订阅列表与单订阅事件时间线（status 支持逗号分隔多值）
api.get('/subscriptions', async (c) => {
  const status = c.req.query('status')
  const appId = c.req.query('app_id')
  const statuses = status ? status.split(',').map((s) => s.trim()).filter(Boolean) : []
  const conditions: string[] = []
  const binds: unknown[] = []
  if (statuses.length) { conditions.push(`s.status IN (${statuses.map(() => '?').join(',')})`); binds.push(...statuses) }
  if (appId) { conditions.push('s.app_id = ?'); binds.push(Number(appId)) }
  const filter = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await c.env.DB.prepare(
    `SELECT s.*, a.name AS app_name, a.icon_url AS app_icon, a.bundle_id AS app_bundle_id, p.name AS product_name
     FROM subscriptions s
     LEFT JOIN apps a ON a.id = s.app_id
     LEFT JOIN products p ON p.product_id = s.product_id
     ${filter} ORDER BY s.updated_at DESC LIMIT 200`
  )
    .bind(...binds)
    .all()
  return c.json(rows.results)
})

// 一次性购买流水（非自动续订订阅的交易：买断 / 消耗型 / 非续订订阅）
api.get('/purchases', async (c) => {
  const before = Number(c.req.query('before') ?? Date.now() + 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const appId = c.req.query('app_id')
  const rows = await c.env.DB.prepare(
    `SELECT t.transaction_id, t.product_id, t.type, t.price_milli, t.currency, t.country,
            t.purchase_date, t.event_type, t.refunded,
            a.name AS app_name, a.icon_url AS app_icon, a.bundle_id AS app_bundle_id, p.name AS product_name
     FROM transactions t
     LEFT JOIN apps a ON a.id = t.app_id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE t.type != 'Auto-Renewable Subscription' AND t.purchase_date < ? ${appId ? 'AND t.app_id = ?' : ''}
     ORDER BY t.purchase_date DESC LIMIT ?`
  )
    .bind(...(appId ? [before, Number(appId), limit] : [before, limit]))
    .all<{ purchase_date: number }>()
  const purchases = rows.results
  return c.json({
    purchases,
    nextBefore: purchases.length === limit ? purchases[purchases.length - 1].purchase_date : null,
  })
})

api.get('/subscriptions/:otid/timeline', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*, n.type AS notification_type, n.subtype, n.received_at
     FROM transactions t LEFT JOIN notifications_raw n ON t.raw_uuid = n.uuid
     WHERE t.original_transaction_id = ? ORDER BY t.purchase_date`
  )
    .bind(c.req.param('otid'))
    .all()
  return c.json(rows.results)
})

// 评论流（M5）
api.get('/reviews', async (c) => {
  const appId = c.req.query('app_id')
  const maxRating = c.req.query('max_rating')
  const tag = c.req.query('tag')
  const before = Number(c.req.query('before') ?? Date.now() + 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)

  const conditions = ['r.created_at < ?', 'r.dup_of IS NULL'] // 排除 asc/rss 双源重复
  const binds: unknown[] = [before]
  if (appId) { conditions.push('r.app_id = ?'); binds.push(Number(appId)) }
  if (maxRating) { conditions.push('r.rating <= ?'); binds.push(Number(maxRating)) }
  if (tag) { conditions.push('EXISTS (SELECT 1 FROM review_tags rt WHERE rt.review_id = r.id AND rt.tag = ?)'); binds.push(tag) }
  binds.push(limit)

  const rows = await c.env.DB.prepare(
    `SELECT r.*, (SELECT json_group_array(tag) FROM review_tags rt WHERE rt.review_id = r.id) AS tags
     FROM reviews r WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC LIMIT ?`
  )
    .bind(...binds)
    .all<Record<string, unknown> & { created_at: number }>()
  const reviews = rows.results.map((r) => ({ ...r, tags: JSON.parse((r.tags as string) ?? '[]') }))
  return c.json({ reviews, nextBefore: reviews.length === limit ? reviews[reviews.length - 1].created_at : null })
})

// 评论标签统计（本周抱怨最多的是什么）
api.get('/reviews/tags/stats', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 365)
  const appId = c.req.query('app_id')
  const since = Date.now() - days * 86400_000
  const rows = await c.env.DB.prepare(
    `SELECT rt.tag, COUNT(*) AS count FROM review_tags rt
     JOIN reviews r ON r.id = rt.review_id
     WHERE r.created_at >= ? AND r.dup_of IS NULL ${appId ? 'AND r.app_id = ?' : ''}
     GROUP BY rt.tag ORDER BY count DESC`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all<{ tag: string; count: number }>()
  return c.json(rows.results)
})

// 评分分布（1-5 星占比）；样本 = 已抓取的文字评论（官方无全量分布 API）
api.get('/reviews/distribution', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 90), 365)
  const appId = c.req.query('app_id')
  const since = Date.now() - days * 86400_000
  const rows = await c.env.DB.prepare(
    `SELECT rating, COUNT(*) AS count FROM reviews
     WHERE created_at >= ? AND dup_of IS NULL ${appId ? 'AND app_id = ?' : ''} GROUP BY rating`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all<{ rating: number; count: number }>()
  const map = new Map(rows.results.map((r) => [r.rating, r.count]))
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: map.get(rating) ?? 0 }))
  return c.json({ distribution, total: distribution.reduce((s, d) => s + d.count, 0) })
})

// 版本前后对比：最近两个版本的文字评论均分 / 差评率（review_version 来自 RSS）
api.get('/reviews/version-compare', async (c) => {
  const appId = c.req.query('app_id')
  if (!appId) return c.json({ versions: [] })
  const rels = await c.env.DB.prepare(
    'SELECT version, released_at FROM app_releases WHERE app_id = ? ORDER BY COALESCE(released_at, first_seen_at) DESC LIMIT 2'
  )
    .bind(Number(appId))
    .all<{ version: string; released_at: number | null }>()
  const versions = []
  for (const rel of rels.results) {
    const stat = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, AVG(rating) AS avg, SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS bad
       FROM reviews WHERE app_id = ? AND review_version = ? AND dup_of IS NULL`
    )
      .bind(Number(appId), rel.version)
      .first<{ n: number; avg: number | null; bad: number }>()
    versions.push({
      version: rel.version,
      releasedAt: rel.released_at,
      count: stat?.n ?? 0,
      avg: stat?.avg ?? null,
      badRate: stat?.n ? stat.bad / stat.n : null,
    })
  }
  return c.json({ versions })
})

// 平台内回复评论（仅 asc 源；需 Admin / App Manager / Customer Support 角色的 Key）
api.post('/reviews/:id/reply', async (c) => {
  const id = c.req.param('id')
  if (!id.startsWith('asc:')) return c.json({ error: 'only_asc_reviewable' }, 400)
  const { body } = await c.req.json<{ body: string }>()
  if (!body?.trim()) return c.json({ error: 'empty_body' }, 400)
  const creds = await loadAscCredentials(c.env.DB)
  if (!creds) return c.json({ error: 'asc_not_configured' }, 400)
  try {
    const state = await postReviewResponse(creds, id.slice(4), body.trim())
    await c.env.DB.prepare('UPDATE reviews SET response_body = ?, response_state = ?, responded_at = ? WHERE id = ?')
      .bind(body.trim(), state, Date.now(), id)
      .run()
    return c.json({ ok: true, state })
  } catch (e) {
    return c.json({ error: 'reply_failed', message: String(e) }, 502)
  }
})

api.get('/ratings', async (c) => {
  const appId = c.req.query('app_id')
  const days = Math.min(Number(c.req.query('days') ?? 90), 365)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const rows = await c.env.DB.prepare(
    `SELECT * FROM ratings_snapshots WHERE date >= ? ${appId ? 'AND app_id = ?' : ''} ORDER BY date`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all()
  return c.json(rows.results)
})

// 告警（M6）
api.get('/alerts/rules', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM alert_rules ORDER BY id').all()
  return c.json(rows.results)
})

api.post('/alerts/rules', async (c) => {
  const body = await c.req.json<{ app_id?: number; kind: string; params?: object; channels?: string[]; silence_min?: number }>()
  const row = await c.env.DB.prepare(
    `INSERT INTO alert_rules (app_id, kind, params_json, channels_json, silence_min) VALUES (?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(
      body.app_id ?? null,
      body.kind,
      JSON.stringify(body.params ?? {}),
      JSON.stringify(body.channels ?? ['push']),
      body.silence_min ?? 60
    )
    .first()
  return c.json(row)
})

api.put('/alerts/rules/:id', async (c) => {
  const body = await c.req.json<{ params?: object; channels?: string[]; silence_min?: number; enabled?: boolean }>()
  await c.env.DB.prepare(
    `UPDATE alert_rules SET
       params_json = COALESCE(?, params_json),
       channels_json = COALESCE(?, channels_json),
       silence_min = COALESCE(?, silence_min),
       enabled = COALESCE(?, enabled)
     WHERE id = ?`
  )
    .bind(
      body.params ? JSON.stringify(body.params) : null,
      body.channels ? JSON.stringify(body.channels) : null,
      body.silence_min ?? null,
      body.enabled == null ? null : body.enabled ? 1 : 0,
      Number(c.req.param('id'))
    )
    .run()
  return c.json({ ok: true })
})

api.delete('/alerts/rules/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM alert_rules WHERE id = ?').bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

api.get('/alerts/events', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT 100').all()
  return c.json(rows.results)
})

// 配置管理（ASC 凭证、Telegram、汇率、App 的 asc_app_id 等）
api.get('/config', async (c) => {
  const rows = await c.env.DB.prepare("SELECT key FROM config WHERE key != 'access_token'").all<{ key: string }>()
  return c.json(rows.results.map((r) => r.key)) // 只暴露 key，不回读敏感值
})

api.put('/config/:key', async (c) => {
  const key = c.req.param('key')
  if (key === 'access_token') return c.json({ error: 'forbidden' }, 403)
  const { value } = await c.req.json<{ value: string }>()
  await c.env.DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run()
  return c.json({ ok: true })
})

// 立即抓取评论评分（不等 cron）
api.post('/jobs/fetch-reviews', async (c) => {
  await fetchReviewsJob(c.env.DB)
  await snapshotRatingsJob(c.env.DB)
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM reviews').first<{ n: number }>()
  return c.json({ ok: true, totalReviews: count?.n ?? 0 })
})

// 回放原始通知重建交易/订阅状态（0002 迁移后补齐新字段；分批断点，前端循环调用直到 done）
api.post('/jobs/reprocess', async (c) => {
  const reset = c.req.query('reset') === '1'
  const result = await reprocessJob(c.env.DB, reset)
  return c.json(result)
})

// 立即抓取销售报告（账单数据，回填最近 30 天）
api.post('/jobs/fetch-sales', async (c) => {
  const result = await fetchSalesJob(c.env.DB)
  const days = await c.env.DB.prepare('SELECT COUNT(DISTINCT date) AS n FROM sales_daily').first<{ n: number }>()
  return c.json({ ok: true, ...result, totalDays: days?.n ?? 0 })
})

// 每日账单聚合（下载量 + 结算收入，折算 USD）；app_id 经 apps.asc_app_id ↔ sales_daily.apple_id 关联
api.get('/sales/daily', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 365)
  const appId = c.req.query('app_id')
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const fx = await fxRates(c.env.DB)
  const rows = await c.env.DB.prepare(
    `SELECT s.date, s.product_type, s.units, s.proceeds_milli, s.currency FROM sales_daily s
     WHERE s.date >= ? ${appId ? 'AND s.apple_id = (SELECT asc_app_id FROM apps WHERE id = ?)' : ''}`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all<{ date: string; product_type: string; units: number; proceeds_milli: number; currency: string }>()

  const byDate = new Map<string, { downloads: number; iapUnits: number; proceedsUsdMilli: number }>()
  for (const r of rows.results) {
    const agg = byDate.get(r.date) ?? { downloads: 0, iapUnits: 0, proceedsUsdMilli: 0 }
    if (r.product_type.startsWith('1') || r.product_type.startsWith('F')) agg.downloads += r.units
    else if (r.product_type.startsWith('IA')) agg.iapUnits += r.units
    agg.proceedsUsdMilli += Math.round(r.proceeds_milli * (fx[r.currency] ?? 0))
    byDate.set(r.date, agg)
  }
  return c.json([...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)))
})

// 双口径对账：事件收入（客户价 × 费率估算净得）vs 账单实际 proceeds，按日对比
api.get('/revenue/reconciliation', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 90)
  const appId = c.req.query('app_id')
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const fx = await fxRates(c.env.DB)
  const rateRow = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'proceeds_rate'").first<{ value: string }>()
  const proceedsRate = rateRow ? Number(rateRow.value) : 0.85 // 小型企业计划默认 15% 佣金

  const events = await c.env.DB.prepare(
    `SELECT date, SUM(revenue_milli) AS revenue FROM metrics_daily WHERE date >= ? ${appId ? 'AND app_id = ?' : ''} GROUP BY date`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all<{ date: string; revenue: number }>()

  const sales = await c.env.DB.prepare(
    `SELECT date, proceeds_milli, currency FROM sales_daily
     WHERE date >= ? ${appId ? 'AND apple_id = (SELECT asc_app_id FROM apps WHERE id = ?)' : ''}`
  )
    .bind(...(appId ? [since, Number(appId)] : [since]))
    .all<{ date: string; proceeds_milli: number; currency: string }>()

  const byDate = new Map<string, { events: number; actual: number }>()
  for (const e of events.results) {
    const agg = byDate.get(e.date) ?? { events: 0, actual: 0 }
    agg.events += e.revenue
    byDate.set(e.date, agg)
  }
  for (const s of sales.results) {
    const agg = byDate.get(s.date) ?? { events: 0, actual: 0 }
    agg.actual += Math.round(s.proceeds_milli * (fx[s.currency] ?? 0))
    byDate.set(s.date, agg)
  }

  const rows = [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      eventsUsdMilli: v.events,
      estimatedUsdMilli: Math.round(v.events * proceedsRate),
      actualUsdMilli: v.actual,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const totalEstimated = rows.reduce((s, r) => s + r.estimatedUsdMilli, 0)
  const totalActual = rows.reduce((s, r) => s + r.actualUsdMilli, 0)
  return c.json({
    days: rows,
    summary: {
      eventsUsdMilli: rows.reduce((s, r) => s + r.eventsUsdMilli, 0),
      estimatedUsdMilli: totalEstimated,
      actualUsdMilli: totalActual,
      proceedsRate,
      // 估算 vs 实际差值%（正 = 估算偏高）；无账单数据时为 null
      diffPct: totalActual > 0 ? ((totalEstimated - totalActual) / totalActual) * 100 : null,
    },
  })
})

// 数据健康：管道新鲜度 / 汇率状态 / 未折算币种 / 评论重复 / 存储用量
api.get('/health/data', async (c) => {
  const [lastWebhook, fxUpdated, fxAuto, currencies, dupReviews, rawStats, reprocessCursor] = await Promise.all([
    c.env.DB.prepare('SELECT MAX(received_at) AS t FROM notifications_raw').first<{ t: number | null }>(),
    c.env.DB.prepare("SELECT value FROM config WHERE key = 'fx_updated_at'").first<{ value: string }>(),
    c.env.DB.prepare("SELECT value FROM config WHERE key = 'fx_rates_auto'").first<{ value: string }>(),
    c.env.DB.prepare('SELECT currency, COUNT(*) AS n FROM transactions WHERE currency IS NOT NULL GROUP BY currency').all<{ currency: string; n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM reviews WHERE dup_of IS NOT NULL').first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n, SUM(LENGTH(signed_payload)) AS bytes FROM notifications_raw").first<{ n: number; bytes: number | null }>(),
    c.env.DB.prepare("SELECT value FROM config WHERE key = 'reprocess_cursor'").first<{ value: string }>(),
  ])
  const fx = await fxRates(c.env.DB)
  const unconverted = currencies.results.filter((r) => !(r.currency in fx)).map((r) => ({ currency: r.currency, count: r.n }))
  return c.json({
    lastWebhookAt: lastWebhook?.t ?? null,
    fxUpdatedAt: fxUpdated ? Number(fxUpdated.value) : null,
    fxAutoCount: fxAuto ? Object.keys(JSON.parse(fxAuto.value)).length : 0,
    unconverted,
    duplicateReviews: dupReviews?.n ?? 0,
    rawNotifications: rawStats?.n ?? 0,
    rawPayloadBytes: rawStats?.bytes ?? 0,
    reprocessInProgress: !!reprocessCursor,
  })
})

// 手动添加 App（不必等第一条 Store 通知）
api.post('/apps', async (c) => {
  const body = await c.req.json<{ bundle_id: string; name?: string; asc_app_id?: string }>()
  if (!body.bundle_id?.trim()) return c.json({ error: 'bundle_id_required' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO apps (bundle_id, name, asc_app_id) VALUES (?, ?, ?)
     ON CONFLICT(bundle_id) DO UPDATE SET
       name = COALESCE(excluded.name, apps.name),
       asc_app_id = COALESCE(excluded.asc_app_id, apps.asc_app_id)
     RETURNING *`
  )
    .bind(body.bundle_id.trim(), body.name?.trim() || body.bundle_id.trim(), body.asc_app_id?.trim() || null)
    .first<AppLite>()
  // 自动补全图标 / 正式名称 / Apple ID（iTunes Lookup，免费公开接口）
  if (row) {
    await enrichApp(c.env.DB, row)
    const fresh = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(row.id).first()
    return c.json(fresh ?? row)
  }
  return c.json(row)
})

api.put('/apps/:id', async (c) => {
  const body = await c.req.json<{ name?: string; asc_app_id?: string }>()
  await c.env.DB.prepare('UPDATE apps SET name = COALESCE(?, name), asc_app_id = COALESCE(?, asc_app_id) WHERE id = ?')
    .bind(body.name ?? null, body.asc_app_id ?? null, Number(c.req.param('id')))
    .run()
  return c.json({ ok: true })
})
