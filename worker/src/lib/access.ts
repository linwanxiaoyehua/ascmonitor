// Cloudflare Access（Zero Trust）身份校验
//
// Access 坐在 Worker 前面：用户在 Cloudflare 侧完成登录（邮箱 OTP / Google / …），
// Cloudflare 给通过的请求签一个 JWT，放在 CF_Authorization cookie 与
// Cf-Access-Jwt-Assertion 请求头里。我们这边只负责验签 —— 不再自己保管任何长期凭证。
//
// 为什么必须验签而不是「有这个头就信」：Worker 的 workers.dev 域名不受 Access 保护，
// 请求头是可以伪造的。签名 + aud 校验才是真正的门。

export interface AccessConfig {
  /** 团队域名，如 xiaoyehua.cloudflareaccess.com */
  teamDomain: string
  /** Access 应用的 Application Audience (AUD) tag */
  aud: string
}

export interface AccessIdentity {
  email: string | null
  /** JWT sub：Access 用户 ID */
  sub: string | null
  expiresAt: number | null
}

interface Jwk {
  kid: string
  kty: string
  alg?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

/** JWKS 按团队域名缓存在 isolate 内存里（公钥轮换周期以周计，1 小时足够新） */
const JWKS_TTL_MS = 3600_000
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()

async function fetchJwks(teamDomain: string, now: number): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain)
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`access certs ${res.status}`)
  const json = (await res.json()) as { keys?: Jwk[] }
  const keys = json.keys ?? []
  jwksCache.set(teamDomain, { keys, fetchedAt: now })
  return keys
}

const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Access 目前签 RS256，ES256 一并支持以防将来切换 */
async function verifySignature(alg: string, jwk: Jwk, signature: Uint8Array, signed: Uint8Array): Promise<boolean> {
  try {
    if (alg === 'RS256') {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk as JsonWebKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      )
      return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature as BufferSource, signed as BufferSource)
    }
    if (alg === 'ES256') {
      const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'verify',
      ])
      return crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signature as BufferSource,
        signed as BufferSource
      )
    }
  } catch {
    // 公钥与 alg 不匹配（JWKS 轮换到别的算法）时按验签失败处理
  }
  return false
}

/**
 * 校验 Access JWT，通过返回身份，否则返回 null。
 * 校验项：签名、aud 命中本应用、iss 是本团队、exp / nbf 时间窗（留 60s 时钟偏移）。
 */
export async function verifyAccessJwt(
  token: string,
  cfg: AccessConfig,
  now = Date.now()
): Promise<AccessIdentity | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header: { alg?: string; kid?: string }
  let claims: { aud?: string | string[]; iss?: string; email?: string; sub?: string; exp?: number; nbf?: number }
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
  } catch {
    return null
  }

  if (!header.alg || !header.kid) return null

  // aud 是数组：一个 Access 应用一个 tag，必须命中我们配置的那个
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!auds.includes(cfg.aud)) return null
  if (claims.iss !== `https://${cfg.teamDomain}`) return null

  const skew = 60_000
  const sec = Math.floor(now / 1000)
  if (claims.exp != null && sec > claims.exp + skew / 1000) return null
  if (claims.nbf != null && sec < claims.nbf - skew / 1000) return null

  const jwk = (await fetchJwks(cfg.teamDomain, now)).find((k) => k.kid === header.kid)
  if (!jwk) return null

  const ok = await verifySignature(
    header.alg,
    jwk,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  )
  if (!ok) return null

  return {
    email: claims.email ?? null,
    sub: claims.sub ?? null,
    expiresAt: claims.exp != null ? claims.exp * 1000 : null,
  }
}

/** 从请求里取 Access JWT：Cloudflare 会同时给请求头与 cookie，两处都认 */
export function accessTokenFromRequest(req: Request): string | null {
  const header = req.headers.get('Cf-Access-Jwt-Assertion')
  if (header) return header
  const cookie = req.headers.get('Cookie')
  if (!cookie) return null
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie)
  return match ? decodeURIComponent(match[1]) : null
}
