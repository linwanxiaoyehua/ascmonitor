import { Hono } from 'hono'
import type { Env } from '../types'
import { getOverview, fxRates } from '../lib/metrics'
import { fetchReviewsJob } from '../jobs/fetch-reviews'
import { snapshotRatingsJob } from '../jobs/snapshot-ratings'
import { fetchSalesJob } from '../jobs/fetch-sales'

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
  return c.json(await getOverview(c.env.DB, appId ? Number(appId) : undefined))
})

// 事件流（分页，基于 received_at 游标）
api.get('/events', async (c) => {
  const before = Number(c.req.query('before') ?? Date.now() + 1)
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const appId = c.req.query('app_id')
  const rows = await c.env.DB.prepare(
    `SELECT uuid, app_id, type, subtype, decoded_json, received_at FROM notifications_raw
     WHERE received_at < ? ${appId ? 'AND app_id = ?' : ''}
     ORDER BY received_at DESC LIMIT ?`
  )
    .bind(...(appId ? [before, Number(appId), limit] : [before, limit]))
    .all<{ uuid: string; app_id: number; type: string; subtype: string | null; decoded_json: string; received_at: number }>()

  const events = rows.results.map((r) => {
    const decoded = JSON.parse(r.decoded_json)
    return {
      uuid: r.uuid,
      appId: r.app_id,
      type: r.type,
      subtype: r.subtype,
      environment: decoded.data?.environment,
      bundleId: decoded.data?.bundleId,
      receivedAt: r.received_at,
    }
  })
  return c.json({ events, nextBefore: events.length === limit ? events[events.length - 1].receivedAt : null })
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

// 订阅列表与单订阅事件时间线
api.get('/subscriptions', async (c) => {
  const status = c.req.query('status')
  const rows = await c.env.DB.prepare(
    `SELECT * FROM subscriptions ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC LIMIT 200`
  )
    .bind(...(status ? [status] : []))
    .all()
  return c.json(rows.results)
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

  const conditions = ['r.created_at < ?']
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

// 立即抓取销售报告（账单数据，回填最近 30 天）
api.post('/jobs/fetch-sales', async (c) => {
  const result = await fetchSalesJob(c.env.DB)
  const days = await c.env.DB.prepare('SELECT COUNT(DISTINCT date) AS n FROM sales_daily').first<{ n: number }>()
  return c.json({ ok: true, ...result, totalDays: days?.n ?? 0 })
})

// 每日账单聚合（下载量 + 结算收入，折算 USD）
api.get('/sales/daily', async (c) => {
  const days = Math.min(Number(c.req.query('days') ?? 30), 365)
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const fx = await fxRates(c.env.DB)
  const rows = await c.env.DB.prepare('SELECT date, product_type, units, proceeds_milli, currency FROM sales_daily WHERE date >= ?')
    .bind(since)
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
    .first()
  return c.json(row)
})

api.put('/apps/:id', async (c) => {
  const body = await c.req.json<{ name?: string; asc_app_id?: string }>()
  await c.env.DB.prepare('UPDATE apps SET name = COALESCE(?, name), asc_app_id = COALESCE(?, asc_app_id) WHERE id = ?')
    .bind(body.name ?? null, body.asc_app_id ?? null, Number(c.req.param('id')))
    .run()
  return c.json({ ok: true })
})
