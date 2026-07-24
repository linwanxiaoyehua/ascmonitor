// 收入 · 概况：收入向 KPI → 趋势区（收入趋势｜订阅活动）→ 收入构成
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
import { DistributionBars } from '../../components/DistributionBars'
import { TrendChart } from '../../components/TrendChart'
import { Section, SegmentedControl, Skeleton, StatCard } from '../../components/ui'

type Range = 7 | 30 | 90

/** 收入趋势全功能版（range + 三口径数据源）；range 控件在图上方独立行，不挤 head */
function RevenueTrend({ rate }: { rate: number }) {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const [range, setRange] = useState<Range>(30)

  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, range],
    queryFn: () => api<MetricsDaily[]>(withAppParam(`/api/metrics/daily?days=${range}`, appId)),
  })
  const salesQ = useQuery({
    queryKey: ['sales-daily', appId, range],
    queryFn: () => api<SalesDaily[]>(withAppParam(`/api/sales/daily?days=${range}`, appId)),
    enabled: caliber === 'billed',
  })

  const billedReady = (salesQ.data?.length ?? 0) > 0
  const effective = effectiveCaliber(caliber, billedReady)

  const data: Array<{ date: string; value: number }> = (() => {
    if (effective === 'billed') {
      return (salesQ.data ?? []).map((d) => ({ date: d.date, value: d.proceedsUsdMilli }))
    }
    const byDate = new Map<string, number>()
    for (const d of metricsQ.data ?? []) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.revenue_milli)
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, value: applyCaliber(v, effective, rate) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  })()
  const total = data.reduce((s, d) => s + d.value, 0)
  const loading = effective === 'billed' ? salesQ.isPending : metricsQ.isPending

  return (
    <Section title="收入趋势">
      <div className="hstack-center mb-2">
        <span className="ml-auto">
          <SegmentedControl<`${Range}`>
            label="时间范围"
            options={[
              { value: '7', label: '7 天' },
              { value: '30', label: '30 天' },
              { value: '90', label: '90 天' },
            ]}
            value={`${range}`}
            onChange={(v) => setRange(Number(v) as Range)}
          />
        </span>
      </div>
      <div className="chart-frame">
        <div className="head">
          <span className="total num">{fmtUsd(total)}</span>
          <span className="label">{range} 天合计</span>
        </div>
        {loading ? (
          <Skeleton variant="chart" height={200} />
        ) : (
          <TrendChart
            type={range > 7 ? 'area' : 'bar'}
            data={data}
            series={[{ key: 'value', name: '收入', color: effective === 'billed' ? 'var(--chart-2)' : 'var(--chart-1)' }]}
            format={fmtUsd}
            axisFormat={fmtUsdCompact}
            height={200}
          />
        )}
      </div>
    </Section>
  )
}

/** 收入构成（国家/产品）；billed 无维度数据 → 恒用事件口径 */
function BreakdownSection({ rate }: { rate: number }) {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const [by, setBy] = useState<'country' | 'product'>('country')
  const { data } = useQuery({
    queryKey: ['breakdown', appId, by],
    queryFn: () => api<BreakdownRow[]>(withAppParam(`/api/metrics/breakdown?by=${by}&days=30`, appId)),
  })
  if (!data?.length) return null
  const effective = effectiveCaliber(caliber, false)
  return (
    <Section title="收入构成（30 天）">
      <div className="panel pad">
        <div className="mb-3">
          <SegmentedControl
            label="收入构成维度"
            options={[
              { value: 'country', label: '按国家' },
              { value: 'product', label: '按产品' },
            ]}
            value={by}
            onChange={setBy}
          />
        </div>
        <DistributionBars
          variant="seq"
          data={data.map((r) => ({
            key: r.key,
            label: by === 'country' ? countryDisplay(r.key) || r.key : r.label ?? r.key.split('.').slice(-2).join('.'),
            value: r.usdMilli,
            display: `${fmtUsd(applyCaliber(r.usdMilli, effective, rate))} · ${r.count} 笔`,
          }))}
        />
      </div>
    </Section>
  )
}

export function RevenueSummary() {
  const appId = useAppFilter()
  const caliber = useCaliber()

  const overviewQ = useQuery({
    queryKey: ['overview', appId],
    queryFn: () => api<Overview>(withAppParam('/api/overview', appId)),
  })
  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, 30],
    queryFn: () => api<MetricsDaily[]>(withAppParam('/api/metrics/daily?days=30', appId)),
  })
  const salesQ = useQuery({
    queryKey: ['sales-daily', appId, 30],
    queryFn: () => api<SalesDaily[]>(withAppParam('/api/sales/daily?days=30', appId)),
    enabled: caliber === 'billed',
  })
  const reconQ = useQuery({
    queryKey: ['reconciliation', appId],
    queryFn: () => api<Reconciliation>(withAppParam('/api/revenue/reconciliation?days=30', appId)),
    enabled: caliber !== 'gross',
  })
  const rate = reconQ.data?.summary.proceedsRate ?? 0.85

  const o = overviewQ.data
  const m = metricsQ.data ?? []
  const sum = (f: (d: MetricsDaily) => number) => m.reduce((s, d) => s + f(d), 0)

  // 30 天收入 KPI：billed 用账单合计（空降 net）
  const billedTotal = (salesQ.data ?? []).reduce((s, d) => s + d.proceedsUsdMilli, 0)
  const kpiCaliber = effectiveCaliber(caliber, billedTotal > 0)
  const revenue30 = kpiCaliber === 'billed' ? billedTotal : applyCaliber(sum((d) => d.revenue_milli), kpiCaliber, rate)
  const todayCaliber = effectiveCaliber(caliber, false)
  const todayRevenue = o ? applyCaliber(o.todayRevenueUsdMilli, todayCaliber, rate) : 0

  // 本月收入（月至今）：从已有 30 天数据过滤当月即可——月最长 31 天，30 天窗口从每月 31 号
  // 往回正好覆盖到 1 号（metrics_daily.date 为 UTC，故月首也按 UTC 取）。口径与 30 天卡一致。
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const monthMetrics = m.filter((d) => d.date >= monthStart)
  const monthSum = (f: (d: MetricsDaily) => number) => monthMetrics.reduce((s, d) => s + f(d), 0)
  const billedMonth = (salesQ.data ?? []).filter((d) => d.date >= monthStart).reduce((s, d) => s + d.proceedsUsdMilli, 0)
  const monthCaliber = effectiveCaliber(caliber, billedMonth > 0)
  const revenueMonth = monthCaliber === 'billed' ? billedMonth : applyCaliber(monthSum((d) => d.revenue_milli), monthCaliber, rate)

  // 订阅活动（按日合并，多 App）
  const byDate = new Map<string, { new_subs: number; renewals: number; refunds: number }>()
  for (const d of m) {
    const agg = byDate.get(d.date) ?? { new_subs: 0, renewals: 0, refunds: 0 }
    agg.new_subs += d.new_subs
    agg.renewals += d.renewals
    agg.refunds += d.refunds
    byDate.set(d.date, agg)
  }
  const activity = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <>
      {/* 收入向 KPI（订阅健康类指标在「订阅健康」子页） */}
      <div className="stat-grid kpi">
        <StatCard
          loading={overviewQ.isPending}
          icon="dollar"
          tone="success"
          label="今日收入"
          value={o ? fmtUsd(todayRevenue) : ''}
          foot={o ? `新订 ${o.todayNewSubs} · 续费 ${o.todayRenewals}` : undefined}
        />
        <StatCard
          loading={metricsQ.isPending}
          icon="chart"
          tone="accent"
          label="本月收入"
          value={fmtUsd(revenueMonth)}
          foot={`新订 ${monthSum((d) => d.new_subs)} · 续费 ${monthSum((d) => d.renewals)}`}
        />
        <StatCard
          loading={metricsQ.isPending}
          icon="clock"
          tone="accent"
          label="30 天收入"
          value={fmtUsd(revenue30)}
          foot={`新订 ${sum((d) => d.new_subs)} · 续费 ${sum((d) => d.renewals)}`}
        />
        <StatCard
          loading={overviewQ.isPending}
          icon="trendingUp"
          tone="violet"
          label="MRR"
          value={o ? fmtUsd(o.mrrUsdMilli) : ''}
          foot={o ? `ARR ${fmtUsd(o.mrrUsdMilli * 12)}` : undefined}
        />
        <StatCard
          loading={metricsQ.isPending}
          icon="trendingDown"
          tone="danger"
          label="30 天退款"
          value={String(sum((d) => d.refunds))}
          foot="笔数"
        />
      </div>

      {/* 趋势区（相关模块聚合，桌面两列） */}
      <div className="section-group">
        <div className="two-col">
          <RevenueTrend rate={rate} />
          <Section title="订阅活动（30 天）">
            <div className="chart-frame">
              <div className="head">
                <span className="total num">{sum((d) => d.new_subs) + sum((d) => d.renewals)}</span>
                <span className="label">新订 + 续费笔数</span>
              </div>
              {metricsQ.isPending ? (
                <Skeleton variant="chart" height={200} />
              ) : (
                <TrendChart
                  type="bar"
                  data={activity}
                  series={[
                    { key: 'new_subs', name: '新订', stackId: 'a', color: 'var(--chart-1)' },
                    { key: 'renewals', name: '续费', stackId: 'a', color: 'var(--chart-4)' },
                    { key: 'refunds', name: '退款', stackId: 'a', color: 'var(--chart-neg)' },
                  ]}
                  format={(v) => `${v} 笔`}
                  axisFormat={(v) => String(v)}
                  height={200}
                />
              )}
            </div>
          </Section>
        </div>
      </div>

      <BreakdownSection rate={rate} />
    </>
  )
}
