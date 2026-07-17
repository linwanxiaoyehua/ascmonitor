// 展示层人性化：国旗、中文国家名、货币、subtype 中文标签

/** App Store storefront 用 ISO 3166-1 alpha-3，转 alpha-2 才能拼国旗 */
const A3_TO_A2: Record<string, string> = {
  USA: 'US', CHN: 'CN', JPN: 'JP', GBR: 'GB', DEU: 'DE', FRA: 'FR', ITA: 'IT', ESP: 'ES',
  KOR: 'KR', TWN: 'TW', HKG: 'HK', MAC: 'MO', SGP: 'SG', MYS: 'MY', THA: 'TH', VNM: 'VN',
  IDN: 'ID', PHL: 'PH', IND: 'IN', AUS: 'AU', NZL: 'NZ', CAN: 'CA', MEX: 'MX', BRA: 'BR',
  ARG: 'AR', CHL: 'CL', COL: 'CO', PER: 'PE', RUS: 'RU', UKR: 'UA', POL: 'PL', NLD: 'NL',
  BEL: 'BE', CHE: 'CH', AUT: 'AT', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', IRL: 'IE',
  PRT: 'PT', GRC: 'GR', CZE: 'CZ', HUN: 'HU', ROU: 'RO', TUR: 'TR', ISR: 'IL', SAU: 'SA',
  ARE: 'AE', EGY: 'EG', ZAF: 'ZA', NGA: 'NG', PAK: 'PK', BGD: 'BD', KAZ: 'KZ',
}

function toAlpha2(code: string): string | null {
  const c = code.trim().toUpperCase()
  if (c.length === 2) return c
  return A3_TO_A2[c] ?? null
}

/** "CHN" / "cn" → "🇨🇳"；识别不了返回空串 */
export function countryFlag(code?: string | null): string {
  if (!code) return ''
  const a2 = toAlpha2(code)
  if (!a2) return ''
  return String.fromCodePoint(...[...a2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

/** "CHN" / "cn" → "中国"；识别不了返回原码 */
export function countryName(code?: string | null): string {
  if (!code) return ''
  const a2 = toAlpha2(code)
  if (!a2) return code.toUpperCase()
  try {
    return new Intl.DisplayNames(['zh-Hans'], { type: 'region' }).of(a2) ?? a2
  } catch {
    return a2
  }
}

/** 国旗 + 中文名，如 "🇨🇳 中国" */
export function countryDisplay(code?: string | null): string {
  if (!code) return ''
  const flag = countryFlag(code)
  const name = countryName(code)
  return flag ? `${flag} ${name}` : name
}

/** 毫单位金额 + 币种 → "¥68.00" / "US$9.99" */
export function money(milli?: number | null, currency?: string | null): string {
  if (milli == null || !currency) return ''
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(milli / 1000)
  } catch {
    return `${(milli / 1000).toFixed(2)} ${currency}`
  }
}

/** 产品 ID 去掉 bundleId 前缀，只留人能认出的部分 */
export function productDisplay(productId?: string | null, bundleId?: string | null): string {
  if (!productId) return ''
  if (bundleId && productId.startsWith(`${bundleId}.`)) return productId.slice(bundleId.length + 1)
  const parts = productId.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : productId
}

const PERIOD_LABELS: Record<string, string> = { P1W: '周付', P1M: '月付', P3M: '季付', P6M: '半年付', P1Y: '年付' }

/** ISO 8601 周期 → 中文，如 "P1M" → "月付" */
export function periodLabel(period?: string | null): string {
  return period ? PERIOD_LABELS[period] ?? '' : ''
}

/** 到期时间人性化："3 天后到期" / "今天到期" / "已到期 5 天" */
export function expiresDisplay(ts?: number | null): string {
  if (!ts) return ''
  const days = Math.floor((ts - Date.now()) / 86400_000)
  if (days > 0) return `${days} 天后到期`
  if (days === 0) return '今天到期'
  return `已到期 ${-days} 天`
}

/** 产生收入的事件类型（事件流金额高亮用） */
export const REVENUE_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE'])

/** ASSN subtype → 中文 */
export const SUBTYPE_LABELS: Record<string, string> = {
  INITIAL_BUY: '首次订阅',
  RESUBSCRIBE: '重新订阅',
  UPGRADE: '升级',
  DOWNGRADE: '降级',
  AUTO_RENEW_ENABLED: '开启自动续费',
  AUTO_RENEW_DISABLED: '关闭自动续费',
  GRACE_PERIOD: '宽限期',
  BILLING_RETRY: '扣款重试',
  BILLING_RECOVERY: '扣款恢复',
  VOLUNTARY: '主动取消',
  PRICE_INCREASE: '价格上调',
  PENDING: '待用户确认',
  ACCEPTED: '用户已接受',
  PRODUCT_NOT_FOR_SALE: '商品已下架',
  SUMMARY: '汇总',
  FAILURE: '失败',
}

export function subtypeLabel(subtype?: string | null): string {
  return subtype ? SUBTYPE_LABELS[subtype] ?? subtype : ''
}
