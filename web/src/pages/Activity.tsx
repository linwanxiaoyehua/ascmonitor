// 动态：ASSN 事件 + 告警合流时间线（替代原「事件」segment 与告警历史）
// 筛选 chips + 按天分组（组头带当日收入合计）+ 无限加载

import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api, type ActivityItem, type DayTotal } from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { dayKey, dayLabel } from '../lib/format'
import { fmtUsd } from '../lib/money'
import { ActivityRow } from '../components/ActivityRow'
import { SubPage } from '../components/SubPage'
import { EmptyState, FilterChips, LoadMore, Skeleton } from '../components/ui'

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
  const [kind, setKind] = useState<string | null>(null)
  const [hideSandbox, setHideSandbox] = useState(false)

  const q = useInfiniteQuery({
    queryKey: ['activity', appId, kind, hideSandbox],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('before', String(pageParam))
      if (kind) params.set('kinds', kind)
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
    <SubPage title="实时动态" backTo="/" backLabel="返回总览" width="narrow-lg">
      <div className="hstack-center">
        <FilterChips scroll label="事件类型" items={KIND_FILTERS} active={kind} onToggle={setKind} />
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
          hint={kind ? '当前筛选下没有记录' : '在 App Store Connect 配置 Server URL 后，事件会实时出现在这里'}
        />
      ) : (
        groups.map((g) => {
          const total = totalsQ.data?.get(g.key)
          return (
            <div className="day-group" key={g.key}>
              <div className="group-label">
                <span>{g.label}</span>
                {total && (
                  <span
                    className={`day-total num${total.usdMilli < 0 ? ' neg' : ''}`}
                    title={`当日 ${total.count} 笔收入 / 退款事件合计（已折算 USD）`}
                  >
                    {total.usdMilli < 0 ? '−' : '+'}{fmtUsd(Math.abs(total.usdMilli))}
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
    </SubPage>
  )
}
