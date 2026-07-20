// 设置 · 构建监控：ASC Webhook 注册 + 各 App 当前构建/审核状态
// 状态文案与配色由后端给出（lib/build-status.ts 是唯一事实源），这里只负责排版

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type BuildStatus, type WebhookConfig } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import { toast } from '../../lib/toast'
import { AppIcon } from '../../components/AppIcon'
import { Icon, type IconName } from '../../components/Icon'
import { SubPage } from '../../components/SubPage'
import { Badge, EmptyState, ListRow, Section, Skeleton } from '../../components/ui'

const SCOPE_META: Record<BuildStatus['scope'], { label: string; icon: IconName }> = {
  upload: { label: '构建上传', icon: 'send' },
  build: { label: '构建处理', icon: 'layers' },
  testflight: { label: 'TestFlight', icon: 'flask' },
  appstore: { label: '上架审核', icon: 'star' },
}

function WebhookRows() {
  const queryClient = useQueryClient()
  const { data: hooks, isPending } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api<WebhookConfig[]>('/api/webhooks'),
  })

  const register = useMutation({
    mutationFn: (appId: number) => api(`/api/webhooks/${appId}`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('已在 App Store Connect 注册 Webhook')
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
    onError: () => toast.error('注册失败，检查 ASC 凭证是否具备 Admin / App Manager 角色'),
  })

  const unregister = useMutation({
    mutationFn: (appId: number) => api(`/api/webhooks/${appId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('已注销')
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
  })

  if (isPending) return <Skeleton variant="rows" count={2} />
  if (!hooks?.length) {
    return <EmptyState icon="layers" title="还没有 App" hint="先在「App 管理」添加 App 并填写 Apple ID" />
  }

  const busy = register.isPending || unregister.isPending
  return (
    <div className="list">
      {hooks.map((h) => (
        <ListRow
          key={h.appId}
          leading={
            <span className={`row-icon tone-${h.registered ? 'success' : 'neutral'}`}>
              <Icon name={h.registered ? 'check' : 'bell'} size={16} />
            </span>
          }
          title={h.name}
          detail={
            !h.ascAppId
              ? '缺少 Apple ID，先到「App 管理」补全'
              : h.registered
                ? `已注册 · ${h.createdAt ? timeAgo(h.createdAt) : ''}`
                : '未注册，构建与审核状态不会实时推送'
          }
          trailing={
            h.ascAppId ? (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => (h.registered ? unregister.mutate(h.appId) : register.mutate(h.appId))}
              >
                {h.registered ? '注销' : '注册'}
              </button>
            ) : undefined
          }
        />
      ))}
    </div>
  )
}

function StatusRows() {
  const { data, isPending } = useQuery({
    queryKey: ['build-status'],
    queryFn: () => api<BuildStatus[]>('/api/build-status'),
  })

  if (isPending) return <Skeleton variant="rows" count={3} />
  if (!data?.length) {
    return (
      <EmptyState
        icon="layers"
        title="还没有构建状态"
        hint="注册 Webhook 后，状态变化会实时同步；也会在每日对账时补齐"
      />
    )
  }

  return (
    <div className="list">
      {data.map((s) => {
        const meta = SCOPE_META[s.scope] ?? { label: s.scope, icon: 'layers' as IconName }
        // label / tone 由后端算好（lib/build-status 单一事实源），BadgeTone 正好覆盖这五个值
        const version = [s.version, s.build_number && `(${s.build_number})`].filter(Boolean).join(' ')
        return (
          <ListRow
            key={`${s.scope}:${s.entity_id}`}
            leading={
              s.app_icon ? (
                <div className="icon-stack">
                  <AppIcon url={s.app_icon} name={s.app_name} size={32} />
                  <span className={`icon-badge tone-${s.tone}`}>
                    <Icon name={meta.icon} size={10} />
                  </span>
                </div>
              ) : (
                <span className={`row-icon tone-${s.tone}`}>
                  <Icon name={meta.icon} size={16} />
                </span>
              )
            }
            title={meta.label}
            badges={<Badge tone={s.tone}>{s.label}</Badge>}
            detail={[s.app_name, version].filter(Boolean).join(' · ')}
            time={s.updated_at}
          />
        )
      })}
    </div>
  )
}

export function BuildsSection() {
  return (
    <SubPage title="构建监控" backTo="/settings" backLabel="返回设置">
      <Section title="当前状态">
        <StatusRows />
      </Section>

      <Section title="实时推送">
        <WebhookRows />
      </Section>
      <p className="muted hint">
        注册后 App Store Connect 会在构建上传、TestFlight 审核、上架审核状态变化时实时回调；
        每日还会拉取一次真实状态对账，防止漏投。每个 App 单独注册，Apple 侧上限 10 个。
      </p>
    </SubPage>
  )
}
