// 收入口径选择器：顶栏 chip + 底部 Sheet。
// 取代原页内 segmented（移动端与子页签两栏堆叠太挤），风格与 App 切换器 chip 统一。
// 仍是全局口径开关的唯一入口，只在收入页由 AppShell 按路由渲染。

import { useState } from 'react'
import { setCaliber, useCaliber, type RevenueCaliber } from '../lib/caliber'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { ListRow } from './ui'

const OPTIONS: Array<{ value: RevenueCaliber; label: string; desc: string }> = [
  { value: 'gross', label: '客户价', desc: '实时 · 客户支付价' },
  { value: 'net', label: '净得', desc: '实时 · 估算净得（扣 Apple 分成）' },
  { value: 'billed', label: '账单', desc: '账单 · 实际到账（T+1）' },
]

export function CaliberSelect() {
  const caliber = useCaliber()
  const [open, setOpen] = useState(false)
  const current = OPTIONS.find((o) => o.value === caliber) ?? OPTIONS[0]

  return (
    <>
      <button
        className="app-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`收入口径：${current.label}`}
      >
        <Icon name="dollar" size={13} />
        <span className="label">{current.label}</span>
        <Icon name="chevronDown" size={13} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="收入口径">
        <div className="list">
          {OPTIONS.map((o) => (
            <ListRow
              key={o.value}
              title={o.label}
              detail={o.desc}
              trailing={caliber === o.value ? <Icon name="check" size={17} className="accent-text" /> : undefined}
              onPress={() => { setCaliber(o.value); setOpen(false) }}
            />
          ))}
        </div>
      </Sheet>
    </>
  )
}
