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

export interface SalesReportRow {
  appleId: string
  sku: string
  productType: string
  units: number
  developerProceeds: number // 单价（开发者分成）
  currency: string
  country: string
}

/**
 * 拉取某日销售报告（gzip TSV）。该日无数据时 Apple 返回 404 → 返回 null。
 * 报告有约 1 天延迟，最早可取一年内。
 */
export async function fetchSalesReport(
  creds: AscCredentials,
  vendorNumber: string,
  date: string // YYYY-MM-DD
): Promise<SalesReportRow[] | null> {
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportDate]': date,
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': vendorNumber,
  })
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
    headers: { Authorization: `Bearer ${await ascJwt(creds)}`, Accept: 'application/a-gzip' },
  })
  if (res.status === 404) return null // 无该日数据
  if (!res.ok) throw new Error(`salesReports ${res.status}: ${await res.text()}`)

  const stream = res.body!.pipeThrough(new DecompressionStream('gzip'))
  const tsv = await new Response(stream).text()
  const lines = tsv.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split('\t')
  const col = (name: string) => headers.indexOf(name)
  const iAppleId = col('Apple Identifier')
  const iSku = col('SKU')
  const iType = col('Product Type Identifier')
  const iUnits = col('Units')
  const iProceeds = col('Developer Proceeds')
  const iCurrency = col('Currency of Proceeds')
  const iCountry = col('Country Code')

  return lines.slice(1).map((line) => {
    const f = line.split('\t')
    return {
      appleId: f[iAppleId],
      sku: f[iSku],
      productType: f[iType],
      units: Number(f[iUnits]) || 0,
      developerProceeds: Number(f[iProceeds]) || 0,
      currency: f[iCurrency] || 'USD',
      country: f[iCountry] || '',
    }
  })
}

export interface SubscriptionReportRow {
  appAppleId: string
  subscriptionName: string
  activeStandard: number
  activeTrial: number
  activeIntroPaid: number
}

/** 拉取某日订阅状态报告（截至该日的活跃订阅快照）。无数据返回 null。 */
export async function fetchSubscriptionReport(
  creds: AscCredentials,
  vendorNumber: string,
  date: string
): Promise<SubscriptionReportRow[] | null> {
  const tryVersion = async (version: string) => {
    const params = new URLSearchParams({
      'filter[frequency]': 'DAILY',
      'filter[reportDate]': date,
      'filter[reportType]': 'SUBSCRIPTION',
      'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': vendorNumber,
      'filter[version]': version,
    })
    return fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
      headers: { Authorization: `Bearer ${await ascJwt(creds)}`, Accept: 'application/a-gzip' },
    })
  }
  let res = await tryVersion('1_4')
  if (res.status === 400) res = await tryVersion('1_3')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`subscriptionReport ${res.status}: ${await res.text()}`)

  const tsv = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).text()
  const lines = tsv.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split('\t')
  const col = (name: string) => headers.indexOf(name)
  const num = (f: string[], i: number) => (i >= 0 ? Number(f[i]) || 0 : 0)
  const iAppleId = col('App Apple ID')
  const iName = col('Subscription Name')
  const iStandard = col('Active Standard Price Subscriptions')
  const iTrial = col('Active Free Trial Introductory Offer Subscriptions')
  const iPayUpFront = col('Active Pay Up Front Introductory Offer Subscriptions')
  const iPayAsYouGo = col('Active Pay As You Go Introductory Offer Subscriptions')

  return lines.slice(1).map((line) => {
    const f = line.split('\t')
    return {
      appAppleId: f[iAppleId] ?? '',
      subscriptionName: iName >= 0 ? f[iName] : '',
      activeStandard: num(f, iStandard),
      activeTrial: num(f, iTrial),
      activeIntroPaid: num(f, iPayUpFront) + num(f, iPayAsYouGo),
    }
  })
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
