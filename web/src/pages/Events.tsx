import { useEffect, useState } from 'react'
import { api, timeAgo, type EventRow } from '../lib/api'

const TYPE_LABELS: Record<string, string> = {
  SUBSCRIBED: '🎉 新订阅',
  DID_RENEW: '♻️ 自动续费',
  ONE_TIME_CHARGE: '💰 新购买',
  REFUND: '⚠️ 退款',
  DID_CHANGE_RENEWAL_STATUS: '🔄 续费状态变更',
  DID_CHANGE_RENEWAL_PREF: '↕️ 升级/降级',
  DID_FAIL_TO_RENEW: '🚨 扣款失败',
  EXPIRED: '❌ 订阅过期',
  GRACE_PERIOD_EXPIRED: '⏳ 宽限期结束',
  PRICE_INCREASE: '💲 价格上调',
  OFFER_REDEEMED: '🎟️ 优惠兑换',
  TEST: '🧪 测试通知',
}

export function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (before?: number) => {
    setLoading(true)
    try {
      const res = await api<{ events: EventRow[]; nextBefore: number | null }>(
        `/api/events${before ? `?before=${before}` : ''}`
      )
      setEvents((prev) => (before ? [...prev, ...res.events] : res.events))
      setNextBefore(res.nextBefore)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <h1>事件流</h1>
      {events.length === 0 && !loading && <div className="empty">还没有收到事件<br /><span className="muted">在 App Store Connect 配置 Server URL 后，事件会实时出现在这里</span></div>}
      <div className="list">
        {events.map((e) => (
          <div className="row" key={e.uuid}>
            <div className="main">
              <div className="title">
                {TYPE_LABELS[e.type] ?? e.type}
                {e.subtype && <span className="muted"> · {e.subtype}</span>}
                {e.environment === 'Sandbox' && <span className="tag" style={{ marginLeft: 6 }}>沙盒</span>}
              </div>
              <div className="detail">{e.bundleId}</div>
            </div>
            <div className="time">{timeAgo(e.receivedAt)}</div>
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
