import { useEffect, useState } from 'react'
import { api, timeAgo, type Review } from '../lib/api'
import { countryFlag, countryName } from '../lib/format'
import { Icon, Stars } from '../components/Icon'

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
  const [loading, setLoading] = useState(false)

  const load = async (before?: number, bad = badOnly) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (before) params.set('before', String(before))
      if (bad) params.set('max_rating', '2')
      const res = await api<{ reviews: Review[]; nextBefore: number | null }>(`/api/reviews?${params}`)
      setReviews((prev) => (before && prev ? [...prev, ...res.reviews] : res.reviews))
      setNextBefore(res.nextBefore)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setReviews(null)
    load(undefined, badOnly)
  }, [badOnly])

  return (
    <div>
      <h1 className="page-title">评论</h1>
      <div className="filters" role="tablist">
        <button role="tab" aria-selected={!badOnly} className={!badOnly ? 'active' : ''} onClick={() => setBadOnly(false)}>全部</button>
        <button role="tab" aria-selected={badOnly} className={badOnly ? 'active' : ''} onClick={() => setBadOnly(true)}>仅差评</button>
      </div>
      {reviews === null ? (
        <ReviewsSkeleton />
      ) : reviews.length === 0 ? (
        <div className="empty">
          <Icon name="message" size={36} />
          <div>暂无评论</div>
          <span className="muted">在设置页填写 App 的 Apple ID 后开始自动抓取</span>
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
