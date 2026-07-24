// 指挥中心 KPI 卡：图标片 + delta 药丸 + 大数 + 可选 sparkline + 注脚
// 对齐设计稿 KPI STRIP；Overview / 收入分析共用。
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { Sparkline } from './Sparkline'

export type KpiTone = 'violet' | 'accent' | 'teal' | 'star' | 'success' | 'danger'

export function KpiCard({
  icon, tone, label, value, delta, foot, spark, badge, onPress,
}: {
  icon: IconName
  tone: KpiTone
  label: string
  value: string
  delta?: { text: string; direction: 'up' | 'down' }
  foot?: string
  spark?: number[]
  badge?: ReactNode
  onPress?: () => void
}) {
  const Tag = onPress ? 'button' : 'div'
  return (
    <Tag className="kpi-card" onClick={onPress}>
      <div className="kc-head">
        <span className={`stat-ic tone-${tone}`}><Icon name={icon} size={15} /></span>
        <span className="kc-label">{label}</span>
        {delta ? (
          <span className={`kc-delta ${delta.direction}`}>{delta.direction === 'up' ? '↑' : '↓'} {delta.text}</span>
        ) : badge ? (
          <span className="kc-badge">{badge}</span>
        ) : null}
      </div>
      <div className="kc-value num">{value}</div>
      {spark && spark.length > 1 && (
        <div className={`kc-spark tone-${tone}`}><Sparkline data={spark} height={34} /></div>
      )}
      {foot && <div className="kc-foot">{foot}</div>}
    </Tag>
  )
}
