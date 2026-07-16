import { useEffect, useState } from 'react'
import { api, type AppRow } from '../lib/api'

function b64urlToUint8(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function PushSection() {
  const [status, setStatus] = useState('')
  const supported = 'serviceWorker' in navigator && 'PushManager' in window

  const subscribe = async () => {
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return setStatus('通知权限被拒绝')
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await api<{ publicKey: string }>('/push/vapid-public-key')
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToUint8(publicKey) as BufferSource,
      })
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
      setStatus('✅ 已开启推送')
    } catch (e) {
      setStatus(`失败：${e}`)
    }
  }

  const test = async () => {
    const res = await api<{ sent: number; total: number; errors: string[] }>('/push/test', { method: 'POST' })
    setStatus(`已发送 ${res.sent}/${res.total}${res.errors.length ? ` 错误: ${res.errors[0]}` : ''}`)
  }

  if (!supported) return <div className="muted">当前浏览器不支持 Web Push（iOS 需 16.4+ 且安装到主屏幕）</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary" onClick={subscribe}>开启推送</button>
        <button className="ghost" onClick={test}>发送测试推送</button>
      </div>
      {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
    </div>
  )
}

export function SettingsPage() {
  const [apps, setApps] = useState<AppRow[]>([])
  const [ascKeyId, setAscKeyId] = useState('')
  const [ascIssuerId, setAscIssuerId] = useState('')
  const [ascKey, setAscKey] = useState('')
  const [configKeys, setConfigKeys] = useState<string[]>([])
  const [saved, setSaved] = useState('')

  const load = () => {
    api<AppRow[]>('/api/apps').then(setApps).catch(() => {})
    api<string[]>('/api/config').then(setConfigKeys).catch(() => {})
  }
  useEffect(load, [])

  const saveAsc = async () => {
    if (ascKeyId) await api('/api/config/asc_key_id', { method: 'PUT', body: JSON.stringify({ value: ascKeyId }) })
    if (ascIssuerId) await api('/api/config/asc_issuer_id', { method: 'PUT', body: JSON.stringify({ value: ascIssuerId }) })
    if (ascKey) await api('/api/config/asc_private_key', { method: 'PUT', body: JSON.stringify({ value: ascKey }) })
    setSaved('✅ 已保存')
    load()
  }

  const updateAppId = async (app: AppRow) => {
    const value = prompt(`${app.bundle_id} 的 App Apple ID（App Store 链接中 id 后面的数字）`, app.asc_app_id ?? '')
    if (value == null) return
    await api(`/api/apps/${app.id}`, { method: 'PUT', body: JSON.stringify({ asc_app_id: value }) })
    load()
  }

  return (
    <div>
      <h1>设置</h1>

      <h2>推送通知</h2>
      <PushSection />

      <h2>App 列表</h2>
      <p className="muted" style={{ marginBottom: 8 }}>App 在收到第一条 Store 通知后自动出现；填写 Apple ID 后开始抓取评论评分</p>
      {apps.length === 0 && <div className="empty">暂无 App</div>}
      <div className="list">
        {apps.map((a) => (
          <div className="row" key={a.id}>
            <div className="main">
              <div className="title">{a.name}</div>
              <div className="detail">{a.bundle_id} · Apple ID: {a.asc_app_id ?? '未设置'}</div>
            </div>
            <button className="ghost" onClick={() => updateAppId(a)}>编辑</button>
          </div>
        ))}
      </div>

      <h2>App Store Connect API 凭证</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        已配置：{configKeys.filter((k) => k.startsWith('asc_')).join(', ') || '无'}（用于拉取可回复评论，可选）
      </p>
      <div className="field"><label>Key ID</label><input value={ascKeyId} onChange={(e) => setAscKeyId(e.target.value)} /></div>
      <div className="field"><label>Issuer ID</label><input value={ascIssuerId} onChange={(e) => setAscIssuerId(e.target.value)} /></div>
      <div className="field"><label>私钥（.p8 文件内容）</label><textarea rows={4} value={ascKey} onChange={(e) => setAscKey(e.target.value)} /></div>
      <button className="primary" onClick={saveAsc}>保存凭证</button>
      {saved && <p className="muted" style={{ marginTop: 8 }}>{saved}</p>}
    </div>
  )
}
