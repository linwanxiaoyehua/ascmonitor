import { useEffect, useState } from 'react'
import { api, usd, type Overview, type MetricsDaily } from '../lib/api'

/** 轻量 SVG 柱状趋势图 */
function BarChart({ data, format }: { data: Array<{ date: string; value: number }>; format: (v: number) => string }) {
  if (!data.length) return <div className="empty">暂无数据</div>
  const max = Math.max(...data.map((d) => d.value), 1)
  const w = 100 / data.length
  return (
    <svg viewBox="0 0 100 40" style={{ width: '100%', height: 120 }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * 36
        return (
          <rect
            key={d.date}
            x={i * w + w * 0.15}
            y={40 - h}
            width={w * 0.7}
            height={h}
            rx={0.8}
            fill="var(--accent)"
            opacity={i === data.length - 1 ? 1 : 0.55}
          >
            <title>{`${d.date}: ${format(d.value)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [daily, setDaily] = useState<MetricsDaily[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Overview>('/api/overview').then(setOverview).catch((e) => setError(String(e)))
    api<MetricsDaily[]>('/api/metrics/daily?days=30').then(setDaily).catch(() => {})
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!overview) return <div className="empty">加载中…</div>

  // 多 App 时按日期合并
  const byDate = new Map<string, number>()
  for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.revenue_milli)
  const revenueTrend = [...byDate.entries()].map(([date, value]) => ({ date, value }))

  return (
    <div>
      <h1>总览</h1>
      <div className="cards">
        <div className="card">
          <div className="label">今日收入</div>
          <div className="value" style={{ color: 'var(--green)' }}>{usd(overview.todayRevenueUsdMilli)}</div>
          <div className="sub">新订 {overview.todayNewSubs} · 续费 {overview.todayRenewals} · 退款 {overview.todayRefunds}</div>
        </div>
        <div className="card">
          <div className="label">MRR</div>
          <div className="value">{usd(overview.mrrUsdMilli)}</div>
          <div className="sub">ARR {usd(overview.mrrUsdMilli * 12)}</div>
        </div>
        <div className="card">
          <div className="label">活跃订阅</div>
          <div className="value">{overview.activeSubs}</div>
          <div className="sub">已关自动续费 {overview.autoRenewOffCount}</div>
        </div>
        <div className="card">
          <div className="label">试用中</div>
          <div className="value">{overview.trialSubs}</div>
        </div>
      </div>
      <h2>近 30 天收入</h2>
      <div className="chart">
        <BarChart data={revenueTrend} format={usd} />
      </div>
    </div>
  )
}
