// 横向分布条：评分分布 / 国家、产品维度切分共用（纯 CSS，不走图表库）
// variant 决定填充配色（见 components.css 的 .dist.seq / .dist.rating）：
//   seq    —— 按次序取图表色板，区分相邻条目
//   rating —— 1★ 红 → 5★ 绿，数据自带情感方向
//   plain  —— 单色（同一量纲的纯排名，不需要区分色）

import type { ReactNode } from 'react'

export function DistributionBars({
  data, format, variant = 'plain',
}: {
  data: Array<{ label: ReactNode; key: string; value: number; display?: string }>
  format?: (v: number) => string
  variant?: 'plain' | 'seq' | 'rating'
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className={`dist${variant === 'plain' ? '' : ` ${variant}`}`}>
      {data.map((d) => (
        <div className="dist-row" key={d.key}>
          <span className="dist-label">{d.label}</span>
          <div className="dist-track">
            <div className="dist-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="dist-value num">{d.display ?? format?.(d.value) ?? d.value}</span>
        </div>
      ))}
    </div>
  )
}
