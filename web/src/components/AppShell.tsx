// 应用外壳：毛玻璃 TopBar（面包屑 + App 切换器 + 数据新鲜度 + 手动刷新）+ 内容区 + 导航
// 移动端底部 TabBar，桌面（≥1024px）左侧边栏（含二级导航）
// 含跟手的下拉刷新（iOS standalone 无原生 PTR）

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ActivityItem, type AppRow } from '../lib/api'
import { syncUrl } from '../lib/app-filter'
import { activeChild, activeTab, breadcrumb, matchPath, TABS } from '../lib/nav'
import { AppSwitcher } from './AppSwitcher'
import { CaliberSelect } from './CaliberSelect'
import { Icon } from './Icon'
import { isOverlayOpen } from './Sheet'

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

const PTR_THRESHOLD = 72
const PTR_RESISTANCE = 0.5

/** 跟手的下拉刷新：位移随手指渐进，过阈值提示松手，触发后进入 loading 直到请求落地 */
function usePullToRefresh() {
  const queryClient = useQueryClient()
  const [pull, setPull] = useState(0) // 已下拉距离（px，含阻尼）
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)
  const refreshingRef = useRef(false)
  // touchend 闭包读不到最新 pull，用 ref 镜像
  const pullRef = useRef(0)
  pullRef.current = pull

  const trigger = useCallback(() => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    queryClient.invalidateQueries().finally(() => {
      refreshingRef.current = false
      setRefreshing(false)
    })
  }, [queryClient])

  useEffect(() => {
    // Sheet 打开时 body 被锁滚动，scrollY 恒为 0 —— 不排除的话在弹层里下拉会误触发全量刷新
    const blocked = () => isOverlayOpen() || refreshingRef.current

    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !blocked() ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return
      if (window.scrollY > 0) { start.current = null; setPull(0); return }
      const dy = (e.touches[0].clientY - start.current) * PTR_RESISTANCE
      setPull(dy > 0 ? Math.min(dy, PTR_THRESHOLD * 1.5) : 0)
    }
    const onEnd = () => {
      if (start.current != null && pullRef.current >= PTR_THRESHOLD) trigger()
      start.current = null
      setPull(0)
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [trigger])

  return { pull, refreshing, ready: pull >= PTR_THRESHOLD }
}

function PullIndicator({ pull, refreshing, ready }: { pull: number; refreshing: boolean; ready: boolean }) {
  if (!refreshing && pull <= 0) return null
  const height = refreshing ? 44 : Math.min(pull, PTR_THRESHOLD)
  const progress = Math.min(pull / PTR_THRESHOLD, 1)
  return (
    <div
      className={`ptr${refreshing ? ' refreshing' : ''}${ready ? ' ready' : ''}`}
      style={{ height, opacity: refreshing ? 1 : progress }}
      role="status"
      aria-live="polite"
    >
      <Icon
        name="refresh"
        size={16}
        className={refreshing ? 'spin' : undefined}
        style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
      />
      <span>{refreshing ? '刷新中…' : ready ? '松手刷新' : '下拉刷新'}</span>
    </div>
  )
}

/** 侧边栏 / 底部 tab 共用的导航树 */
function NavTree({ location }: { location: string }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      <div className="tabbar-brand" aria-hidden="true">
        <Icon name="chart" size={22} />
        <span>ASCMonitor</span>
      </div>
      {TABS.map((t) => {
        const active = t.owns.some((p) => matchPath(location, p))
        // 最长匹配，否则 /revenue/health 会把二级项「概况」也点亮
        const currentChild = active ? activeChild(t, location)?.path : undefined
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
                  const childActive = c.path === currentChild
                  return (
                    <Link key={c.path} href={c.path} className={childActive ? 'active' : ''} aria-current={childActive ? 'page' : undefined}>
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
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation()
  const ptr = usePullToRefresh()
  const { data: apps } = useQuery({ queryKey: ['apps'], queryFn: () => api<AppRow[]>('/api/apps') })
  // 只有一个 App 时切换器是纯占位 —— 不显示。设置页与 App 筛选无关，同样不显示。
  // 无切换器时（title-in-bar）：页标题上移顶栏，内容区大标题隐藏（见 components.css）。
  const showSwitcher = activeTab(location)?.path !== '/settings' && (apps?.length ?? 0) > 1
  const crumbs = breadcrumb(location)

  // 路由切换：把 ?app= 写回 URL（Link 导航会丢 query）并回到顶部
  useEffect(() => {
    syncUrl()
    window.scrollTo({ top: 0 })
  }, [location])

  return (
    <div className="shell">
      <NavTree location={location} />
      <div className={`shell-content${showSwitcher ? '' : ' title-in-bar'}`}>
        <header className="topbar">
          <div className={`topbar-inner${showSwitcher ? '' : ' solo'}`}>
            <nav className="topbar-crumb" aria-label="当前位置">
              {crumbs.map((c, i) => (
                <span key={c} className={i === crumbs.length - 1 ? 'current' : undefined}>
                  {i > 0 && <span className="sep" aria-hidden="true">/</span>}
                  {c}
                </span>
              ))}
            </nav>
            {showSwitcher && <AppSwitcher />}
            <span className="topbar-spacer" />
            {/* 收入口径开关：唯一入口，仅收入页出现在顶栏 */}
            {location.startsWith('/revenue') && <CaliberSelect />}
            <FreshnessDot />
            <RefreshButton />
          </div>
        </header>
        <PullIndicator {...ptr} />
        <main className="shell-main">{children}</main>
      </div>
    </div>
  )
}
