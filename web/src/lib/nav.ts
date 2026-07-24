// 导航单一事实源：底部 TabBar / 桌面侧边栏 / 页内子页签 / 顶栏面包屑 全部读这里
// 之前 AppShell 与 revenue/index、settings/index 各写一份，改一处漏一处

import type { IconName } from '../components/Icon'

export interface NavChild {
  path: string
  label: string
  /** 设置二级页还要在 /settings 主页以列表行呈现，故多带图标与说明 */
  detail?: string
  icon?: IconName
  tone?: string
}

export interface NavTab {
  path: string
  label: string
  icon: IconName
  /** 归本 tab 管辖的路由前缀 —— 决定导航高亮与面包屑归属 */
  owns: string[]
  children?: NavChild[]
}

export const REVENUE_SUBS: NavChild[] = [
  { path: '/revenue', label: '概况' },
  { path: '/revenue/health', label: '订阅健康' },
  { path: '/revenue/detail', label: '明细' },
]

export const SETTINGS_SUBS: NavChild[] = [
  { path: '/settings/connect', label: '接入与凭证', detail: 'Webhook URL · ASC API 凭证', icon: 'key', tone: 'accent' },
  { path: '/settings/apps', label: 'App 管理', detail: 'App 列表 · Apple ID', icon: 'layers', tone: 'info' },
  { path: '/settings/alerts', label: '通知与告警', detail: '推送 · Telegram · 告警规则 · 日报', icon: 'bell', tone: 'danger' },
  { path: '/settings/builds', label: '构建监控', detail: '构建处理 · TestFlight · 上架审核状态', icon: 'flask', tone: 'warning' },
  { path: '/settings/data', label: '数据运维', detail: '手动抓取评论 / 账单', icon: 'wrench', tone: 'success' },
]

// 5 tab：实时动态升为独立 tab；订阅并入收入子页签
export const TABS: NavTab[] = [
  { path: '/', label: '总览', icon: 'chart', owns: ['/'] },
  { path: '/revenue', label: '收入', icon: 'creditCard', owns: ['/revenue'], children: REVENUE_SUBS },
  { path: '/reviews', label: '评分', icon: 'star', owns: ['/reviews'] },
  { path: '/activity', label: '动态', icon: 'activity', owns: ['/activity'] },
  { path: '/settings', label: '设置', icon: 'settings', owns: ['/settings'], children: SETTINGS_SUBS },
]

/** 精确段匹配：/revenue 不会误命中 /revenuexyz */
export function matchPath(loc: string, path: string): boolean {
  if (path === '/') return loc === '/'
  return loc === path || loc.startsWith(`${path}/`)
}

/** 未知路由回落到首个 tab —— 与 App.tsx 的兜底路由（渲染总览）保持一致 */
export function activeTab(loc: string): NavTab {
  return TABS.find((t) => t.owns.some((p) => matchPath(loc, p))) ?? TABS[0]
}

/** 当前二级页；最长路径优先，避免 /revenue/health 命中 /revenue */
export function activeChild(tab: NavTab | undefined, loc: string): NavChild | undefined {
  if (!tab?.children) return undefined
  return [...tab.children].sort((a, b) => b.path.length - a.path.length).find((c) => matchPath(loc, c.path))
}

/** 面包屑：一级页只显示 tab 名，二级页显示「tab / 子页」 */
export function breadcrumb(loc: string): string[] {
  const tab = activeTab(loc)
  const child = activeChild(tab, loc)
  return child && child.path !== tab.path ? [tab.label, child.label] : [tab.label]
}
