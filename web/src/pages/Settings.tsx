import { useEffect, useState } from 'react'
import { api, type AppRow } from '../lib/api'
import { Icon } from '../components/Icon'

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
      setStatus('已开启推送')
    } catch (e) {
      setStatus(`失败：${e}`)
    }
  }

  const test = async () => {
    const res = await api<{ sent: number; total: number; errors: string[] }>('/push/test', { method: 'POST' })
    setStatus(`已发送 ${res.sent}/${res.total}${res.errors.length ? ` 错误: ${res.errors[0]}` : ''}`)
  }

  if (!supported) {
    return (
      <div className="list">
        <div className="row">
          <div className="row-icon"><Icon name="bell" size={17} /></div>
          <div className="main">
            <div className="title">Web Push 不可用</div>
            <div className="detail">iOS 需 16.4+ 且先安装到主屏幕</div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="list">
        <div className="row" onClick={subscribe} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="row-icon tone-danger"><Icon name="bell" size={17} /></div>
          <div className="main"><div className="title">开启推送通知</div></div>
          <Icon name="chevronRight" size={18} style={{ color: 'var(--text-lo)' }} />
        </div>
        <div className="row" onClick={test} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="row-icon tone-primary"><Icon name="send" size={17} /></div>
          <div className="main"><div className="title">发送测试推送</div></div>
          <Icon name="chevronRight" size={18} style={{ color: 'var(--text-lo)' }} />
        </div>
      </div>
      {status && <p className="muted" style={{ margin: '8px 16px 0' }} role="status">{status}</p>}
    </>
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
    setSaved('已保存')
    load()
  }

  const updateAppId = async (app: AppRow) => {
    const value = prompt(`${app.bundle_id} 的 App Apple ID（App Store 链接中 id 后面的数字）`, app.asc_app_id ?? '')
    if (value == null) return
    await api(`/api/apps/${app.id}`, { method: 'PUT', body: JSON.stringify({ asc_app_id: value }) })
    load()
  }

  const ascConfigured = configKeys.filter((k) => k.startsWith('asc_')).length >= 3

  return (
    <div>
      <h1 className="page-title">设置</h1>

      <h2 className="section-title">推送通知</h2>
      <PushSection />

      <h2 className="section-title">App 列表</h2>
      {apps.length === 0 ? (
        <div className="empty">
          <Icon name="chart" size={36} />
          <div>暂无 App</div>
          <span className="muted">收到第一条 Store 通知后自动出现</span>
        </div>
      ) : (
        <div className="list">
          {apps.map((a) => (
            <div className="row" key={a.id} onClick={() => updateAppId(a)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
              <div className="row-icon tone-primary"><Icon name="chart" size={17} /></div>
              <div className="main">
                <div className="title">{a.name}</div>
                <div className="detail">{a.bundle_id} · Apple ID: {a.asc_app_id ?? '未设置'}</div>
              </div>
              <Icon name="chevronRight" size={18} style={{ color: 'var(--text-lo)' }} />
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ margin: '8px 16px 0' }}>填写 Apple ID 后开始抓取评论评分</p>

      <h2 className="section-title">App Store Connect API 凭证</h2>
      <div className="field">
        <label htmlFor="asc-key-id">Key ID</label>
        <input id="asc-key-id" value={ascKeyId} onChange={(e) => setAscKeyId(e.target.value)} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="asc-issuer-id">Issuer ID</label>
        <input id="asc-issuer-id" value={ascIssuerId} onChange={(e) => setAscIssuerId(e.target.value)} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="asc-key">私钥（.p8 文件内容）</label>
        <textarea id="asc-key" rows={4} value={ascKey} onChange={(e) => setAscKey(e.target.value)} />
      </div>
      <button className="primary" style={{ width: '100%' }} onClick={saveAsc}>保存凭证</button>
      <p className="muted" style={{ margin: '8px 16px 0' }} role="status">
        {saved || (ascConfigured ? '已配置（用于拉取可回复评论，可选）' : '未配置（可选，用于拉取可回复评论）')}
      </p>
    </div>
  )
}
