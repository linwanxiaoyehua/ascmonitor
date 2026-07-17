import { useEffect, useState } from 'react'
import { api, usd, type Overview, type MetricsDaily } from '../lib/api'
import { Icon, type IconName } from '../components/Icon'

/** "2026-07-16" → "7月16日 周四" */
function dateDisplay(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`
}

/** 轻量 SVG 柱状趋势图：含横向网格线与首末日期轴标 */
function BarChart({ data, format }: { data: Array<{ date: string; value: number }>; format: (v: number) => string }) {
  if (!data.length) return <div className="muted" style={{ textAlign: 'center', padding: '32px 0' }}>暂无数据，等待第一笔交易</div>
  const max = Math.max(...data.map((d) => d.value), 1)
  const w = 100 / data.length
  const H = 34
  return (
    <>
      <svg viewBox="0 0 100 40" style={{ width: '100%', height: 130, display: 'block' }} preserveAspectRatio="none" role="img"
        aria-label={`近 ${data.length} 天收入趋势，最高 ${format(max)}`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="chart-grid" x1="0" x2="100" y1={H - H * f + 2} y2={H - H * f + 2} />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * H, d.value > 0 ? 0.6 : 0)
          return (
            <rect
              key={d.date}
              className={`chart-bar${i === data.length - 1 ? ' last' : ''}`}
              x={i * w + w * 0.18}
              y={H - h + 2}
              width={w * 0.64}
              height={h}
              rx={Math.min(w * 0.32, 1)}
            >
              <title>{`${dateDisplay(d.date)} · ${format(d.value)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span className="muted num">{data[0].date.slice(5)}</span>
        <span className="muted num">{data[data.length - 1].date.slice(5)}</span>
      </div>
    </>
  )
}

function StatCard({
  icon, label, value, sub, tone,
}: { icon: IconName; label: string; value: string; sub?: string; tone?: 'pos' }) {
  return (
    <div className="card">
      <div className="card-head">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

function CardsSkeleton() {
  return (
    <div className="cards" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton" style={{ height: 96 }} />
      ))}
    </div>
  )
}

interface SalesDaily {
  date: string
  downloads: number
  iapUnits: number
  proceedsUsdMilli: number
}

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [daily, setDaily] = useState<MetricsDaily[]>([])
  const [sales, setSales] = useState<SalesDaily[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<Overview>('/api/overview').then(setOverview).catch((e) => setError(String(e)))
    api<MetricsDaily[]>('/api/metrics/daily?days=30').then(setDaily).catch(() => {})
    api<SalesDaily[]>('/api/sales/daily?days=30').then(setSales).catch(() => {})
  }, [])

  if (error) return <div className="error" role="alert">{error}</div>

  // 多 App 时按日期合并
  const byDate = new Map<string, number>()
  for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.revenue_milli)
  const revenueTrend = [...byDate.entries()].map(([date, value]) => ({ date, value }))
  const total30 = revenueTrend.reduce((s, d) => s + d.value, 0)

  // 今日 vs 昨日（metrics_daily 最新一天即昨日 rollup）
  const yesterdayRevenue = revenueTrend.length ? revenueTrend[revenueTrend.length - 1].value : null
  let todaySub = ''
  if (overview && yesterdayRevenue != null && yesterdayRevenue > 0) {
    const pct = ((overview.todayRevenueUsdMilli - yesterdayRevenue) / yesterdayRevenue) * 100
    const arrow = pct >= 0 ? '↑' : '↓'
    todaySub = ` · 昨日 ${usd(yesterdayRevenue)} ${arrow}${Math.abs(pct).toFixed(0)}%`
  }

  return (
    <div>
      <h1 className="page-title">总览</h1>
      {!overview ? (
        <CardsSkeleton />
      ) : (
        <div className="cards">
          <StatCard
            icon="dollar"
            label="今日收入"
            value={usd(overview.todayRevenueUsdMilli)}
            sub={`新订 ${overview.todayNewSubs} · 续费 ${overview.todayRenewals} · 退款 ${overview.todayRefunds}${todaySub}`}
            tone="pos"
          />
          <StatCard icon="trendingUp" label="MRR" value={usd(overview.mrrUsdMilli)} sub={`ARR ${usd(overview.mrrUsdMilli * 12)}`} />
          <StatCard
            icon="users"
            label="活跃订阅"
            value={String(Math.max(overview.activeSubs, overview.snapshot?.active ?? 0))}
            sub={
              overview.snapshot && overview.snapshot.active > overview.activeSubs
                ? `截至 ${overview.snapshot.date.slice(5)}（ASC 报告）`
                : `已关自动续费 ${overview.autoRenewOffCount}`
            }
          />
          <StatCard
            icon="clock"
            label="试用中"
            value={String(Math.max(overview.trialSubs, overview.snapshot?.trials ?? 0))}
            sub={
              overview.snapshot && overview.snapshot.trials > overview.trialSubs
                ? `截至 ${overview.snapshot.date.slice(5)}（ASC 报告）`
                : undefined
            }
          />
        </div>
      )}
      <h2 className="section-title">近 30 天收入（实时事件）</h2>
      <div className="chart">
        <div className="chart-head">
          <span className="chart-total">{usd(total30)}</span>
          <span className="chart-label">30 天合计</span>
        </div>
        <BarChart data={revenueTrend} format={usd} />
      </div>

      {sales.length > 0 && (
        <>
          <h2 className="section-title">商店账单（销售报告）</h2>
          <div className="cards" style={{ marginBottom: 12 }}>
            <StatCard
              icon="dollar"
              label="30 天结算收入"
              value={usd(sales.reduce((s, d) => s + d.proceedsUsdMilli, 0))}
              sub="Apple 分成后（约 1 天延迟）"
              tone="pos"
            />
            <StatCard
              icon="trendingUp"
              label="30 天下载"
              value={String(sales.reduce((s, d) => s + d.downloads, 0))}
              sub={`内购 ${sales.reduce((s, d) => s + d.iapUnits, 0)} 笔`}
            />
          </div>
          <div className="chart">
            <div className="chart-head">
              <span className="chart-total num">{sales[sales.length - 1]?.downloads ?? 0}</span>
              <span className="chart-label">最新一日下载</span>
            </div>
            <BarChart data={sales.map((d) => ({ date: d.date, value: d.downloads }))} format={(v) => `${v} 次下载`} />
          </div>
        </>
      )}
    </div>
  )
}
