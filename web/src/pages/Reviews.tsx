import { useEffect, useState } from 'react'
import { api, timeAgo, type Review } from '../lib/api'

export function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
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
      setReviews((prev) => (before ? [...prev, ...res.reviews] : res.reviews))
      setNextBefore(res.nextBefore)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(undefined, badOnly)
  }, [badOnly])

  return (
    <div>
      <h1>评论</h1>
      <div className="filters">
        <button className={!badOnly ? 'active' : ''} onClick={() => setBadOnly(false)}>全部</button>
        <button className={badOnly ? 'active' : ''} onClick={() => setBadOnly(true)}>仅差评</button>
      </div>
      {reviews.length === 0 && !loading && (
        <div className="empty">暂无评论<br /><span className="muted">在设置页填写 App 的 Apple ID 后开始自动抓取</span></div>
      )}
      <div className="list">
        {reviews.map((r) => (
          <div className="review-card" key={r.id}>
            <div className="meta">
              <span className="stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
              <span>{r.country?.toUpperCase()}</span>
              {r.review_version && <span>v{r.review_version}</span>}
              <span>{r.reviewer}</span>
              <span style={{ marginLeft: 'auto' }}>{timeAgo(r.created_at)}</span>
            </div>
            {r.title && <div className="rtitle">{r.title}</div>}
            <div className="rbody">{r.body}</div>
            {r.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {r.tags.map((t) => (
                  <span className="tag" key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {nextBefore && (
        <button className="ghost" style={{ width: '100%', marginTop: 12 }} disabled={loading} onClick={() => load(nextBefore)}>
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
