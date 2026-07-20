// 全局 App 筛选：null = 全部 Apps
// 初始化：URL ?app= 优先（分享/刷新保持），其次 localStorage
// 变更时双写 URL（replaceState，不触发路由）与 localStorage；query key 统一携带 appId

import { useSyncExternalStore } from 'react'

const KEY = 'ascmonitor_app_filter'

function initial(): number | null {
  const fromUrl = new URLSearchParams(location.search).get('app')
  if (fromUrl && !Number.isNaN(Number(fromUrl))) return Number(fromUrl)
  const fromStorage = localStorage.getItem(KEY)
  return fromStorage && !Number.isNaN(Number(fromStorage)) ? Number(fromStorage) : null
}

let current: number | null = initial()
const listeners = new Set<() => void>()

export function getAppFilter(): number | null {
  return current
}

export function setAppFilter(appId: number | null): void {
  current = appId
  if (appId == null) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, String(appId))
  syncUrl()
  for (const l of listeners) l()
}

/** 把当前筛选写回 URL query（路由切换后也调用，保持 ?app= 不丢） */
export function syncUrl(): void {
  const url = new URL(location.href)
  if (current == null) url.searchParams.delete('app')
  else url.searchParams.set('app', String(current))
  history.replaceState(history.state, '', url)
}

export function useAppFilter(): number | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

/** 给 API 路径追加 app_id 参数 */
export function withAppParam(path: string, appId: number | null): string {
  if (appId == null) return path
  return `${path}${path.includes('?') ? '&' : '?'}app_id=${appId}`
}
