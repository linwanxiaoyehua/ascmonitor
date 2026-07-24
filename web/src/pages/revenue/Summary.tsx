// 收入 · 概况：HERO（本月净额 + 今日/30天/ARPU + 趋势）→ KPI 条（MRR/新订/续费/退款）
//   → 收入构成（近30天活动 stacked | 收入占比 donut）→ 下载量
// 去重：对账归「明细」子页、转化漏斗归「订阅健康」子页、活跃订阅归「订阅健康」
// 口径徽标不逐处标注——收入页头 CaliberSwitch 已指示当前口径

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  api, type BreakdownRow, type MetricsDaily, type Overview, type Reconciliation, type SalesDaily,
} from '../../lib/api'
import { useAppFilter, withAppParam } from '../../lib/app-filter'
import { applyCaliber, effectiveCaliber, useCaliber } from '../../lib/caliber'
import { fmtUsd, fmtUsdCompact } from '../../lib/money'
import { countryDisplay } from '../../lib/format'
import { Donut } from '../../components/Donut'
import { KpiCard } from '../../components/Kpi'
import { StackedBars } from '../../components/StackedBars'
import { TrendChart } from '../../components/TrendChart'
import { Section, SegmentedControl, Skeleton } from '../../components/ui'

type Range = 7 | 30 | 90
const SEQ_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']

/* ---------- HERO：本月收入 + 今日/30天/ARPU + 趋势图 ---------- */
function RevenueHero({ rate }: { rate: number }) {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const [range, setRange] = useState<Range>(30)

  const overviewQ = useQuery({
    queryKey: ['overview', appId],
    queryFn: () => api<Overview>(withAppParam('/api/overview', appId)),
  })
  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, range],
    queryFn: () => api<MetricsDaily[]>(withAppParam(`/api/metrics/daily?days=${range}`, appId)),
  })
  const salesQ = useQuery({
    queryKey: ['sales-daily', appId, range],
    queryFn: () => api<SalesDaily[]>(withAppParam(`/api/sales/daily?days=${range}`, appId)),
    enabled: caliber === 'billed',
  })

  const o = overviewQ.data
  const billedReady = (salesQ.data?.length ?? 0) > 0
  const effective = effectiveCaliber(caliber, billedReady)
  const calLabel = ({ net: '净额', gross: '流水', billed: '账单' } as Record<string, string>)[effective] ?? '净额'

  const data: Array<{ date: string; value: number }> = (() => {
    if (effective === 'billed') return (salesQ.data ?? []).map((d) => ({ date: d.date, value: d.proceedsUsdMilli }))
    const byDate = new Map<string, number>()
    for (const d of metricsQ.data ?? []) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.revenue_milli)
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, value: applyCaliber(v, effective, rate) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  })()
  const total = data.reduce((s, d) => s + d.value, 0)

  // 本月至今（从 30/90 天窗口过滤当月）
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const monthMetrics = (metricsQ.data ?? []).filter((d) => d.date >= monthStart)
  const billedMonth = (salesQ.data ?? []).filter((d) => d.date >= monthStart).reduce((s, d) => s + d.proceedsUsdMilli, 0)
  const monthCaliber = effectiveCaliber(caliber, billedMonth > 0)
  const monthRevenue = monthCaliber === 'billed'
    ? billedMonth
    : applyCaliber(monthMetrics.reduce((s, d) => s + d.revenue_milli, 0), monthCaliber, rate)

  const todayRevenue = o ? applyCaliber(o.todayRevenueUsdMilli, effectiveCaliber(caliber, false), rate) : 0
  const arpu = o && o.activeSubs > 0 ? o.mrrUsdMilli / o.activeSubs : null

  if (overviewQ.isPending || !o) return <div className="skeleton h-hero" aria-hidden="true" />

  return (
    <section className="cmd-hero rev-hero">
      <div className="ch-main">
        <span className="ch-label">本月收入 · {calLabel}（月至今）</span>
        <div className="ch-value num">{fmtUsd(monthRevenue)}</div>
        <div className="rev-mini">
          <div><div className="rm-k">今日</div><div className="rm-v num">{fmtUsd(todayRevenue)}</div></div>
          <div><div className="rm-k">{range} 天</div><div className="rm-v num">{fmtUsd(total)}</div></div>
          <div><div className="rm-k">ARPU</div><div className="rm-v num">{arpu != null ? fmtUsd(arpu) : '—'}</div></div>
        </div>
      </div>
      <div className="ch-chart">
        <div className="ch-chart-head">
          <span>收入趋势</span>
          <span className="rev-ranges">
            <SegmentedControl<`${Range}`>
              label="时间范围"
              options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]}
              value={`${range}`}
              onChange={(v) => setRange(Number(v) as Range)}
            />
          </span>
        </div>
        <div className="ch-chart-body">
          {metricsQ.isPending ? (
            <Skeleton variant="chart" height={172} />
          ) : (
            <TrendChart
              type={range > 7 ? 'area' : 'bar'}
              data={data}
              series={[{ key: 'value', name: '收入', color: effective === 'billed' ? 'var(--chart-2)' : 'var(--chart-1)' }]}
              format={fmtUsd}
              axisFormat={fmtUsdCompact}
              height={172}
            />
          )}
        </div>
      </div>
    </section>
  )
}

/* ---------- KPI 条：MRR / 活跃订阅 / 30天新订 / 30天退款 ---------- */
function RevenueKpis() {
  const appId = useAppFilter()
  const overviewQ = useQuery({
    queryKey: ['overview', appId],
    queryFn: () => api<Overview>(withAppParam('/api/overview', appId)),
  })
  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, 30],
    queryFn: () => api<MetricsDaily[]>(withAppParam('/api/metrics/daily?days=30', appId)),
  })
  const o = overviewQ.data
  const m = metricsQ.data ?? []
  const sum = (f: (d: MetricsDaily) => number) => m.reduce((s, d) => s + f(d), 0)
  return (
    <div className="kpi-strip">
      <KpiCard icon="trendingUp" tone="accent" label="MRR" value={o ? fmtUsd(o.mrrUsdMilli) : '—'} foot={o ? `ARR ${fmtUsd(o.mrrUsdMilli * 12)}` : undefined} />
      <KpiCard icon="zap" tone="violet" label="30 天新订" value={String(sum((d) => d.new_subs))} foot="笔数" />
      <KpiCard icon="refresh" tone="teal" label="30 天续费" value={String(sum((d) => d.renewals))} foot="笔数" />
      <KpiCard icon="trendingDown" tone="danger" label="30 天退款" value={String(sum((d) => d.refunds))} foot="笔数" />
    </div>
  )
}

/* ---------- 收入构成：近30天活动 stacked | 收入占比 donut ---------- */
function RevenueComposition({ rate }: { rate: number }) {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const [by, setBy] = useState<'country' | 'product'>('product')
  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, 30],
    queryFn: () => api<MetricsDaily[]>(withAppParam('/api/metrics/daily?days=30', appId)),
  })
  const breakdownQ = useQuery({
    queryKey: ['breakdown', appId, by],
    queryFn: () => api<BreakdownRow[]>(withAppParam(`/api/metrics/breakdown?by=${by}&days=30`, appId)),
  })

  // 近 30 天活动（新订/续费/退款笔数）按日堆叠
  const byDate = new Map<string, { new_subs: number; renewals: number; refunds: number }>()
  for (const d of metricsQ.data ?? []) {
    const a = byDate.get(d.date) ?? { new_subs: 0, renewals: 0, refunds: 0 }
    a.new_subs += d.new_subs; a.renewals += d.renewals; a.refunds += d.refunds
    byDate.set(d.date, a)
  }
  const days = [...byDate.keys()].sort()
  const stacked = [
    { key: 'new_subs', name: '新订', color: 'var(--chart-1)', data: days.map((dt) => byDate.get(dt)!.new_subs) },
    { key: 'renewals', name: '续费', color: 'var(--chart-4)', data: days.map((dt) => byDate.get(dt)!.renewals) },
    { key: 'refunds', name: '退款', color: 'var(--chart-neg)', data: days.map((dt) => byDate.get(dt)!.refunds) },
  ]

  const rows = breakdownQ.data ?? []
  const effective = effectiveCaliber(caliber, false)
  const nameOf = (r: BreakdownRow) =>
    by === 'country' ? countryDisplay(r.key) || r.key : r.label ?? r.key.split('.').slice(-2).join('.')
  const total = rows.reduce((s, r) => s + r.usdMilli, 0) || 1
  const segs = rows.map((r, i) => ({ value: r.usdMilli, color: SEQ_COLORS[i % SEQ_COLORS.length], label: nameOf(r) }))

  return (
    <div className="section-group">
      <div className="group-label divider"><span>收入构成</span></div>
      <div className="two-col">
        <Section title="近 30 天活动">
          <div className="panel pad">
            <div className="compo-legend-inline">
              {stacked.map((s) => (
                <span key={s.key}><span className="cli-dot" style={{ background: s.color }} />{s.name}</span>
              ))}
            </div>
            {days.length ? <StackedBars series={stacked} height={190} /> : <div className="chart-empty">暂无数据</div>}
          </div>
        </Section>
        <Section title="收入占比">
          <div className="panel pad">
            <div className="mb-3">
              <SegmentedControl
                label="占比维度"
                options={[{ value: 'product', label: '按产品' }, { value: 'country', label: '按国家' }]}
                value={by}
                onChange={setBy}
              />
            </div>
            {rows.length ? (
              <div className="compo-donut">
                <Donut segments={segs} size={140} thickness={15} gap={3}>
                  <span className="donut-center">
                    <span className="dc-value num">{fmtUsd(applyCaliber(total, effective, rate))}</span>
                    <span className="dc-label">30 天</span>
                  </span>
                </Donut>
                <ul className="health-legend">
                  {rows.map((r, i) => (
                    <li key={r.key}>
                      <span className="hl-dot" style={{ background: SEQ_COLORS[i % SEQ_COLORS.length] }} />
                      <span className="hl-label">{nameOf(r)}</span>
                      <span className="hl-pct num">{Math.round((r.usdMilli / total) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="chart-empty">暂无数据</div>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

/* ---------- 下载量（对账归明细页、按产品归上方占比、转化漏斗归订阅健康页，此处不重复）---------- */
function DownloadsSection() {
  const appId = useAppFilter()
  const { data: sales } = useQuery({
    queryKey: ['sales-daily', appId, 30],
    queryFn: () => api<SalesDaily[]>(withAppParam('/api/sales/daily?days=30', appId)),
  })
  if (!sales?.length) return null
  const downloads = sales.reduce((s, d) => s + d.downloads, 0)
  return (
    <Section title="下载量" className="mt-4">
      <div className="chart-frame">
        <div className="head">
          <span className="total num">{downloads.toLocaleString()}</span>
          <span className="label">30 天下载 · 账单 T+1</span>
        </div>
        <TrendChart
          type="bar"
          data={sales.map((d) => ({ date: d.date, value: d.downloads }))}
          series={[{ key: 'value', name: '下载', color: 'var(--chart-4)' }]}
          format={(v) => `${v} 次`}
          axisFormat={(v) => String(v)}
          height={190}
        />
      </div>
    </Section>
  )
}

export function RevenueSummary() {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const reconQ = useQuery({
    queryKey: ['reconciliation', appId],
    queryFn: () => api<Reconciliation>(withAppParam('/api/revenue/reconciliation?days=30', appId)),
    enabled: caliber !== 'gross',
  })
  const rate = reconQ.data?.summary.proceedsRate ?? 0.85

  return (
    <>
      <RevenueHero rate={rate} />
      <div className="mt-4"><RevenueKpis /></div>
      <RevenueComposition rate={rate} />
      <DownloadsSection />
    </>
  )
}
