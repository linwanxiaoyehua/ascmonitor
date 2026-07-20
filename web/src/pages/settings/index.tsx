// 设置（/settings/:section?）：三层分组（配置一次 / 偶尔运维 / 日常偏好），二级页路由化
//   /settings          主页面：偏好 + 分组导航 + 关于
//   /settings/connect  接入与凭证    /settings/apps  App 管理
//   /settings/alerts   通知与告警    /settings/data  数据运维
// 告警 tab 已解散：规则配置归此处，历史归动态页

import { useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { getTheme, setTheme, type Theme } from '../../lib/theme'
import { Icon, type IconName } from '../../components/Icon'
import { ListRow, PageHeader, Section, SegmentedControl } from '../../components/ui'
import { ConnectSection } from './Connect'
import { AppsSection } from './Apps'
import { AlertsSection } from './Alerts'
import { DataSection } from './Data'

const SECTIONS: Array<{ key: string; title: string; detail: string; icon: IconName; tone: string }> = [
  { key: 'connect', title: '接入与凭证', detail: 'Webhook URL · ASC API 凭证', icon: 'key', tone: 'accent' },
  { key: 'apps', title: 'App 管理', detail: 'App 列表 · Apple ID', icon: 'layers', tone: 'info' },
  { key: 'alerts', title: '通知与告警', detail: '推送 · Telegram · 告警规则 · 日报', icon: 'bell', tone: 'danger' },
  { key: 'data', title: '数据运维', detail: '手动抓取评论 / 账单', icon: 'wrench', tone: 'success' },
]

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

function SettingsHome() {
  const [, navigate] = useLocation()
  const [theme, setThemeState] = useState<Theme>(getTheme())

  return (
    <div className="narrow">
      <PageHeader title="设置" />

      <Section title="偏好">
        <div className="hstack-center">
          <span className="t-detail muted" style={{ flex: 'none' }}>外观</span>
          <div className="flex-1">
            <SegmentedControl
              options={THEME_OPTIONS}
              value={theme}
              onChange={(t) => { setTheme(t); setThemeState(t) }}
            />
          </div>
        </div>
      </Section>

      <Section title="配置">
        <div className="list">
          {SECTIONS.map((s) => (
            <ListRow
              key={s.key}
              leading={<span className={`row-icon tone-${s.tone}`}><Icon name={s.icon} size={16} /></span>}
              title={s.title}
              detail={s.detail}
              trailing="chevron"
              onPress={() => navigate(`/settings/${s.key}`)}
            />
          ))}
        </div>
      </Section>

      <Section title="关于">
        <div className="list">
          <ListRow
            leading={<span className="row-icon"><Icon name="info" size={16} /></span>}
            title="ASCMonitor"
            detail="App Store 收入 · 订阅 · 评论监控 PWA"
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
    case 'data':
      return <DataSection />
    default:
      return <SettingsHome />
  }
}
