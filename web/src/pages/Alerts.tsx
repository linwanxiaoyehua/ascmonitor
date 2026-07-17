import { useEffect, useState } from 'react'
import { api, timeAgo, type AlertRule, type AlertEvent } from '../lib/api'
import { Icon, type IconName } from '../components/Icon'

const KIND_META: Record<string, { label: string; icon: IconName; tone: 'danger' | 'accent' | 'primary' }> = {
  new_bad_review: { label: '新差评即时告警', icon: 'message', tone: 'danger' },
  bad_review_rate: { label: '24h 差评率告警', icon: 'trendingDown', tone: 'accent' },
  revenue_drop: { label: '收入下降告警', icon: 'dollar', tone: 'accent' },
  webhook_silent: { label: 'Webhook 静默自检', icon: 'moon', tone: 'primary' },
}

/** 分钟 → "30 分钟" / "2 小时" */
function minutesDisplay(min: number): string {
  if (min < 60) return `${min} 分钟`
  return min % 60 === 0 ? `${min / 60} 小时` : `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`
}

/** 把规则参数翻译成一句人话 */
function describeRule(rule: AlertRule): string {
  let p: Record<string, number> = {}
  try { p = JSON.parse(rule.params_json) } catch { /* 参数损坏时只显示静默期 */ }
  const conds: Record<string, string> = {
    new_bad_review: `${p.max_rating ?? 2} 星及以下立即提醒`,
    bad_review_rate: `24 小时差评率 ≥ ${p.threshold_pct ?? 30}%（至少 ${p.min_count ?? 5} 条评论）`,
    revenue_drop: `日收入比 7 日均值低 ${p.drop_pct ?? 30}% 以上`,
    webhook_silent: `超过 ${p.hours ?? 24} 小时没有任何通知`,
  }
  const cond = conds[rule.kind]
  const silence = `同类提醒间隔 ${minutesDisplay(rule.silence_min)}`
  return cond ? `${cond} · ${silence}` : silence
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
                  <div className="detail">{describeRule(r)}</div>
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
          {events.map((e) => {
            const meta = KIND_META[e.kind]
            return (
            <div className="row" key={e.id}>
              <div className={`row-icon tone-${meta?.tone ?? 'danger'}`}>
                <Icon name={meta?.icon ?? 'alertTriangle'} size={17} />
              </div>
              <div className="main">
                <div className="title">{e.title}</div>
                <div className="detail" style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div>
              </div>
              <div className="time">{timeAgo(e.fired_at)}</div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
