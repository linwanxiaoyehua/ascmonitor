// 全局收入口径（仿 app-filter.ts 的 useSyncExternalStore + localStorage 模式）
//   gross  = 实时 · 客户价（events 原值）
//   net    = 实时 · 估算净得（events × proceeds_rate）
//   billed = 账单 · 实际（sales_daily，T+1）
// 个人观察偏好：localStorage 持久、不进 URL。开关入口只在收入页头（CaliberSwitch）；
// 其他页面只读消费。模块不支持所选口径时就近降级并由 CaliberTag 如实标注（见 effectiveCaliber）。

import { useSyncExternalStore } from 'react'

export type RevenueCaliber = 'gross' | 'net' | 'billed'

const KEY = 'ascmonitor_caliber'

function initial(): RevenueCaliber {
  const v = localStorage.getItem(KEY)
  return v === 'net' || v === 'billed' ? v : 'gross'
}

let current: RevenueCaliber = initial()
const listeners = new Set<() => void>()

export function getCaliber(): RevenueCaliber {
  return current
}

export function setCaliber(c: RevenueCaliber): void {
  current = c
  if (c === 'gross') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, c)
  for (const l of listeners) l()
}

export function useCaliber(): RevenueCaliber {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

/** 模块不支持 billed（无账单维度数据）时降级 net */
export function effectiveCaliber(caliber: RevenueCaliber, billedSupported: boolean): RevenueCaliber {
  return caliber === 'billed' && !billedSupported ? 'net' : caliber
}

/** 事件口径金额按口径换算（billed 数据源不同，不走此函数） */
export function applyCaliber(usdMilli: number, caliber: RevenueCaliber, rate: number): number {
  return caliber === 'gross' ? usdMilli : Math.round(usdMilli * rate)
}

/** 口径徽标文案：「实时 · 客户价」「实时 · 估算净得 ×85%」「账单 · 实际 T+1」 */
export function caliberLabel(caliber: RevenueCaliber, rate?: number): string {
  switch (caliber) {
    case 'net':
      return `实时 · 估算净得${rate ? ` ×${Math.round(rate * 100)}%` : ''}`
    case 'billed':
      return '账单 · 实际 T+1'
    default:
      return '实时 · 客户价'
  }
}
