// ASC 历史通知回填：Get Notification History（近 180 天）→ 灌入 notifications_raw
// received_at 用通知原始 signedDate，保证 reprocess 按真实时序重放。
// 灌完后需跑 reprocess(reset) 重建 transactions/subscriptions（前端串联）。
// 预算：每页 fetch 1 + batch 入库 1；按 App 的 paginationToken 游标分片，超预算下轮续跑。

import { loadAscCredentials, fetchNotificationHistory } from '../lib/asc-api'
import { decodeJwsPayload, type NotificationPayload } from '../lib/assn'
import { Budget } from '../lib/budget'

const WINDOW_DAYS = 180

interface AppState { token: string | null; done: boolean }

export async function backfillNotificationsJob(
  db: D1Database,
  reset = false,
  budget = new Budget(45)
): Promise<{ inserted: number; hasMore: boolean; skipped: string }> {
  const creds = await loadAscCredentials(db)
  budget.spend(1)
  if (!creds) return { inserted: 0, hasMore: false, skipped: 'ASC 凭证未配置（Key ID / Issuer ID / 私钥）' }

  if (reset) {
    await db.prepare("DELETE FROM config WHERE key = 'backfill_notif_state'").run()
    budget.spend(1)
  }

  const apps = await db
    .prepare("SELECT id, bundle_id FROM apps WHERE bundle_id IS NOT NULL AND bundle_id != ''")
    .all<{ id: number; bundle_id: string }>()
  budget.spend(1)
  if (!apps.results.length) return { inserted: 0, hasMore: false, skipped: '还没有可回填的 App（需先在设置添加 App）' }

  const stateRow = reset ? null : await db.prepare("SELECT value FROM config WHERE key = 'backfill_notif_state'").first<{ value: string }>()
  budget.spend(1)
  const state: Record<string, AppState> = stateRow ? JSON.parse(stateRow.value) : {}

  const endDate = Date.now()
  const startDate = endDate - WINDOW_DAYS * 86400_000

  let inserted = 0
  for (const app of apps.results) {
    let st: AppState = state[app.bundle_id] ?? { token: null, done: false }
    while (!st.done && budget.remaining > 4) {
      let page
      try {
        page = await fetchNotificationHistory(creds, app.bundle_id, { startDate, endDate, paginationToken: st.token ?? undefined })
      } catch (err) {
        budget.spend(1)
        await db.prepare("INSERT INTO config (key, value) VALUES ('backfill_notif_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(state)).run()
        const msg = err instanceof Error ? err.message : '未知错误'
        return { inserted, hasMore: true, skipped: `拉取「${app.bundle_id}」失败：${msg}${/\b401\b/.test(msg) ? '（可能需在 App Store Connect → 用户与访问 → 集成 生成「In-App Purchase」密钥并填入凭证）' : ''}` }
      }
      budget.spend(1)

      const stmts = page.notifications
        .map((sp) => {
          const payload = decodeJwsPayload<NotificationPayload>(sp)
          if (!payload?.notificationUUID) return null
          return db
            .prepare(
              `INSERT OR IGNORE INTO notifications_raw (uuid, app_id, type, subtype, signed_payload, decoded_json, received_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              payload.notificationUUID,
              app.id,
              payload.notificationType,
              payload.subtype ?? null,
              sp,
              JSON.stringify(payload),
              payload.signedDate ?? Date.now()
            )
        })
        .filter((s): s is D1PreparedStatement => s !== null)

      if (stmts.length) {
        const results = await db.batch(stmts)
        budget.spend(1)
        for (const r of results) inserted += r.meta.changes ?? 0
      }

      st = { token: page.paginationToken ?? null, done: !page.hasMore }
      state[app.bundle_id] = st
    }
    state[app.bundle_id] = st
    if (budget.remaining <= 4) break
  }

  await db
    .prepare("INSERT INTO config (key, value) VALUES ('backfill_notif_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(state))
    .run()
  budget.spend(1)

  const hasMore = apps.results.some((a) => !state[a.bundle_id]?.done)
  return { inserted, hasMore, skipped: '' }
}
