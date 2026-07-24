// 环形图（订阅健康 / 收入占比）——纯 SVG，零依赖，配色走 var(--chart-*)
// 与 Sparkline 同风格：调用方给 segments，组件只负责画。
import type { CSSProperties, ReactNode } from 'react'

export interface DonutSegment {
  value: number
  color: string // 传 CSS 颜色，建议用 var(--chart-3) 等 token
  label?: string
}

export function Donut({
  segments,
  size = 140,
  thickness = 15,
  gap = 0,
  children,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  /** 段间留白（度数）*/
  gap?: number
  /** 环心内容（如活跃订阅总数）*/
  children?: ReactNode
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const r = (size - thickness) / 2
  const cx = size / 2
  const C = 2 * Math.PI * r
  let offset = 0
  const wrap: CSSProperties = { position: 'relative', width: size, height: size, flex: 'none' }
  const center: CSSProperties = {
    position: 'absolute', inset: 0, display: 'flex',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div style={wrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        {/* stroke 走 style 而非 presentation 属性 —— var() 只在 CSS 上下文可靠解析 */}
        <circle cx={cx} cy={cx} r={r} fill="none" style={{ stroke: 'var(--bg-inset)' }} strokeWidth={thickness} />
        {segments.map((s, i) => {
          const frac = s.value / total
          const len = Math.max(0, frac * C - (gap / 360) * C)
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={thickness}
              strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
              strokeDashoffset={(-offset).toFixed(2)}
              transform={`rotate(-90 ${cx} ${cx})`}
              strokeLinecap="round"
            />
          )
          offset += frac * C
          return el
        })}
      </svg>
      {children && <div style={center}>{children}</div>}
    </div>
  )
}
