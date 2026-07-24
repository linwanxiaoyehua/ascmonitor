// 收入 · 明细：审计（对账卡）+ 交易流水（订阅状态分组 ⇄ 一次性购买）
// 单笔金额恒为原币客户价（事实记录，不随全局口径换算）

import { useState } from 'react'
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
import {
  Badge, CaliberTag, EmptyState, ListRow, LoadMore, Section, SegmentedControl, Skeleton,
} from '../../components/ui'

const STATUS_GROUPS: Array<{ title: string; statuses: string[] }> = [
  { title: '试用中', statuses: ['trial'] },
  { title: '活跃订阅', statuses: ['active'] },
  { title: '流失风险', statuses: ['grace_period', 'billing_retry'] },
  { title: '已流失', statuses: ['expired', 'revoked'] },
]

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

function SubsList() {
  const appId = useAppFilter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data: subs, isPending } = useQuery({
    queryKey: ['subscriptions', appId],
    queryFn: () => api<SubRow[]>(withAppParam('/api/subscriptions', appId)),
  })

  if (isPending) return <Skeleton variant="rows" count={4} />
  if (!subs?.length) {
    return <EmptyState icon="users" title="还没有订阅记录" hint="收到 App Store 订阅通知后会自动出现在这里" />
  }

  const renderRow = (s: SubRow) => {
    const open = expanded === s.original_transaction_id
    const appLabel = appLabelOf(s.app_name, s.app_bundle_id)
    // 已按国家分组时，行内 detail 不再重复国家
    const detail = [
      appLabel,
      s.status === 'expired' || s.status === 'revoked' ? STATUS_LABELS[s.status] : expiresDisplay(s.expires_at),
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div key={s.original_transaction_id}>
        <ListRow
          leading={<AppIcon url={s.app_icon} name={appLabel || s.product_id} size={32} />}
          title={
            <>
              {s.product_name ?? productDisplay(s.product_id, s.app_bundle_id)}
              {periodLabel(s.period) && <span className="muted">{periodLabel(s.period)}</span>}
            </>
          }
          badges={
            <>
              {(s.status === 'grace_period' || s.status === 'billing_retry') && (
                <Badge tone="warning">{STATUS_LABELS[s.status]}</Badge>
              )}
              {!s.auto_renew && (s.status === 'active' || s.status === 'trial') && (
                <Badge tone="warning">已关续费</Badge>
              )}
            </>
          }
          detail={detail}
          amount={{ milli: s.price_milli, currency: s.currency }}
          time={s.updated_at}
          trailing="chevron"
          chevronOpen={open}
          onPress={() => setExpanded(open ? null : s.original_transaction_id)}
        />
        {open && <Timeline otid={s.original_transaction_id} />}
      </div>
    )
  }

  return (
    <>
      {STATUS_GROUPS.map((group) => {
        const items = subs.filter((s) => group.statuses.includes(s.status))
        if (!items.length) return null
        // 组内 ≥2 个国家时二级按国家分组（避免「长一串」）；单一国家保持平铺
        const byCountry = new Map<string, SubRow[]>()
        for (const s of items) {
          const c = s.country ?? '—'
          const arr = byCountry.get(c)
          if (arr) arr.push(s)
          else byCountry.set(c, [s])
        }
        const grouped = byCountry.size >= 2
        const countries = [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length)
        return (
          <div key={group.title}>
            <div className="group-label">
              {group.title}
              <span className="count">{items.length}</span>
              {grouped && <span className="count">{byCountry.size} 个地区</span>}
            </div>
            {grouped ? (
              countries.map(([country, rows]) => (
                <div className="sub-country" key={country}>
                  <div className="subgroup-head">
                    <span>{countryFlag(country)} {countryName(country) || countryDisplay(country) || country}</span>
                    <span className="sg-count num">{rows.length}</span>
                  </div>
                  <div className="list">{rows.map(renderRow)}</div>
                </div>
              ))
            ) : (
              <div className="list">{items.map(renderRow)}</div>
            )}
          </div>
        )
      })}
    </>
  )
}

function PurchasesList() {
  const appId = useAppFilter()
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

  return (
    <>
      <div className="list">
        {purchases.map((p) => {
          const appLabel = appLabelOf(p.app_name, p.app_bundle_id)
          const detail = [appLabel, PURCHASE_TYPES[p.type] ?? p.type, countryDisplay(p.country)].filter(Boolean).join(' · ')
          return (
            <ListRow
              key={p.transaction_id}
              leading={<AppIcon url={p.app_icon} name={appLabel || p.product_id} size={32} />}
              title={p.product_name ?? productDisplay(p.product_id, p.app_bundle_id)}
              badges={p.refunded ? <Badge tone="danger">已退款</Badge> : undefined}
              detail={detail}
              amount={{ milli: p.price_milli, currency: p.currency, sign: p.refunded ? 'neg' : 'pos' }}
              time={p.purchase_date ?? 0}
            />
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
