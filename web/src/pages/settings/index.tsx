// 设置（/settings/:section?）：三层分组（配置一次 / 偶尔运维 / 日常偏好），二级页路由化
//   /settings          主页面：偏好 + 分组导航 + 关于
//   /settings/connect  接入与凭证    /settings/apps  App 管理
//   /settings/alerts   通知与告警    /settings/data  数据运维
//   /settings/builds   构建监控
// 二级页清单来自 lib/nav 的 SETTINGS_SUBS —— 与桌面侧边栏共用同一份定义
// 告警 tab 已解散：规则配置归此处，历史归动态页

import { useState } from 'react'
import { useParams } from 'wouter'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, clearToken, setToken, type AppRow, type AuthStatus, type DataHealth } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { toast } from '../../lib/toast'
import { getTheme, setTheme, type Theme } from '../../lib/theme'
import { Icon } from '../../components/Icon'
import { ListRow, PageHeader, Section } from '../../components/ui'

/** 数据管道状态卡（对齐 设置.dc.html 顶部）：管道健康 + 接入 App / 原始事件 */
function DataPipelineCard() {
  const { data: health } = useQuery({ queryKey: ['data-health'], queryFn: () => api<DataHealth>('/api/health/data') })
  const { data: apps } = useQuery({ queryKey: ['apps'], queryFn: () => api<AppRow[]>('/api/apps') })
  if (!health) return null
  const fresh = health.lastWebhookAt != null && Date.now() - health.lastWebhookAt < 24 * 3600 * 1000
  return (
    <div className="pipe-card">
      <span className={`pipe-ic ${fresh ? 'ok' : 'warn'}`}><Icon name="activity" size={20} /></span>
      <div className="pipe-main">
        <div className="pipe-title">
          {fresh ? '数据管道运行正常' : '数据管道待接入'}
          <span className={`fresh-dot ${fresh ? 'ok' : 'stale'}`} />
        </div>
        <div className="pipe-sub">
          {health.lastWebhookAt ? `最近事件 ${timeAgo(health.lastWebhookAt)}` : '尚未收到 Webhook 事件'}
          {health.fxUpdatedAt ? ` · 汇率 ${timeAgo(health.fxUpdatedAt)}` : ''}
        </div>
      </div>
      <div className="pipe-stats">
        <div><div className="ps-v num">{apps?.length ?? '—'}</div><div className="ps-k">接入 App</div></div>
        <div><div className="ps-v num">{health.rawNotifications.toLocaleString()}</div><div className="ps-k">原始事件</div></div>
      </div>
    </div>
  )
}
import { ConnectSection } from './Connect'
import { AppsSection } from './Apps'
import { AlertsSection } from './Alerts'
import { BuildsSection } from './Builds'
import { DataSection } from './Data'

/**
 * 登录与安全。
 * 两条认证路径：Cloudflare Access（Zero Trust 托管登录，推荐）与 Access Token（兜底）。
 * 兜底的意义是别把自己锁在门外 —— Access 配错时还能用 token 进来改配置；
 * 确认 Access 真的生效（本行显示为 Access + 邮箱）后再关掉它。
 */
function AccountSection() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['auth-status'], queryFn: () => api<AuthStatus>('/api/auth/status') })
  const [editing, setEditing] = useState(false)
  const [teamDomain, setTeamDomain] = useState('')
  const [aud, setAud] = useState('')
  const [freshToken, setFreshToken] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth-status'] })

  const saveAccess = useMutation({
    mutationFn: () =>
      api<AuthStatus>('/api/auth/access', { method: 'PUT', body: JSON.stringify({ teamDomain, aud }) }),
    onSuccess: () => {
      toast.success(teamDomain && aud ? 'Access 已配置，刷新页面走 Cloudflare 登录' : 'Access 校验已关闭')
      setEditing(false)
      setAud('')
      refresh()
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError && /bad_team_domain/.test(e.message)
        ? '团队域名格式应为 xxx.cloudflareaccess.com'
        : e instanceof ApiError && /bad_aud/.test(e.message)
          ? 'AUD 应为 64 位十六进制'
          : '保存失败'
      toast.error(msg)
    },
  })

  const setFallback = useMutation({
    mutationFn: (enabled: boolean) =>
      api<AuthStatus>('/api/auth/token-fallback', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? '已开启 Token 兜底' : 'Token 兜底已关闭，此后只认 Access')
      refresh()
    },
    onError: (e: unknown) => {
      toast.error(
        e instanceof ApiError && /access_not_active/.test(e.message)
          ? '当前这次访问不是 Access 认证的 —— 先确认 Access 生效再关兜底'
          : '操作失败'
      )
    },
  })

  const rotate = useMutation({
    mutationFn: () => api<{ token: string }>('/api/auth/rotate-token', { method: 'POST' }),
    onSuccess: ({ token }) => {
      setToken(token) // 本机立即换新，避免自己被旧 token 顶下线
      setFreshToken(token)
      refresh()
    },
    onError: () => toast.error('轮换失败'),
  })

  const logout = () => {
    clearToken()
    // Access 模式下还要退掉 Cloudflare 的会话，否则刷新即自动登录
    if (status?.method === 'access') location.href = '/cdn-cgi/access/logout'
    else location.reload()
  }

  const isAccess = status?.method === 'access'
  return (
    <Section title="登录与安全">
      <div className="list">
        <ListRow
          leading={<span className={`row-icon ${isAccess ? 'tone-success' : 'tone-accent'}`}><Icon name="key" size={16} /></span>}
          title={isAccess ? 'Cloudflare Access' : 'Access Token'}
          detail={
            isAccess
              ? [status?.email, status?.sessionExpiresAt ? `会话至 ${new Date(status.sessionExpiresAt).toLocaleString()}` : null]
                  .filter(Boolean).join(' · ')
              : status?.accessConfigured
                ? 'Access 已配置但本次访问未通过 —— 用受保护的域名打开'
                : '本机 Token 认证（建议改用 Cloudflare Access）'
          }
        />
        {status?.accessConfigured && !editing && (
          <ListRow
            leading={<span className="row-icon tone-info"><Icon name="settings" size={16} /></span>}
            title="Access 配置"
            detail={`${status.accessTeamDomain} · AUD ${status.accessAud}`}
            trailing="chevron"
            onPress={() => { setTeamDomain(status.accessTeamDomain ?? ''); setEditing(true) }}
          />
        )}
      </div>

      {(!status?.accessConfigured || editing) && (
        <div className="panel pad mt-2">
          <div className="field">
            <label htmlFor="access-team">团队域名</label>
            <input
              id="access-team"
              value={teamDomain}
              onChange={(e) => setTeamDomain(e.target.value)}
              placeholder="your-team.cloudflareaccess.com"
              autoComplete="off" autoCapitalize="none" spellCheck={false}
            />
          </div>
          <div className="field">
            <label htmlFor="access-aud">Application Audience (AUD) tag</label>
            <input
              id="access-aud"
              value={aud}
              onChange={(e) => setAud(e.target.value)}
              placeholder="64 位十六进制，Zero Trust 应用概览里复制"
              autoComplete="off" autoCapitalize="none" spellCheck={false}
            />
          </div>
          <div className="hstack mt-2">
            <button className="primary flex-1" disabled={saveAccess.isPending} onClick={() => saveAccess.mutate()}>
              {saveAccess.isPending ? '保存中…' : '保存'}
            </button>
            {editing && <button className="ghost" onClick={() => { setEditing(false); setAud('') }}>取消</button>}
          </div>
          <p className="muted hint">
            Zero Trust → Access → Applications 新建自助应用，域名填本站；
            再单独给 <code>/webhook/*</code> 建一条 Bypass 策略（Apple 与 ASC 无法登录）。
            两项留空即关闭 Access 校验。
          </p>
        </div>
      )}

      {freshToken && (
        <div className="panel pad mt-2">
          <p className="muted mb-2">新 Token（<strong>只显示这一次</strong>，本机已自动换上）</p>
          <div className="panel token-box"><code className="num t-detail">{freshToken}</code></div>
          <button className="ghost mt-2" onClick={() => setFreshToken('')}>我已保存</button>
        </div>
      )}

      <div className="list mt-2">
        {status?.accessConfigured && (
          <ListRow
            leading={<span className={`row-icon ${status.tokenFallback ? 'tone-warning' : 'tone-success'}`}><Icon name="wrench" size={16} /></span>}
            title={status.tokenFallback ? '关闭 Token 兜底（只认 Access）' : '开启 Token 兜底'}
            detail={
              status.tokenFallback
                ? '兜底开启期间，拿到 Token 的人仍能绕过 Access'
                : '当前只接受 Cloudflare Access；Access 出问题时需用 wrangler 改库才能恢复'
            }
            trailing="chevron"
            onPress={() => setFallback.mutate(!status.tokenFallback)}
          />
        )}
        <ListRow
          leading={<span className="row-icon tone-accent"><Icon name="refresh" size={16} /></span>}
          title="轮换 Access Token"
          detail="旧 Token 立即失效；服务端只存哈希，明文只在轮换时显示一次"
          trailing="chevron"
          onPress={() => rotate.mutate()}
        />
        <ListRow
          leading={<span className="row-icon tone-danger"><Icon name="x" size={16} /></span>}
          title={<span className="neg">{isAccess ? '退出登录（含 Cloudflare 会话）' : '退出登录（清除本机 Token）'}</span>}
          onPress={logout}
        />
      </div>
      <p className="muted hint">
        Token 明文只存在本机浏览器，服务端只有 SHA-256；连续 8 次认证失败会锁定 15 分钟。
      </p>
    </Section>
  )
}

/** 主题选择：3 张预览色卡 + 选中 ✓（对齐 设置.dc.html 外观） */
function ThemePicker() {
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const opts: Array<{ value: Theme; label: string; preview: string }> = [
    { value: 'auto', label: '跟随系统', preview: 'auto' },
    { value: 'light', label: '浅色', preview: 'light' },
    { value: 'dark', label: '深色', preview: 'dark' },
  ]
  return (
    <div className="theme-picker">
      {opts.map((o) => (
        <button
          key={o.value}
          className={`theme-card${theme === o.value ? ' active' : ''}`}
          aria-pressed={theme === o.value}
          onClick={() => { setTheme(o.value); setThemeState(o.value) }}
        >
          <span className={`theme-preview preview-${o.preview}`} aria-hidden="true">
            <span className="tp-bar" /><span className="tp-bar sm" /><span className="tp-dot" />
          </span>
          <span className="theme-label">
            {o.label}
            {theme === o.value && <Icon name="check" size={14} />}
          </span>
        </button>
      ))}
    </div>
  )
}

function SettingsHome() {

  return (
    <div className="narrow">
      <PageHeader title="设置" />

      {/* 顶部：数据管道健康概览 */}
      <DataPipelineCard />

      {/* 单长页，按「配置 → 运维 → 偏好」功能顺序；子路由保留供深链/侧边栏 */}
      <AppsSection embedded />
      <ConnectSection embedded />
      <AlertsSection embedded />
      <BuildsSection embedded />
      <DataSection embedded />

      {/* 外观（对齐设计稿，靠近底部） */}
      <Section title="外观">
        <div className="panel pad">
          <ThemePicker />
        </div>
      </Section>

      {/* 账户与安全 */}
      <AccountSection />

      <Section title="关于">
        <div className="list">
          <ListRow
            leading={<span className="row-icon"><Icon name="info" size={16} /></span>}
            title="Vantage"
            detail="App Store 收入 · 订阅 · 评分监控 PWA"
          />
        </div>
      </Section>
    </div>
  )
}

export function SettingsPage() {
  const params = useParams<{ section?: string; sub?: string }>()
  switch (params.section) {
    case 'connect':
      return <ConnectSection />
    case 'apps':
      return <AppsSection />
    case 'alerts':
      return <AlertsSection />
    case 'builds':
      // /settings/builds/:appId —— 单个 App 的全部构建 / 审核状态
      return <BuildsSection appId={params.sub ? Number(params.sub) : undefined} />
    case 'data':
      return <DataSection />
    default:
      return <SettingsHome />
  }
}
