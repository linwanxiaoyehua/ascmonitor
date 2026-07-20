// 评论：回答「用户怎么说」
// Rating hero → 筛选（差评 / 标签，状态 URL 化：?bad=1&tag=x，可直链/跨页携带）→ 评论流
// P4 将追加：评分分布条、版本对比卡、回复状态与回复 Sheet

import { useSearchParams } from 'wouter'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  api, type RatingDistribution, type RatingSnapshot, type Review, type TagStat, type VersionCompare,
} from '../lib/api'
import { useAppFilter, withAppParam } from '../lib/app-filter'
import { countryFlag, countryName } from '../lib/format'
import { DistributionBars } from '../components/DistributionBars'
import { ReviewCard } from '../components/ReviewCard'
import { Sparkline } from '../components/Sparkline'
import { EmptyState, FilterChips, LoadMore, PageHeader, Section, SegmentedControl, Skeleton, StatCard } from '../components/ui'

/** 评分分布（近 90 天文字评论样本；官方无全量分布 API） */
function RatingDist() {
  const appId = useAppFilter()
  const { data } = useQuery({
    queryKey: ['rating-dist', appId],
    queryFn: () => api<RatingDistribution>(withAppParam('/api/reviews/distribution?days=90', appId)),
  })
  if (!data || data.total === 0) return null
  return (
    <Section title="评分分布">
      <div className="panel pad">
        <DistributionBars
          variant="rating"
          data={data.distribution.map((d) => ({
            key: String(d.rating),
            label: `${d.rating} ★`,
            value: d.count,
            display: `${d.count} · ${data.total ? Math.round((d.count / data.total) * 100) : 0}%`,
          }))}
        />
        <p className="muted hint">样本 = 近 90 天已抓取的文字评论</p>
      </div>
    </Section>
  )
}

/** 版本前后对比（仅选定单 App；review_version 来自 RSS） */
function VersionCompareCard() {
  const appId = useAppFilter()
  const { data } = useQuery({
    queryKey: ['version-compare', appId],
    queryFn: () => api<VersionCompare>(withAppParam('/api/reviews/version-compare', appId)),
    enabled: appId != null,
  })
  if (!data || data.versions.length === 0) return null
  return (
    <Section title="版本对比">
      <div className="stat-grid pair">
        {data.versions.map((v, i) => (
          <StatCard
            key={v.version}
            icon={i === 0 ? 'trendingUp' : 'clock'}
            label={`v${v.version}${i === 0 ? ' · 当前' : ' · 上一版'}`}
            value={v.avg != null ? `${v.avg.toFixed(2)} ★` : '—'}
            foot={`${v.count} 条 · 差评率 ${v.badRate != null ? Math.round(v.badRate * 100) : 0}%`}
          />
        ))}
      </div>
    </Section>
  )
}

/** 各国快照按日加权平均：Σ(均分×数量)/Σ数量 */
function weightedByDate(snapshots: RatingSnapshot[]): Array<{ date: string; avg: number; count: number }> {
  const byDate = new Map<string, { sum: number; count: number }>()
  for (const s of snapshots) {
    if (s.avg_rating == null || !s.ratings_count) continue
    const agg = byDate.get(s.date) ?? { sum: 0, count: 0 }
    agg.sum += s.avg_rating * s.ratings_count
    agg.count += s.ratings_count
    byDate.set(s.date, agg)
  }
  return [...byDate.entries()]
    .map(([date, { sum, count }]) => ({ date, avg: sum / count, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function RatingHero() {
  const appId = useAppFilter()
  const { data: snapshots, isPending } = useQuery({
    queryKey: ['ratings', appId],
    queryFn: () => api<RatingSnapshot[]>(withAppParam('/api/ratings?days=30', appId)),
  })

  if (isPending) return <Skeleton variant="hero" />
  if (!snapshots?.length) return null

  const trend = weightedByDate(snapshots)
  if (!trend.length) return null
  const latest = trend[trend.length - 1]
  const weekAgoDate = new Date(Date.parse(latest.date) - 7 * 86400_000).toISOString().slice(0, 10)
  const base = [...trend].reverse().find((d) => d.date <= weekAgoDate)
  const delta = base ? latest.avg - base.avg : null

  const countries = snapshots
    .filter((s) => s.date === latest.date && s.ratings_count)
    .sort((a, b) => (b.ratings_count ?? 0) - (a.ratings_count ?? 0))
    .slice(0, 6)

  return (
    <div className="chart-frame mb-3">
      <div className="head">
        <span className="total num">
          {latest.avg.toFixed(2)} <span className="star-text">★</span>
        </span>
        <span className="label num">
          {latest.count.toLocaleString()} 个评分
          {delta != null && Math.abs(delta) >= 0.005 && (
            <span className={delta > 0 ? 'delta-up' : 'delta-down'}>
              {' '}{delta > 0 ? '↑' : '↓'}{Math.abs(delta).toFixed(2)} / 7天
            </span>
          )}
        </span>
      </div>
      {trend.length >= 4 && <Sparkline data={trend.map((d) => d.avg)} height={40} />}
      {countries.length > 1 && (
        <div className="country-ratings">
          {countries.map((c) => (
            <span key={c.country} className="country-rating num" title={countryName(c.country)}>
              {countryFlag(c.country)} {c.avg_rating?.toFixed(1)}
              <span className="muted">（{c.ratings_count}）</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReviewsPage() {
  const appId = useAppFilter()
  // 筛选状态以 URL 为唯一事实源（?bad=1&tag=x），可直链/刷新/跨页携带
  const [searchParams, setSearchParams] = useSearchParams()
  const badOnly = searchParams.get('bad') === '1'
  const tag = searchParams.get('tag')

  // updater 形式写回：天然保留 ?app= 等既有参数
  const setBadOnly = (v: boolean) =>
    setSearchParams((prev) => {
      if (v) prev.set('bad', '1')
      else prev.delete('bad')
      return prev
    }, { replace: true })
  const setTag = (v: string | null) =>
    setSearchParams((prev) => {
      if (v) prev.set('tag', v)
      else prev.delete('tag')
      return prev
    }, { replace: true })

  const { data: tagStats } = useQuery({
    queryKey: ['tag-stats', appId],
    queryFn: () => api<TagStat[]>(withAppParam('/api/reviews/tags/stats?days=30', appId)),
  })

  const reviewsQ = useInfiniteQuery({
    queryKey: ['reviews', appId, badOnly, tag],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('before', String(pageParam))
      if (badOnly) params.set('max_rating', '2')
      if (tag) params.set('tag', tag)
      return api<{ reviews: Review[]; nextBefore: number | null }>(withAppParam(`/api/reviews?${params}`, appId))
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore,
  })

  const reviews = reviewsQ.data?.pages.flatMap((p) => p.reviews) ?? []

  return (
    <div className="narrow-lg">
      <PageHeader title="评论" />
      <RatingHero />
      <RatingDist />
      <VersionCompareCard />

      <div className="vstack mb-3">
        <SegmentedControl
          label="评分筛选"
          options={[
            { value: 'all', label: '全部' },
            { value: 'bad', label: '仅差评' },
          ]}
          value={badOnly ? 'bad' : 'all'}
          onChange={(v) => setBadOnly(v === 'bad')}
        />
        {(tagStats?.length ?? 0) > 0 && (
          <FilterChips
            scroll
            label="评论标签"
            items={(tagStats ?? []).map((t) => ({ key: t.tag, label: t.tag, count: t.count }))}
            active={tag}
            onToggle={setTag}
          />
        )}
      </div>

      {reviewsQ.isPending ? (
        <Skeleton variant="rows" count={3} />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="message"
          title="暂无评论"
          hint={tag ? '该标签下近 30 天没有评论' : '在设置 → App 管理填写 Apple ID 后开始自动抓取'}
        />
      ) : (
        <div className="review-list">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
      <LoadMore
        hasNextPage={!!reviewsQ.hasNextPage}
        isFetchingNextPage={reviewsQ.isFetchingNextPage}
        fetchNextPage={() => reviewsQ.fetchNextPage()}
      />
    </div>
  )
}
