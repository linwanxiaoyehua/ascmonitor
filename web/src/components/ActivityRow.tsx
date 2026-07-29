// 动态合流行渲染：ASSN 事件 / 告警 统一外观
// 总览「今日动态」预览与动态页共用

import { useState } from 'react'
import type { ActivityItem } from '../lib/api'
import { eventMeta, type Tone } from '../lib/event-meta'
import { appLabelOf, changeText, countryDisplay, productDisplay, REVENUE_TYPES } from '../lib/format'
import { fmtMoney } from '../lib/money'
import { AppIcon } from './AppIcon'
import { Icon, type IconName } from './Icon'
import { SubTimeline } from './SubTimeline'
import { Badge, ListRow } from './ui'

const ALERT_META: Record<string, { icon: IconName; tone: Tone }> = {
  new_bad_review: { icon: 'message', tone: 'danger' },
  bad_review_rate: { icon: 'trendingDown', tone: 'warning' },
  revenue_drop: { icon: 'dollar', tone: 'warning' },
  webhook_silent: { icon: 'moon', tone: 'info' },
}

// 构建 / 审核状态事件（kind = build_*）。状态语义（文案与颜色）由后端给出，
// 这里只决定用哪个图标 —— 避免前后端各维护一份状态枚举映射
const BUILD_ICONS: Record<string, IconName> = {
  build_upload: 'send',
  build_build: 'layers',
  build_testflight: 'flask',
  build_appstore: 'star',
}

const BUILD_BADGES: Record<string, string> = {
  build_upload: '上传',
  build_build: '构建',
  build_testflight: 'TestFlight',
  build_appstore: '审核',
}

/**
 * 剥掉标题开头的 emoji。
 * 后端在 title 里带 emoji 是为了推送通知 —— 系统通知只有纯文本，emoji 是那里唯一的视觉线索。
 * 但动态流每行已经有语义图标了，再显示一遍 emoji 是重复，也违反「不用 emoji 当图标」的规约。
 */
const stripLeadingEmoji = (t: string) => t.replace(/^\p{Extended_Pictographic}️?\s*/u, '')

function AlertRow({ item }: { item: Extract<ActivityItem, { kind: 'alert' }> }) {
  const buildIcon = BUILD_ICONS[item.alertKind]
  // 构建事件：用后端给的 tone，配 App 图标；普通告警沿用固定的规则配色
  const meta = buildIcon
    ? { icon: buildIcon, tone: (item.tone ?? 'info') as Tone }
    : ALERT_META[item.alertKind] ?? { icon: 'bell' as IconName, tone: 'danger' as Tone }
  const badgeLabel = BUILD_BADGES[item.alertKind]
  return (
    <ListRow
      leading={
        item.appIcon
          ? <AppIcon url={item.appIcon} name={item.appName ?? ''} size={34} />
          : <span className={`row-icon tone-${meta.tone}`}><Icon name={meta.icon} size={18} /></span>
      }
      title={stripLeadingEmoji(item.title)}
      badges={
        badgeLabel ? (
          <Badge tone={meta.tone === 'accent' ? 'info' : meta.tone}>{badgeLabel}</Badge>
        ) : (
          <Badge tone="danger">告警</Badge>
        )
      }
      detail={item.body?.split('\n')[0]}
      time={item.ts}
    />
  )
}

function EventRow({ item }: { item: Extract<ActivityItem, { kind: 'event' }> }) {
  // 交易 / 订阅类事件可以点开，看这条订阅从首次订阅到现在的每一次续费、升降级、退款
  const otid = item.originalTransactionId
  const [open, setOpen] = useState(false)

  const meta = eventMeta(item.type, item.subtype)
  const appLabel = appLabelOf(item.appName, item.bundleId)
  const isRevenue = REVENUE_TYPES.has(item.type)
  const isRefund = item.type === 'REFUND'
  // 请求退款（Apple 询问消耗信息以裁定退款）：展示涉及金额，但钱未动，不带 +/− 符号
  const isRefundRequest = item.type === 'CONSUMPTION_REQUEST'
  // 免费试用金额为 0，仍要显示（¥0.00）并配「试用」徽标说明；其他 0 元事件照旧隐藏
  const isTrial = item.isTrial === true
  const showAmount = (isRevenue || isRefund || isRefundRequest) && item.priceMilli != null && (item.priceMilli > 0 || isTrial)
  const amountSign = isRefund ? 'neg' : isRefundRequest ? undefined : 'pos'

  // 换购事件说「从哪个套餐换到哪个套餐」——只写「升级 / 降级」看不出到底做了什么；
  // 降级不产生交易，钱的变化只能靠 renewalInfo 里的下期续费价说明
  const change = item.productChange
  const renewalPrice =
    change?.renewalPriceMilli != null && change.renewalPriceMilli > 0
      ? `下期 ${fmtMoney(change.renewalPriceMilli, change.renewalCurrency)}`
      : null
  const detail = [
    appLabel,
    change ? changeText(change, item.bundleId) : item.productName ?? productDisplay(item.productId, item.bundleId),
    renewalPrice,
    countryDisplay(item.country),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div>
      <ListRow
        leading={
          item.appIcon
            ? <AppIcon url={item.appIcon} name={appLabel} size={34} />
            : <span className={`row-icon tone-${meta.tone}`}><Icon name={meta.icon} size={18} /></span>
        }
        title={
          <>
            {meta.label}
            {meta.note && <span className="sub-pill">{meta.note}</span>}
          </>
        }
        badges={
          <>
            {isTrial && <Badge tone="info">试用</Badge>}
            {item.environment === 'Sandbox' && <Badge tone="neutral">沙盒</Badge>}
          </>
        }
        detail={detail}
        amount={showAmount ? { milli: item.priceMilli, currency: item.currency, sign: amountSign } : undefined}
        time={item.ts}
        trailing={otid ? 'chevron' : undefined}
        chevronOpen={open}
        onPress={otid ? () => setOpen((v) => !v) : undefined}
      />
      {open && otid && <SubTimeline otid={otid} bundleId={item.bundleId} />}
    </div>
  )
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  return item.kind === 'alert' ? <AlertRow item={item} /> : <EventRow item={item} />
}
