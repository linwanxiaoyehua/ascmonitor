// App Store Connect API 客户端：ES256 JWT 签发 + customerReviews 拉取
// 凭证存 config 表：asc_key_id / asc_issuer_id / asc_private_key（.p8 PEM 内容）

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export interface AscCredentials {
  keyId: string
  issuerId: string
  privateKeyPem: string
}

export async function loadAscCredentials(db: D1Database): Promise<AscCredentials | null> {
  const rows = await db
    .prepare("SELECT key, value FROM config WHERE key IN ('asc_key_id', 'asc_issuer_id', 'asc_private_key')")
    .all<{ key: string; value: string }>()
  const map = Object.fromEntries(rows.results.map((r) => [r.key, r.value]))
  if (!map.asc_key_id || !map.asc_issuer_id || !map.asc_private_key) return null
  return { keyId: map.asc_key_id, issuerId: map.asc_issuer_id, privateKeyPem: map.asc_private_key }
}

/** 签发 ASC API JWT（有效期 15 分钟，按 Apple 上限 ≤20min） */
export async function ascJwt(creds: AscCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' })))
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ iss: creds.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })
    )
  )
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(creds.privateKeyPem) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`))
  )
  return `${header}.${payload}.${b64url(sig)}`
}

export interface AscReview {
  id: string
  attributes: {
    rating: number
    title: string | null
    body: string | null
    reviewerNickname: string | null
    createdDate: string
    territory: string
  }
}

/** 拉取 App 的客户评论（按创建时间倒序，一页最多 200 条） */
export async function fetchCustomerReviews(
  creds: AscCredentials,
  ascAppId: string,
  cursor?: string
): Promise<{ reviews: AscReview[]; nextCursor: string | null }> {
  const url = cursor
    ? cursor
    : `https://api.appstoreconnect.apple.com/v1/apps/${ascAppId}/customerReviews?sort=-createdDate&limit=200`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await ascJwt(creds)}` } })
  if (!res.ok) throw new Error(`ASC API ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data: AscReview[]; links?: { next?: string } }
  return { reviews: json.data, nextCursor: json.links?.next ?? null }
}
