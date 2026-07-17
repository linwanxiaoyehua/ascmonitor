import { useEffect, useState } from 'react'
import { api, timeAgo, type Review, type RatingSnapshot, type TagStat } from '../lib/api'
import { countryFlag, countryName } from '../lib/format'
import { Icon, Stars } from '../components/Icon'

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

/** 评分趋势折线（单系列 sparkline，纵轴自适应数据范围） */
function RatingSparkline({ data }: { data: Array<{ date: string; avg: number }> }) {
  if (data.length < 2) return null
  const min = Math.min(...data.map((d) => d.avg))
  const max = Math.max(...data.map((d) => d.avg))
  const span = Math.max(max - min, 0.1)
  const W = 100
  const H = 28
  const points = data
    .map((d, i) => `${(i / (data.length - 1)) * W},${H - 2 - ((d.avg - min) / span) * (H - 4)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 56, display: 'block' }} preserveAspectRatio="none"
      role="img" aria-label={`近 ${data.length} 天评分走势，${data[0].avg.toFixed(2)} 到 ${data[data.length - 1].avg.toFixed(2)}`}>
      <polyline className="spark-line" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function RatingHeader() {
  const [snapshots, setSnapshots] = useState<RatingSnapshot[] | null>(null)

  useEffect(() => {
    api<RatingSnapshot[]>('/api/ratings?days=30').then(setSnapshots).catch(() => setSnapshots([]))
  }, [])

  if (!snapshots?.length) return null

  const trend = weightedByDate(snapshots)
  if (!trend.length) return null
  const latest = trend[trend.length - 1]
  // 与 ≥7 天前最近一个快照对比
  const weekAgoDate = new Date(Date.parse(latest.date) - 7 * 86400_000).toISOString().slice(0, 10)
  const base = [...trend].reverse().find((d) => d.date <= weekAgoDate)
  const delta = base ? latest.avg - base.avg : null

  // 最新一天的各国明细（按评分数排序取前 6）
  const countries = snapshots
    .filter((s) => s.date === latest.date && s.ratings_count)
    .sort((a, b) => (b.ratings_count ?? 0) - (a.ratings_count ?? 0))
    .slice(0, 6)

  return (
    <div className="chart" style={{ marginBottom: 12 }}>
      <div className="chart-head">
        <span className="chart-total">
          {latest.avg.toFixed(2)} <span style={{ color: 'var(--yellow)' }}>★</span>
        </span>
        <span className="chart-label num">
          {latest.count.toLocaleString()} 个评分
          {delta != null && Math.abs(delta) >= 0.005 && (
            <span className={delta > 0 ? 'delta-up' : 'delta-down'}>
              {' '}{delta > 0 ? '↑' : '↓'}{Math.abs(delta).toFixed(2)} / 7天
            </span>
          )}
        </span>
      </div>
      <RatingSparkline data={trend} />
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

function ReviewsSkeleton() {
  return (
    <div className="review-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ height: 110 }} />
      ))}
    </div>
  )
}

export function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [badOnly, setBadOnly] = useState(false)
  const [tag, setTag] = useState<string | null>(null)
  const [tagStats, setTagStats] = useState<TagStat[]>([])
  const [loading, setLoading] = useState(false)

  const load = async (before?: number, bad = badOnly, activeTag = tag) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (before) params.set('before', String(before))
      if (bad) params.set('max_rating', '2')
      if (activeTag) params.set('tag', activeTag)
      const res = await api<{ reviews: Review[]; nextBefore: number | null }>(`/api/reviews?${params}`)
      setReviews((prev) => (before && prev ? [...prev, ...res.reviews] : res.reviews))
      setNextBefore(res.nextBefore)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api<TagStat[]>('/api/reviews/tags/stats?days=30').then(setTagStats).catch(() => {})
  }, [])

  useEffect(() => {
    setReviews(null)
    load(undefined, badOnly, tag)
  }, [badOnly, tag])

  return (
    <div>
      <h1 className="page-title">评论</h1>
      <RatingHeader />
      <div className="filters" role="tablist">
        <button role="tab" aria-selected={!badOnly} className={!badOnly ? 'active' : ''} onClick={() => setBadOnly(false)}>全部</button>
        <button role="tab" aria-selected={badOnly} className={badOnly ? 'active' : ''} onClick={() => setBadOnly(true)}>仅差评</button>
      </div>
      {tagStats.length > 0 && (
        <div className="tag-chips" role="group" aria-label="按标签筛选">
          {tagStats.map((t) => (
            <button
              key={t.tag}
              className={`tag-chip${tag === t.tag ? ' active' : ''}`}
              aria-pressed={tag === t.tag}
              onClick={() => setTag(tag === t.tag ? null : t.tag)}
            >
              {t.tag} <span className="num">{t.count}</span>
            </button>
          ))}
        </div>
      )}
      {reviews === null ? (
        <ReviewsSkeleton />
      ) : reviews.length === 0 ? (
        <div className="empty">
          <Icon name="message" size={36} />
          <div>暂无评论</div>
          <span className="muted">
            {tag ? '该标签下近 30 天没有评论' : '在设置页填写 App 的 Apple ID 后开始自动抓取'}
          </span>
        </div>
      ) : (
        <div className="review-list">
          {reviews.map((r) => (
            <article className="review-card" key={r.id}>
              <div className="meta">
                <Stars rating={r.rating} />
                {r.country && (
                  <span title={countryName(r.country)}>
                    {countryFlag(r.country) || r.country.toUpperCase()} {countryName(r.country)}
                  </span>
                )}
                {r.review_version && <span>v{r.review_version}</span>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reviewer}</span>
                <span style={{ marginLeft: 'auto', flex: 'none' }}>{timeAgo(r.created_at)}</span>
              </div>
              {r.title && <div className="rtitle">{r.title}</div>}
              <div className="rbody">{r.body}</div>
              {r.tags.length > 0 && (
                <div className="tags-row">
                  {r.tags.map((t) => (
                    <span className="tag" key={t}>{t}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {nextBefore && (
        <button className="ghost" style={{ width: '100%', marginTop: 12 }} disabled={loading} onClick={() => load(nextBefore)}>
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
