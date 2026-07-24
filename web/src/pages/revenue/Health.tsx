// 收入 · 订阅健康：订阅生意健康度（活跃/续订/Trial/Churn/退款）+ Trial 漏斗 + LTV
// 口径徽标不逐处标注——收入页头 CaliberSwitch 已指示当前口径

import { useQuery } from '@tanstack/react-query'
import {
  api, type CohortRow, type MetricsDaily, type Overview, type Reconciliation, type SalesDaily,
  type SubHealth, type TrialCohort,
} from '../../lib/api'
import { useAppFilter, withAppParam } from '../../lib/app-filter'
import { applyCaliber, effectiveCaliber, useCaliber } from '../../lib/caliber'
import { fmtUsd } from '../../lib/money'
import { DistributionBars } from '../../components/DistributionBars'
import { FunnelCard, type FunnelStep } from '../../components/FunnelCard'
import { Icon } from '../../components/Icon'
import { StackedBars } from '../../components/StackedBars'
import { EmptyState, ListRow, Section, Skeleton, StatCard } from '../../components/ui'

function TrialFunnel({ data }: { data: TrialCohort[] }) {
  return (
    <Section title="Trial 转化漏斗（按开始试用的周）">
      <div className="panel pad">
        <DistributionBars
          variant="seq"
          data={data.map((c) => ({
            key: c.weekStart,
            label: c.weekStart.slice(5),
            value: c.starts,
            display: `${c.converted}/${c.starts} · ${Math.round(c.rate * 100)}%`,
          }))}
        />
      </div>
    </Section>
  )
}

function LtvSection({ data, rate }: { data: CohortRow[]; rate: number }) {
  const effective = effectiveCaliber(useCaliber(), false)
  return (
    <Section title="LTV（按订阅开始月）">
      <div className="list">
        {data.map((c) => (
          <ListRow
            key={c.month}
            title={c.month}
            detail={`${c.subs} 个订阅 · 累计 ${fmtUsd(applyCaliber(c.revenueUsdMilli, effective, rate))}`}
            trailing={<span className="amount num">{fmtUsd(applyCaliber(c.ltvUsdMilli, effective, rate))}</span>}
          />
        ))}
      </div>
      <p className="muted hint">LTV = cohort 累计收入 ÷ 订阅者数 · 每周一自动重算</p>
    </Section>
  )
}

function ActivityBars() {
  const appId = useAppFilter()
  const { data } = useQuery({
    queryKey: ['metrics-daily', appId, 30],
    queryFn: () => api<MetricsDaily[]>(withAppParam('/api/metrics/daily?days=30', appId)),
  })
  const byDate = new Map<string, { new_subs: number; renewals: number; refunds: number }>()
  for (const d of data ?? []) {
    const a = byDate.get(d.date) ?? { new_subs: 0, renewals: 0, refunds: 0 }
    a.new_subs += d.new_subs; a.renewals += d.renewals; a.refunds += d.refunds
    byDate.set(d.date, a)
  }
  const days = [...byDate.keys()].sort()
  if (!days.length) return null
  const stacked = [
    { key: 'new_subs', name: '新订', color: 'var(--chart-1)', data: days.map((dt) => byDate.get(dt)!.new_subs) },
    { key: 'renewals', name: '续费', color: 'var(--chart-4)', data: days.map((dt) => byDate.get(dt)!.renewals) },
    { key: 'refunds', name: '退款', color: 'var(--chart-neg)', data: days.map((dt) => byDate.get(dt)!.refunds) },
  ]
  return (
    <Section title="近 30 天活动">
      <div className="panel pad">
        <div className="compo-legend-inline">
          {stacked.map((s) => (<span key={s.key}><span className="cli-dot" style={{ background: s.color }} />{s.name}</span>))}
        </div>
        <StackedBars series={stacked} height={190} />
      </div>
    </Section>
  )
}

function ConversionFunnel() {
  const appId = useAppFilter()
  const salesQ = useQuery({ queryKey: ['sales-daily', appId, 30], queryFn: () => api<SalesDaily[]>(withAppParam('/api/sales/daily?days=30', appId)) })
  const trialsQ = useQuery({ queryKey: ['trials', appId], queryFn: () => api<TrialCohort[]>(withAppParam('/api/metrics/trials?weeks=12', appId)) })
  const downloads = (salesQ.data ?? []).reduce((s, d) => s + d.downloads, 0)
  const starts = (trialsQ.data ?? []).reduce((s, c) => s + c.starts, 0)
  const converted = (trialsQ.data ?? []).reduce((s, c) => s + c.converted, 0)
  const convRate = starts ? Math.round((converted / starts) * 100) : 0
  if (starts === 0 && downloads === 0) return null
  const steps: FunnelStep[] = [
    { label: '下载 · 30 天', value: downloads.toLocaleString(), icon: <Icon name="download" size={18} />, tone: 'info' },
    { label: '试用开始', value: starts.toLocaleString(), icon: <Icon name="flask" size={18} />, tone: 'violet' },
    { label: '试用转化', value: converted.toLocaleString(), icon: <Icon name="check" size={18} />, tone: 'success', delta: starts ? { text: `转化率 ${convRate}%`, direction: 'up' } : undefined },
  ]
  return (
    <Section title="转化漏斗">
      <div className="funnel">{steps.map((s) => <FunnelCard key={s.label} step={s} />)}</div>
    </Section>
  )
}

export function RevenueHealth() {
  const appId = useAppFilter()
  const caliber = useCaliber()

  const overviewQ = useQuery({ queryKey: ['overview', appId], queryFn: () => api<Overview>(withAppParam('/api/overview', appId)) })
  const healthQ = useQuery({ queryKey: ['sub-health', appId], queryFn: () => api<SubHealth>(withAppParam('/api/metrics/sub-health?days=30', appId)) })
  const trialsQ = useQuery({ queryKey: ['trials', appId], queryFn: () => api<TrialCohort[]>(withAppParam('/api/metrics/trials?weeks=12', appId)) })
  const cohortsQ = useQuery({ queryKey: ['cohorts', appId], queryFn: () => api<CohortRow[]>(withAppParam('/api/metrics/cohorts', appId)) })
  const reconQ = useQuery({
    queryKey: ['reconciliation', appId],
    queryFn: () => api<Reconciliation>(withAppParam('/api/revenue/reconciliation?days=30', appId)),
    enabled: caliber !== 'gross',
  })
  const rate = reconQ.data?.summary.proceedsRate ?? 0.85

  const o = overviewQ.data
  const h = healthQ.data
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)
  const trialStarts = (trialsQ.data ?? []).reduce((s, c) => s + c.starts, 0)
  const trialConverted = (trialsQ.data ?? []).reduce((s, c) => s + c.converted, 0)

  const hasTrials = (trialsQ.data?.length ?? 0) > 0
  const hasCohorts = (cohortsQ.data?.length ?? 0) > 0

  return (
    <>
      <div className="stat-grid kpi">
        <StatCard
          loading={overviewQ.isPending}
          icon="users"
          tone="teal"
          label="活跃订阅"
          value={o ? String(o.activeSubs) : ''}
          foot={o ? `试用 ${o.trialSubs} · 流失风险 ${o.riskSubs}` : undefined}
        />
        <StatCard
          loading={healthQ.isPending}
          icon="refresh"
          tone="success"
          label="续订率"
          value={pct(h?.renewalRate)}
          foot={h ? `首续 ${h.firstRenewals} · 多续 ${h.repeatRenewals}` : undefined}
        />
        <StatCard
          loading={trialsQ.isPending}
          icon="zap"
          tone="accent"
          label="Trial 转化率"
          value={trialStarts > 0 ? `${Math.round((trialConverted / trialStarts) * 100)}%` : '—'}
          foot={trialStarts > 0 ? `${trialConverted}/${trialStarts} · 12 周` : '暂无试用'}
        />
        <StatCard
          loading={healthQ.isPending}
          icon="trendingDown"
          tone="danger"
          label="退款率 / Churn"
          value={pct(h?.refundRate)}
          foot={h ? `Churn ${pct(h.churnRate)}（主动 ${h.churnedVoluntary}/被动 ${h.churnedInvoluntary}）` : undefined}
        />
      </div>

      <ActivityBars />
      <ConversionFunnel />

      {hasTrials && <TrialFunnel data={trialsQ.data!} />}
      {hasCohorts && <LtvSection data={cohortsQ.data!} rate={rate} />}
      {!hasTrials && !hasCohorts && !trialsQ.isPending && (
        <Section title="转化与留存">
          <EmptyState icon="zap" title="还没有转化 / 留存数据" hint="收到试用与续订事件后开始积累；LTV 每周一自动重算（也可在设置 → 数据运维手动重建）" />
        </Section>
      )}
    </>
  )
}
