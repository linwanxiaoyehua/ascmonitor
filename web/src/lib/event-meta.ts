// ASSN 事件 → 展示语义（标题 / 图标 / 语义色 / 补充说明）
// 动态流与订阅历史时间线共用：同一个事件在哪儿看都是同一句话
//
// 关键点：光有 notificationType 说不清发生了什么 —— DID_CHANGE_RENEWAL_PREF 是升还是降、
// DID_CHANGE_RENEWAL_STATUS 是开还是关，全在 subtype 里。所以按 (type, subtype) 组合取标题，
// 标题吸收了 subtype 语义就不再重复显示 subtype 药丸。

import type { IconName } from '../components/Icon'
import { subtypeLabel } from './format'

export type Tone = 'success' | 'info' | 'danger' | 'warning' | 'accent' | 'neutral'

export interface EventMeta {
  label: string
  icon: IconName
  tone: Tone
  /** 标题旁的补充说明药丸（生效时机、过期原因…）；缺省回退到 subtype 中文名 */
  note?: string
}

const BY_TYPE: Record<string, EventMeta> = {
  SUBSCRIBED: { label: '新订阅', icon: 'zap', tone: 'success' },
  DID_RENEW: { label: '自动续费', icon: 'refresh', tone: 'success' },
  ONE_TIME_CHARGE: { label: '新购买', icon: 'creditCard', tone: 'success' },
  OFFER_REDEEMED: { label: '优惠兑换', icon: 'gift', tone: 'info' },
  REFUND: { label: '退款', icon: 'trendingDown', tone: 'danger' },
  REFUND_DECLINED: { label: '退款被拒', icon: 'trendingDown', tone: 'neutral' },
  REFUND_REVERSED: { label: '退款撤销', icon: 'refresh', tone: 'info' },
  REVOKE: { label: '共享撤销', icon: 'x', tone: 'danger' },
  DID_CHANGE_RENEWAL_STATUS: { label: '续费状态变更', icon: 'refresh', tone: 'warning' },
  DID_CHANGE_RENEWAL_PREF: { label: '套餐变更', icon: 'refresh', tone: 'info' },
  DID_FAIL_TO_RENEW: { label: '扣款失败', icon: 'alertTriangle', tone: 'danger' },
  EXPIRED: { label: '订阅过期', icon: 'clock', tone: 'neutral' },
  GRACE_PERIOD_EXPIRED: { label: '宽限期结束', icon: 'clock', tone: 'danger' },
  PRICE_INCREASE: { label: '价格上调', icon: 'trendingUp', tone: 'warning' },
  CONSUMPTION_REQUEST: { label: '请求退款', icon: 'info', tone: 'neutral' },
  RENEWAL_EXTENDED: { label: '续期顺延', icon: 'clock', tone: 'info' },
  RENEWAL_EXTENSION: { label: '续期顺延', icon: 'clock', tone: 'info' },
  TEST: { label: '测试通知', icon: 'flask', tone: 'neutral' },
}

// 空串键 = 该类型不带 subtype 时的含义（Apple 用「没有 subtype」表达语义，例如
// DID_CHANGE_RENEWAL_PREF 无 subtype = 用户把续费偏好改回当前套餐，也就是取消了降级）
const BY_SUBTYPE: Record<string, Record<string, EventMeta>> = {
  SUBSCRIBED: {
    RESUBSCRIBE: { label: '重新订阅', icon: 'zap', tone: 'success' },
  },
  DID_CHANGE_RENEWAL_PREF: {
    UPGRADE: { label: '订阅升级', icon: 'trendingUp', tone: 'success', note: '立即生效' },
    DOWNGRADE: { label: '订阅降级', icon: 'trendingDown', tone: 'warning', note: '下期生效' },
    '': { label: '取消降级', icon: 'refresh', tone: 'info', note: '维持当前套餐' },
  },
  DID_CHANGE_RENEWAL_STATUS: {
    AUTO_RENEW_DISABLED: { label: '关闭自动续费', icon: 'x', tone: 'warning' },
    AUTO_RENEW_ENABLED: { label: '开启自动续费', icon: 'check', tone: 'success' },
  },
  DID_FAIL_TO_RENEW: {
    GRACE_PERIOD: { label: '进入宽限期', icon: 'clock', tone: 'warning', note: '仍可自动恢复' },
  },
  EXPIRED: {
    VOLUNTARY: { label: '订阅到期', icon: 'clock', tone: 'neutral', note: '用户主动取消' },
    BILLING_RETRY: { label: '订阅到期', icon: 'clock', tone: 'danger', note: '扣款始终失败' },
    PRICE_INCREASE: { label: '订阅到期', icon: 'clock', tone: 'warning', note: '未接受涨价' },
    PRODUCT_NOT_FOR_SALE: { label: '订阅到期', icon: 'clock', tone: 'neutral', note: '商品已下架' },
  },
  PRICE_INCREASE: {
    PENDING: { label: '价格上调', icon: 'trendingUp', tone: 'warning', note: '待用户确认' },
    ACCEPTED: { label: '价格上调', icon: 'trendingUp', tone: 'info', note: '用户已接受' },
  },
}

const FALLBACK: EventMeta = { label: '未知事件', icon: 'activity', tone: 'neutral' }

export function eventMeta(type: string, subtype?: string | null): EventMeta {
  const special = BY_SUBTYPE[type]?.[subtype ?? '']
  if (special) return special
  const base = BY_TYPE[type] ?? { ...FALLBACK, label: type }
  // 没有专门文案的 subtype 仍要露出来，否则「首次订阅 / 扣款重试」这类信息就丢了
  return subtype ? { ...base, note: subtypeLabel(subtype) } : base
}
