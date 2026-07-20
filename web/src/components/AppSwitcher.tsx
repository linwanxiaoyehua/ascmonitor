// 全局 App 切换器：TopBar chip + 底部 Sheet 选择
// 选择持久化 localStorage 并同步 URL ?app=（见 lib/app-filter）

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type AppRow } from '../lib/api'
import { setAppFilter, useAppFilter } from '../lib/app-filter'
import { AppIcon } from './AppIcon'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { ListRow } from './ui'

export function AppSwitcher() {
  const appId = useAppFilter()
  const [open, setOpen] = useState(false)
  const { data: apps } = useQuery({ queryKey: ['apps'], queryFn: () => api<AppRow[]>('/api/apps') })

  const current = apps?.find((a) => a.id === appId) ?? null
  // 只有一个 App 时切换器没有意义，仍显示名称但不可点
  const single = (apps?.length ?? 0) <= 1

  return (
    <>
      <button className="app-chip" onClick={() => !single && setOpen(true)} aria-haspopup="dialog" disabled={single && !current}>
        {current ? (
          <AppIcon url={current.icon_url} name={current.name} size={20} />
        ) : (
          <span className="row-icon tone-accent sm">
            <Icon name="layers" size={12} />
          </span>
        )}
        <span className="label">{current ? current.name : '全部 Apps'}</span>
        {!single && <Icon name="chevronDown" size={13} />}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="选择 App">
        <div className="list">
          <ListRow
            leading={
              <span className="row-icon tone-accent"><Icon name="layers" size={16} /></span>
            }
            title="全部 Apps"
            detail="合并展示所有 App 的数据"
            trailing={appId == null ? <Icon name="check" size={17} className="accent-text" /> : undefined}
            onPress={() => { setAppFilter(null); setOpen(false) }}
          />
          {(apps ?? []).map((a) => (
            <ListRow
              key={a.id}
              leading={<AppIcon url={a.icon_url} name={a.name} size={32} />}
              title={a.name}
              detail={a.bundle_id}
              trailing={appId === a.id ? <Icon name="check" size={17} className="accent-text" /> : undefined}
              onPress={() => { setAppFilter(a.id); setOpen(false) }}
            />
          ))}
        </div>
      </Sheet>
    </>
  )
}
