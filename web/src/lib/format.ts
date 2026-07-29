// 展示层人性化：国旗、中文国家名、货币、subtype 中文标签

/**
 * App Store storefront 用 ISO 3166-1 alpha-3，转 alpha-2 才能拼国旗。
 * 必须是完整表：Apple 有约 175 个 storefront，早先只列了热门 55 个，
 * 结果冷门区（如 ALB 阿尔巴尼亚）退化成裸三字母码，既没国旗也没中文名。
 * 紧凑串在模块加载时解析一次，省掉 249 行字面量。
 */
const A3_A2_PAIRS =
  'AFG=AF ALA=AX ALB=AL DZA=DZ ASM=AS AND=AD AGO=AO AIA=AI ATA=AQ ATG=AG ARG=AR ARM=AM ABW=AW ' +
  'AUS=AU AUT=AT AZE=AZ BHS=BS BHR=BH BGD=BD BRB=BB BLR=BY BEL=BE BLZ=BZ BEN=BJ BMU=BM BTN=BT ' +
  'BOL=BO BES=BQ BIH=BA BWA=BW BVT=BV BRA=BR IOT=IO BRN=BN BGR=BG BFA=BF BDI=BI CPV=CV KHM=KH ' +
  'CMR=CM CAN=CA CYM=KY CAF=CF TCD=TD CHL=CL CHN=CN CXR=CX CCK=CC COL=CO COM=KM COG=CG COD=CD ' +
  'COK=CK CRI=CR CIV=CI HRV=HR CUB=CU CUW=CW CYP=CY CZE=CZ DNK=DK DJI=DJ DMA=DM DOM=DO ECU=EC ' +
  'EGY=EG SLV=SV GNQ=GQ ERI=ER EST=EE SWZ=SZ ETH=ET FLK=FK FRO=FO FJI=FJ FIN=FI FRA=FR GUF=GF ' +
  'PYF=PF ATF=TF GAB=GA GMB=GM GEO=GE DEU=DE GHA=GH GIB=GI GRC=GR GRL=GL GRD=GD GLP=GP GUM=GU ' +
  'GTM=GT GGY=GG GIN=GN GNB=GW GUY=GY HTI=HT HMD=HM VAT=VA HND=HN HKG=HK HUN=HU ISL=IS IND=IN ' +
  'IDN=ID IRN=IR IRQ=IQ IRL=IE IMN=IM ISR=IL ITA=IT JAM=JM JPN=JP JEY=JE JOR=JO KAZ=KZ KEN=KE ' +
  'KIR=KI PRK=KP KOR=KR KWT=KW KGZ=KG LAO=LA LVA=LV LBN=LB LSO=LS LBR=LR LBY=LY LIE=LI LTU=LT ' +
  'LUX=LU MAC=MO MDG=MG MWI=MW MYS=MY MDV=MV MLI=ML MLT=MT MHL=MH MTQ=MQ MRT=MR MUS=MU MYT=YT ' +
  'MEX=MX FSM=FM MDA=MD MCO=MC MNG=MN MNE=ME MSR=MS MAR=MA MOZ=MZ MMR=MM NAM=NA NRU=NR NPL=NP ' +
  'NLD=NL NCL=NC NZL=NZ NIC=NI NER=NE NGA=NG NIU=NU NFK=NF MKD=MK MNP=MP NOR=NO OMN=OM PAK=PK ' +
  'PLW=PW PSE=PS PAN=PA PNG=PG PRY=PY PER=PE PHL=PH PCN=PN POL=PL PRT=PT PRI=PR QAT=QA REU=RE ' +
  'ROU=RO RUS=RU RWA=RW BLM=BL SHN=SH KNA=KN LCA=LC MAF=MF SPM=PM VCT=VC WSM=WS SMR=SM STP=ST ' +
  'SAU=SA SEN=SN SRB=RS SYC=SC SLE=SL SGP=SG SXM=SX SVK=SK SVN=SI SLB=SB SOM=SO ZAF=ZA SGS=GS ' +
  'SSD=SS ESP=ES LKA=LK SDN=SD SUR=SR SJM=SJ SWE=SE CHE=CH SYR=SY TWN=TW TJK=TJ TZA=TZ THA=TH ' +
  'TLS=TL TGO=TG TKL=TK TON=TO TTO=TT TUN=TN TUR=TR TKM=TM TCA=TC TUV=TV UGA=UG UKR=UA ARE=AE ' +
  'GBR=GB USA=US UMI=UM URY=UY UZB=UZ VUT=VU VEN=VE VNM=VN VGB=VG VIR=VI WLF=WF ESH=EH YEM=YE ' +
  'ZMB=ZM ZWE=ZW'

const A3_TO_A2: Record<string, string> = Object.fromEntries(
  A3_A2_PAIRS.split(' ').map((pair) => pair.split('=') as [string, string])
)

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

/** App 名可读（非 bundleId 占位）就用名字，否则退回 bundleId 末段 */
export function appLabelOf(name?: string | null, bundleId?: string | null): string {
  return name && name !== bundleId ? name : bundleId?.split('.').pop() ?? ''
}

/** 与今天相差的自然日数（本地时区） */
function dayDiff(ts: number): number {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400_000)
}

/** 相对时间："刚刚" / "3 小时前" / "昨天 14:30" / "7月2日" */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`

  const d = new Date(ts)
  const days = dayDiff(ts)
  const hm = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  if (days === 1) return `昨天 ${hm}`
  if (days <= 7) return `${days} 天前`
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/**
 * 本地时区的 YYYY-MM-DD —— 按天分组的稳定键（dayLabel 是给人看的，同一天可能重名跨年）
 * 与 /api/activity/day-totals 的 tz_offset 聚合口径必须一致
 */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 按天分组标签："今天" / "昨天" / "7月2日" */
export function dayLabel(ts: number): string {
  const days = dayDiff(ts)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/** 产品 ID 去掉 bundleId 前缀，只留人能认出的部分 */
export function productDisplay(productId?: string | null, bundleId?: string | null): string {
  if (!productId) return ''
  if (bundleId && productId.startsWith(`${bundleId}.`)) return productId.slice(bundleId.length + 1)
  const parts = productId.split('.')
  return parts.length > 2 ? parts.slice(-2).join('.') : productId
}

/**
 * 换购两端的展示名："年付会员 → 月付会员"。
 * 升级前的套餐靠回溯历史交易推断，回溯不到（如接入前就存在的订阅）时只说换到了什么；
 * 两端相同（取消降级）时只说当前套餐。
 */
export function changeText(
  change: { fromId: string | null; fromName: string | null; toId: string | null; toName: string | null },
  bundleId?: string | null
): string {
  const from = change.fromId ? change.fromName ?? productDisplay(change.fromId, bundleId) : ''
  const to = change.toId ? change.toName ?? productDisplay(change.toId, bundleId) : ''
  if (from && to && from !== to) return `${from} → ${to}`
  return to || from
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
