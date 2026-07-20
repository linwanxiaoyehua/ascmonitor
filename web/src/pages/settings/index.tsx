// 设置（/settings/:section?）：三层分组（配置一次 / 偶尔运维 / 日常偏好），二级页路由化
//   /settings          主页面：偏好 + 分组导航 + 关于
//   /settings/connect  接入与凭证    /settings/apps  App 管理
//   /settings/alerts   通知与告警    /settings/data  数据运维
//   /settings/builds   构建监控
// 二级页清单来自 lib/nav 的 SETTINGS_SUBS —— 与桌面侧边栏共用同一份定义
// 告警 tab 已解散：规则配置归此处，历史归动态页

import { useState } from 'react'
import { useLocation, useParams } from 'wouter'
import { SETTINGS_SUBS } from '../../lib/nav'
import { getTheme, setTheme, type Theme } from '../../lib/theme'
import { Icon } from '../../components/Icon'
import { ListRow, PageHeader, Section, SegmentedControl } from '../../components/ui'
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
  const [, navigate] = useLocation()
  const [theme, setThemeState] = useState<Theme>(getTheme())

  return (
    <div className="narrow">
      <PageHeader title="设置" />

      <Section title="偏好">
        <div className="pref-row">
          <span className="pref-label">外观</span>
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

      <Section title="配置">
        <div className="list">
          {SETTINGS_SUBS.map((s) => (
            <ListRow
              key={s.path}
              leading={<span className={`row-icon tone-${s.tone}`}>{s.icon && <Icon name={s.icon} size={16} />}</span>}
              title={s.label}
              detail={s.detail}
              trailing="chevron"
              onPress={() => navigate(s.path)}
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
    case 'builds':
      return <BuildsSection />
    case 'data':
      return <DataSection />
    default:
      return <SettingsHome />
  }
}
