// 横向分布条：评分分布 / 国家、产品维度切分共用（纯 CSS，不走图表库）

import type { ReactNode } from 'react'

export function DistributionBars({
  data, format,
}: {
  data: Array<{ label: ReactNode; key: string; value: number; display?: string }>
  format?: (v: number) => string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="dist">
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
