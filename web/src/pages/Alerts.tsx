import { useEffect, useState } from 'react'
import { api, timeAgo, type AlertRule, type AlertEvent } from '../lib/api'
import { Icon, type IconName } from '../components/Icon'

const KIND_META: Record<string, { label: string; icon: IconName; tone: 'danger' | 'accent' | 'primary' }> = {
  new_bad_review: { label: '新差评即时告警', icon: 'message', tone: 'danger' },
  bad_review_rate: { label: '24h 差评率告警', icon: 'trendingDown', tone: 'accent' },
  revenue_drop: { label: '收入下降告警', icon: 'dollar', tone: 'accent' },
  webhook_silent: { label: 'Webhook 静默自检', icon: 'moon', tone: 'primary' },
}

export function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[] | null>(null)
  const [events, setEvents] = useState<AlertEvent[]>([])

  const load = () => {
    api<AlertRule[]>('/api/alerts/rules').then(setRules).catch(() => {})
    api<AlertEvent[]>('/api/alerts/events').then(setEvents).catch(() => {})
  }
  useEffect(load, [])

  const toggle = async (rule: AlertRule) => {
    // 乐观更新
    setRules((prev) => prev?.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled ? 0 : 1 } : r)) ?? null)
    await api(`/api/alerts/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) })
  }

  return (
    <div>
      <h1 className="page-title">告警</h1>
      <h2 className="section-title">规则</h2>
      {rules === null ? (
        <div className="skeleton" style={{ height: 232 }} aria-hidden="true" />
      ) : (
        <div className="list">
          {rules.map((r) => {
            const meta = KIND_META[r.kind] ?? { label: r.kind, icon: 'bell' as IconName, tone: 'primary' as const }
            return (
              <div className="row" key={r.id}>
                <div className={`row-icon tone-${meta.tone}`}>
                  <Icon name={meta.icon} size={17} />
                </div>
                <div className="main">
                  <div className="title">{meta.label}</div>
                  <div className="detail">静默 {r.silence_min} 分钟</div>
                </div>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={!!r.enabled}
                  aria-label={`${meta.label}开关`}
                  onClick={() => toggle(r)}
                />
              </div>
            )
          })}
        </div>
      )}
      <h2 className="section-title">历史</h2>
      {events.length === 0 ? (
        <div className="empty">
          <Icon name="bell" size={36} />
          <div>还没有告警记录</div>
        </div>
      ) : (
        <div className="list">
          {events.map((e) => (
            <div className="row" key={e.id}>
              <div className="row-icon tone-danger">
                <Icon name="alertTriangle" size={17} />
              </div>
              <div className="main">
                <div className="title">{e.title}</div>
                <div className="detail" style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div>
              </div>
              <div className="time">{timeAgo(e.fired_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
