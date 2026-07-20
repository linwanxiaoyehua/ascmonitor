// 共享 UI 组件：布局、卡片、列表、状态、控件
// 页面不要再手写这些结构 —— 有新需求先扩展这里

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { timeAgo } from '../lib/format'
import { fmtMoney } from '../lib/money'
import { Icon, type IconName } from './Icon'

/* ---------- 页面结构 ---------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  // 桌面隐藏页内大标题（顶栏面包屑接管），但带操作区的页头要保留操作 —— 用 has-actions 区分
  return (
    <div className={`page-header${actions ? ' has-actions' : ''}`}>
      <h1>{title}</h1>
      {subtitle && <span className="subtitle">{subtitle}</span>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function Section({
  title, count, action, className, children,
}: { title: string; count?: number; action?: { label: string; onPress: () => void }; className?: string; children: ReactNode }) {
  return (
    <section className={`section${className ? ` ${className}` : ''}`}>
      <div className="section-head">
        <span className="title">{title}</span>
        {count != null && <span className="count">{count}</span>}
        {action && (
          <button className="action" onClick={action.onPress}>{action.label}</button>
        )}
      </div>
      {children}
    </section>
  )
}

/* ---------- 徽标 ---------- */

export type BadgeTone = 'neutral' | 'warning' | 'danger' | 'info' | 'success'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>
}

/** 口径徽标：来源 + 新鲜度，如「实时」「ASC · 07-16」「账单 · T+1」 */
export function CaliberTag({ children }: { children: ReactNode }) {
  return <span className="caliber">{children}</span>
}

/* ---------- StatCard ---------- */

export function StatCard({
  label, value, delta, badge, icon, loading, onPress, foot,
}: {
  label: string
  value: ReactNode
  delta?: { text: string; direction: 'up' | 'down' }
  badge?: ReactNode
  icon?: IconName
  loading?: boolean
  onPress?: () => void
  foot?: ReactNode
}) {
  if (loading) return <div className="skeleton h-card" aria-hidden="true" />
  const inner = (
    <>
      {badge && <span className="stat-badge">{badge}</span>}
      <div className="label">
        {icon && <Icon name={icon} size={13} />}
        <span className="label-text">{label}</span>
      </div>
      <div className="value num">{value}</div>
      {/* foot 恒占位，避免有无注脚的卡片高度不一致 */}
      <div className="foot">
        {delta && <span className={`delta ${delta.direction}`}>{delta.direction === 'up' ? '↑' : '↓'} {delta.text}</span>}
        {foot}
      </div>
    </>
  )
  return onPress ? (
    <button className="stat-card" onClick={onPress}>{inner}</button>
  ) : (
    <div className="stat-card">{inner}</div>
  )
}

/* ---------- ListRow ---------- */

export function ListRow({
  leading, title, badges, detail, amount, time, trailing, chevronOpen, onPress,
}: {
  leading?: ReactNode
  title: ReactNode
  badges?: ReactNode
  detail?: ReactNode
  amount?: { milli: number | null | undefined; currency: string | null | undefined; sign?: 'pos' | 'neg' }
  time?: number
  trailing?: 'chevron' | ReactNode
  chevronOpen?: boolean
  onPress?: () => void
}) {
  const amountText = amount ? fmtMoney(amount.milli, amount.currency) : ''
  const body = (
    <>
      {leading}
      <div className="main">
        <div className="title">
          {title}
          {badges}
        </div>
        {detail && <div className="detail">{detail}</div>}
      </div>
      {amountText ? (
        <div className="side">
          <div className={`amount num${amount?.sign ? ` ${amount.sign}` : ''}`}>
            {amount?.sign === 'neg' ? '−' : amount?.sign === 'pos' ? '+' : ''}{amountText}
          </div>
          {time != null && <div className="time">{timeAgo(time)}</div>}
        </div>
      ) : time != null ? (
        <span className="time">{timeAgo(time)}</span>
      ) : null}
      {trailing === 'chevron' ? (
        <Icon name="chevronRight" size={16} className={`chevron${chevronOpen ? ' open' : ''}`} />
      ) : (
        trailing
      )}
    </>
  )
  return onPress ? (
    <button className="lrow pressable" onClick={onPress} aria-expanded={chevronOpen}>{body}</button>
  ) : (
    <div className="lrow">{body}</div>
  )
}

/* ---------- 状态 ---------- */

/** height 只对 chart 变体有意义：图表高度由调用方决定，骨架必须等高才不跳版 */
export function Skeleton({ variant, count = 3, height }: { variant: 'rows' | 'cards' | 'chart' | 'hero'; count?: number; height?: number }) {
  if (variant === 'cards') {
    return (
      <div className="stat-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton h-card" />
        ))}
      </div>
    )
  }
  if (variant === 'chart') return <div className="skeleton h-chart" aria-hidden="true" style={height ? { height } : undefined} />
  if (variant === 'hero') return <div className="skeleton h-hero" aria-hidden="true" />
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton h-row" />
      ))}
    </div>
  )
}

export function EmptyState({
  icon = 'inbox', title, hint, action,
}: { icon?: IconName; title: string; hint?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <div className="state-box empty">
      <Icon name={icon} size={34} />
      <div className="state-title">{title}</div>
      {hint && <span className="muted">{hint}</span>}
      {action && (
        <div className="mt-3">
          <button className="ghost" onClick={action.onPress}>{action.label}</button>
        </div>
      )}
    </div>
  )
}

export function ErrorState({ message = '加载失败，请检查网络', onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="state-box error-state" role="alert">
      <Icon name="alertTriangle" size={34} />
      <div className="state-title">{message}</div>
      <div className="mt-3">
        <button className="ghost" onClick={onRetry}>重试</button>
      </div>
    </div>
  )
}

/** 直连 useInfiniteQuery：<LoadMore query={q} /> */
export function LoadMore({
  hasNextPage, isFetchingNextPage, fetchNextPage,
}: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void }) {
  if (!hasNextPage) return null
  return (
    <button className="ghost btn-block mt-3" disabled={isFetchingNextPage} onClick={fetchNextPage}>
      {isFetchingNextPage ? '加载中…' : '加载更多'}
    </button>
  )
}

/* ---------- 控件 ---------- */

/**
 * 单选分段控件。语义是「一组互斥选项」而非 tab 面板 —— 用 radiogroup，
 * 并按 ARIA 惯例支持左右方向键切换。路由型子页签请用 SegmentedLinks。
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, label,
}: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + dir + options.length) % options.length]
    onChange(next.value)
    // 选中项即焦点项（roving tabindex）
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'active' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** 路由型子页签：外观同 SegmentedControl，但渲染真链接（可 ⌘/中键新开、可右键复制地址） */
export function SegmentedLinks({
  options, isActive, label,
}: { options: Array<{ path: string; label: string }>; isActive: (path: string) => boolean; label?: string }) {
  return (
    <div className="segmented" aria-label={label}>
      {options.map((o) => {
        const active = isActive(o.path)
        return (
          <Link key={o.path} href={o.path} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}

export function FilterChips({
  items, active, onToggle, scroll, label,
}: {
  items: Array<{ key: string; label: string; count?: number }>
  active: string | null
  onToggle: (key: string | null) => void
  scroll?: boolean
  label?: string
}) {
  return (
    <div className={`chips${scroll ? ' scroll' : ''}`} role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.key}
          className={`chip${active === it.key ? ' active' : ''}`}
          aria-pressed={active === it.key}
          onClick={() => onToggle(active === it.key ? null : it.key)}
        >
          {it.label}
          {it.count != null && <span className="num">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}
