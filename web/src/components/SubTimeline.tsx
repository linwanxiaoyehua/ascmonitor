// 一条订阅 / 一次性购买的完整历史：首次订阅 → 每次续费 → 升降级 → 退款 → 过期…
// 数据来自 /api/subscriptions/:otid/timeline（以原始通知为主线，含不产生交易的状态事件）
// 动态流点开与「收入 · 明细」的订阅行共用

import { useQuery } from '@tanstack/react-query'
import { api, type TimelineRow } from '../lib/api'
import { eventMeta } from '../lib/event-meta'
import { changeText, countryDisplay, productDisplay, timeAgo } from '../lib/format'
import { fmtMoney } from '../lib/money'

/** 金额显示为负：退款 / 撤销，以及已被退掉的那笔交易 */
const NEGATIVE_TYPES = new Set(['REFUND', 'REVOKE'])

export function SubTimeline({ otid, bundleId }: { otid: string; bundleId?: string | null }) {
  const { data: rows, isPending } = useQuery({
    queryKey: ['sub-timeline', otid],
    queryFn: () => api<TimelineRow[]>(`/api/subscriptions/${otid}/timeline`),
  })

  if (isPending) return <div className="skeleton h-timeline" />
  if (!rows?.length) return <div className="muted timeline">暂无历史记录</div>

  return (
    <div className="timeline">
      {rows.map((t) => {
        const meta = eventMeta(t.type, t.subtype)
        const neg = NEGATIVE_TYPES.has(t.type)
        // 换购说明「旧 → 新」；其余事件说明所属套餐 —— 一条订阅可能换过好几个产品，
        // 不写产品的话就分不清哪次续费是哪个套餐
        const product = t.productChange
          ? changeText(t.productChange, bundleId)
          : t.productName ?? productDisplay(t.productId, bundleId)
        const renewal =
          t.productChange?.renewalPriceMilli != null && t.productChange.renewalPriceMilli > 0
            ? `下期 ${fmtMoney(t.productChange.renewalPriceMilli, t.productChange.renewalCurrency)}`
            : null
        const sub = [product, renewal, countryDisplay(t.country)].filter(Boolean).join(' · ')
        const amount = t.priceMilli != null && (t.priceMilli > 0 || t.isTrial) ? fmtMoney(t.priceMilli, t.currency) : ''

        return (
          <div className="timeline-item" key={t.id}>
            <span className={`timeline-dot tone-${neg ? 'danger' : meta.tone}`} />
            <div className="timeline-body">
              <div className="timeline-head">
                <span className="timeline-label">{meta.label}</span>
                {meta.note && <span className="timeline-note">{meta.note}</span>}
                {t.isTrial && <span className="timeline-note">试用</span>}
                {t.refunded && !neg && <span className="timeline-note neg">已退款</span>}
                {amount && (
                  <span className={`timeline-amount num${neg ? ' neg' : ''}`}>
                    {neg ? '−' : ''}{amount}
                  </span>
                )}
              </div>
              <div className="timeline-sub">
                {sub && <span className="timeline-what">{sub}</span>}
                <span className="timeline-time">{timeAgo(t.ts)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
