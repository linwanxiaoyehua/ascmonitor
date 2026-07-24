// 总览 = 指挥中心：一屏回答四件事——①今天赚多少 ②新差评 ③订阅健康 ④多 App 概览
// KPI 行 → 差评醒目卡 → [实时动态流 | 收入趋势+下载+口碑] → 多 App 分列概览
// 全局口径只读消费（开关在收入页头）；收入类不重复标口径，数据新鲜度（ASC 快照）保留角标

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import {
  api, type ActivityItem, type AppOverviewRow, type MetricsDaily, type Overview,
  type RatingDistribution, type Reconciliation, type Review, type SalesDaily,
} from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { applyCaliber, effectiveCaliber, useCaliber } from '../lib/caliber'
import { fmtUsd, fmtUsdCompact } from '../lib/money'
import { ActivityRow } from '../components/ActivityRow'
import { AppIcon } from '../components/AppIcon'
import { Donut } from '../components/Donut'
import { DistributionBars } from '../components/DistributionBars'
import { Icon, Stars } from '../components/Icon'
import { KpiCard } from '../components/Kpi'
import { TrendChart } from '../components/TrendChart'
import { CaliberTag, EmptyState, ErrorState, PageHeader, Section, Skeleton } from '../components/ui'

function yesterdayStr(): string {
  return new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
}

/** 多 App 分列概览（全部 Apps 且 App>1 时）：每 App 一行关键数 */
function MultiAppOverview() {
  const [, navigate] = useLocation()
  const { data } = useQuery({
    queryKey: ['overview-apps'],
    queryFn: () => api<AppOverviewRow[]>('/api/overview/apps'),
  })
  if (!data || data.length < 2) return null
  return (
    <Section title="各 App 概览" className="span-full">
      <div className="list">
        {data.map((a) => (
          <button key={a.id} className="lrow pressable app-ov-row" onClick={() => navigate('/revenue')}>
            <AppIcon url={a.icon} name={a.name} size={32} />
            <span className="ao-name">{a.name}</span>
            <div className="app-ov-metrics">
              <span className="app-ov-metric"><span className="v">{fmtUsd(a.todayRevenueUsdMilli)}</span><span className="k">今日</span></span>
              <span className="app-ov-metric"><span className="v">{a.activeSubs}</span><span className="k">活跃</span></span>
              <span className="app-ov-metric opt"><span className="v">{a.todayReviewAvg != null ? a.todayReviewAvg.toFixed(1) : '—'}</span><span className="k">今日评分</span></span>
            </div>
          </button>
        ))}
      </div>
    </Section>
  )
}

/** 订阅健康环形：活跃订阅按「正常续费 / 试用中 / 流失风险」拆分 */
function SubHealthCard({ o }: { o: Overview }) {
  const total = o.activeSubs
  const trial = o.trialSubs
  const risk = o.riskSubs
  const normal = Math.max(0, total - trial - risk)
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const segs = [
    { label: '正常续费', value: normal, color: 'var(--chart-2)' },
    { label: '试用中', value: trial, color: 'var(--chart-3)' },
    { label: '流失风险', value: risk, color: 'var(--warning-icon)' },
  ]
  return (
    <div className="panel pad health-card">
      <Donut segments={segs} size={148} thickness={16} gap={3}>
        <span className="donut-center">
          <span className="dc-value num">{total.toLocaleString()}</span>
          <span className="dc-label">活跃订阅</span>
        </span>
      </Donut>
      <ul className="health-legend">
        {segs.map((s) => (
          <li key={s.label}>
            <span className="hl-dot" style={{ background: s.color }} />
            <span className="hl-label">{s.label}</span>
            <span className="hl-value num">{s.value.toLocaleString()}</span>
            <span className="hl-pct num">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 评分分布（近 90 天文字评论样本）——总览精简版：均分 + 分布条 */
function RatingDistCard({ appId, onOpen }: { appId: number | null; onOpen: () => void }) {
  const { data } = useQuery({
    queryKey: ['rating-dist', appId],
    queryFn: () => api<RatingDistribution>(withAppParam('/api/reviews/distribution?days=90', appId)),
  })
  if (!data || data.total === 0) return null
  const avg = data.distribution.reduce((s, d) => s + d.rating * d.count, 0) / data.total
  return (
    <Section title="评分分布" action={{ label: '评论评分', onPress: onOpen }}>
      <div className="panel pad">
        <div className="rating-summary">
          <span className="rs-avg num">{avg.toFixed(1)}</span>
          <Stars rating={Math.round(avg)} />
          <span className="rs-total num">{data.total.toLocaleString()} 条</span>
        </div>
        <DistributionBars
          variant="rating"
          data={data.distribution.map((d) => ({
            key: String(d.rating),
            label: `${d.rating} ★`,
            value: d.count,
            display: `${d.count} · ${Math.round((d.count / data.total) * 100)}%`,
          }))}
        />
      </div>
    </Section>
  )
}

export function OverviewPage() {
  const appId = useAppFilter()
  const caliber = useCaliber()
  const [, navigate] = useLocation()

  const overviewQ = useQuery({
    queryKey: ['overview', appId],
    queryFn: () => api<Overview>(withAppParam('/api/overview', appId)),
    refetchInterval: 60_000,
  })
  const metricsQ = useQuery({
    queryKey: ['metrics-daily', appId, 30],
    queryFn: () => api<MetricsDaily[]>(withAppParam('/api/metrics/daily?days=30', appId)),
  })
  const salesQ = useQuery({
    queryKey: ['sales-daily', appId, 30],
    queryFn: () => api<SalesDaily[]>(withAppParam('/api/sales/daily?days=30', appId)),
  })
  const activityQ = useQuery({
    queryKey: ['activity-feed', appId],
    queryFn: () => api<{ items: ActivityItem[] }>(withAppParam('/api/activity?limit=8', appId)),
    refetchInterval: 60_000,
  })
  const badReviewQ = useQuery({
    queryKey: ['latest-bad-review', appId],
    queryFn: () => api<{ reviews: Review[] }>(withAppParam('/api/reviews?max_rating=2&limit=1', appId)),
  })
  const reconQ = useQuery({
    queryKey: ['reconciliation', appId],
    queryFn: () => api<Reconciliation>(withAppParam('/api/revenue/reconciliation?days=30', appId)),
    enabled: caliber !== 'gross',
  })
  const rate = reconQ.data?.summary.proceedsRate ?? 0.85
  // 平均评分 KPI（页级取分布，与下方「评分分布」卡共享 react-query 缓存，仅一次请求）
  const distQ = useQuery({
    queryKey: ['rating-dist', appId],
    queryFn: () => api<RatingDistribution>(withAppParam('/api/reviews/distribution?days=90', appId)),
  })

  const o = overviewQ.data

  // 活跃订阅单一口径：全部 Apps 且 ASC 快照 ≥ 昨日用快照，否则实时值
  const snapshotFresh = appId == null && o?.snapshot != null && o.snapshot.date >= yesterdayStr()
  const activeValue = snapshotFresh ? o!.snapshot!.active : o?.activeSubs ?? 0
  const subsSource = snapshotFresh ? `ASC · ${o!.snapshot!.date.slice(5)}` : '实时'

  const todayCaliber = effectiveCaliber(caliber, false)
  const calLabel = ({ net: '净额', gross: '流水', billed: '账单' } as Record<string, string>)[todayCaliber] ?? '净额'
  const todayRevenue = o ? applyCaliber(o.todayRevenueUsdMilli, todayCaliber, rate) : 0

  // 本月收入（月至今）：从 30 天 metrics 过滤当月即可——月最长 31 天，30 天窗口从每月 31 号
  // 往回正好覆盖到 1 号（metrics_daily.date 为 UTC，故月首也按 UTC 取）。口径与今日/趋势一致。
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const monthMetrics = (metricsQ.data ?? []).filter((d) => d.date >= monthStart)
  const monthSum = (f: (d: MetricsDaily) => number) => monthMetrics.reduce((s, d) => s + f(d), 0)
  const billedMonth = (salesQ.data ?? []).filter((d) => d.date >= monthStart).reduce((s, d) => s + d.proceedsUsdMilli, 0)
  const monthCaliber = effectiveCaliber(caliber, billedMonth > 0)
  const monthRevenue = monthCaliber === 'billed' ? billedMonth : applyCaliber(monthSum((d) => d.revenue_milli), monthCaliber, rate)

  const yesterdayRevenue = metricsQ.data?.filter((d) => d.date === yesterdayStr()).reduce((s, d) => s + d.revenue_milli, 0)
  const todayDelta =
    o && yesterdayRevenue != null && yesterdayRevenue > 0
      ? ((o.todayRevenueUsdMilli - yesterdayRevenue) / yesterdayRevenue) * 100
      : null

  // 收入趋势缩略（固定 30 天，跟随全局口径，billed 无账单降 net）
  const billedReady = (salesQ.data?.length ?? 0) > 0
  const trendCaliber = effectiveCaliber(caliber, billedReady)
  const trendData: Array<{ date: string; value: number }> = (() => {
    if (trendCaliber === 'billed') return (salesQ.data ?? []).map((d) => ({ date: d.date, value: d.proceedsUsdMilli }))
    const byDate = new Map<string, number>()
    for (const d of metricsQ.data ?? []) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.revenue_milli)
    return [...byDate.entries()].map(([date, value]) => ({ date, value: applyCaliber(value, trendCaliber, rate) })).sort((a, b) => a.date.localeCompare(b.date))
  })()
  const trendTotal = trendData.reduce((s, d) => s + d.value, 0)
  const downloads30 = (salesQ.data ?? []).reduce((s, d) => s + d.downloads, 0)
  const badReview = badReviewQ.data?.reviews[0]

  // KPI sparkline 序列：按日聚合 30 天 metrics（多 App 合并）
  const dailyAgg = new Map<string, { mrr: number; active: number }>()
  for (const d of metricsQ.data ?? []) {
    const a = dailyAgg.get(d.date) ?? { mrr: 0, active: 0 }
    a.mrr += d.mrr_milli
    a.active += d.active_subs
    dailyAgg.set(d.date, a)
  }
  const aggDates = [...dailyAgg.keys()].sort()
  const mrrSeries = aggDates.map((dt) => dailyAgg.get(dt)!.mrr)
  const activeSeries = aggDates.map((dt) => dailyAgg.get(dt)!.active)
  const revSeries = trendData.map((d) => d.value)
  const mrrDelta =
    mrrSeries.length > 1 && mrrSeries[0] > 0
      ? ((mrrSeries[mrrSeries.length - 1] - mrrSeries[0]) / mrrSeries[0]) * 100
      : null
  const ratingAvg =
    distQ.data && distQ.data.total > 0
      ? distQ.data.distribution.reduce((s, d) => s + d.rating * d.count, 0) / distQ.data.total
      : null

  if (overviewQ.isError) {
    return (
      <>
        <PageHeader title="总览" />
        <ErrorState onRetry={() => overviewQ.refetch()} />
      </>
    )
  }

  return (
    <div className="overview-grid">
      <PageHeader title="总览" />

      {/* ═══ HERO：今日收入大卡 + 30 天趋势（对齐设计稿指挥中心 HERO）═══ */}
      {overviewQ.isPending || !o ? (
        <div className="skeleton h-hero span-full" aria-hidden="true" />
      ) : (
        <section className="cmd-hero span-full">
          <div className="ch-main">
            <div className="ch-head">
              <span className="stat-ic tone-success"><Icon name="dollar" size={17} /></span>
              <span className="ch-label">今日收入 · {calLabel}</span>
              {todayDelta != null && (
                <span className={`ch-delta ${todayDelta >= 0 ? 'up' : 'down'}`}>
                  {todayDelta >= 0 ? '↑' : '↓'} {Math.abs(todayDelta).toFixed(0)}% vs 昨日
                </span>
              )}
            </div>
            <div className="ch-value num">{fmtUsd(todayRevenue)}</div>
            <div className="ch-foots">
              <span><b>{o.todayNewSubs}</b> 新订</span>
              <span><b>{o.todayRenewals}</b> 续费</span>
              <span><b className="neg">{o.todayRefunds}</b> 退款</span>
            </div>
            <div className="ch-actions">
              <button className="primary" onClick={() => navigate('/revenue')}>收入分析 →</button>
            </div>
          </div>
          <div className="ch-chart">
            <div className="ch-chart-head">
              <span>近 30 天收入趋势</span>
              <span className="cc-total">合计 <b className="num">{fmtUsd(trendTotal)}</b></span>
            </div>
            <div className="ch-chart-body">
              {metricsQ.isPending ? (
                <Skeleton variant="chart" height={172} />
              ) : (
                <TrendChart
                  type="area"
                  data={trendData}
                  series={[{ key: 'value', name: '收入', color: 'var(--chart-2)' }]}
                  format={fmtUsd}
                  axisFormat={fmtUsdCompact}
                  height={172}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ═══ KPI STRIP：本月收入 / MRR / 活跃订阅 / 平均评分 ═══ */}
      <div className="kpi-strip span-full">
        <KpiCard
          icon="chart" tone="violet" label="本月收入"
          value={fmtUsd(monthRevenue)}
          foot={`新订 ${monthSum((d) => d.new_subs)} · 续费 ${monthSum((d) => d.renewals)}`}
          spark={revSeries}
          onPress={() => navigate('/revenue')}
        />
        <KpiCard
          icon="trendingUp" tone="accent" label="MRR"
          value={o ? fmtUsd(o.mrrUsdMilli) : '—'}
          delta={mrrDelta != null ? { text: `${Math.abs(mrrDelta).toFixed(1)}%`, direction: mrrDelta >= 0 ? 'up' : 'down' } : undefined}
          foot={o ? `ARR ${fmtUsd(o.mrrUsdMilli * 12)}` : undefined}
          spark={mrrSeries}
          onPress={() => navigate('/revenue/health')}
        />
        <KpiCard
          icon="users" tone="teal" label="活跃订阅"
          value={String(activeValue)}
          badge={<CaliberTag>{subsSource}</CaliberTag>}
          foot={o ? `试用 ${o.trialSubs} · 风险 ${o.riskSubs}` : undefined}
          spark={activeSeries}
          onPress={() => navigate('/revenue/detail')}
        />
        <KpiCard
          icon="star" tone="star" label="平均评分"
          value={ratingAvg != null ? ratingAvg.toFixed(1) : '—'}
          foot={`近 90 天 ${distQ.data?.total ?? 0} 条评论`}
          onPress={() => navigate('/reviews')}
        />
      </div>

      {/* 新差评醒目卡（一眼看到要处理的差评） */}
      {badReview && (
        <button className="alert-card span-full" onClick={() => navigate('/reviews?bad=1')}>
          <Icon name="message" size={20} />
          <div className="ac-body">
            <div className="ac-title"><Stars rating={badReview.rating} /> 有新差评待处理</div>
            <div className="ac-text">{badReview.title || badReview.body}</div>
          </div>
          <Icon name="chevronRight" size={18} />
        </button>
      )}

      {/* ===== 实时监控 ===== */}
      <div className="group-label divider span-full"><span>实时监控</span></div>

      {/* 实时动态流（桌面左列，指挥中心主视觉） */}
      <Section title="实时动态" action={{ label: '查看全部', onPress: () => navigate('/activity') }}>
        {activityQ.isPending ? (
          <Skeleton variant="rows" count={5} />
        ) : !activityQ.data?.items.length ? (
          <EmptyState icon="activity" title="还没有动态" hint="收到 App Store 通知后会实时出现在这里" />
        ) : (
          <div className="list">
            {activityQ.data.items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Section>

      {/* 右列：收入趋势缩略 + 下载量 */}
      <div className="col-stack">
        <Section title="收入趋势" action={{ label: '收入分析', onPress: () => navigate('/revenue') }}>
          <div className="chart-frame">
            <div className="head">
              <span className="total num">{fmtUsd(trendTotal)}</span>
              <span className="label">30 天合计{trendCaliber === 'billed' ? ' · 账单' : ''}</span>
            </div>
            {metricsQ.isPending ? (
              <Skeleton variant="chart" height={170} />
            ) : (
              <TrendChart
                type="area"
                data={trendData}
                series={[{ key: 'value', name: '收入', color: 'var(--chart-2)' }]}
                format={fmtUsd}
                axisFormat={fmtUsdCompact}
                height={170}
              />
            )}
          </div>
        </Section>

        {(salesQ.data?.length ?? 0) > 0 && (
          <Section title="下载量">
            <div className="chart-frame">
              <div className="head">
                <span className="total num">{downloads30.toLocaleString()}</span>
                <span className="label">30 天下载 · 账单 T+1</span>
              </div>
              <TrendChart
                type="area"
                data={(salesQ.data ?? []).map((d) => ({ date: d.date, value: d.downloads }))}
                series={[{ key: 'value', name: '下载', color: 'var(--chart-4)' }]}
                format={(v) => `${v} 次`}
                axisFormat={(v) => String(v)}
                height={150}
              />
            </div>
          </Section>
        )}
      </div>

      {/* ===== 健康度与口碑 ===== */}
      <div className="group-label divider span-full"><span>健康度与口碑</span></div>

      {/* 订阅健康环形（桌面左列） */}
      <Section title="订阅健康" action={{ label: '订阅明细', onPress: () => navigate('/revenue/detail') }}>
        {overviewQ.isPending || !o ? (
          <Skeleton variant="chart" height={196} />
        ) : (
          <SubHealthCard o={o} />
        )}
      </Section>

      {/* 评分分布（桌面右列） */}
      <div className="col-stack">
        <RatingDistCard appId={appId} onOpen={() => navigate('/reviews')} />
      </div>

      {/* 多 App 分列概览（全部 Apps 模式） */}
      {appId == null && <MultiAppOverview />}
    </div>
  )
}
