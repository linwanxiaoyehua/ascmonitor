import { useEffect, useState } from 'react'
import { api, timeAgo, type AlertRule, type AlertEvent } from '../lib/api'

const KIND_LABELS: Record<string, string> = {
  new_bad_review: '新差评即时告警',
  bad_review_rate: '24h 差评率告警',
  revenue_drop: '收入下降告警',
  webhook_silent: 'Webhook 静默自检',
}

export function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [events, setEvents] = useState<AlertEvent[]>([])

  const load = () => {
    api<AlertRule[]>('/api/alerts/rules').then(setRules).catch(() => {})
    api<AlertEvent[]>('/api/alerts/events').then(setEvents).catch(() => {})
  }
  useEffect(load, [])

  const toggle = async (rule: AlertRule) => {
    await api(`/api/alerts/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) })
    load()
  }

  return (
    <div>
      <h1>告警</h1>
      <h2>规则</h2>
      <div className="list">
        {rules.map((r) => (
          <div className="row" key={r.id}>
            <div className="main">
              <div className="title">{KIND_LABELS[r.kind] ?? r.kind}</div>
              <div className="detail">{r.params_json} · 静默 {r.silence_min}min</div>
            </div>
            <button className="ghost" onClick={() => toggle(r)}>{r.enabled ? '✅ 开' : '⛔ 关'}</button>
          </div>
        ))}
      </div>
      <h2>历史</h2>
      {events.length === 0 && <div className="empty">还没有告警记录</div>}
      <div className="list">
        {events.map((e) => (
          <div className="row" key={e.id}>
            <div className="main">
              <div className="title">{e.title}</div>
              <div className="detail" style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div>
            </div>
            <div className="time">{timeAgo(e.fired_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
