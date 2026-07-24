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
      toast.success(`重建完成，共回放 ${total} 条通知`)
      queryClient.invalidateQueries()
    } catch {
      toast.error('重建中断，可再次点击续跑')
    } finally {
      setRebuilding(null)
    }
  }

  if (!health) return <Skeleton variant="rows" count={3} />

  const webhookAge = health.lastWebhookAt ? Date.now() - health.lastWebhookAt : null
  const webhookTone = webhookAge == null ? 'neutral' : webhookAge < 3600_000 ? 'success' : webhookAge < 86400_000 ? 'warning' : 'danger'

  return (
    <>
      <div className="list">
        <ListRow
          leading={<span className={`row-icon tone-${webhookTone === 'neutral' ? 'info' : webhookTone}`}><Icon name="zap" size={16} /></span>}
          title="Webhook 管道"
          detail={health.lastWebhookAt ? `最近事件 ${timeAgo(health.lastWebhookAt)} · 共 ${health.rawNotifications} 条通知` : '还没有收到过通知'}
        />
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
  const [running, setRunning] = useState<string | null>(null)

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
        </div>
      </Section>
    </>
  )
  return embedded ? inner : <SubPage title="数据运维" backTo="/settings" backLabel="返回设置">{inner}</SubPage>
}
