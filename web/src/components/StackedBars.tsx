// 堆叠柱状图（收入来源：新订 / 续费 / 内购）——纯 SVG，零依赖。
// series: 每个系列一条等长数组；colors 与之对应（建议 var(--chart-*)）。
import type { ReactNode } from 'react'

export interface StackedSeries {
  key: string
  name: string
  color: string
  data: number[]
}

export function StackedBars({
  series,
  height = 190,
  gap = 3,
}: {
  series: StackedSeries[]
  height?: number
  /** 柱间距（px，viewBox 内）*/
  gap?: number
}) {
  if (!series.length) return null
  const n = series[0].data.length
  const W = 560
  const totals = Array.from({ length: n }, (_, i) => series.reduce((s, ser) => s + (ser.data[i] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const bw = (W - gap * (n - 1)) / n
  const rects: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    let y = height
    series.forEach((ser) => {
      const bh = ((ser.data[i] ?? 0) / max) * (height - 6)
      y -= bh
      rects.push(
        <rect
          key={`${ser.key}-${i}`}
          x={(i * (bw + gap)).toFixed(1)}
          y={y.toFixed(1)}
          width={bw.toFixed(1)}
          height={bh.toFixed(1)}
          style={{ fill: ser.color }}
        />,
      )
    })
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      role="img"
      aria-label={series.map((s) => s.name).join(' / ')}
    >
      {rects}
    </svg>
  )
}
