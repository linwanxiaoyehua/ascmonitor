import { Hono } from 'hono'
import type { Env } from '../types'
import { verifyAppleJws, type NotificationPayload, type TransactionInfo, type RenewalInfo } from '../lib/assn'
import { processNotification } from '../lib/events'
import { notify } from '../lib/notify'
import { recordState, type BuildScope } from '../lib/build-status'

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
    c.executionCtx.waitUntil(notify(c.env.DB, 'transaction', event.title, event.body, { icon: event.icon }))
  }

  return c.text('OK', 200)
})

/* ---------- App Store Connect Webhook（构建 / 审核状态）---------- */

/**
 * 事件类型 → 本地 scope 与状态字段名。
 * 注意两点：
 * 1. 推送 body 里的 data.type 是 lowerCamelCase，与创建 webhook 时填的
 *    UPPER_SNAKE（BUILD_UPLOAD_STATE_UPDATED）不是一个东西
 * 2. 每个事件放新状态的字段名都不同，没法写通用解析
 */
const ASC_EVENTS: Record<string, { scope: BuildScope; field: string }> = {
  buildUploadStateUpdated: { scope: 'upload', field: 'newState' },
  buildBetaDetailExternalBuildStateUpdated: { scope: 'testflight', field: 'newExternalBuildState' },
  appStoreVersionAppVersionStateUpdated: { scope: 'appstore', field: 'newValue' },
}

/** x-apple-signature: hmacsha256=<hex>，HMAC-SHA256(secret, 原始 body)。
    用 subtle.verify 而非字符串比较 —— 后者不是常数时间，会泄漏签名信息 */
export async function verifyAscSignature(secret: string, rawBody: string, header?: string): Promise<boolean> {
  const prefix = 'hmacsha256='
  if (!header?.startsWith(prefix)) return false
  const hex = header.slice(prefix.length).trim()
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false
  const sig = new Uint8Array(hex.length / 2)
  for (let i = 0; i < sig.length; i++) sig[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify('HMAC', key, sig as BufferSource, new TextEncoder().encode(rawBody))
}

/**
 * ASC Webhook 接收端。
 * appId 走路径而非 body —— Apple 的 payload 里**不含任何 App 标识**（也没有版本号/构建号），
 * 靠路径带上就不必为了认领事件再回调一次 API。每个 App 注册各自的 URL 与 secret。
 */
webhook.post('/asc/:appId', async (c) => {
  const appId = Number(c.req.param('appId'))
  if (!Number.isInteger(appId) || appId <= 0) return c.text('Bad Request', 400)

  const cfg = await c.env.DB.prepare('SELECT value FROM config WHERE key = ?')
    .bind(`asc_webhook_${appId}`)
    .first<{ value: string }>()
  if (!cfg) return c.text('Not Found', 404)

  // 必须用原始字节验签：JSON.parse 后重新 stringify 会改变字节流，签名必然对不上
  const raw = await c.req.text()
  let secret: string
  try {
    secret = JSON.parse(cfg.value).secret
  } catch {
    return c.text('Not Found', 404)
  }
  if (!(await verifyAscSignature(secret, raw, c.req.header('x-apple-signature')))) {
    return c.text('Unauthorized', 401)
  }

  let body: {
    data?: {
      type?: string
      id?: string
      attributes?: Record<string, unknown>
      relationships?: { instance?: { data?: { id?: string } } }
    }
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return c.text('OK', 200) // 验签已过，形状不认识就吞掉，别让 Apple 记一次失败投递
  }

  const type = body.data?.type
  const mapping = type ? ASC_EVENTS[type] : undefined
  // ping 与未来新增的事件类型都会走到这里。Apple 未公开 ping 的 body 形状，
  // 也未公开重试策略与超时，所以一律 200，只记日志。
  if (!mapping) {
    console.log('ASC webhook: 未处理的事件类型', type)
    return c.text('OK', 200)
  }

  const state = body.data?.attributes?.[mapping.field]
  // 资源 id 在 relationships.instance，不是 data.id —— 后者是事件自身的 UUID，每次推送都不同，
  // 拿它当实体键会让每条事件都被当成新实体，状态比对永远失效
  const entityId = body.data?.relationships?.instance?.data?.id
  if (typeof state !== 'string' || !entityId) return c.text('OK', 200)

  // 尽快返回：Apple 会记录响应码，处理放到 waitUntil 里。
  // notifyOnFirstSight：webhook 事件本身就代表「状态变了」，即使本地没有基线也要推
  c.executionCtx.waitUntil(
    recordState(c.env.DB, { appId, scope: mapping.scope, entityId, state }, { notifyOnFirstSight: true }).catch((err) =>
      console.error('ASC webhook recordState failed:', err)
    )
  )
  return c.text('OK', 200)
})
