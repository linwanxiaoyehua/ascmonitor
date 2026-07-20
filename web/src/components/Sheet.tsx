// 底部弹层：回复评论 / 规则编辑 / App 切换共用（替代原生 alert/prompt）
// 桌面（≥768px）变居中弹窗，见 components.css

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

// 打开中的弹层计数：下拉刷新据此避让（弹层内 body 被锁滚，scrollY 恒为 0 会误触发）
let openCount = 0
export function isOverlayOpen(): boolean {
  return openCount > 0
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // 调用方普遍传内联箭头函数，onClose 每次渲染都是新引用 —— 绝不能进依赖数组，
  // 否则弹层内每敲一个字都会重跑 effect，把焦点从输入框抢回容器（只能输入一个字符）
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current()
      // 焦点陷阱：aria-modal 只约束读屏，键盘 Tab 仍会走到背后的页面上去
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) {
        e.preventDefault()
        return ref.current.focus()
      }
      const [first, last] = [items[0], items[items.length - 1]]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    openCount += 1
    document.body.style.overflow = 'hidden'
    // 焦点移入弹层，关闭后归还给触发元素
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) document.body.style.overflow = ''
      restoreTo?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet-head">
          <span className="title">{title}</span>
          <button className="close" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>,
    document.body
  )
}
