// 轻量 sparkline（纯 SVG，不走 Recharts）：KPI 卡与评分 hero 用

export function Sparkline({ data, height = 56 }: { data: number[]; height?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = Math.max(max - min, 0.1)
  const W = 100
  const H = 28
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - 2 - ((v - min) / span) * (H - 4)}`)
    .join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} style={{ height }} preserveAspectRatio="none" role="img"
      aria-label={`走势 ${data[0].toFixed(2)} 到 ${data[data.length - 1].toFixed(2)}`}>
      <polyline className="spark-line" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
