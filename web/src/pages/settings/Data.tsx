// 设置 · 数据运维：数据健康 + 重建订阅状态 + 手动抓取

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DataHealth } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { toast } from '../../lib/toast'
import { Icon } from '../../components/Icon'
import { ListRow, Section, Skeleton } from '../../components/ui'
import { SubPage } from '../../components/SubPage'

function HealthSection() {
  const queryClient = useQueryClient()
  const { data: health } = useQuery({
    queryKey: ['data-health'],
    queryFn: () => api<DataHealth>('/api/health/data'),
  })
  const [rebuilding, setRebuilding] = useState<string | null>(null)

  // 循环调用 reprocess 直到 done（每批 ~200 条，断点续跑）
  const rebuild = async () => {
    if (rebuilding) return
    setRebuilding('启动中…')
    try {
      let total = 0
      for (let i = 0; i < 500; i++) {
        const res = await api<{ processed: number; done: boolean; remaining: number }>(
          `/api/jobs/reprocess${i === 0 && !health?.reprocessInProgress ? '?reset=1' : ''}`,
          { method: 'POST' }
        )
        total += res.processed
        if (res.done) break
        setRebuilding(`已回放 ${total} 条，剩余约 ${res.remaining} 条…`)
      }
      // reprocess 只重建交易/订阅，不碰 metrics_daily —— 顺带重算每日指标（曲线/当月收入）
      let days = 0
      for (let i = 0; i < 500; i++) {
        const res = await api<{ processed: number; done: boolean; remaining: number }>(
          `/api/jobs/rollup-metrics${i === 0 ? '?reset=1' : ''}`,
          { method: 'POST' }
        )
        days += res.processed
        if (res.done) break
        setRebuilding(`重算每日指标… 已 ${days} 天`)
      }
      toast.success(`重建完成，回放 ${total} 条通知，重算 ${days} 天指标`)
      queryClient.invalidateQueries()
    } catch {
      toast.error('重建中断，可再次点击续跑')
    } finally {
      setRebuilding(null)
    }
  }

  if (!health) return <Skeleton variant="rows" count={3} />

  return (
    <>
      <div className="list">
        <ListRow
          leading={<span className={`row-icon ${health.fxUpdatedAt ? 'tone-success' : ''}`}><Icon name="dollar" size={16} /></span>}
          title="汇率"
          detail={
            health.fxUpdatedAt
              ? `自动更新于 ${timeAgo(health.fxUpdatedAt)} · ${health.fxAutoCount} 币种`
              : '未自动更新（每日 UTC 1:00 拉取，当前用内置汇率表）'
          }
        />
        {health.unconverted.length > 0 && (
          <ListRow
            leading={<span className="row-icon tone-warning"><Icon name="alertTriangle" size={16} /></span>}
            title="未折算币种"
            detail={`${health.unconverted.map((u) => `${u.currency}×${u.count}`).join('、')} —— 这些交易未计入 USD 汇总`}
          />
        )}
        {health.duplicateReviews > 0 && (
          <ListRow
            leading={<span className="row-icon"><Icon name="message" size={16} /></span>}
            title="评论去重"
            detail={`已识别 ${health.duplicateReviews} 条 ASC/RSS 双源重复评论（统计与列表已排除）`}
          />
        )}
      </div>
      <div className="list mt-3">
        <ListRow
          leading={<span className="row-icon tone-accent"><Icon name="refresh" size={16} /></span>}
          title={rebuilding ?? (health.reprocessInProgress ? '继续重建订阅状态' : '重建订阅状态')}
          detail="回放全部历史通知，补齐升降级 / 试用漏斗 / 退款撤销等新字段"
          trailing="chevron"
          onPress={rebuild}
        />
      </div>
    </>
  )
}

export function DataSection({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState<string | null>(null)

  // 从 ASC 回填近 180 天历史通知 → 串联 reprocess 重建交易/订阅状态
  const backfill = async () => {
    if (backfilling || running) return
    setBackfilling('启动中…')
    try {
      let inserted = 0
      for (let i = 0; i < 500; i++) {
        const res = await api<{ inserted: number; hasMore: boolean; skipped: string }>(
          `/api/jobs/backfill-notifications${i === 0 ? '?reset=1' : ''}`,
          { method: 'POST' }
        )
        if (res.skipped) {
          toast.error(res.skipped)
          return
        }
        inserted += res.inserted
        if (!res.hasMore) break
        setBackfilling(`已回填 ${inserted} 条历史通知…`)
      }
      // 串联重建：回放全部历史通知重建交易/订阅状态
      let total = 0
      for (let i = 0; i < 500; i++) {
        const res = await api<{ processed: number; done: boolean; remaining: number }>(
          `/api/jobs/reprocess${i === 0 ? '?reset=1' : ''}`,
          { method: 'POST' }
        )
        total += res.processed
        if (res.done) break
        setBackfilling(`回填 ${inserted} 条，重建中已回放 ${total} 条…`)
      }
      // 重算历史每日指标（曲线 / 当月收入），否则趋势不更新
      let days = 0
      for (let i = 0; i < 500; i++) {
        const res = await api<{ processed: number; done: boolean; remaining: number }>(
          `/api/jobs/rollup-metrics${i === 0 ? '?reset=1' : ''}`,
          { method: 'POST' }
        )
        days += res.processed
        if (res.done) break
        setBackfilling(`重算每日指标… 已 ${days} 天`)
      }
      toast.success(`回填完成：新增 ${inserted} 条历史通知，重建 ${total} 条，重算 ${days} 天指标`)
      queryClient.invalidateQueries()
    } catch {
      toast.error('回填中断，可再次点击续跑')
    } finally {
      setBackfilling(null)
    }
  }

  const run = async (kind: 'reviews' | 'sales' | 'products') => {
    if (running) return
    setRunning(kind)
    try {
      if (kind === 'reviews') {
        const res = await api<{ totalReviews: number }>('/api/jobs/fetch-reviews', { method: 'POST' })
        toast.success(`完成，当前共 ${res.totalReviews} 条评论`)
      } else if (kind === 'products') {
        const res = await api<{ totalProducts: number; skipped: string }>('/api/jobs/fetch-products', { method: 'POST' })
        if (res.skipped) toast.error(res.skipped)
        else toast.success(`完成，产品目录共 ${res.totalProducts} 条`)
      } else {
        const res = await api<{ fetched: number; totalDays: number; skipped: string }>('/api/jobs/fetch-sales', { method: 'POST' })
        if (res.skipped) toast.error(res.skipped)
        else toast.success(`完成，拉取 ${res.fetched} 份报告，已覆盖 ${res.totalDays} 天`)
      }
    } catch {
      toast.error('抓取失败')
    } finally {
      setRunning(null)
    }
  }

  const inner = (
    <>
      <Section title="数据健康">
        <HealthSection />
      </Section>
      <Section title="手动抓取">
        <div className="list">
          <ListRow
            leading={<span className="row-icon tone-accent"><Icon name="refresh" size={16} /></span>}
            title={running === 'reviews' ? '抓取中…' : '立即抓取评论评分'}
            detail="平时每 15 分钟自动抓取；新加 App 后可手动回填"
            trailing="chevron"
            onPress={() => run('reviews')}
          />
          <ListRow
            leading={<span className="row-icon tone-success"><Icon name="download" size={16} /></span>}
            title={running === 'sales' ? '抓取中…' : '立即抓取账单数据'}
            detail="销售报告回填 30 天；之后每日自动更新（需 Vendor Number）"
            trailing="chevron"
            onPress={() => run('sales')}
          />
          <ListRow
            leading={<span className="row-icon tone-info"><Icon name="layers" size={16} /></span>}
            title={running === 'products' ? '同步中…' : '同步产品名称'}
            detail="从 ASC 拉取内购/订阅名称，展示层替代 product id（每日自动同步）"
            trailing="chevron"
            onPress={() => run('products')}
          />
          <ListRow
            leading={<span className="row-icon tone-info"><Icon name="download" size={16} /></span>}
            title={backfilling ?? '回填历史订阅/内购（近 180 天）'}
            detail="从 App Store Connect 拉取近 180 天历史通知补全订阅/交易（需 ASC 凭证；失败可能需 In-App Purchase 密钥）"
            trailing="chevron"
            onPress={backfill}
          />
        </div>
      </Section>
    </>
  )
  return embedded ? inner : <SubPage title="数据运维" backTo="/settings" backLabel="返回设置">{inner}</SubPage>
}
