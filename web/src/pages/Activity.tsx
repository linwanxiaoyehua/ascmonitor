// 动态：ASSN 事件 + 告警合流时间线（替代原「事件」segment 与告警历史）
// 筛选 chips + 按天分组 + 无限加载

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api, type ActivityItem } from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { dayLabel } from '../lib/format'
import { ActivityRow } from '../components/ActivityRow'
import { EmptyState, FilterChips, LoadMore, PageHeader, Skeleton } from '../components/ui'

const KIND_FILTERS = [
  { key: 'revenue', label: '收入' },
  { key: 'sub_change', label: '订阅变化' },
  { key: 'refund', label: '退款' },
  { key: 'alert', label: '告警' },
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

  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  // 按天分组
  const groups: Array<{ label: string; items: ActivityItem[] }> = []
  for (const item of items) {
    const label = dayLabel(item.ts)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  return (
    <div className="narrow-lg">
      <PageHeader title="动态" />

      <div className="hstack-center">
        <FilterChips scroll items={KIND_FILTERS} active={kind} onToggle={setKind} />
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
        groups.map((g) => (
          <div className="day-group" key={g.label}>
            <div className="group-label">{g.label}</div>
            <div className="list">
              {g.items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))
      )}
      <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => q.fetchNextPage()} />
    </div>
  )
}
