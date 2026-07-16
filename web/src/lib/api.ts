// API 客户端：Bearer token 存 localStorage

const TOKEN_KEY = 'ascmonitor_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
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

export interface Overview {
  todayRevenueUsdMilli: number
  mrrUsdMilli: number
  activeSubs: number
  trialSubs: number
  todayNewSubs: number
  todayRenewals: number
  todayRefunds: number
  autoRenewOffCount: number
}

export interface AppRow {
  id: number
  bundle_id: string
  name: string
  asc_app_id: string | null
}

export interface EventRow {
  uuid: string
  appId: number | null
  type: string
  subtype: string | null
  environment?: string
  bundleId?: string
  receivedAt: number
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

export interface AlertEvent {
  id: number
  kind: string
  title: string
  body: string
  fired_at: number
  delivered: number
}

export function usd(milli: number): string {
  return `$${(milli / 1000).toFixed(2)}`
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return new Date(ts).toLocaleDateString()
}
