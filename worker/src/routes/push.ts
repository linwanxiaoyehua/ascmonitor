import { Hono } from 'hono'
import type { Env } from '../types'
import { generateVapidKeys, sendWebPush, type VapidKeys } from '../lib/webpush'

export const push = new Hono<{ Bindings: Env }>()

// 与 /api 相同的 Bearer 鉴权
push.use('*', async (c, next) => {
  const row = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'access_token'").first<{ value: string }>()
  if (!row || c.req.header('Authorization') !== `Bearer ${row.value}`) return c.json({ error: 'unauthorized' }, 401)
  return next()
})

async function getOrCreateVapid(db: D1Database): Promise<VapidKeys> {
  const row = await db.prepare("SELECT value FROM config WHERE key = 'vapid_keys'").first<{ value: string }>()
  if (row) return JSON.parse(row.value)
  const keys = await generateVapidKeys()
  await db.prepare("INSERT INTO config (key, value) VALUES ('vapid_keys', ?)").bind(JSON.stringify(keys)).run()
  return keys
}

// 前端获取 applicationServerKey
push.get('/vapid-public-key', async (c) => {
  const keys = await getOrCreateVapid(c.env.DB)
  return c.json({ publicKey: keys.publicKey })
})

// 注册推送订阅
push.post('/subscribe', async (c) => {
  const sub = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>()
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return c.json({ error: 'bad_subscription' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  )
    .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth)
    .run()
  return c.json({ ok: true })
})

push.post('/unsubscribe', async (c) => {
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
  return c.json({ ok: true })
})

// 测试推送
push.post('/test', async (c) => {
  const keys = await getOrCreateVapid(c.env.DB)
  const subs = await c.env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all<{
    endpoint: string
    p256dh: string
    auth: string
  }>()
  let sent = 0
  const errors: string[] = []
  for (const sub of subs.results) {
    try {
      await sendWebPush(keys, sub, JSON.stringify({ title: '🔔 测试推送', body: 'ASCMonitor 推送链路正常' }))
      sent++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  return c.json({ sent, total: subs.results.length, errors })
})
