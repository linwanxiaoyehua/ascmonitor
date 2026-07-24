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

/** 签发 ASC API JWT（有效期 15 分钟，按 Apple 上限 ≤20min）；App Store Server API 需带 bid=Bundle ID */
export async function ascJwt(creds: AscCredentials, bid?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' })))
  const claims: Record<string, unknown> = { iss: creds.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }
  if (bid) claims.bid = bid
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
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

export interface AscProduct {
  productId: string
  name: string
  type: string
}

/**
 * 拉取 App 的产品目录：自动续订订阅（subscriptionGroups?include=subscriptions）+ 内购（inAppPurchasesV2）。
 * name 为 ASC referenceName（开发者内部名，展示层替代裸 product_id）。
 */
export async function fetchProducts(creds: AscCredentials, ascAppId: string): Promise<AscProduct[]> {
  const jwt = await ascJwt(creds)
  const headers = { Authorization: `Bearer ${jwt}` }
  const products: AscProduct[] = []

  // 订阅：include 展开每个订阅组下的 subscriptions
  const subsRes = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${ascAppId}/subscriptionGroups?include=subscriptions&limit=50`,
    { headers }
  )
  if (subsRes.ok) {
    const json = (await subsRes.json()) as {
      included?: Array<{ type: string; attributes?: { name?: string; productId?: string } }>
    }
    for (const item of json.included ?? []) {
      if (item.type === 'subscriptions' && item.attributes?.productId && item.attributes.name) {
        products.push({ productId: item.attributes.productId, name: item.attributes.name, type: 'subscription' })
      }
    }
  }

  // 内购（消耗型 / 买断 / 非续订订阅）
  const iapRes = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${ascAppId}/inAppPurchasesV2?limit=200`,
    { headers }
  )
  if (iapRes.ok) {
    const json = (await iapRes.json()) as {
      data?: Array<{ attributes?: { name?: string; productId?: string; inAppPurchaseType?: string } }>
    }
    for (const item of json.data ?? []) {
      if (item.attributes?.productId && item.attributes.name) {
        products.push({
          productId: item.attributes.productId,
          name: item.attributes.name,
          type: item.attributes.inAppPurchaseType ?? 'iap',
        })
      }
    }
  }

  return products
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
  relationships?: { response?: { data?: { id: string } | null } }
  /** 由 included 解析附加（开发者回复） */
  responseBody?: string | null
  responseState?: string | null
}

interface ReviewResponseResource {
  id: string
  type: string
  attributes?: { responseBody?: string; state?: string }
}

/** 拉取 App 的客户评论（按创建时间倒序，一页最多 200 条）；include=response 同步开发者回复状态 */
export async function fetchCustomerReviews(
  creds: AscCredentials,
  ascAppId: string,
  cursor?: string
): Promise<{ reviews: AscReview[]; nextCursor: string | null }> {
  const url = cursor
    ? cursor
    : `https://api.appstoreconnect.apple.com/v1/apps/${ascAppId}/customerReviews` +
      `?sort=-createdDate&limit=200&include=response&fields[customerReviewResponses]=responseBody,state`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await ascJwt(creds)}` } })
  if (!res.ok) throw new Error(`ASC API ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data: AscReview[]; included?: ReviewResponseResource[]; links?: { next?: string } }

  // included 里的回复按 id 索引，回填到对应评论
  const responses = new Map<string, ReviewResponseResource>()
  for (const inc of json.included ?? []) {
    if (inc.type === 'customerReviewResponses') responses.set(inc.id, inc)
  }
  for (const r of json.data) {
    const respId = r.relationships?.response?.data?.id
    const resp = respId ? responses.get(respId) : undefined
    r.responseBody = resp?.attributes?.responseBody ?? null
    r.responseState = resp?.attributes?.state ?? null
  }
  return { reviews: json.data, nextCursor: json.links?.next ?? null }
}

/** 发布/更新对某条评论的开发者回复（需 Admin / App Manager / Customer Support 角色的 Key） */
export async function postReviewResponse(creds: AscCredentials, reviewId: string, body: string): Promise<string> {
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/customerReviewResponses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await ascJwt(creds)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: body },
        relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
      },
    }),
  })
  if (!res.ok) throw new Error(`review response ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { attributes?: { state?: string } } }
  return json.data?.attributes?.state ?? 'PENDING_PUBLISH'
}

/* ---------- Webhook 注册 ---------- */

/** 我们订阅的三类事件：构建上传、外部 TestFlight（含 Beta 审核流转）、上架审核 */
export const ASC_WEBHOOK_EVENTS = [
  'BUILD_UPLOAD_STATE_UPDATED',
  'BUILD_BETA_DETAIL_EXTERNAL_BUILD_STATE_UPDATED',
  'APP_STORE_VERSION_APP_VERSION_STATE_UPDATED',
]

/** 一个 webhook 只能绑一个 App，多 App 需各自注册（每 App 上限 10 个） */
export async function createWebhook(
  creds: AscCredentials,
  ascAppId: string,
  url: string,
  secret: string,
  name = 'ASCMonitor'
): Promise<string> {
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/webhooks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await ascJwt(creds)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'webhooks',
        attributes: { enabled: true, eventTypes: ASC_WEBHOOK_EVENTS, name, secret, url },
        relationships: { app: { data: { type: 'apps', id: ascAppId } } },
      },
    }),
  })
  if (!res.ok) throw new Error(`create webhook ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: { id?: string } }
  if (!json.data?.id) throw new Error('create webhook: 响应缺少 id')
  return json.data.id
}

export async function deleteWebhook(creds: AscCredentials, webhookId: string): Promise<void> {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/webhooks/${webhookId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await ascJwt(creds)}` },
  })
  // 404 = 已经不在了，视作成功
  if (!res.ok && res.status !== 404) throw new Error(`delete webhook ${res.status}: ${await res.text()}`)
}

export interface NotificationHistoryPage {
  notifications: string[] // signedPayload（JWS）字符串，与 webhook 同构
  hasMore: boolean
  paginationToken?: string
}

/** App Store Server API - Get Notification History（近 180 天历史通知）。
 *  需要 bid=Bundle ID 的 JWT；生产环境端点。401 多为需「In-App Purchase」密钥。 */
export async function fetchNotificationHistory(
  creds: AscCredentials,
  bundleId: string,
  params: { startDate: number; endDate: number; paginationToken?: string },
  sandbox = false
): Promise<NotificationHistoryPage> {
  const jwt = await ascJwt(creds, bundleId)
  // App Store Server API 的主机与 App Store Connect API 不同（后者是 api.appstoreconnect.apple.com）
  const host = sandbox ? 'https://api.storekit-sandbox.itunes.apple.com' : 'https://api.storekit.itunes.apple.com'
  const url = `${host}/inApps/v1/notifications/history${params.paginationToken ? `?paginationToken=${encodeURIComponent(params.paginationToken)}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: params.startDate, endDate: params.endDate }),
  })
  if (!res.ok) throw new Error(`notificationHistory ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { notificationHistory?: Array<{ signedPayload: string }>; hasMore?: boolean; paginationToken?: string }
  return {
    notifications: (json.notificationHistory ?? []).map((n) => n.signedPayload).filter(Boolean),
    hasMore: !!json.hasMore,
    paginationToken: json.paginationToken,
  }
}

/* ---------- 构建 / 审核状态（webhook 的对账兜底，每 App 2 个子请求）---------- */

export interface AscBuildStatus {
  buildId: string
  /** builds.attributes.version 实际是构建号（42），不是 1.2.3 */
  buildNumber: string | null
  processingState: string | null
  externalBuildState: string | null
}

export interface AscVersionStatus {
  versionId: string
  versionString: string | null
  appVersionState: string | null
}

/**
 * 最新一个构建的处理状态 + 外部 TestFlight 状态。
 * include=buildBetaDetail 把两者一次取回 —— 分开查会翻倍子请求，
 * Beta 审核流转（WAITING_FOR_BETA_REVIEW → IN_BETA_REVIEW → BETA_APPROVED/REJECTED）
 * 已体现在 externalBuildState 里，无需再 include betaAppReviewSubmission。
 */
export async function fetchBuildStatus(creds: AscCredentials, ascAppId: string): Promise<AscBuildStatus | null> {
  const params = new URLSearchParams({
    'filter[app]': ascAppId,
    sort: '-uploadedDate',
    limit: '1',
    include: 'buildBetaDetail',
    'fields[builds]': 'version,uploadedDate,processingState',
    'fields[buildBetaDetails]': 'internalBuildState,externalBuildState',
  })
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?${params}`, {
    headers: { Authorization: `Bearer ${await ascJwt(creds)}` },
  })
  if (!res.ok) return null
  const json = (await res.json()) as {
    data?: Array<{ id: string; attributes?: { version?: string; processingState?: string } }>
    included?: Array<{ type: string; attributes?: { externalBuildState?: string } }>
  }
  const build = json.data?.[0]
  if (!build) return null
  const detail = json.included?.find((i) => i.type === 'buildBetaDetails')
  return {
    buildId: build.id,
    buildNumber: build.attributes?.version ?? null,
    processingState: build.attributes?.processingState ?? null,
    externalBuildState: detail?.attributes?.externalBuildState ?? null,
  }
}

/**
 * 当前在办版本的上架审核状态（appVersionState；旧的 appStoreState 已弃用）。
 * appStoreVersions 的返回顺序未定义，所以取几条后跳过已被取代的版本，而不是盲取第一条。
 */
export async function fetchVersionStatus(creds: AscCredentials, ascAppId: string): Promise<AscVersionStatus | null> {
  const params = new URLSearchParams({
    limit: '5',
    'fields[appStoreVersions]': 'versionString,appVersionState,createdDate',
  })
  const res = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${ascAppId}/appStoreVersions?${params}`,
    { headers: { Authorization: `Bearer ${await ascJwt(creds)}` } }
  )
  if (!res.ok) return null
  const json = (await res.json()) as {
    data?: Array<{ id: string; attributes?: { versionString?: string; appVersionState?: string; createdDate?: string } }>
  }
  const versions = json.data ?? []
  const current =
    versions.find((v) => v.attributes?.appVersionState !== 'REPLACED_WITH_NEW_VERSION') ?? versions[0]
  if (!current) return null
  return {
    versionId: current.id,
    versionString: current.attributes?.versionString ?? null,
    appVersionState: current.attributes?.appVersionState ?? null,
  }
}
