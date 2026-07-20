// 动态合流行渲染：ASSN 事件 / 告警 统一外观
// 总览「今日动态」预览与动态页共用

import type { ActivityItem } from '../lib/api'
import { appLabelOf, countryDisplay, productDisplay, subtypeLabel, REVENUE_TYPES } from '../lib/format'
import { AppIcon } from './AppIcon'
import { Icon, type IconName } from './Icon'
import { Badge, ListRow } from './ui'

type Tone = 'success' | 'info' | 'danger' | 'warning' | 'accent' | 'neutral'

const TYPE_META: Record<string, { label: string; icon: IconName; tone: Tone }> = {
  SUBSCRIBED: { label: '新订阅', icon: 'zap', tone: 'success' },
  DID_RENEW: { label: '自动续费', icon: 'refresh', tone: 'success' },
  ONE_TIME_CHARGE: { label: '新购买', icon: 'creditCard', tone: 'success' },
  OFFER_REDEEMED: { label: '优惠兑换', icon: 'gift', tone: 'info' },
  REFUND: { label: '退款', icon: 'trendingDown', tone: 'danger' },
  REFUND_DECLINED: { label: '退款被拒', icon: 'trendingDown', tone: 'neutral' },
  REFUND_REVERSED: { label: '退款撤销', icon: 'refresh', tone: 'info' },
  REVOKE: { label: '共享撤销', icon: 'x', tone: 'danger' },
  DID_CHANGE_RENEWAL_STATUS: { label: '续费状态变更', icon: 'refresh', tone: 'warning' },
  DID_CHANGE_RENEWAL_PREF: { label: '升级 / 降级', icon: 'trendingUp', tone: 'info' },
  DID_FAIL_TO_RENEW: { label: '扣款失败', icon: 'alertTriangle', tone: 'danger' },
  EXPIRED: { label: '订阅过期', icon: 'clock', tone: 'neutral' },
  GRACE_PERIOD_EXPIRED: { label: '宽限期结束', icon: 'clock', tone: 'danger' },
  PRICE_INCREASE: { label: '价格上调', icon: 'trendingUp', tone: 'warning' },
  CONSUMPTION_REQUEST: { label: '消耗查询', icon: 'info', tone: 'neutral' },
  RENEWAL_EXTENDED: { label: '续期顺延', icon: 'clock', tone: 'info' },
  TEST: { label: '测试通知', icon: 'flask', tone: 'neutral' },
}

const ALERT_META: Record<string, { icon: IconName; tone: Tone }> = {
  new_bad_review: { icon: 'message', tone: 'danger' },
  bad_review_rate: { icon: 'trendingDown', tone: 'warning' },
  revenue_drop: { icon: 'dollar', tone: 'warning' },
  webhook_silent: { icon: 'moon', tone: 'info' },
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  if (item.kind === 'alert') {
    const meta = ALERT_META[item.alertKind] ?? { icon: 'bell' as IconName, tone: 'danger' as Tone }
    return (
      <ListRow
        leading={
          <span className={`row-icon tone-${meta.tone}`}><Icon name={meta.icon} size={16} /></span>
        }
        title={item.title}
        badges={<Badge tone="danger">告警</Badge>}
        detail={item.body?.split('\n')[0]}
        time={item.ts}
      />
    )
  }

  const meta = TYPE_META[item.type] ?? { label: item.type, icon: 'activity' as IconName, tone: 'neutral' as Tone }
  const appLabel = appLabelOf(item.appName, item.bundleId)
  const isRevenue = REVENUE_TYPES.has(item.type)
  const isRefund = item.type === 'REFUND'
  // 0 元交易（免费试用开始）不显示 "+¥0.00"
  const showAmount = (isRevenue || isRefund) && item.priceMilli != null && item.priceMilli > 0
  const detail = [
    appLabel,
    item.productName ?? productDisplay(item.productId, item.bundleId),
    countryDisplay(item.country),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <ListRow
      leading={
        item.appIcon ? (
          <div className="icon-stack">
            <AppIcon url={item.appIcon} name={appLabel} size={32} />
            <span className={`icon-badge tone-${meta.tone}`}>
              <Icon name={meta.icon} size={10} />
            </span>
          </div>
        ) : (
          <span className={`row-icon tone-${meta.tone}`}><Icon name={meta.icon} size={16} /></span>
        )
      }
      title={
        <>
          {meta.label}
          {item.subtype && <span className="muted">{subtypeLabel(item.subtype)}</span>}
        </>
      }
      badges={item.environment === 'Sandbox' ? <Badge tone="neutral">沙盒</Badge> : undefined}
      detail={detail}
      amount={showAmount ? { milli: item.priceMilli, currency: item.currency, sign: isRefund ? 'neg' : 'pos' } : undefined}
      time={item.ts}
    />
  )
}
