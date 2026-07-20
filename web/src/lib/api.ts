// API 客户端：Bearer token 存 localStorage

const TOKEN_KEY = 'ascmonitor_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as Promise<T>
}

/** 动态页按天分组的当日金额合计（USD 毫，退款已抵扣，可为负） */
export interface DayTotal {
  date: string
  usdMilli: number
  count: number
}

export interface Overview {
  todayRevenueUsdMilli: number
  mrrUsdMilli: number
  activeSubs: number
  trialSubs: number
  todayNewSubs: number
  todayRenewals: number
  todayRefunds: number
  autoRenewOffCount: number
  riskSubs: number
  todayReviews: number
  todayReviewAvg: number | null
  /** ASC 订阅报告快照（补全 Webhook 前的存量） */
  snapshot: { date: string; active: number; trials: number } | null
}

export interface AppRow {
  id: number
  bundle_id: string
  name: string
  asc_app_id: string | null
  icon_url: string | null
}

export interface MetricsDaily {
  app_id: number
  date: string
  revenue_milli: number
  new_subs: number
  renewals: number
  refunds: number
  active_subs: number
  mrr_milli: number
}

export interface Review {
  id: string
  app_id: number
  source: string
  country: string | null
  rating: number
  title: string
  body: string
  reviewer: string
  review_version: string | null
  created_at: number
  tags: string[]
  response_body?: string | null
  response_state?: string | null   // NULL=未回复 | PENDING_PUBLISH | PUBLISHED
  responded_at?: number | null
}

export interface RatingDistribution {
  distribution: Array<{ rating: number; count: number }>
  total: number
}

export interface VersionCompare {
  versions: Array<{ version: string; releasedAt: number | null; count: number; avg: number | null; badRate: number | null }>
}

export interface SubRow {
  original_transaction_id: string
  product_name?: string | null
  app_id: number | null
  product_id: string
  status: string
  auto_renew: number
  period: string | null
  price_milli: number | null
  currency: string | null
  country: string | null
  started_at: number | null
  expires_at: number | null
  updated_at: number
  app_name: string | null
  app_icon: string | null
  app_bundle_id: string | null
}

export interface TimelineRow {
  transaction_id: string
  product_id: string
  price_milli: number | null
  currency: string | null
  event_type: string
  refunded: number
  purchase_date: number | null
  notification_type: string | null
  subtype: string | null
  received_at: number | null
}

export interface PurchaseRow {
  transaction_id: string
  product_name?: string | null
  product_id: string
  type: string
  price_milli: number | null
  currency: string | null
  country: string | null
  purchase_date: number | null
  event_type: string
  refunded: number
  app_name: string | null
  app_icon: string | null
  app_bundle_id: string | null
}

export interface RatingSnapshot {
  app_id: number
  country: string
  date: string
  avg_rating: number | null
  ratings_count: number | null
}

export interface TagStat {
  tag: string
  count: number
}

export interface AlertRule {
  id: number
  app_id: number | null
  kind: string
  params_json: string
  channels_json: string
  silence_min: number
  enabled: number
}

/** /api/activity 合流项：ASSN 事件或告警 */
export type ActivityItem =
  | {
      kind: 'event'
      id: string
      ts: number
      type: string
      subtype: string | null
      environment?: string
      appId: number | null
      appName: string | null
      appIcon: string | null
      bundleId?: string
      productId: string | null
      productName?: string | null
      priceMilli: number | null
      currency: string | null
      country: string | null
    }
  | {
      kind: 'alert'
      id: string
      ts: number
      alertKind: string
      title: string
      body: string | null
    }

export interface SalesDaily {
  date: string
  downloads: number
  iapUnits: number
  proceedsUsdMilli: number
}

export interface Reconciliation {
  days: Array<{ date: string; eventsUsdMilli: number; estimatedUsdMilli: number; actualUsdMilli: number }>
  summary: {
    eventsUsdMilli: number
    estimatedUsdMilli: number
    actualUsdMilli: number
    proceedsRate: number
    diffPct: number | null
  }
}

export interface SubHealth {
  windowDays: number
  renewals: number
  firstRenewals: number
  repeatRenewals: number
  expirations: number
  renewalRate: number | null
  churnedVoluntary: number
  churnedInvoluntary: number
  activeAtStart: number
  churnRate: number | null
  refunds: number
  purchases: number
  refundRate: number | null
}

export interface TrialCohort {
  weekStart: string
  starts: number
  converted: number
  rate: number
}

export interface BreakdownRow {
  key: string
  label: string | null
  usdMilli: number
  count: number
}

export interface CohortRow {
  month: string
  subs: number
  revenueUsdMilli: number
  ltvUsdMilli: number
}

export interface AppOverviewRow {
  id: number
  name: string
  icon: string | null
  todayRevenueUsdMilli: number
  activeSubs: number
  trialSubs: number
  riskSubs: number
  todayReviews: number
  todayReviewAvg: number | null
}

export interface DataHealth {
  lastWebhookAt: number | null
  fxUpdatedAt: number | null
  fxAutoCount: number
  unconverted: Array<{ currency: string; count: number }>
  duplicateReviews: number
  rawNotifications: number
  rawPayloadBytes: number
  reprocessInProgress: boolean
}

