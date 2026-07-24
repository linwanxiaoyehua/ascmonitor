// 设置（/settings/:section?）：三层分组（配置一次 / 偶尔运维 / 日常偏好），二级页路由化
//   /settings          主页面：偏好 + 分组导航 + 关于
//   /settings/connect  接入与凭证    /settings/apps  App 管理
//   /settings/alerts   通知与告警    /settings/data  数据运维
//   /settings/builds   构建监控
// 二级页清单来自 lib/nav 的 SETTINGS_SUBS —— 与桌面侧边栏共用同一份定义
// 告警 tab 已解散：规则配置归此处，历史归动态页

import { useState } from 'react'
import { useParams } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { api, clearToken, getToken, type AppRow, type DataHealth } from '../../lib/api'
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

/** 账户与安全：Access Token（掩码显示 + 复制 + 退出登录），对齐 设置.dc.html 末尾 */
function AccountSection() {
  const token = getToken() ?? ''
  const masked = token ? `asc_${'•'.repeat(16)}${token.slice(-4)}` : '未登录'
  const copy = async () => {
    try { await navigator.clipboard.writeText(token); toast.success('已复制 Access Token') } catch { /* http 无剪贴板权限 */ }
  }
  const logout = () => { clearToken(); location.reload() }
  return (
    <Section title="账户与安全">
      <div className="list">
        <ListRow
          leading={<span className="row-icon tone-accent"><Icon name="key" size={16} /></span>}
          title="Access Token"
          detail={masked}
          trailing={<span className="row-action-text">复制</span>}
          onPress={copy}
        />
        <ListRow
          leading={<span className="row-icon tone-danger"><Icon name="x" size={16} /></span>}
          title={<span className="neg">退出登录（清除本机 Token）</span>}
          onPress={logout}
        />
      </div>
      <p className="muted hint">Token 存于本机浏览器；退出后需重新粘贴才能访问。</p>
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
  const params = useParams<{ section?: string }>()
  switch (params.section) {
    case 'connect':
      return <ConnectSection />
    case 'apps':
      return <AppsSection />
    case 'alerts':
      return <AlertsSection />
    case 'builds':
      return <BuildsSection />
    case 'data':
      return <DataSection />
    default:
      return <SettingsHome />
  }
}
