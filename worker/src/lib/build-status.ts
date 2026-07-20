// 构建 / 审核状态：枚举语义映射 + 变化检测 + 通知
// 数据来源有二，都汇到 recordState()：
//   1. ASC Webhook 实时推送（routes/webhook.ts 的 /asc）
//   2. 每日对账轮询兜底（jobs/sync-build-status.ts）—— Apple 未公开投递 SLA，不能假设 100% 送达
// 去重靠 build_states 表的当前态快照：状态没变就什么都不做，天然幂等。

import { notify } from './notify'

export type BuildScope = 'upload' | 'build' | 'testflight' | 'appstore'

interface StateMeta {
  label: string
  /** 决定通知与动态流里的配色 */
  tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'
  /** 需要立刻知道的结果态（通过/被拒/可发布），用于 UI 强调 */
  major?: boolean
}

/**
 * 上传处理状态：BuildUpload.state —— webhook 专属。
 * ⚠️ 与下面的 Build.processingState 是两套不同的枚举，指向的也是不同的 ASC 资源
 * （buildUploads vs builds），故拆成两个 scope：混在一起会因 COMPLETE/VALID
 * 语义相同但值不同而来回抖动，反复推送假变化。
 */
const UPLOAD_STATES: Record<string, StateMeta> = {
  AWAITING_UPLOAD: { label: '等待上传', tone: 'neutral' },
  PROCESSING: { label: '上传处理中', tone: 'info' },
  COMPLETE: { label: '上传处理完成', tone: 'success', major: true },
  FAILED: { label: '上传失败', tone: 'danger', major: true },
}

/** 构建处理状态：Build.processingState —— 对账轮询专属 */
const BUILD_STATES: Record<string, StateMeta> = {
  PROCESSING: { label: '构建处理中', tone: 'info' },
  VALID: { label: '构建处理完成', tone: 'success', major: true },
  FAILED: { label: '构建处理失败', tone: 'danger', major: true },
  INVALID: { label: '构建无效', tone: 'danger', major: true },
}

/** 外部 TestFlight 状态：BuildBetaDetail.externalBuildState（Beta 审核流转也在这里体现） */
const TESTFLIGHT_STATES: Record<string, StateMeta> = {
  PROCESSING: { label: 'TestFlight 处理中', tone: 'info' },
  PROCESSING_EXCEPTION: { label: 'TestFlight 处理异常', tone: 'danger', major: true },
  MISSING_EXPORT_COMPLIANCE: { label: '缺少出口合规信息', tone: 'warning', major: true },
  IN_EXPORT_COMPLIANCE_REVIEW: { label: '出口合规审核中', tone: 'info' },
  READY_FOR_BETA_SUBMISSION: { label: '可提交 Beta 审核', tone: 'info' },
  WAITING_FOR_BETA_REVIEW: { label: '等待 Beta 审核', tone: 'info' },
  IN_BETA_REVIEW: { label: 'Beta 审核中', tone: 'info' },
  BETA_REJECTED: { label: 'Beta 审核被拒', tone: 'danger', major: true },
  BETA_APPROVED: { label: 'Beta 审核通过', tone: 'success', major: true },
  READY_FOR_BETA_TESTING: { label: '可开始测试', tone: 'success', major: true },
  IN_BETA_TESTING: { label: '测试进行中', tone: 'success' },
  EXPIRED: { label: '构建已过期', tone: 'neutral' },
  NOT_APPLICABLE: { label: '不适用外部测试', tone: 'neutral' },
}

/** 上架审核状态：AppStoreVersion.appVersionState
    注意用新枚举 AppVersionState —— 旧的 appStoreState 已弃用，
    且旧值 READY_FOR_SALE 在新枚举里改名为 READY_FOR_DISTRIBUTION */
const APPSTORE_STATES: Record<string, StateMeta> = {
  PREPARE_FOR_SUBMISSION: { label: '准备提交', tone: 'neutral' },
  READY_FOR_REVIEW: { label: '可提交审核', tone: 'info' },
  WAITING_FOR_EXPORT_COMPLIANCE: { label: '等待出口合规', tone: 'warning' },
  WAITING_FOR_REVIEW: { label: '等待审核', tone: 'info' },
  IN_REVIEW: { label: '审核中', tone: 'info' },
  ACCEPTED: { label: '审核通过', tone: 'success', major: true },
  REJECTED: { label: '审核被拒', tone: 'danger', major: true },
  METADATA_REJECTED: { label: '元数据被拒', tone: 'danger', major: true },
  DEVELOPER_REJECTED: { label: '已撤回提交', tone: 'warning', major: true },
  PENDING_DEVELOPER_RELEASE: { label: '等待你发布', tone: 'success', major: true },
  PENDING_APPLE_RELEASE: { label: '等待 Apple 发布', tone: 'info' },
  PROCESSING_FOR_DISTRIBUTION: { label: '分发处理中', tone: 'info' },
  READY_FOR_DISTRIBUTION: { label: '已上架', tone: 'success', major: true },
  INVALID_BINARY: { label: '二进制无效', tone: 'danger', major: true },
  REPLACED_WITH_NEW_VERSION: { label: '被新版本替换', tone: 'neutral' },
}

const SCOPE_STATES: Record<BuildScope, Record<string, StateMeta>> = {
  upload: UPLOAD_STATES,
  build: BUILD_STATES,
  testflight: TESTFLIGHT_STATES,
  appstore: APPSTORE_STATES,
}

const SCOPE_EMOJI: Record<BuildScope, string> = { upload: '📤', build: '📦', testflight: '✈️', appstore: '🚀' }

/** 未知枚举也要能显示：Apple 加新状态时降级成原值而不是丢事件 */
export function describeState(scope: BuildScope, state: string): StateMeta {
  return SCOPE_STATES[scope][state] ?? { label: state, tone: 'neutral' }
}

export interface StateInput {
  appId: number
  scope: BuildScope
  entityId: string
  state: string
  version?: string | null
  buildNumber?: string | null
}

/**
 * 记录一次状态观测，仅在状态**发生变化**时通知。
 * @param opts.notifyOnFirstSight 本地没有基线时也通知。webhook 传 true（事件本身即变化）；
 *        对账轮询保持 false —— 它首次运行要给所有 App 建立基线，不能炸出一串历史状态通知。
 * @returns 是否发生了变化（对账轮询据此统计漏投）
 */
export async function recordState(
  db: D1Database,
  input: StateInput,
  opts?: { notifyOnFirstSight?: boolean }
): Promise<boolean> {
  const { appId, scope, entityId, state } = input
  const version = input.version ?? null
  const buildNumber = input.buildNumber ?? null

  const prev = await db
    .prepare('SELECT state FROM build_states WHERE scope = ? AND entity_id = ?')
    .bind(scope, entityId)
    .first<{ state: string }>()

  if (prev?.state === state) return false // 无变化：webhook 重投或轮询重复看到，直接吞掉

  await db
    .prepare(
      `INSERT INTO build_states (app_id, scope, entity_id, version, build_number, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, entity_id) DO UPDATE SET
         state = excluded.state,
         version = COALESCE(excluded.version, build_states.version),
         build_number = COALESCE(excluded.build_number, build_states.build_number),
         updated_at = excluded.updated_at`
    )
    .bind(appId, scope, entityId, version, buildNumber, state, Date.now())
    .run()

  if (!prev && !opts?.notifyOnFirstSight) return true

  const meta = describeState(scope, state)
  const app = await db
    .prepare('SELECT name, icon_url FROM apps WHERE id = ?')
    .bind(appId)
    .first<{ name: string; icon_url: string | null }>()

  const label = [app?.name, version, buildNumber && `(${buildNumber})`].filter(Boolean).join(' ')
  await notify(db, `build_${scope}`, `${SCOPE_EMOJI[scope]} ${meta.label}`, label, {
    appId,
    icon: app?.icon_url ?? null,
    tone: meta.tone,
  })
  return true
}
