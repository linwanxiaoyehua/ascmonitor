// 鉴权：Cloudflare Access 校验 + token 兜底（哈希存储 / 常数时间比较 / 失败节流）

import { describe, expect, it } from 'vitest'
import { authenticate, rotateToken, sha256Hex, timingSafeEqual } from '../src/lib/auth'
import { verifyAccessJwt } from '../src/lib/access'

/** 内存版 config 表：够跑 authenticate 的读写路径（SELECT … IN / UPSERT / DELETE） */
function fakeDb(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const run = (sql: string, binds: unknown[]) => {
    if (/^SELECT key, value FROM config WHERE key IN/.test(sql)) {
      const results = binds
        .filter((k): k is string => typeof k === 'string' && store.has(k))
        .map((k) => ({ key: k, value: store.get(k)! }))
      return { results }
    }
    if (/^INSERT INTO config/.test(sql)) {
      store.set(binds[0] as string, binds[1] as string)
      return { results: [] }
    }
    if (/^SELECT value FROM config WHERE key IN/.test(sql)) {
      const hit = binds.find((k): k is string => typeof k === 'string' && store.has(k))
      return { results: hit ? [{ value: store.get(hit)! }] : [] }
    }
    if (/^DELETE FROM config WHERE key =/.test(sql)) {
      const key = /key = '([^']+)'/.exec(sql)?.[1]
      if (key) store.delete(key)
      return { results: [] }
    }
    throw new Error(`fakeDb 未覆盖的 SQL: ${sql}`)
  }
  const db = {
    prepare: (sql: string) => {
      const stmt = {
        bind: (...binds: unknown[]) => ({
          all: async () => run(sql, binds),
          first: async () => run(sql, binds).results[0] ?? null,
          run: async () => run(sql, binds),
        }),
        all: async () => run(sql, []),
        first: async () => run(sql, []).results[0] ?? null,
        run: async () => run(sql, []),
      }
      return stmt
    },
  } as unknown as D1Database
  return { db, store }
}

const req = (headers: Record<string, string> = {}) => new Request('https://asc.example.com/api/apps', { headers })

describe('timingSafeEqual', () => {
  it('同值为真，不同值为假，长度不同直接假', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
    expect(timingSafeEqual('abc', 'abc123')).toBe(false)
  })
})

describe('token 兜底', () => {
  it('未初始化时报 not_initialized（放行 setup 由路由层判断）', async () => {
    const { db } = fakeDb()
    expect(await authenticate(db, req())).toMatchObject({ ok: false, reason: 'not_initialized' })
  })

  it('哈希匹配放行，错误 token 拒绝', async () => {
    const { db } = fakeDb({ access_token_sha256: await sha256Hex('good-token') })
    expect(await authenticate(db, req({ Authorization: 'Bearer good-token' }))).toMatchObject({
      ok: true,
      method: 'token',
    })
    expect(await authenticate(db, req({ Authorization: 'Bearer bad-token' }))).toMatchObject({
      ok: false,
      reason: 'bad_token',
    })
  })

  it('旧明文 token 首次用对即迁成哈希，明文从库里删掉', async () => {
    const { db, store } = fakeDb({ access_token: 'legacy-plain' })
    expect(await authenticate(db, req({ Authorization: 'Bearer legacy-plain' }))).toMatchObject({ ok: true })
    expect(store.has('access_token')).toBe(false)
    expect(store.get('access_token_sha256')).toBe(await sha256Hex('legacy-plain'))
  })

  it('连续失败到阈值后锁定，正确 token 也要等解锁', async () => {
    const { db } = fakeDb({ access_token_sha256: await sha256Hex('good') })
    for (let i = 0; i < 8; i++) await authenticate(db, req({ Authorization: 'Bearer wrong' }))
    const locked = await authenticate(db, req({ Authorization: 'Bearer good' }))
    expect(locked).toMatchObject({ ok: false, reason: 'locked' })
    expect(locked.retryAfterMs).toBeGreaterThan(0)
  })

  it('兜底关闭后 token 一律无效', async () => {
    const { db } = fakeDb({
      access_token_sha256: await sha256Hex('good'),
      auth_token_fallback: 'off',
      access_team_domain: 'demo.cloudflareaccess.com',
      access_aud: 'a'.repeat(64),
    })
    expect(await authenticate(db, req({ Authorization: 'Bearer good' }))).toMatchObject({ ok: false })
  })

  it('轮换后旧 token 失效、新 token 生效', async () => {
    const { db } = fakeDb({ access_token_sha256: await sha256Hex('old') })
    const fresh = await rotateToken(db)
    expect(await authenticate(db, req({ Authorization: 'Bearer old' }))).toMatchObject({ ok: false })
    expect(await authenticate(db, req({ Authorization: `Bearer ${fresh}` }))).toMatchObject({ ok: true })
  })
})

/* ---- Access JWT：用临时 RSA 密钥自签，走真实验签路径 ---- */

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const TEAM = 'demo.cloudflareaccess.com'
const AUD = 'b'.repeat(64)

async function signedJwt(claims: Record<string, unknown>, kid = 'test-key') {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })))
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  )
  return { jwt: `${header}.${payload}.${b64url(sig)}`, jwks: { keys: [{ ...jwk, kid, alg: 'RS256' }] } }
}

/** 替掉全局 fetch，让 JWKS 拉取命中我们自签的公钥 */
function withJwks<T>(jwks: unknown, teamDomain: string, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === `https://${teamDomain}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify(jwks), { headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`未预期的 fetch: ${url}`)
  }) as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = original
  })
}

describe('Cloudflare Access JWT', () => {
  const now = Date.parse('2026-07-30T00:00:00Z')
  const base = {
    iss: `https://${TEAM}`,
    aud: [AUD],
    email: 'me@example.com',
    sub: 'user-1',
    exp: Math.floor(now / 1000) + 3600,
  }

  it('签名与 aud / iss 都对 → 通过并给出身份', async () => {
    // 每个用例各自生成密钥（团队域名带索引，绕开 isolate 内的 JWKS 缓存）
    const team = `t1.${TEAM}`
    const { jwt, jwks } = await signedJwt({ ...base, iss: `https://${team}` })
    const identity = await withJwks(jwks, team, () =>
      verifyAccessJwt(jwt, { teamDomain: team, aud: AUD }, now)
    )
    expect(identity).toMatchObject({ email: 'me@example.com', sub: 'user-1' })
  })

  it('aud 不是本应用 → 拒绝（别的 Access 应用的票不能用在这里）', async () => {
    const team = `t2.${TEAM}`
    const { jwt, jwks } = await signedJwt({ ...base, iss: `https://${team}`, aud: ['c'.repeat(64)] })
    expect(await withJwks(jwks, team, () => verifyAccessJwt(jwt, { teamDomain: team, aud: AUD }, now))).toBeNull()
  })

  it('iss 不是本团队 → 拒绝', async () => {
    const team = `t3.${TEAM}`
    const { jwt, jwks } = await signedJwt({ ...base, iss: 'https://evil.cloudflareaccess.com' })
    expect(await withJwks(jwks, team, () => verifyAccessJwt(jwt, { teamDomain: team, aud: AUD }, now))).toBeNull()
  })

  it('已过期 → 拒绝', async () => {
    const team = `t4.${TEAM}`
    const { jwt, jwks } = await signedJwt({ ...base, iss: `https://${team}`, exp: Math.floor(now / 1000) - 7200 })
    expect(await withJwks(jwks, team, () => verifyAccessJwt(jwt, { teamDomain: team, aud: AUD }, now))).toBeNull()
  })

  it('签名对不上（换了密钥）→ 拒绝', async () => {
    const team = `t5.${TEAM}`
    const { jwt } = await signedJwt({ ...base, iss: `https://${team}` })
    const other = await signedJwt({ ...base, iss: `https://${team}` }) // 另一对密钥，kid 相同
    expect(await withJwks(other.jwks, team, () => verifyAccessJwt(jwt, { teamDomain: team, aud: AUD }, now))).toBeNull()
  })

  it('伪造请求头没有有效签名 → authenticate 不放行', async () => {
    const { db } = fakeDb({
      access_team_domain: `t6.${TEAM}`,
      access_aud: AUD,
      auth_token_fallback: 'off',
      access_token_sha256: await sha256Hex('good'),
    })
    const { jwks } = await signedJwt(base)
    const result = await withJwks(jwks, `t6.${TEAM}`, () =>
      authenticate(db, req({ 'Cf-Access-Jwt-Assertion': 'not.a.jwt' }), now)
    )
    expect(result.ok).toBe(false)
  })

  it('Access 通过时即使 token 兜底已关也放行', async () => {
    const team = `t7.${TEAM}`
    const { jwt, jwks } = await signedJwt({ ...base, iss: `https://${team}` })
    const { db } = fakeDb({ access_team_domain: team, access_aud: AUD, auth_token_fallback: 'off' })
    const result = await withJwks(jwks, team, () => authenticate(db, req({ 'Cf-Access-Jwt-Assertion': jwt }), now))
    expect(result).toMatchObject({ ok: true, method: 'access' })
  })
})
