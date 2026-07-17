// App 信息自动补全：通过 iTunes Lookup 抓图标 / 正式名称 / Apple ID
// 新 App 建档或手动添加时调用一次；失败静默（不影响主流程）

import { lookupAppInfo } from './itunes'

export interface AppLite {
  id: number
  bundle_id: string
  name: string
  asc_app_id: string | null
  icon_url: string | null
}

/** 缺什么补什么：icon_url、asc_app_id，以及仍是 bundleId 占位的 name */
export async function enrichApp(db: D1Database, app: AppLite): Promise<void> {
  if (app.icon_url && app.asc_app_id && app.name !== app.bundle_id) return
  try {
    // 优先 bundleId 查（不用先知道数字 ID）；美区查不到再试中区
    const info =
      (await lookupAppInfo(app.asc_app_id ? { id: app.asc_app_id } : { bundleId: app.bundle_id }, 'us')) ??
      (await lookupAppInfo(app.asc_app_id ? { id: app.asc_app_id } : { bundleId: app.bundle_id }, 'cn'))
    if (!info) return
    await db
      .prepare(
        `UPDATE apps SET
           icon_url = COALESCE(icon_url, ?),
           asc_app_id = COALESCE(asc_app_id, ?),
           name = CASE WHEN name = bundle_id AND ? != '' THEN ? ELSE name END
         WHERE id = ?`
      )
      .bind(info.artworkUrl, String(info.trackId), info.trackName, info.trackName, app.id)
      .run()
  } catch {
    // Lookup 挂了就下次再补
  }
}

/** 批量回填：每次最多补 limit 个缺图标的 App（cron 内用，控制子请求数） */
export async function backfillAppInfo(db: D1Database, limit = 3): Promise<void> {
  const rows = await db
    .prepare(`SELECT id, bundle_id, name, asc_app_id, icon_url FROM apps WHERE icon_url IS NULL LIMIT ?`)
    .bind(limit)
    .all<AppLite>()
  for (const app of rows.results) await enrichApp(db, app)
}
