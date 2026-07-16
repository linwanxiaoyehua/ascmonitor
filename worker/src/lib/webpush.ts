// Web Push：VAPID (RFC 8292) + aes128gcm 消息加密 (RFC 8291/8188)
// 纯 WebCrypto 实现，零依赖

export interface VapidKeys {
  /** base64url raw 公钥（65 字节，前端 applicationServerKey 直接可用） */
  publicKey: string
  /** JWK 私钥 */
  privateJwk: JsonWebKey
}

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair
  const rawPub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: b64url(rawPub), privateJwk }
}

async function vapidAuthHeader(keys: VapidKeys, endpoint: string, subject: string): Promise<string> {
  const { origin } = new URL(endpoint)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
    )
  )
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`))
  )
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicKey}`
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8
  )
  return new Uint8Array(bits)
}

/** RFC 8291 aes128gcm 加密 */
async function encryptPayload(
  payload: Uint8Array,
  p256dh: Uint8Array,
  auth: Uint8Array
): Promise<Uint8Array> {
  // 临时 ECDH 密钥对（应用服务器侧）
  const asPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', asPair.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', p256dh as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPair.privateKey, 256)
  )

  const te = new TextEncoder()
  // IKM = HKDF(salt=auth, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(auth, ecdhSecret, concat(te.encode('WebPush: info\0'), p256dh, asPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)

  // 单记录：payload + 0x02 分隔符（最后一条记录）
  const plaintext = concat(payload, new Uint8Array([0x02]))
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext as BufferSource)
  )

  // aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(as_public 65)
  const header = new Uint8Array(16 + 4 + 1 + asPub.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPub.length
  header.set(asPub, 21)
  return concat(header, ciphertext)
}

export async function sendWebPush(
  keys: VapidKeys,
  subscription: PushSubscriptionRow,
  payload: string,
  ttl = 86400
): Promise<void> {
  const body = await encryptPayload(
    new TextEncoder().encode(payload),
    b64urlDecode(subscription.p256dh),
    b64urlDecode(subscription.auth)
  )
  const subject = 'mailto:ops@example.com'
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(keys, subscription.endpoint, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body: body as BodyInit,
  })
  if (!res.ok) throw new Error(`Push failed: ${res.status} ${await res.text()}`)
}
