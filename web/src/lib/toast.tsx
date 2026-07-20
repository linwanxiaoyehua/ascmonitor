// 全局 Toast 单例：toast.error/success() 任意处可调，<Toaster /> 挂在 AppShell
// QueryCache onError 也走这里 —— 同文案 2.5s 内去重，避免多个 query 同时失败时刷屏

import { useSyncExternalStore } from 'react'
import { Icon } from '../components/Icon'

interface ToastItem {
  id: number
  kind: 'error' | 'success'
  text: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const recent = new Map<string, number>()

function emit() {
  for (const l of listeners) l()
}

function push(kind: ToastItem['kind'], text: string) {
  const last = recent.get(text)
  if (last && Date.now() - last < 2500) return
  recent.set(text, Date.now())
  const id = nextId++
  items = [...items, { id, kind, text }]
  emit()
  setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 3200)
}

export const toast = {
  error: (text: string) => push('error', text),
  success: (text: string) => push('success', text),
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items)
  if (!list.length) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'alertTriangle' : 'check'} size={15} />
          {t.text}
        </div>
      ))}
    </div>
  )
}
