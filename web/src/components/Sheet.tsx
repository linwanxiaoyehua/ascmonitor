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

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
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
  }, [open, onClose])

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
