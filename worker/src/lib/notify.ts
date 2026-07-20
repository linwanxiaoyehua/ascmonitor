// 通知分发：记录 alert_events，并向所有 Web Push 订阅推送（M4 接入 webpush 实现）

import { sendWebPush } from './webpush'

export async function notify(
  db: D1Database,
  kind: string,
  title: string,
  body: string,
  opts?: { ruleId?: number; appId?: number | null; icon?: string | null; push?: boolean; tone?: string }
): Promise<void> {
  const event = await db
    .prepare(
      'INSERT INTO alert_events (rule_id, app_id, kind, title, body, tone) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
    )
    .bind(opts?.ruleId ?? null, opts?.appId ?? null, kind, title, body, opts?.tone ?? null)
    .first<{ id: number }>()

  // 规则渠道未含 "push" 时只记录事件不推送（channels_json 真正生效）
  if (opts?.push === false) return

  const subs = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all<{
    endpoint: string
    p256dh: string
    auth: string
  }>()
  if (!subs.results.length) return

  const vapid = await db.prepare("SELECT value FROM config WHERE key = 'vapid_keys'").first<{ value: string }>()
  if (!vapid) return

  let delivered = false
  for (const sub of subs.results) {
    try {
      await sendWebPush(JSON.parse(vapid.value), sub, JSON.stringify({ title, body, kind, icon: opts?.icon ?? undefined }))
      delivered = true
    } catch (err) {
      // 410/404 = 订阅失效，清理
      if (err instanceof Error && /41[04]/.test(err.message)) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
      }
    }
  }
  if (delivered && event) {
    await db.prepare('UPDATE alert_events SET delivered = 1 WHERE id = ?').bind(event.id).run()
  }
}
