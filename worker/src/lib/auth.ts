// 统一鉴权：Cloudflare Access 优先，Access Token 作为兜底
//
// 迁移策略（重要）：Access 配好之前、或 Access 校验失败时，仍接受 token —— 否则一旦
// Zero Trust 配错就把自己锁在外面，连改配置的页面都进不去。确认 Access 可用后在设置页
// 关掉兜底（config.auth_token_fallback = 'off'），此后 token 一律无效。
//
// token 只存 SHA-256：D1 导出、备份、或任何能读 config 的 bug 都不再直接给出可用凭证。
// 旧的明文 token（access_token）仍认，但校验成功时顺手升级成哈希并删掉明文。

import { accessTokenFromRequest, verifyAccessJwt, type AccessConfig, type AccessIdentity } from './access'

export type AuthMethod = 'access' | 'token'

export interface AuthResult {
  ok: boolean
  method?: AuthMethod
  identity?: AccessIdentity
  /** 拒绝原因，只用于日志与 401 body，不回显任何凭证信息 */
  reason?: 'no_credential' | 'bad_token' | 'bad_access' | 'locked' | 'not_initialized'
  retryAfterMs?: number
}

/** 连续失败节流：单用户场景不必上 KV，config 里记次数与解锁时间就够 */
const LOCK_THRESHOLD = 8
const LOCK_MS = 15 * 60_000

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 常数时间比较等长十六进制串（避免按前缀逐字节试探） */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function readConfig(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  const rows = await db
    .prepare(`SELECT key, value FROM config WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all<{ key: string; value: string }>()
  return Object.fromEntries(rows.results.map((r) => [r.key, r.value]))
}

async function putConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run()
}

export function accessConfigFrom(cfg: Record<string, string>): AccessConfig | null {
  const teamDomain = cfg.access_team_domain?.trim()
  const aud = cfg.access_aud?.trim()
  return teamDomain && aud ? { teamDomain, aud } : null
}

/**
 * 鉴权主入口。顺序：
 * 1. Access 已配置且 JWT 有效 → 放行（method='access'）
 * 2. token 兜底未关且 Bearer 匹配 → 放行（method='token'）
 * 3. 其余拒绝，并累计失败次数
 */
export async function authenticate(db: D1Database, req: Request, now = Date.now()): Promise<AuthResult> {
  const cfg = await readConfig(db, [
    'access_team_domain',
    'access_aud',
    'auth_token_fallback',
    'access_token',
    'access_token_sha256',
    'auth_fail_state',
  ])

  const accessCfg = accessConfigFrom(cfg)
  if (accessCfg) {
    const jwt = accessTokenFromRequest(req)
    if (jwt) {
      const identity = await verifyAccessJwt(jwt, accessCfg, now)
      if (identity) return { ok: true, method: 'access', identity }
    }
  }

  const fallbackOff = cfg.auth_token_fallback === 'off'
  const hashed = cfg.access_token_sha256
  const legacy = cfg.access_token
  if (!hashed && !legacy) return { ok: false, reason: 'not_initialized' }
  if (fallbackOff) return { ok: false, reason: accessCfg ? 'bad_access' : 'no_credential' }

  // 失败节流：只拦 token 路径，Access 路径由 Cloudflare 侧兜着
  const fail: { count: number; until: number } = cfg.auth_fail_state
    ? JSON.parse(cfg.auth_fail_state)
    : { count: 0, until: 0 }
  if (fail.until > now) return { ok: false, reason: 'locked', retryAfterMs: fail.until - now }

  const auth = req.headers.get('Authorization')
  const presented = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!presented) return { ok: false, reason: 'no_credential' }

  let matched = false
  if (hashed) {
    matched = timingSafeEqual(await sha256Hex(presented), hashed)
  } else if (legacy) {
    matched = timingSafeEqual(await sha256Hex(presented), await sha256Hex(legacy))
    // 明文旧 token 首次用对：立刻迁成哈希，明文不再留在库里
    if (matched) {
      await putConfig(db, 'access_token_sha256', await sha256Hex(presented))
      await db.prepare("DELETE FROM config WHERE key = 'access_token'").run()
    }
  }

  if (!matched) {
    const count = fail.count + 1
    await putConfig(
      db,
      'auth_fail_state',
      JSON.stringify({ count, until: count >= LOCK_THRESHOLD ? now + LOCK_MS : 0 })
    )
    return { ok: false, reason: 'bad_token' }
  }
  if (fail.count) await putConfig(db, 'auth_fail_state', JSON.stringify({ count: 0, until: 0 }))
  return { ok: true, method: 'token' }
}

/** 当前认证状态（设置页展示用；不回显任何凭证） */
export async function authStatus(
  db: D1Database,
  req: Request,
  now = Date.now()
): Promise<{
  method: AuthMethod | null
  email: string | null
  accessConfigured: boolean
  accessTeamDomain: string | null
  accessAud: string | null
  tokenFallback: boolean
  tokenSet: boolean
  sessionExpiresAt: number | null
}> {
  const cfg = await readConfig(db, [
    'access_team_domain',
    'access_aud',
    'auth_token_fallback',
    'access_token',
    'access_token_sha256',
  ])
  const accessCfg = accessConfigFrom(cfg)
  let method: AuthMethod | null = null
  let identity: AccessIdentity | null = null
  if (accessCfg) {
    const jwt = accessTokenFromRequest(req)
    if (jwt) identity = await verifyAccessJwt(jwt, accessCfg, now)
    if (identity) method = 'access'
  }
  if (!method) method = 'token'
  return {
    method,
    email: identity?.email ?? null,
    accessConfigured: !!accessCfg,
    accessTeamDomain: cfg.access_team_domain ?? null,
    accessAud: cfg.access_aud ? `${cfg.access_aud.slice(0, 6)}…${cfg.access_aud.slice(-4)}` : null,
    tokenFallback: cfg.auth_token_fallback !== 'off',
    tokenSet: !!(cfg.access_token_sha256 || cfg.access_token),
    sessionExpiresAt: identity?.expiresAt ?? null,
  }
}

/** 生成新 token（32 字节），只存哈希，明文只返回给调用方显示一次 */
export async function rotateToken(db: D1Database): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await putConfig(db, 'access_token_sha256', await sha256Hex(token))
  await db.prepare("DELETE FROM config WHERE key = 'access_token'").run()
  await putConfig(db, 'auth_fail_state', JSON.stringify({ count: 0, until: 0 }))
  return token
}
