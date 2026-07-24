// 转化漏斗行卡（浏览→下载→试用→付费）——presentational，配色走 token。
// icon 传 ReactNode（用你现有的 <Icon name=... />），避免与图标库耦合。
import type { ReactNode } from 'react'

export interface FunnelStep {
  label: string
  value: string // 已格式化，如 "28.4%"
  delta?: { text: string; direction: 'up' | 'down' }
  icon?: ReactNode
  /** 语义色片：accent / success / info / violet / teal —— 复用 .stat-ic 的 tone 类 */
  tone?: 'accent' | 'success' | 'info' | 'violet' | 'teal' | 'danger'
}

/** 单行漏斗卡。多个 step 竖排即成漏斗；样式见 components.css 的 .funnel-row。 */
export function FunnelCard({ step }: { step: FunnelStep }) {
  const up = step.delta?.direction === 'up'
  return (
    <div className="funnel-row">
      {step.icon && (
        <span className={`stat-ic funnel-ic${step.tone ? ` tone-${step.tone}` : ''}`}>{step.icon}</span>
      )}
      <div className="funnel-main">
        <div className="funnel-label">{step.label}</div>
        <div className="funnel-value num">{step.value}</div>
      </div>
      {step.delta && (
        <span className={`funnel-delta num ${up ? 'up' : 'down'}`}>
          {up ? '↑' : '↓'} {step.delta.text}
        </span>
      )}
    </div>
  )
}
