// 总览 = 指挥中心：一屏回答四件事——①今天赚多少 ②新差评 ③订阅健康 ④多 App 概览
// KPI 行 → 差评醒目卡 → [实时动态流 | 收入趋势+下载+口碑] → 多 App 分列概览
// 全局口径只读消费（开关在收入页头）；收入类不重复标口径，数据新鲜度（ASC 快照）保留角标

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import {
  api, type ActivityItem, type AppOverviewRow, type MetricsDaily, type Overview,
  type Reconciliation, type Review, type SalesDaily,
} from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { applyCaliber, effectiveCaliber, useCaliber } from '../lib/caliber'
import { fmtUsd, fmtUsdCompact } from '../lib/money'
import { ActivityRow } from '../components/ActivityRow'
import { AppIcon } from '../components/AppIcon'
import { Icon, Stars } from '../components/Icon'
import { TrendChart } from '../components/TrendChart'
import { CaliberTag, EmptyState, ErrorState, PageHeader, Section, Skeleton, StatCard } from '../components/ui'

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

  const o = overviewQ.data

  // 活跃订阅单一口径：全部 Apps 且 ASC 快照 ≥ 昨日用快照，否则实时值
  const snapshotFresh = appId == null && o?.snapshot != null && o.snapshot.date >= yesterdayStr()
  const activeValue = snapshotFresh ? o!.snapshot!.active : o?.activeSubs ?? 0
  const trialValue = snapshotFresh ? o!.snapshot!.trials : o?.trialSubs ?? 0
  const subsSource = snapshotFresh ? `ASC · ${o!.snapshot!.date.slice(5)}` : '实时'

  const todayCaliber = effectiveCaliber(caliber, false)
  const todayRevenue = o ? applyCaliber(o.todayRevenueUsdMilli, todayCaliber, rate) : 0
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

      {/* KPI：今日收入 / MRR / 活跃订阅 / 试用中 —— 卡片是路由器 */}
      <div className="stat-grid cols-2 span-full">
        <StatCard
          loading={overviewQ.isPending}
          icon="dollar"
          label="今日收入"
          value={o ? fmtUsd(todayRevenue) : ''}
          delta={todayDelta != null ? { text: `${Math.abs(todayDelta).toFixed(0)}% vs 昨日`, direction: todayDelta >= 0 ? 'up' : 'down' } : undefined}
          foot={o ? `新订 ${o.todayNewSubs} · 续费 ${o.todayRenewals} · 退款 ${o.todayRefunds}` : undefined}
          onPress={() => navigate('/revenue')}
        />
        <StatCard
          loading={overviewQ.isPending}
          icon="trendingUp"
          label="MRR"
          value={o ? fmtUsd(o.mrrUsdMilli) : ''}
          foot={o ? `ARR ${fmtUsd(o.mrrUsdMilli * 12)}` : undefined}
          onPress={() => navigate('/revenue')}
        />
        <StatCard
          loading={overviewQ.isPending}
          icon="users"
          label="活跃订阅"
          badge={<CaliberTag>{subsSource}</CaliberTag>}
          value={String(activeValue)}
          foot={o && o.riskSubs > 0 ? `流失风险 ${o.riskSubs} · 已关续费 ${o.autoRenewOffCount}` : o ? `已关续费 ${o.autoRenewOffCount}` : undefined}
          onPress={() => navigate('/revenue/detail')}
        />
        <StatCard
          loading={overviewQ.isPending}
          icon="clock"
          label="试用中"
          badge={<CaliberTag>{subsSource}</CaliberTag>}
          value={String(trialValue)}
          foot={o?.todayReviewAvg != null ? `今日评分 ${o.todayReviewAvg.toFixed(1)} ★` : undefined}
          onPress={() => navigate('/revenue/health')}
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
              <span className="label">30 天合计</span>
            </div>
            {metricsQ.isPending ? (
              <Skeleton variant="chart" />
            ) : (
              <TrendChart
                type="area"
                data={trendData}
                series={[{ key: 'value', name: '收入', color: trendCaliber === 'billed' ? 'var(--chart-2)' : 'var(--chart-1)' }]}
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

      {/* 多 App 分列概览（全部 Apps 模式） */}
      {appId == null && <MultiAppOverview />}
    </div>
  )
}
