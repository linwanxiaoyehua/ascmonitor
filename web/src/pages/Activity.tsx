// 动态：ASSN 事件 + 告警合流时间线（替代原「事件」segment 与告警历史）
// 筛选 chips + 按天分组（组头带当日收入合计）+ 无限加载

import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api, type ActivityItem, type DayTotal, type Overview } from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { dayKey, dayLabel } from '../lib/format'
import { fmtUsd } from '../lib/money'
import { ActivityRow } from '../components/ActivityRow'
import { Icon, type IconName } from '../components/Icon'
import { EmptyState, FilterChips, LoadMore, PageHeader, Skeleton } from '../components/ui'

/** 今日汇总条（对齐 实时动态.dc.html）：今日收入 / 新订 / 续费 / 退款 */
function TodaySummary() {
  const appId = useAppFilter()
  const { data: o } = useQuery({
    queryKey: ['overview', appId],
    queryFn: () => api<Overview>(withAppParam('/api/overview', appId)),
    refetchInterval: 60_000,
  })
  if (!o) return null
  const cells: Array<{ icon: IconName; tone: string; label: string; value: string }> = [
    { icon: 'dollar', tone: 'success', label: '今日收入', value: fmtUsd(o.todayRevenueUsdMilli) },
    { icon: 'zap', tone: 'accent', label: '新订', value: String(o.todayNewSubs) },
    { icon: 'refresh', tone: 'info', label: '续费', value: String(o.todayRenewals) },
    { icon: 'trendingDown', tone: 'danger', label: '退款', value: String(o.todayRefunds) },
  ]
  return (
    <div className="act-summary">
      {cells.map((c) => (
        <div className="as-cell" key={c.label}>
          <div className="as-head"><span className={`stat-ic tone-${c.tone}`}><Icon name={c.icon} size={14} /></span>{c.label}</div>
          <div className={`as-value num tone-${c.tone}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

const KIND_FILTERS = [
  { key: 'revenue', label: '收入' },
  { key: 'sub_change', label: '订阅变化' },
  { key: 'refund', label: '退款' },
  { key: 'alert', label: '告警' },
  { key: 'build', label: '构建' },
  { key: 'system', label: '系统' },
]

export function ActivityPage() {
  const appId = useAppFilter()
  // 空数组＝全部；多选并集（后端 kinds 逗号分隔已支持）
  const [kinds, setKinds] = useState<string[]>([])
  const [hideSandbox, setHideSandbox] = useState(false)
  const toggleKind = (key: string) =>
    setKinds((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const q = useInfiniteQuery({
    queryKey: ['activity', appId, kinds, hideSandbox],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('before', String(pageParam))
      if (kinds.length) params.set('kinds', kinds.join(','))
      if (hideSandbox) params.set('sandbox', '0')
      return api<{ items: ActivityItem[]; nextBefore: number | null }>(withAppParam(`/api/activity?${params}`, appId))
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: 60_000,
  })

  // 当日收入合计：后端按本地时区重算，故与下方各行严格对齐，且不随「加载更多」变化
  const tzOffset = new Date().getTimezoneOffset()
  const totalsQ = useQuery({
    queryKey: ['activity-day-totals', appId, hideSandbox, tzOffset],
    queryFn: () => {
      const params = new URLSearchParams({ days: '30', tz_offset: String(tzOffset) })
      if (hideSandbox) params.set('sandbox', '0')
      return api<DayTotal[]>(withAppParam(`/api/activity/day-totals?${params}`, appId))
    },
    select: (rows) => new Map(rows.map((r) => [r.date, r])),
    refetchInterval: 60_000,
  })

  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  // 按本地自然日分组（key 用 dayKey，label 只负责显示）
  const groups: Array<{ key: string; label: string; items: ActivityItem[] }> = []
  for (const item of items) {
    const key = dayKey(item.ts)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(item.ts), items: [item] })
  }

  return (
    <div className="narrow-lg">
      <PageHeader title="实时动态" />
      <TodaySummary />
      <div className="hstack-center">
        <FilterChips scroll multiple label="事件类型" items={KIND_FILTERS} active={kinds} onToggle={toggleKind} />
        <button
          className={`chip${hideSandbox ? ' active' : ''}`}
          aria-pressed={hideSandbox}
          onClick={() => setHideSandbox(!hideSandbox)}
        >
          隐藏沙盒
        </button>
      </div>

      {q.isPending ? (
        <div className="mt-4">
          <Skeleton variant="rows" count={5} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="activity"
          title="还没有动态"
          hint={kinds.length ? '当前筛选下没有记录' : '在 App Store Connect 配置 Server URL 后，事件会实时出现在这里'}
        />
      ) : (
        groups.map((g) => {
          const total = totalsQ.data?.get(g.key)
          return (
            <div className="day-group" key={g.key}>
              <div className="group-label">
                <span>{g.label}</span>
                <span className="count">{g.items.length} 条</span>
                {total && (
                  <span
                    className={`day-total num${total.usdMilli < 0 ? ' neg' : ''}`}
                    title={`当日 ${total.count} 笔收入 / 退款事件合计（已折算 USD）`}
                  >
                    净 {total.usdMilli < 0 ? '−' : '+'}{fmtUsd(Math.abs(total.usdMilli))}
                  </span>
                )}
              </div>
              <div className="list">
                {g.items.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )
        })
      )}
      <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => q.fetchNextPage()} />
    </div>
  )
}
