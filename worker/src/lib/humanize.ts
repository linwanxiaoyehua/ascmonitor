// 人类可读文案工具：国旗、中文国家名、货币符号、订阅周期、时长
// 推送/告警正文统一走这里，避免把 bundleId/ISO 码直接怼给用户

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

/** "CHN" / "cn" → "🇨🇳 中国"；识别不了就原样返回 */
export function countryDisplay(code?: string | null): string {
  if (!code) return ''
  const a2 = toAlpha2(code)
  if (!a2) return code
  const flag = String.fromCodePoint(...[...a2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
  let name = a2
  try {
    name = new Intl.DisplayNames(['zh-Hans'], { type: 'region' }).of(a2) ?? a2
  } catch {
    // 运行时无 ICU 数据时退回 alpha-2
  }
  return `${flag} ${name}`
}

/** 毫单位金额 + 币种 → 本地化货币串，如 "¥68.00"、"US$9.99" */
export function money(milli?: number | null, currency?: string | null): string {
  if (milli == null || !currency) return ''
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(milli / 1000)
  } catch {
    return `${(milli / 1000).toFixed(2)} ${currency}`
  }
}

const PERIOD_LABELS: Record<string, string> = { P1W: '周付', P1M: '月付', P3M: '季付', P6M: '半年付', P1Y: '年付' }

/** ISO 8601 周期 → 中文，如 "P1M" → "月付" */
export function periodLabel(period?: string | null): string {
  return period ? PERIOD_LABELS[period] ?? '' : ''
}

/** 产品 ID 去掉 bundleId 前缀，只留人能认出的部分 */
export function productDisplay(productId?: string | null, bundleId?: string | null): string {
  if (!productId) return ''
  if (bundleId && productId.startsWith(`${bundleId}.`)) return productId.slice(bundleId.length + 1)
  const parts = productId.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : productId
}

/** 小时数 → "3 小时" / "1 天 2 小时" */
export function hoursDisplay(hours: number): string {
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} 小时`
  const days = Math.floor(hours / 24)
  const rest = Math.round(hours % 24)
  return rest > 0 ? `${days} 天 ${rest} 小时` : `${days} 天`
}
