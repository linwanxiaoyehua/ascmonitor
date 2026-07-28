// 设置 · 构建监控：ASC Webhook 注册 + 各 App 当前构建/审核状态
// 状态文案与配色由后端给出（lib/build-status.ts 是唯一事实源），这里只负责排版
//
// 列表分两层，避免设置主页被状态行淹没：
//   /settings/builds          每个 App 只摘要两条 —— 最新构建动态 + 最新上架审核动态
//   /settings/builds/:appId   该 App 的全部状态记录

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
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

/** 摘要只看这两类：构建流水线（上传→处理→TestFlight）与上架审核各取最新一条 */
const BUILD_SCOPES: Array<BuildStatus['scope']> = ['upload', 'build', 'testflight']

/** 构建号只在有版本号时用括号附注；否则单独成词，避免显示成孤零零的「(128)」 */
function versionText(s: BuildStatus): string {
  if (s.version) return [s.version, s.build_number && `(${s.build_number})`].filter(Boolean).join(' ')
  return s.build_number ? `构建 ${s.build_number}` : ''
}

interface AppGroup {
  appId: number
  name: string
  icon: string | null
  rows: BuildStatus[]
  /** 最新构建流水线动态 / 最新上架审核动态，可能缺席 */
  build?: BuildStatus
  review?: BuildStatus
  updatedAt: number
}

/** 后端已按 updated_at DESC 返回，故每组内首个命中即最新 */
function groupByApp(rows: BuildStatus[]): AppGroup[] {
  const groups = new Map<number, AppGroup>()
  for (const r of rows) {
    let g = groups.get(r.app_id)
    if (!g) {
      g = { appId: r.app_id, name: r.app_name ?? `App ${r.app_id}`, icon: r.app_icon, rows: [], updatedAt: r.updated_at }
      groups.set(r.app_id, g)
    }
    g.rows.push(r)
    g.updatedAt = Math.max(g.updatedAt, r.updated_at)
    if (r.scope === 'appstore') g.review ??= r
    else if (BUILD_SCOPES.includes(r.scope)) g.build ??= r
  }
  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 单条状态行；sub 表示它是 App 分组下的次级行（缩进 + 小图标） */
function StatusRow({ s, sub, onPress }: { s: BuildStatus; sub?: boolean; onPress?: () => void }) {
  const meta = SCOPE_META[s.scope] ?? { label: s.scope, icon: 'layers' as IconName }
  return (
    <ListRow
      className={sub ? 'lrow-sub' : undefined}
      leading={
        <span className={`row-icon${sub ? ' sm' : ''} tone-${s.tone}`}>
          <Icon name={meta.icon} size={sub ? 12 : 16} />
        </span>
      }
      title={meta.label}
      badges={<Badge tone={s.tone}>{s.label}</Badge>}
      detail={versionText(s) || undefined}
      time={s.updated_at}
      onPress={onPress}
    />
  )
}

/** 该类动态还没有记录时的占位行，保持每个 App 恒为两行、不跳版 */
function MissingRow({ scope }: { scope: BuildStatus['scope'] }) {
  const meta = SCOPE_META[scope]
  return (
    <ListRow
      className="lrow-sub"
      leading={<span className="row-icon sm"><Icon name={meta.icon} size={12} /></span>}
      title={<span className="muted">{meta.label}</span>}
      detail="暂无记录"
    />
  )
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

/** 摘要视图：每个 App 一张卡 —— App 行 + 最新构建 + 最新上架审核，详情点进二级页 */
function StatusSummary() {
  const [, navigate] = useLocation()
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

  const groups = groupByApp(data)
  return (
    <div className="build-groups">
      {groups.map((g) => {
        const open = () => navigate(`/settings/builds/${g.appId}`)
        return (
          <div className="list" key={g.appId}>
            <ListRow
              leading={<AppIcon url={g.icon} name={g.name} size={32} />}
              title={g.name}
              detail={`共 ${g.rows.length} 条状态记录`}
              trailing="chevron"
              onPress={open}
            />
            {g.build ? <StatusRow s={g.build} sub onPress={open} /> : <MissingRow scope="build" />}
            {g.review ? <StatusRow s={g.review} sub onPress={open} /> : <MissingRow scope="appstore" />}
          </div>
        )
      })}
    </div>
  )
}

/** 二级页：单个 App 的全部构建 / 审核状态 */
function BuildAppPage({ appId }: { appId: number }) {
  const { data, isPending } = useQuery({
    queryKey: ['build-status', appId],
    queryFn: () => api<BuildStatus[]>(`/api/build-status?app_id=${appId}`),
  })

  const name = data?.find((r) => r.app_name)?.app_name ?? '构建状态'
  const icon = data?.find((r) => r.app_icon)?.app_icon ?? null

  return (
    <SubPage title={name} backTo="/settings/builds" backLabel="返回构建监控">
      {isPending ? (
        <Skeleton variant="rows" count={5} />
      ) : !data?.length ? (
        <EmptyState icon="layers" title="该 App 还没有构建状态" hint="注册 Webhook 后，状态变化会实时同步" />
      ) : (
        <>
          <div className="app-head">
            <AppIcon url={icon} name={name} size={44} />
            <div>
              <div className="t-title">{name}</div>
              <div className="muted t-detail">共 {data.length} 条状态记录</div>
            </div>
          </div>
          <Section title="全部状态" count={data.length}>
            <div className="list">
              {data.map((s) => (
                <StatusRow key={`${s.scope}:${s.entity_id}`} s={s} />
              ))}
            </div>
          </Section>
        </>
      )}
    </SubPage>
  )
}

export function BuildsSection({ embedded = false, appId }: { embedded?: boolean; appId?: number } = {}) {
  if (appId != null && Number.isFinite(appId)) return <BuildAppPage appId={appId} />

  const inner = (
    <>
      <Section title="当前状态">
        <StatusSummary />
      </Section>

      <Section title="实时推送">
        <WebhookRows />
      </Section>
      <p className="muted hint">
        注册后 App Store Connect 会在构建上传、TestFlight 审核、上架审核状态变化时实时回调；
        每日还会拉取一次真实状态对账，防止漏投。每个 App 单独注册，Apple 侧上限 10 个。
      </p>
    </>
  )
  return embedded ? inner : <SubPage title="构建监控" backTo="/settings" backLabel="返回设置">{inner}</SubPage>
}
