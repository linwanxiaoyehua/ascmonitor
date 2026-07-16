import { useEffect, useState } from 'react'
import { api, timeAgo, type EventRow } from '../lib/api'
import { Icon, type IconName } from '../components/Icon'

const TYPE_META: Record<string, { label: string; icon: IconName; tone: 'success' | 'primary' | 'danger' | 'accent' | 'neutral' }> = {
  SUBSCRIBED: { label: '新订阅', icon: 'zap', tone: 'success' },
  DID_RENEW: { label: '自动续费', icon: 'refresh', tone: 'success' },
  ONE_TIME_CHARGE: { label: '新购买', icon: 'creditCard', tone: 'success' },
  REFUND: { label: '退款', icon: 'trendingDown', tone: 'danger' },
  DID_CHANGE_RENEWAL_STATUS: { label: '续费状态变更', icon: 'refresh', tone: 'accent' },
  DID_CHANGE_RENEWAL_PREF: { label: '升级 / 降级', icon: 'trendingUp', tone: 'primary' },
  DID_FAIL_TO_RENEW: { label: '扣款失败', icon: 'alertTriangle', tone: 'danger' },
  EXPIRED: { label: '订阅过期', icon: 'clock', tone: 'neutral' },
  GRACE_PERIOD_EXPIRED: { label: '宽限期结束', icon: 'clock', tone: 'danger' },
  PRICE_INCREASE: { label: '价格上调', icon: 'trendingUp', tone: 'accent' },
  OFFER_REDEEMED: { label: '优惠兑换', icon: 'gift', tone: 'primary' },
  TEST: { label: '测试通知', icon: 'flask', tone: 'neutral' },
}

function ListSkeleton() {
  return (
    <div className="list" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skeleton" style={{ height: 60 }} />
      ))}
    </div>
  )
}

export function EventsPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (before?: number) => {
    setLoading(true)
    try {
      const res = await api<{ events: EventRow[]; nextBefore: number | null }>(
        `/api/events${before ? `?before=${before}` : ''}`
      )
      setEvents((prev) => (before && prev ? [...prev, ...res.events] : res.events))
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
      <h1 className="page-title">事件流</h1>
      {events === null ? (
        <ListSkeleton />
      ) : events.length === 0 ? (
        <div className="empty">
          <Icon name="activity" size={36} />
          <div>还没有收到事件</div>
          <span className="muted">在 App Store Connect 配置 Server URL 后，购买事件会实时出现在这里</span>
        </div>
      ) : (
        <div className="list">
          {events.map((e) => {
            const meta = TYPE_META[e.type] ?? { label: e.type, icon: 'activity' as IconName, tone: 'neutral' as const }
            return (
              <div className="row" key={e.uuid}>
                <div className={`row-icon${meta.tone !== 'neutral' ? ` tone-${meta.tone}` : ''}`}>
                  <Icon name={meta.icon} size={18} />
                </div>
                <div className="main">
                  <div className="title">
                    {meta.label}
                    {e.subtype && <span className="muted">{e.subtype}</span>}
                    {e.environment === 'Sandbox' && <span className="badge">沙盒</span>}
                  </div>
                  <div className="detail">{e.bundleId}</div>
                </div>
                <div className="time">{timeAgo(e.receivedAt)}</div>
              </div>
            )
          })}
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
