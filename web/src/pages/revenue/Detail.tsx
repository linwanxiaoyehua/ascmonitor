// 收入 · 明细：审计（对账卡）+ 交易流水（订阅状态分组 ⇄ 一次性购买）
// 单笔金额恒为原币客户价（事实记录，不随全局口径换算）

import { useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  api, type PurchaseRow, type Reconciliation, type SubRow, type TimelineRow,
} from '../../lib/api'
import { useAppFilter, withAppParam } from '../../lib/app-filter'
import { fmtMoney, fmtUsd } from '../../lib/money'
import {
  appLabelOf, countryDisplay, countryFlag, countryName, expiresDisplay, periodLabel, productDisplay, subtypeLabel, timeAgo,
} from '../../lib/format'
import { AppIcon } from '../../components/AppIcon'
import { Icon } from '../../components/Icon'
import {
  Badge, type BadgeTone, CaliberTag, EmptyState, ListRow, LoadMore, Section, SegmentedControl, Skeleton,
} from '../../components/ui'

const STATUS_LABELS: Record<string, string> = {
  trial: '试用中',
  active: '活跃',
  grace_period: '宽限期',
  billing_retry: '扣款重试',
  expired: '已过期',
  revoked: '已退订',
}

const TIMELINE_LABELS: Record<string, string> = {
  SUBSCRIBED: '订阅',
  DID_RENEW: '续费',
  ONE_TIME_CHARGE: '购买',
  REFUND: '退款',
  DID_CHANGE_RENEWAL_STATUS: '续费状态变更',
  DID_CHANGE_RENEWAL_PREF: '升降级',
  DID_FAIL_TO_RENEW: '扣款失败',
  EXPIRED: '过期',
}

const PURCHASE_TYPES: Record<string, string> = {
  Consumable: '消耗型',
  'Non-Consumable': '买断',
  'Non-Renewing Subscription': '非续订订阅',
}

/** 订阅健康与对账（审计型置顶；无账单数据自动隐藏） */
function ReconciliationCard() {
  const appId = useAppFilter()
  const { data } = useQuery({
    queryKey: ['reconciliation', appId],
    queryFn: () => api<Reconciliation>(withAppParam('/api/revenue/reconciliation?days=30', appId)),
  })

  if (!data || data.summary.actualUsdMilli <= 0) return null
  const s = data.summary
  return (
    <Section title="对账（30 天）">
      <div className="panel pad">
        <div className="vstack tight">
          <div className="recon-row">
            <span className="k">事件收入（客户价）<CaliberTag>实时</CaliberTag></span>
            <span className="num">{fmtUsd(s.eventsUsdMilli)}</span>
          </div>
          <div className="recon-row">
            <span className="k">估算净得（× {Math.round(s.proceedsRate * 100)}%）<CaliberTag>估算</CaliberTag></span>
            <span className="num">{fmtUsd(s.estimatedUsdMilli)}</span>
          </div>
          <div className="recon-row">
            <span className="k">账单实际净得 <CaliberTag>账单 · T+1</CaliberTag></span>
            <span className="num">{fmtUsd(s.actualUsdMilli)}</span>
          </div>
          {s.diffPct != null && (
            <div className="recon-row total">
              <span className="k">估算偏差（费率 / 汇率 / 到账时差）</span>
              <span className={`num ${Math.abs(s.diffPct) > 15 ? 'neg' : 'muted'}`}>
                {s.diffPct > 0 ? '+' : ''}{s.diffPct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

function Timeline({ otid }: { otid: string }) {
  const { data: rows, isPending } = useQuery({
    queryKey: ['sub-timeline', otid],
    queryFn: () => api<TimelineRow[]>(`/api/subscriptions/${otid}/timeline`),
  })

  if (isPending) return <div className="skeleton h-timeline" />
  if (!rows?.length) return <div className="muted timeline">暂无交易记录</div>
  return (
    <div className="timeline">
      {rows.map((t) => {
        const type = t.notification_type ?? t.event_type
        const label = TIMELINE_LABELS[type] ?? type
        const sub = subtypeLabel(t.subtype)
        return (
          <div className="timeline-item" key={t.transaction_id + type}>
            <span className={`timeline-dot${t.refunded || type === 'REFUND' ? ' neg' : ''}`} />
            <span className="timeline-label">
              {label}
              {sub && <span className="muted"> · {sub}</span>}
            </span>
            <span className="timeline-amount num">{fmtMoney(t.price_milli, t.currency)}</span>
            <span className="timeline-time">{timeAgo(t.purchase_date ?? t.received_at ?? 0)}</span>
          </div>
        )
      })}
    </div>
  )
}

const STATUS_TONE: Record<string, BadgeTone> = {
  trial: 'info', active: 'success', grace_period: 'warning', billing_retry: 'warning',
  expired: 'neutral', revoked: 'neutral',
}

const STATUS_BUCKETS = [
  { key: 'active', label: '活跃', statuses: ['active', 'grace_period', 'billing_retry'] },
  { key: 'trial', label: '试用', statuses: ['trial'] },
  { key: 'expired', label: '过期', statuses: ['expired', 'revoked'] },
]

function SubsList() {
  const appId = useAppFilter()
  // 四级折叠：状态 → 产品(订阅ID) → 国家 → 具体订阅；状态默认展开，产品/国家默认折叠
  const [openStatus, setOpenStatus] = useState<Set<string>>(new Set(['active', 'trial', 'expired']))
  const [openProduct, setOpenProduct] = useState<Set<string>>(new Set())
  const [openCountry, setOpenCountry] = useState<Set<string>>(new Set())
  const [openTimeline, setOpenTimeline] = useState<string | null>(null)
  const { data: subs, isPending } = useQuery({
    queryKey: ['subscriptions', appId],
    queryFn: () => api<SubRow[]>(withAppParam('/api/subscriptions', appId)),
  })

  if (isPending) return <Skeleton variant="rows" count={4} />
  if (!subs?.length) {
    return <EmptyState icon="users" title="还没有订阅记录" hint="收到 App Store 订阅通知后会自动出现在这里" />
  }

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const renderRow = (s: SubRow) => {
    const open = openTimeline === s.original_transaction_id
    const detail = [
      periodLabel(s.period),
      s.status === 'expired' || s.status === 'revoked' ? '' : expiresDisplay(s.expires_at),
    ].filter(Boolean).join(' · ')
    return (
      <div key={s.original_transaction_id}>
        <ListRow
          title={
            <>
              {s.product_name ?? productDisplay(s.product_id, s.app_bundle_id)}
              <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_LABELS[s.status] ?? s.status}</Badge>
              {!s.auto_renew && (s.status === 'active' || s.status === 'trial') && (
                <Badge tone="warning">已关续费</Badge>
              )}
            </>
          }
          detail={detail || undefined}
          amount={{ milli: s.price_milli, currency: s.currency }}
          time={s.updated_at}
          trailing="chevron"
          chevronOpen={open}
          onPress={() => setOpenTimeline(open ? null : s.original_transaction_id)}
        />
        {open && <Timeline otid={s.original_transaction_id} />}
      </div>
    )
  }

  // 产品(订阅ID) → 国家 → 具体订阅；prefix=状态桶 key，避免同一产品跨状态桶时 key 冲突
  const productTree = (items: SubRow[], prefix: string) => {
    const byProduct = new Map<string, { label: string; icon: string | null; app: string; rows: SubRow[] }>()
    for (const s of items) {
      const key = `${s.app_bundle_id ?? ''}|${s.product_id}`
      const g = byProduct.get(key)
      if (g) g.rows.push(s)
      else
        byProduct.set(key, {
          label: s.product_name ?? productDisplay(s.product_id, s.app_bundle_id) ?? s.product_id,
          icon: s.app_icon,
          app: appLabelOf(s.app_name, s.app_bundle_id),
          rows: [s],
        })
    }
    const products = [...byProduct.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)

    return products.map(([pid, g]) => {
      const pKey = `${prefix}|${pid}`
      const pOpen = openProduct.has(pKey)
      // 按国家分组
      const byCountry = new Map<string, SubRow[]>()
      for (const s of g.rows) {
        const c = s.country ?? '—'
        const arr = byCountry.get(c)
        if (arr) arr.push(s)
        else byCountry.set(c, [s])
      }
      const countries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length)
      return (
        <div className="tree-node" key={pKey}>
          <button className={`tree-head lvl1${pOpen ? ' open' : ''}`} aria-expanded={pOpen} onClick={() => toggle(setOpenProduct, pKey)}>
            <Icon name="chevronRight" size={16} className="tree-chev" />
            <AppIcon url={g.icon} name={g.app || g.label} size={26} />
            <span className="th-label">{g.label}</span>
            <span className="th-count num">{g.rows.length}</span>
          </button>
          {pOpen && (
            <div className="tree-children">
              {countries.map(([country, crows]) => {
                const cKey = `${pKey}|${country}`
                const cOpen = openCountry.has(cKey)
                return (
                  <div className="tree-node" key={cKey}>
                    <button className={`tree-head lvl2${cOpen ? ' open' : ''}`} aria-expanded={cOpen} onClick={() => toggle(setOpenCountry, cKey)}>
                      <Icon name="chevronRight" size={15} className="tree-chev" />
                      <span className="th-label">{countryFlag(country)} {countryName(country) || countryDisplay(country) || country}</span>
                      <span className="th-count num">{crows.length}</span>
                    </button>
                    {cOpen && <div className="list tree-leaf">{crows.map(renderRow)}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="sub-tree">
      {STATUS_BUCKETS.map((bucket) => {
        const items = subs.filter((s) => bucket.statuses.includes(s.status))
        if (!items.length) return null
        const sOpen = openStatus.has(bucket.key)
        return (
          <div className="tree-node" key={bucket.key}>
            <button className={`tree-head lvl0${sOpen ? ' open' : ''}`} aria-expanded={sOpen} onClick={() => toggle(setOpenStatus, bucket.key)}>
              <Icon name="chevronRight" size={16} className="tree-chev" />
              <span className="th-label">{bucket.label}</span>
              <span className="th-count num">{items.length}</span>
            </button>
            {sOpen && <div className="tree-children">{productTree(items, bucket.key)}</div>}
          </div>
        )
      })}
    </div>
  )
}

function PurchasesList() {
  const appId = useAppFilter()
  // 四级折叠：类型(消耗型/买断/非续订) → 产品 → 国家 → 购买（对齐订阅树）
  const [openType, setOpenType] = useState<Set<string>>(new Set(['Non-Consumable', 'Consumable', 'Non-Renewing Subscription']))
  const [openProduct, setOpenProduct] = useState<Set<string>>(new Set())
  const [openCountry, setOpenCountry] = useState<Set<string>>(new Set())
  const q = useInfiniteQuery({
    queryKey: ['purchases', appId],
    queryFn: ({ pageParam }) =>
      api<{ purchases: PurchaseRow[]; nextBefore: number | null }>(
        withAppParam(`/api/purchases${pageParam ? `?before=${pageParam}` : ''}`, appId)
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore,
  })

  const purchases = q.data?.pages.flatMap((p) => p.purchases) ?? []

  if (q.isPending) return <Skeleton variant="rows" count={3} />
  if (!purchases.length) {
    return <EmptyState icon="creditCard" title="还没有一次性购买" hint="买断、消耗型内购的付费记录会出现在这里" />
  }

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const renderRow = (p: PurchaseRow) => (
    <ListRow
      key={p.transaction_id}
      title={
        <>
          {p.product_name ?? productDisplay(p.product_id, p.app_bundle_id)}
          {p.refunded && <Badge tone="danger">已退款</Badge>}
        </>
      }
      amount={{ milli: p.price_milli, currency: p.currency, sign: p.refunded ? 'neg' : 'pos' }}
      time={p.purchase_date ?? 0}
    />
  )

  // 产品→国家 子树（复用到每个类型桶下）
  const productTree = (items: PurchaseRow[], prefix: string) => {
    const byProduct = new Map<string, { label: string; icon: string | null; app: string; rows: PurchaseRow[] }>()
    for (const p of items) {
      const key = `${prefix}|${p.app_bundle_id ?? ''}|${p.product_id}`
      const g = byProduct.get(key)
      if (g) g.rows.push(p)
      else
        byProduct.set(key, {
          label: p.product_name ?? productDisplay(p.product_id, p.app_bundle_id) ?? p.product_id,
          icon: p.app_icon,
          app: appLabelOf(p.app_name, p.app_bundle_id),
          rows: [p],
        })
    }
    return [...byProduct.entries()]
      .sort((a, b) => b[1].rows.length - a[1].rows.length)
      .map(([pKey, g]) => {
        const pOpen = openProduct.has(pKey)
        const byCountry = new Map<string, PurchaseRow[]>()
        for (const p of g.rows) {
          const c = p.country ?? '—'
          const arr = byCountry.get(c)
          if (arr) arr.push(p)
          else byCountry.set(c, [p])
        }
        const countries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length)
        return (
          <div className="tree-node" key={pKey}>
            <button className={`tree-head lvl1${pOpen ? ' open' : ''}`} aria-expanded={pOpen} onClick={() => toggle(setOpenProduct, pKey)}>
              <Icon name="chevronRight" size={16} className="tree-chev" />
              <AppIcon url={g.icon} name={g.app || g.label} size={26} />
              <span className="th-label">{g.label}</span>
              <span className="th-count num">{g.rows.length}</span>
            </button>
            {pOpen && (
              <div className="tree-children">
                {countries.map(([country, crows]) => {
                  const cKey = `${pKey}|${country}`
                  const cOpen = openCountry.has(cKey)
                  return (
                    <div className="tree-node" key={cKey}>
                      <button className={`tree-head lvl2${cOpen ? ' open' : ''}`} aria-expanded={cOpen} onClick={() => toggle(setOpenCountry, cKey)}>
                        <Icon name="chevronRight" size={15} className="tree-chev" />
                        <span className="th-label">{countryFlag(country)} {countryName(country) || countryDisplay(country) || country}</span>
                        <span className="th-count num">{crows.length}</span>
                      </button>
                      {cOpen && <div className="list tree-leaf">{crows.map(renderRow)}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })
  }

  // 一级：按内购类型
  const byType = new Map<string, PurchaseRow[]>()
  for (const p of purchases) {
    const arr = byType.get(p.type)
    if (arr) arr.push(p)
    else byType.set(p.type, [p])
  }
  const types = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)

  return (
    <>
      <div className="sub-tree">
        {types.map(([type, items]) => {
          const tOpen = openType.has(type)
          return (
            <div className="tree-node" key={type}>
              <button className={`tree-head lvl0${tOpen ? ' open' : ''}`} aria-expanded={tOpen} onClick={() => toggle(setOpenType, type)}>
                <Icon name="chevronRight" size={16} className="tree-chev" />
                <span className="th-label">{PURCHASE_TYPES[type] ?? type}</span>
                <span className="th-count num">{items.length}</span>
              </button>
              {tOpen && <div className="tree-children">{productTree(items, type)}</div>}
            </div>
          )
        })}
      </div>
      <LoadMore hasNextPage={!!q.hasNextPage} isFetchingNextPage={q.isFetchingNextPage} fetchNextPage={() => q.fetchNextPage()} />
    </>
  )
}

export function RevenueDetail() {
  const [segment, setSegment] = useState<'subs' | 'purchases'>('subs')

  return (
    <>
      <ReconciliationCard />

      <Section title="交易明细">
        <div className="mb-3">
          <SegmentedControl
            label="明细类型"
            options={[
              { value: 'subs', label: '订阅' },
              { value: 'purchases', label: '一次性购买' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </div>
        {segment === 'subs' ? <SubsList /> : <PurchasesList />}
      </Section>
    </>
  )
}
