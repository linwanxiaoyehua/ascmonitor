import { useEffect, useState } from 'react'
import { api, type AppRow } from '../lib/api'
import { Icon } from '../components/Icon'
import { AppIcon } from '../components/AppIcon'
import { getTheme, setTheme, type Theme } from '../lib/theme'

function b64urlToUint8(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function ThemeSection() {
  const [theme, setThemeState] = useState<Theme>(getTheme())

  const choose = (t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }

  return (
    <div className="filters" role="radiogroup" aria-label="外观">
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          className={theme === o.value ? 'active' : ''}
          onClick={() => choose(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function WebhookUrlSection() {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/webhook/assn`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // 旧浏览器 fallback
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="list">
        <div className="row" onClick={copy} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className={`row-icon ${copied ? 'tone-success' : 'tone-accent'}`}>
            <Icon name={copied ? 'check' : 'zap'} size={17} />
          </div>
          <div className="main">
            <div className="title">{copied ? '已复制' : '服务器通知 URL'}</div>
            <div className="detail num">{url}</div>
          </div>
          <span style={{ color: 'var(--blue)', fontSize: 15, flex: 'none' }}>复制</span>
        </div>
      </div>
      <p className="muted" style={{ margin: '8px 16px 0' }}>
        粘贴到 App Store Connect → App 信息 → App Store 服务器通知 → 生产服务器 URL（选择 Version 2）
      </p>
    </>
  )
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

function AddAppForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [bundleId, setBundleId] = useState('')
  const [name, setName] = useState('')
  const [appleId, setAppleId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!bundleId.trim()) return setError('Bundle ID 必填')
    setSaving(true)
    setError('')
    try {
      await api('/api/apps', {
        method: 'POST',
        body: JSON.stringify({ bundle_id: bundleId, name: name || undefined, asc_app_id: appleId || undefined }),
      })
      setBundleId('')
      setName('')
      setAppleId('')
      setOpen(false)
      onAdded()
    } catch (e) {
      setError(`添加失败：${e}`)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="list" style={{ marginTop: 8 }}>
        <div className="row" onClick={() => setOpen(true)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="row-icon tone-success"><Icon name="plus" size={17} /></div>
          <div className="main"><div className="title" style={{ color: 'var(--blue)' }}>手动添加 App</div></div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label htmlFor="new-bundle-id">Bundle ID（必填）</label>
        <input id="new-bundle-id" value={bundleId} onChange={(e) => setBundleId(e.target.value)}
          placeholder="com.example.app" autoComplete="off" autoCapitalize="none" />
      </div>
      <div className="field">
        <label htmlFor="new-name">名称（可选）</label>
        <input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="我的 App" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="new-apple-id">App Apple ID（可选，App Store 链接中 id 后的数字）</label>
        <input id="new-apple-id" value={appleId} onChange={(e) => setAppleId(e.target.value)}
          placeholder="1234567890" inputMode="numeric" autoComplete="off" />
      </div>
      {error && <div className="error" role="alert" style={{ margin: '0 16px 8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
          {saving ? '添加中…' : '添加'}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>取消</button>
      </div>
    </div>
  )
}

function FetchNowSection() {
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState<string | null>(null)

  const run = async (kind: 'reviews' | 'sales') => {
    if (running) return
    setRunning(kind)
    setStatus('抓取中…')
    try {
      if (kind === 'reviews') {
        const res = await api<{ totalReviews: number }>('/api/jobs/fetch-reviews', { method: 'POST' })
        setStatus(`完成，当前共 ${res.totalReviews} 条评论`)
      } else {
        const res = await api<{ fetched: number; totalDays: number; skipped: string }>('/api/jobs/fetch-sales', { method: 'POST' })
        setStatus(res.skipped || `完成，拉取 ${res.fetched} 份报告，已覆盖 ${res.totalDays} 天`)
      }
    } catch (e) {
      setStatus(`失败：${e}`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <>
      <div className="list">
        <div className="row" onClick={() => run('reviews')} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="row-icon tone-accent"><Icon name="refresh" size={17} /></div>
          <div className="main">
            <div className="title">{running === 'reviews' ? '抓取中…' : '立即抓取评论评分'}</div>
            <div className="detail">平时每 15 分钟自动抓取；新加 App 后可手动触发回填</div>
          </div>
          <Icon name="chevronRight" size={18} style={{ color: 'var(--text-lo)' }} />
        </div>
        <div className="row" onClick={() => run('sales')} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="row-icon tone-success"><Icon name="dollar" size={17} /></div>
          <div className="main">
            <div className="title">{running === 'sales' ? '抓取中…' : '立即抓取账单数据'}</div>
            <div className="detail">销售报告回填 30 天；之后每日自动更新（需 Vendor Number）</div>
          </div>
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
  const [vendorNumber, setVendorNumber] = useState('')
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
    if (vendorNumber) await api('/api/config/asc_vendor_number', { method: 'PUT', body: JSON.stringify({ value: vendorNumber }) })
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

      <h2 className="section-title">外观</h2>
      <ThemeSection />

      <h2 className="section-title">App Store 通知接入</h2>
      <WebhookUrlSection />

      <h2 className="section-title">推送通知</h2>
      <PushSection />

      <h2 className="section-title">App 列表</h2>
      {apps.length > 0 && (
        <div className="list">
          {apps.map((a) => (
            <div className="row" key={a.id} onClick={() => updateAppId(a)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
              <AppIcon url={a.icon_url} name={a.name} size={30} />
              <div className="main">
                <div className="title">{a.name}</div>
                <div className="detail">{a.bundle_id} · Apple ID: {a.asc_app_id ?? '未设置'}</div>
              </div>
              <Icon name="chevronRight" size={18} style={{ color: 'var(--text-lo)' }} />
            </div>
          ))}
        </div>
      )}
      <AddAppForm onAdded={load} />
      <p className="muted" style={{ margin: '8px 16px 0' }}>
        收到 Store 通知的 App 会自动出现；也可手动添加，填写 Apple ID 后开始抓取评论评分
      </p>

      <h2 className="section-title">评论抓取</h2>
      <FetchNowSection />

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
      <div className="field">
        <label htmlFor="asc-vendor">Vendor Number（账单数据用，ASC「付款与财务报告」页可查）</label>
        <input id="asc-vendor" value={vendorNumber} onChange={(e) => setVendorNumber(e.target.value)}
          placeholder="8xxxxxxx" inputMode="numeric" autoComplete="off" />
      </div>
      <button className="primary" style={{ width: '100%' }} onClick={saveAsc}>保存凭证</button>
      <p className="muted" style={{ margin: '8px 16px 0' }} role="status">
        {saved || (ascConfigured ? '已配置（用于拉取可回复评论，可选）' : '未配置（可选，用于拉取可回复评论）')}
      </p>
    </div>
  )
}
