// 构建 / 审核状态对账（daily cron）：webhook 的兜底
// Apple 未公开 webhook 的投递 SLA 与重试策略，所以每天拉一次真实状态与本地快照比对，
// 补上漏投的变化。稳态下应当一个变化都查不到 —— 查到就说明 webhook 漏了。
// 成本：每 App 2 外部请求（builds 一次 include 拿全，appStoreVersions 一次）

import { fetchBuildStatus, fetchVersionStatus, loadAscCredentials } from '../lib/asc-api'
import { recordState } from '../lib/build-status'
import { Budget } from '../lib/budget'

export async function syncBuildStatusJob(
  db: D1Database,
  budget = new Budget(40)
): Promise<{ checked: number; drifted: number; skipped: string }> {
  const creds = await loadAscCredentials(db)
  budget.spend(1)
  if (!creds) return { checked: 0, drifted: 0, skipped: 'ASC 凭证未配置' }

  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  budget.spend(1)

  let checked = 0
  let drifted = 0
  for (const app of apps.results) {
    if (budget.remaining < 4) break // 下轮续跑：recordState 幂等，漏掉的明天补
    try {
      const build = await fetchBuildStatus(creds, app.asc_app_id)
      budget.spend(1)
      if (build) {
        if (build.processingState) {
          const changed = await recordState(db, {
            appId: app.id,
            scope: 'build',
            entityId: build.buildId,
            state: build.processingState,
            buildNumber: build.buildNumber,
          })
          if (changed) drifted++
        }
        if (build.externalBuildState) {
          const changed = await recordState(db, {
            appId: app.id,
            scope: 'testflight',
            entityId: build.buildId,
            state: build.externalBuildState,
            buildNumber: build.buildNumber,
          })
          if (changed) drifted++
        }
      }

      const version = await fetchVersionStatus(creds, app.asc_app_id)
      budget.spend(1)
      if (version?.appVersionState) {
        const changed = await recordState(db, {
          appId: app.id,
          scope: 'appstore',
          entityId: version.versionId,
          state: version.appVersionState,
          version: version.versionString,
        })
        if (changed) drifted++
      }
      checked++
    } catch (err) {
      budget.spend(1)
      console.error(`sync-build-status failed (app ${app.id}):`, err)
    }
  }
  return { checked, drifted, skipped: '' }
}
