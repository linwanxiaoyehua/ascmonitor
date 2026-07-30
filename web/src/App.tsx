import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Route, Switch } from 'wouter'
import { api, clearToken, getToken, setToken, type AuthStatus } from './lib/api'
import { UNAUTHORIZED_EVENT } from './lib/query'
import { AppShell } from './components/AppShell'
import { Icon } from './components/Icon'
import { Skeleton } from './components/ui'
import { Toaster } from './lib/toast'
import { OverviewPage } from './pages/Overview'

// 非首屏页面按路由懒加载
const RevenuePage = lazy(() => import('./pages/revenue').then((m) => ({ default: m.RevenuePage })))
const ReviewsPage = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.ReviewsPage })))
const ActivityPage = lazy(() => import('./pages/Activity').then((m) => ({ default: m.ActivityPage })))
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })))

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [copied, setCopied] = useState(false)

  // form 提交而非 onClick：移动端键盘「前往」与回车都能登录
  const tryLogin = async (e: FormEvent) => {
    e.preventDefault()
    const candidate = input.trim()
    if (!candidate || busy) return
    setBusy(true)
    setError('')
    const previous = getToken()
    setToken(candidate)
    try {
      await api('/api/auth/status')
      onLogin()
    } catch {
      // 校验失败不能把无效 token 留在 localStorage
      if (previous) setToken(previous)
      else clearToken()
      setError('Token 无效')
    } finally {
      setBusy(false)
    }
  }

  const trySetup = async () => {
    setInitializing(true)
    setError('')
    try {
      const { token } = await api<{ token: string }>('/api/setup', { method: 'POST' })
      setToken(token)
      setNewToken(token)
    } catch {
      setError('已初始化过，请输入现有 Token')
    } finally {
      setInitializing(false)
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 复制失败时用户仍可手动选中 */ }
  }

  // 初始化成功：页面内展示 Token（只显示一次，替代原生 alert）
  if (newToken) {
    return (
      <div className="shell-main login-screen">
        <div className="login-icon pos">
          <Icon name="check" size={44} />
        </div>
        <h1 className="t-title center mb-2">初始化成功</h1>
        <p className="muted center mb-4">
          这是你的 Access Token，<strong>只显示这一次</strong>，请立即保存
        </p>
        <div className="panel token-box">
          <code className="num t-detail">{newToken}</code>
        </div>
        <div className="hstack">
          <button className="ghost flex-1" onClick={copyToken}>
            {copied ? '已复制' : '复制 Token'}
          </button>
          <button className="primary flex-1" onClick={onLogin}>我已保存，进入</button>
        </div>
      </div>
    )
  }

  return (
    <form className="shell-main login-screen" onSubmit={tryLogin}>
      <div className="login-icon accent-text">
        <Icon name="chart" size={44} />
      </div>
      <h1 className="t-title center mb-5">Vantage</h1>
      <div className="field">
        <label htmlFor="token-input">Access Token</label>
        <input
          id="token-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴 Token"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="hstack">
        <button type="submit" className="primary flex-1" disabled={busy || !input.trim()}>
          {busy ? '验证中…' : '登录'}
        </button>
        <button type="button" className="ghost" onClick={trySetup} disabled={initializing}>首次初始化</button>
      </div>
    </form>
  )
}

function PageFallback() {
  return (
    <div className="mt-4">
      <Skeleton variant="rows" count={5} />
    </div>
  )
}

/** 冷启动校验 token 期间的占位（原来 return null 会白屏闪一下） */
function BootScreen() {
  return (
    <div className="shell-main login-screen center" aria-busy="true">
      <div className="login-icon accent-text">
        <Icon name="chart" size={44} />
      </div>
      <p className="muted">正在载入…</p>
    </div>
  )
}

export function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  // 无条件探一次：走 Cloudflare Access 时本机没有 token，认证靠 cookie，
  // 不能因为「localStorage 里没 token」就先弹登录页
  useEffect(() => {
    api<AuthStatus>('/api/auth/status')
      .then(() => setAuthed(true))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  // 任意请求 401 → 回登录页（token 失效 / 被重置）
  useEffect(() => {
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  if (checking) return <BootScreen />
  if (!authed) {
    return (
      <>
        <LoginScreen onLogin={() => setAuthed(true)} />
        <Toaster />
      </>
    )
  }

  return (
    <>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/" component={OverviewPage} />
            <Route path="/revenue/:sub?" component={RevenuePage} />
            <Route path="/reviews" component={ReviewsPage} />
            <Route path="/activity" component={ActivityPage} />
            {/* :sub 目前只有构建监控用到（/settings/builds/:appId） */}
            <Route path="/settings/:section?/:sub?" component={SettingsPage} />
            <Route component={OverviewPage} />
          </Switch>
        </Suspense>
      </AppShell>
      <Toaster />
    </>
  )
}
