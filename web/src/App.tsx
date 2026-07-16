import { useEffect, useState } from 'react'
import { getToken, setToken, api } from './lib/api'
import { Icon, type IconName } from './components/Icon'
import { OverviewPage } from './pages/Overview'
import { EventsPage } from './pages/Events'
import { ReviewsPage } from './pages/Reviews'
import { AlertsPage } from './pages/Alerts'
import { SettingsPage } from './pages/Settings'

const TABS: Array<{ key: string; label: string; icon: IconName }> = [
  { key: 'overview', label: '总览', icon: 'chart' },
  { key: 'events', label: '事件', icon: 'activity' },
  { key: 'reviews', label: '评论', icon: 'message' },
  { key: 'alerts', label: '告警', icon: 'bell' },
  { key: 'settings', label: '设置', icon: 'settings' },
]

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [initializing, setInitializing] = useState(false)

  const tryLogin = async () => {
    setToken(input.trim())
    try {
      await api('/api/apps')
      onLogin()
    } catch {
      setError('Token 无效')
    }
  }

  const trySetup = async () => {
    setInitializing(true)
    try {
      const { token } = await api<{ token: string }>('/api/setup', { method: 'POST' })
      setToken(token)
      alert(`初始化成功，请妥善保存 Token：\n${token}`)
      onLogin()
    } catch {
      setError('已初始化过，请输入现有 Token')
    } finally {
      setInitializing(false)
    }
  }

  return (
    <div style={{ paddingTop: 96 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: 'var(--primary)' }}>
        <Icon name="chart" size={44} />
      </div>
      <h1 className="page-title" style={{ textAlign: 'center' }}>ASCMonitor</h1>
      <div className="field">
        <label htmlFor="token-input">Access Token</label>
        <input
          id="token-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴 Token"
          autoComplete="off"
        />
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary" style={{ flex: 1 }} onClick={tryLogin}>登录</button>
        <button className="ghost" onClick={trySetup} disabled={initializing}>首次初始化</button>
      </div>
    </div>
  )
}

export function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (!getToken()) {
      setChecking(false)
      return
    }
    api('/api/apps')
      .then(() => setAuthed(true))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  return (
    <>
      <main>
        {tab === 'overview' && <OverviewPage />}
        {tab === 'events' && <EventsPage />}
        {tab === 'reviews' && <ReviewsPage />}
        {tab === 'alerts' && <AlertsPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
      <nav className="tabbar" aria-label="主导航">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={22} />
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
