import { useEffect, useState } from 'react'
import { api, timeAgo, type SubRow, type TimelineRow, type PurchaseRow } from '../lib/api'
import { countryDisplay, expiresDisplay, money, periodLabel, productDisplay, subtypeLabel } from '../lib/format'
import { Icon } from '../components/Icon'
import { AppIcon } from '../components/AppIcon'
import { EventsPage } from './Events'

const STATUS_GROUPS: Array<{ title: string; statuses: string[] }> = [
  { title: '试用中', statuses: ['trial'] },
  { title: '活跃订阅', statuses: ['active'] },
  { title: '流失风险', statuses: ['grace_period', 'billing_retry'] },
  { title: '已流失', statuses: ['expired', 'revoked'] },
]

const STATUS_LABELS: Record<string, string> = {
  trial: '试用中',
  active: '活跃',
  grace_period: '宽限期',
  billing_retry: '扣款重试',
  expired: '已过期',
  revoked: '已退订',
}

const TIMELINE_LABELS: Record<string, string> = {
  SUBSCRIBED: '订阅',
  DID_RENEW: '续费',
  ONE_TIME_CHARGE: '购买',
  REFUND: '退款',
  DID_CHANGE_RENEWAL_STATUS: '续费状态变更',
  DID_CHANGE_RENEWAL_PREF: '升降级',
  DID_FAIL_TO_RENEW: '扣款失败',
  EXPIRED: '过期',
}

/** 一次性购买类型 → 中文 */
const PURCHASE_TYPES: Record<string, string> = {
  Consumable: '消耗型',
  'Non-Consumable': '买断',
  'Non-Renewing Subscription': '非续订订阅',
}

function Timeline({ otid }: { otid: string }) {
  const [rows, setRows] = useState<TimelineRow[] | null>(null)

  useEffect(() => {
    api<TimelineRow[]>(`/api/subscriptions/${otid}/timeline`).then(setRows).catch(() => setRows([]))
  }, [otid])

  if (rows === null) return <div className="skeleton" style={{ height: 44, margin: '4px 16px 12px' }} />
  if (!rows.length) return <div className="muted" style={{ padding: '4px 16px 12px' }}>暂无交易记录</div>
  return (
    <div className="timeline">
      {rows.map((t) => {
        const type = t.notification_type ?? t.event_type
        const label = TIMELINE_LABELS[type] ?? type
        const sub = subtypeLabel(t.subtype)
        return (
          <div className="timeline-item" key={t.transaction_id + type}>
            <span className={`timeline-dot${t.refunded || type === 'REFUND' ? ' neg' : ''}`} />
            <span className="timeline-label">
              {label}
              {sub && <span className="muted"> · {sub}</span>}
            </span>
            <span className="timeline-amount num">{money(t.price_milli, t.currency)}</span>
            <span className="timeline-time">{timeAgo(t.purchase_date ?? t.received_at ?? 0)}</span>
          </div>
        )
      })}
    </div>
  )
}

function appLabelOf(name: string | null, bundleId: string | null): string {
  return name && name !== bundleId ? name : bundleId?.split('.').pop() ?? ''
}

function SubsList() {
  const [subs, setSubs] = useState<SubRow[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api<SubRow[]>('/api/subscriptions').then(setSubs).catch(() => setSubs([]))
  }, [])

  if (subs === null) {
    return (
      <div className="list" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 60 }} />
        ))}
      </div>
    )
  }
  if (!subs.length) {
    return (
      <div className="empty">
        <Icon name="users" size={36} />
        <div>还没有订阅记录</div>
        <span className="muted">收到 App Store 订阅通知后会自动出现在这里</span>
      </div>
    )
  }

  return (
    <>
      {STATUS_GROUPS.map((group) => {
        const items = subs.filter((s) => group.statuses.includes(s.status))
        if (!items.length) return null
        return (
          <div key={group.title}>
            <h2 className="section-title">
              {group.title}
              <span className="count">{items.length}</span>
            </h2>
            <div className="list">
              {items.map((s) => {
                const open = expanded === s.original_transaction_id
                const appLabel = appLabelOf(s.app_name, s.app_bundle_id)
                const detail = [
                  appLabel,
                  countryDisplay(s.country),
                  s.status === 'expired' || s.status === 'revoked'
                    ? STATUS_LABELS[s.status]
                    : expiresDisplay(s.expires_at),
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <div key={s.original_transaction_id}>
                    <div
                      className="row"
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : s.original_transaction_id)}
                      onKeyDown={(e) => e.key === 'Enter' && setExpanded(open ? null : s.original_transaction_id)}
                    >
                      <AppIcon url={s.app_icon} name={appLabel || s.product_id} size={30} />
                      <div className="main">
                        <div className="title">
                          {productDisplay(s.product_id, s.app_bundle_id)}
                          {periodLabel(s.period) && <span className="muted">{periodLabel(s.period)}</span>}
                          {!s.auto_renew && (s.status === 'active' || s.status === 'trial') && (
                            <span className="badge">已关续费</span>
                          )}
                        </div>
                        <div className="detail">{detail}</div>
                      </div>
                      <div className="side">
                        <div className="amount num">{money(s.price_milli, s.currency)}</div>
                        <div className="time">{timeAgo(s.updated_at)}</div>
                      </div>
                      <Icon
                        name="chevronRight"
                        size={16}
                        style={{
                          color: 'var(--text-lo)',
                          flex: 'none',
                          transform: open ? 'rotate(90deg)' : undefined,
                          transition: 'transform 200ms',
                        }}
                      />
                    </div>
                    {open && <Timeline otid={s.original_transaction_id} />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** 一次性付费流水（买断 / 消耗型 / 非续订订阅） */
function PurchasesList() {
  const [purchases, setPurchases] = useState<PurchaseRow[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (before?: number) => {
    setLoading(true)
    try {
      const res = await api<{ purchases: PurchaseRow[]; nextBefore: number | null }>(
        `/api/purchases${before ? `?before=${before}` : ''}`
      )
      setPurchases((prev) => (before && prev ? [...prev, ...res.purchases] : res.purchases))
      setNextBefore(res.nextBefore)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (purchases === null) {
    return (
      <div className="list" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 60 }} />
        ))}
      </div>
    )
  }
  if (!purchases.length) {
    return (
      <div className="empty">
        <Icon name="creditCard" size={36} />
        <div>还没有一次性购买</div>
        <span className="muted">买断、消耗型内购的付费记录会出现在这里</span>
      </div>
    )
  }

  return (
    <>
      <div className="list">
        {purchases.map((p) => {
          const appLabel = appLabelOf(p.app_name, p.app_bundle_id)
          const detail = [appLabel, PURCHASE_TYPES[p.type] ?? p.type, countryDisplay(p.country)]
            .filter(Boolean)
            .join(' · ')
          return (
            <div className="row" key={p.transaction_id}>
              <AppIcon url={p.app_icon} name={appLabel || p.product_id} size={30} />
              <div className="main">
                <div className="title">
                  {productDisplay(p.product_id, p.app_bundle_id)}
                  {!!p.refunded && <span className="badge">已退款</span>}
                </div>
                <div className="detail">{detail}</div>
              </div>
              <div className="side">
                <div className={`amount num ${p.refunded ? 'neg' : 'pos'}`}>
                  {p.refunded ? '−' : '+'}{money(p.price_milli, p.currency)}
                </div>
                <div className="time">{timeAgo(p.purchase_date ?? 0)}</div>
              </div>
            </div>
          )
        })}
      </div>
      {nextBefore && (
        <button className="ghost" style={{ width: '100%', marginTop: 12 }} disabled={loading} onClick={() => load(nextBefore)}>
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
    </>
  )
}

export function RevenuePage() {
  const [segment, setSegment] = useState<'subs' | 'purchases' | 'events'>('subs')

  return (
    <div>
      <h1 className="page-title">收入</h1>
      <div className="filters" role="tablist">
        <button role="tab" aria-selected={segment === 'subs'} className={segment === 'subs' ? 'active' : ''} onClick={() => setSegment('subs')}>
          订阅
        </button>
        <button role="tab" aria-selected={segment === 'purchases'} className={segment === 'purchases' ? 'active' : ''} onClick={() => setSegment('purchases')}>
          付费
        </button>
        <button role="tab" aria-selected={segment === 'events'} className={segment === 'events' ? 'active' : ''} onClick={() => setSegment('events')}>
          事件
        </button>
      </div>
      {segment === 'subs' && <SubsList />}
      {segment === 'purchases' && <PurchasesList />}
      {segment === 'events' && <EventsPage embedded />}
    </div>
  )
}
