// 设置 · 通知与告警：推送 / Telegram / 告警规则（Sheet 编辑）/ 日报

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AlertRule } from '../../lib/api'
import { toast } from '../../lib/toast'
import { Icon, type IconName } from '../../components/Icon'
import { Sheet } from '../../components/Sheet'
import { ListRow, Section, Skeleton, Switch } from '../../components/ui'
import { SubPage } from './SubPage'

function b64urlToUint8(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const RULE_META: Record<string, { label: string; icon: IconName; tone: string; params: Array<{ key: string; label: string; unit?: string }> }> = {
  new_bad_review: { label: '新差评即时告警', icon: 'message', tone: 'danger', params: [{ key: 'max_rating', label: '星级阈值（≤ 此星级触发）', unit: '星' }] },
  bad_review_rate: {
    label: '24h 差评率告警', icon: 'trendingDown', tone: 'warning',
    params: [
      { key: 'threshold_pct', label: '差评率阈值', unit: '%' },
      { key: 'min_count', label: '最少评论数', unit: '条' },
    ],
  },
  revenue_drop: { label: '收入下降告警', icon: 'dollar', tone: 'warning', params: [{ key: 'drop_pct', label: '较 7 日均值下降', unit: '%' }] },
  webhook_silent: { label: 'Webhook 静默自检', icon: 'moon', tone: 'info', params: [{ key: 'hours', label: '静默时长阈值', unit: '小时' }] },
}

function minutesDisplay(min: number): string {
  if (min < 60) return `${min} 分钟`
  return min % 60 === 0 ? `${min / 60} 小时` : `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`
}

function describeRule(rule: AlertRule): string {
  let p: Record<string, number> = {}
  try { p = JSON.parse(rule.params_json) } catch { /* 参数损坏时只显示静默期 */ }
  const conds: Record<string, string> = {
    new_bad_review: `${p.max_rating ?? 2} 星及以下立即提醒`,
    bad_review_rate: `24 小时差评率 ≥ ${p.threshold_pct ?? 30}%（至少 ${p.min_count ?? 5} 条）`,
    revenue_drop: `日收入比 7 日均值低 ${p.drop_pct ?? 30}% 以上`,
    webhook_silent: `超过 ${p.hours ?? 24} 小时没有任何通知`,
  }
  const cond = conds[rule.kind]
  const silence = rule.silence_min > 0 ? `间隔 ${minutesDisplay(rule.silence_min)}` : ''
  return [cond, silence].filter(Boolean).join(' · ')
}

function PushRows() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window

  const subscribe = async () => {
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return toast.error('通知权限被拒绝')
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await api<{ publicKey: string }>('/push/vapid-public-key')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToUint8(publicKey) as BufferSource,
      })
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
      toast.success('已开启推送')
    } catch {
      toast.error('开启推送失败')
    }
  }

  const test = async () => {
    try {
      const res = await api<{ sent: number; total: number; errors: string[] }>('/push/test', { method: 'POST' })
      if (res.errors.length) toast.error(`发送 ${res.sent}/${res.total}，错误：${res.errors[0]}`)
      else toast.success(`已发送 ${res.sent}/${res.total}`)
    } catch {
      toast.error('发送失败')
    }
  }

  if (!supported) {
    return (
      <div className="list">
        <ListRow
          leading={<span className="row-icon"><Icon name="bell" size={16} /></span>}
          title="Web Push 不可用"
          detail="iOS 需 16.4+ 且先安装到主屏幕"
        />
      </div>
    )
  }
  return (
    <div className="list">
      <ListRow
        leading={<span className="row-icon tone-danger"><Icon name="bell" size={16} /></span>}
        title="开启推送通知"
        trailing="chevron"
        onPress={subscribe}
      />
      <ListRow
        leading={<span className="row-icon tone-accent"><Icon name="send" size={16} /></span>}
        title="发送测试推送"
        trailing="chevron"
        onPress={test}
      />
    </div>
  )
}

function TelegramRows() {
  const [open, setOpen] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')

  const save = useMutation({
    mutationFn: () =>
      api('/api/config/telegram', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify({ botToken, chatId }) }) }),
    onSuccess: () => {
      toast.success('Telegram 配置已保存')
      setOpen(false)
    },
  })

  return (
    <>
      <div className="list">
        <ListRow
          leading={<span className="row-icon tone-info"><Icon name="send" size={16} /></span>}
          title="Telegram 告警"
          detail="配置 Bot Token 与 Chat ID 后启用"
          trailing="chevron"
          onPress={() => setOpen(true)}
        />
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Telegram 告警">
        <div className="field">
          <label htmlFor="tg-token">Bot Token</label>
          <input id="tg-token" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC-…" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="tg-chat">Chat ID</label>
          <input id="tg-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100…" autoComplete="off" />
        </div>
        <button className="primary btn-block" onClick={() => save.mutate()} disabled={save.isPending || !botToken || !chatId}>
          {save.isPending ? '保存中…' : '保存'}
        </button>
        <p className="muted hint">向 @BotFather 创建 Bot 获取 Token；把 Bot 拉进会话后用 @userinfobot 查 Chat ID</p>
      </Sheet>
    </>
  )
}

function AlertRulesSection() {
  const queryClient = useQueryClient()
  const { data: rules, isPending } = useQuery({ queryKey: ['alert-rules'], queryFn: () => api<AlertRule[]>('/api/alerts/rules') })
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [params, setParams] = useState<Record<string, number>>({})
  const [silenceMin, setSilenceMin] = useState(0)

  const openEdit = (rule: AlertRule) => {
    setEditing(rule)
    try { setParams(JSON.parse(rule.params_json)) } catch { setParams({}) }
    setSilenceMin(rule.silence_min)
  }

  const toggleMutation = useMutation({
    mutationFn: (rule: AlertRule) =>
      api(`/api/alerts/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) }),
    // 乐观更新：立即翻转开关
    onMutate: async (rule) => {
      await queryClient.cancelQueries({ queryKey: ['alert-rules'] })
      const prev = queryClient.getQueryData<AlertRule[]>(['alert-rules'])
      queryClient.setQueryData<AlertRule[]>(['alert-rules'], (old) =>
        old?.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled ? 0 : 1 } : r))
      )
      return { prev }
    },
    onError: (_e, _r, ctx) => ctx?.prev && queryClient.setQueryData(['alert-rules'], ctx.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  const saveMutation = useMutation({
    mutationFn: (rule: AlertRule) =>
      api(`/api/alerts/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ params, silence_min: silenceMin }) }),
    onSuccess: () => {
      toast.success('规则已更新')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
  })

  const meta = editing ? RULE_META[editing.kind] : null

  return (
    <>
      {isPending ? (
        <Skeleton variant="rows" count={4} />
      ) : (
        <div className="list">
          {(rules ?? []).map((r) => {
            const m = RULE_META[r.kind] ?? { label: r.kind, icon: 'bell' as IconName, tone: 'info', params: [] }
            return (
              <ListRow
                key={r.id}
                leading={<span className={`row-icon tone-${m.tone}`}><Icon name={m.icon} size={16} /></span>}
                title={m.label}
                detail={describeRule(r)}
                trailing={<Switch checked={!!r.enabled} onChange={() => toggleMutation.mutate(r)} label={`${m.label}开关`} />}
                onPress={() => openEdit(r)}
              />
            )
          })}
        </div>
      )}
      <p className="muted hint">点击规则调整阈值；告警历史在「动态」页筛选查看</p>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={meta?.label}>
        {meta?.params.map((p) => (
          <div className="field" key={p.key}>
            <label htmlFor={`rule-${p.key}`}>{p.label}{p.unit ? `（${p.unit}）` : ''}</label>
            <input
              id={`rule-${p.key}`}
              value={params[p.key] ?? ''}
              onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="rule-silence">同类提醒间隔（分钟，0 = 每次都提醒）</label>
          <input id="rule-silence" value={silenceMin} onChange={(e) => setSilenceMin(Number(e.target.value))} inputMode="numeric" autoComplete="off" />
        </div>
        <button className="primary btn-block" onClick={() => editing && saveMutation.mutate(editing)} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? '保存中…' : '保存'}
        </button>
      </Sheet>
    </>
  )
}

function DigestRow() {
  const [enabled, setEnabled] = useState(true) // config 敏感值不回读，默认开启

  const save = useMutation({
    mutationFn: (on: boolean) =>
      api('/api/config/daily_digest', { method: 'PUT', body: JSON.stringify({ value: on ? '1' : '0' }) }),
    onSuccess: (_d, on) => toast.success(on ? '日报已开启' : '日报已关闭'),
  })

  return (
    <div className="list">
      <ListRow
        leading={<span className="row-icon tone-success"><Icon name="send" size={16} /></span>}
        title="每日摘要推送"
        detail="每天 UTC 1:00 推送昨日收入 / 订阅 / 评论摘要"
        trailing={<Switch checked={enabled} onChange={(v) => { setEnabled(v); save.mutate(v) }} label="日报开关" />}
      />
    </div>
  )
}

export function AlertsSection() {
  return (
    <SubPage title="通知与告警">
      <Section title="推送通知">
        <PushRows />
      </Section>
      <Section title="更多渠道">
        <TelegramRows />
      </Section>
      <Section title="告警规则">
        <AlertRulesSection />
      </Section>
      <Section title="日报">
        <DigestRow />
      </Section>
    </SubPage>
  )
}
