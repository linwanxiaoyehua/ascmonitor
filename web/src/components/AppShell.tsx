// 应用外壳：毛玻璃 TopBar（App 切换器 + 数据新鲜度 + 手动刷新）+ 内容区 + 底部 TabBar
// 含轻量下拉刷新（iOS standalone 无原生 PTR）

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ActivityItem } from '../lib/api'
import { syncUrl } from '../lib/app-filter'
import { AppSwitcher } from './AppSwitcher'
import { Icon, type IconName } from './Icon'

const TABS: Array<{
  path: string
  label: string
  icon: IconName
  /** 桌面侧边栏二级项（移动端由页内 .subnav 承担） */
  children?: Array<{ path: string; label: string }>
}> = [
  // 4 tab：动态实时流并入总览，订阅并入收入子页签
  { path: '/', label: '总览', icon: 'chart' },
  {
    path: '/revenue',
    label: '收入',
    icon: 'creditCard',
    children: [
      { path: '/revenue', label: '概况' },
      { path: '/revenue/health', label: '订阅健康' },
      { path: '/revenue/detail', label: '明细' },
    ],
  },
  { path: '/reviews', label: '评论', icon: 'message' },
  { path: '/settings', label: '设置', icon: 'settings' },
]

/** 数据管道新鲜度：最近一条 webhook/告警事件的时间（全局，不随 App 筛选） */
function FreshnessDot() {
  const { data: ts } = useQuery({
    queryKey: ['freshness'],
    queryFn: () => api<{ items: ActivityItem[] }>('/api/activity?limit=1'),
    select: (d) => d.items[0]?.ts ?? null,
    refetchInterval: 120_000,
  })
  if (ts === undefined) return null
  const age = ts == null ? Infinity : Date.now() - ts
  const level = age < 3600_000 ? 'ok' : age < 86400_000 ? 'stale' : 'dead'
  const label = ts == null ? '还没有收到事件' : `最近事件 ${new Date(ts).toLocaleString('zh-CN')}`
  return <span className={`fresh-dot ${level}`} title={label} aria-label={label} />
}

function RefreshButton() {
  const queryClient = useQueryClient()
  const fetching = useIsFetching() > 0
  return (
    <button className="topbar-action" aria-label="刷新数据" onClick={() => queryClient.invalidateQueries()}>
      <Icon name="refresh" size={17} className={fetching ? 'spin' : undefined} />
    </button>
  )
}

/** 轻量下拉刷新：页面顶部下拉超过阈值触发全量 invalidate */
function usePullToRefresh() {
  const queryClient = useQueryClient()
  const [pulling, setPulling] = useState(false)
  const start = useRef<number | null>(null)

  useEffect(() => {
    const THRESHOLD = 72
    let triggered = false
    const onStart = (e: TouchEvent) => {
      if (window.scrollY <= 0) {
        start.current = e.touches[0].clientY
        triggered = false
      } else start.current = null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current == null || triggered) return
      const dy = e.touches[0].clientY - start.current
      setPulling(dy > 24 && window.scrollY <= 0)
      if (dy > THRESHOLD && window.scrollY <= 0) {
        triggered = true
        setPulling(false)
        queryClient.invalidateQueries()
      }
    }
    const onEnd = () => {
      start.current = null
      setPulling(false)
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [queryClient])

  return pulling
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  const pulling = usePullToRefresh()
  const isSettings = location.startsWith('/settings')
  // 桌面：页标题在 TopBar（侧边栏指示位置，页内大标题隐藏）
  const pageTitle = TABS.find((t) => (t.path === '/' ? location === '/' : location.startsWith(t.path)))?.label ?? '总览'

  // 路由切换后把 ?app= 写回 URL（Link 导航会丢 query）
  useEffect(() => {
    syncUrl()
  }, [location])

  return (
    <div className="shell">
      {/* 移动端：底部 TabBar；桌面（≥1024px）：左侧边栏 */}
      <nav className="tabbar" aria-label="主导航">
        <div className="tabbar-brand" aria-hidden="true">
          <Icon name="chart" size={22} />
          <span>ASCMonitor</span>
        </div>
        {TABS.map((t) => {
          const active = t.path === '/' ? location === '/' : location.startsWith(t.path)
          return (
            <div key={t.path} className="tab-item">
              <Link href={t.path} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                <Icon name={t.icon} size={22} />
                {t.label}
              </Link>
              {/* 桌面：当前 tab 展开二级导航（基础样式 display:none，仅 ≥1024px 显示） */}
              {t.children && active && (
                <div className="subnav-rail">
                  {t.children.map((c) => {
                    const childActive = c.path === t.path ? location === c.path : location.startsWith(c.path)
                    return (
                      <Link key={c.path} href={c.path} className={childActive ? 'active' : ''}>
                        {c.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="shell-content">
        <header className="topbar">
          <div className="topbar-inner">
            <span className="topbar-page-title">{pageTitle}</span>
            {isSettings ? <span className="topbar-title">设置</span> : <AppSwitcher />}
            <span className="topbar-spacer" />
            <FreshnessDot />
            <RefreshButton />
          </div>
        </header>
        {pulling && (
          <div className="ptr-indicator" aria-hidden="true" style={{ height: 32 }}>
            <Icon name="refresh" size={16} />
          </div>
        )}
        <main className="shell-main">{children}</main>
      </div>
    </div>
  )
}
