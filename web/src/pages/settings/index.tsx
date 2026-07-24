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
import { api, type AppRow, type DataHealth } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { getTheme, setTheme, type Theme } from '../../lib/theme'
import { Icon } from '../../components/Icon'
import { ListRow, PageHeader, Section, SegmentedControl } from '../../components/ui'

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

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function SettingsHome() {
  const [theme, setThemeState] = useState<Theme>(getTheme())

  return (
    <div className="narrow">
      <PageHeader title="设置" />

      {/* 数据管道状态 */}
      <DataPipelineCard />

      {/* 外观 */}
      <Section title="外观">
        <div className="pref-row">
          <span className="pref-label">主题</span>
          <div className="pref-control">
            <SegmentedControl
              label="外观"
              options={THEME_OPTIONS}
              value={theme}
              onChange={(t) => { setTheme(t); setThemeState(t) }}
            />
          </div>
        </div>
      </Section>

      {/* 全部配置内联为单长页（对齐 设置.dc.html）；子路由仍保留供深链/侧边栏 */}
      <AlertsSection embedded />
      <AppsSection embedded />
      <ConnectSection embedded />
      <DataSection embedded />
      <BuildsSection embedded />

      <Section title="关于">
        <div className="list">
          <ListRow
            leading={<span className="row-icon"><Icon name="info" size={16} /></span>}
            title="ASCMonitor"
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
