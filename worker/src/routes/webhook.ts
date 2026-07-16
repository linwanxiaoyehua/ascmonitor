import { Hono } from 'hono'
import type { Env } from '../types'
import { verifyAppleJws, type NotificationPayload, type TransactionInfo, type RenewalInfo } from '../lib/assn'
import { processNotification } from '../lib/events'
import { notify } from '../lib/notify'

export const webhook = new Hono<{ Bindings: Env }>()

// App Store Server Notifications V2 接收端点
webhook.post('/assn', async (c) => {
  let body: { signedPayload?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.text('Bad Request', 400)
  }
  if (!body.signedPayload) return c.text('Bad Request', 400)

  // 验签失败返回 401（Apple 会重试，但伪造请求不会入库）
  let payload: NotificationPayload
  try {
    payload = await verifyAppleJws<NotificationPayload>(body.signedPayload)
  } catch (err) {
    console.error('ASSN verify failed:', err)
    return c.text('Unauthorized', 401)
  }

  // 幂等：uuid 冲突即已处理过，直接 200
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO notifications_raw (uuid, type, subtype, signed_payload, decoded_json)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      payload.notificationUUID,
      payload.notificationType,
      payload.subtype ?? null,
      body.signedPayload,
      JSON.stringify(payload)
    )
    .run()
  if (!inserted.meta.changes) return c.text('OK', 200)

  // 内层 JWS 同样需要验签
  let tx: TransactionInfo | null = null
  let renewal: RenewalInfo | null = null
  if (payload.data?.signedTransactionInfo) {
    tx = await verifyAppleJws<TransactionInfo>(payload.data.signedTransactionInfo)
  }
  if (payload.data?.signedRenewalInfo) {
    renewal = await verifyAppleJws<RenewalInfo>(payload.data.signedRenewalInfo)
  }

  const event = await processNotification(c.env.DB, payload, tx, renewal, payload.notificationUUID)

  // 沙盒事件入库但不推送
  if (event.notify && payload.data?.environment !== 'Sandbox') {
    c.executionCtx.waitUntil(notify(c.env.DB, 'transaction', event.title, event.body))
  }

  return c.text('OK', 200)
})
