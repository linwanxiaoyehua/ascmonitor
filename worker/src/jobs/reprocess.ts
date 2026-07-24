// 回放 notifications_raw 重建 transactions / subscriptions（0002 迁移后补齐新字段）
// - 按 (received_at, uuid) 升序回放，保证订阅状态机顺序正确
// - 内层 JWS 只解码不验签（入库时已验过），CPU 便宜
// - 整批语句走 db.batch（计 1 子请求）：单批 = 读 1 + batch 1 + 游标 1 ≈ 3 子请求
// - 游标存 config.reprocess_cursor，前端循环调用直到 done

import { decodeJwsPayload, type NotificationPayload, type TransactionInfo, type RenewalInfo } from '../lib/assn'
import { buildSubStatement, buildTxStatement } from '../lib/events'

const BATCH_SIZE = 200

interface Cursor {
  ts: number
  uuid: string
}

export async function reprocessJob(
  db: D1Database,
  reset = false
): Promise<{ processed: number; done: boolean; remaining: number }> {
  if (reset) {
    await db.prepare("DELETE FROM config WHERE key = 'reprocess_cursor'").run()
  }
  const cursorRow = await db.prepare("SELECT value FROM config WHERE key = 'reprocess_cursor'").first<{ value: string }>()
  const cursor: Cursor = cursorRow && !reset ? JSON.parse(cursorRow.value) : { ts: 0, uuid: '' }

  const rows = await db
    .prepare(
      `SELECT uuid, app_id, type, subtype, decoded_json, received_at FROM notifications_raw
       WHERE received_at > ?1 OR (received_at = ?1 AND uuid > ?2)
       ORDER BY received_at, uuid LIMIT ?3`
    )
    .bind(cursor.ts, cursor.uuid, BATCH_SIZE)
    .all<{ uuid: string; app_id: number | null; type: string; subtype: string | null; decoded_json: string; received_at: number }>()

  const stmts: D1PreparedStatement[] = []
  for (const row of rows.results) {
    let payload: NotificationPayload
    try {
      payload = JSON.parse(row.decoded_json)
    } catch {
      continue
    }
    const tx = decodeJwsPayload<TransactionInfo>(payload.data?.signedTransactionInfo)
    const renewal = decodeJwsPayload<RenewalInfo>(payload.data?.signedRenewalInfo)
    if (!tx) continue
    const subtype = row.subtype ?? undefined
    stmts.push(buildTxStatement(db, tx, row.type, subtype, row.app_id, row.uuid))
    // 回放时用事件自身时间做状态判定与 updated_at，避免"当前时间"污染历史语义
    const subStmt = buildSubStatement(db, tx, renewal, row.type, subtype, row.app_id, row.received_at)
    if (subStmt) stmts.push(subStmt)
  }
  if (stmts.length) await db.batch(stmts)

  const done = rows.results.length < BATCH_SIZE
  if (done) {
    await db.prepare("DELETE FROM config WHERE key = 'reprocess_cursor'").run()
  } else {
    const last = rows.results[rows.results.length - 1]
    await db
      .prepare("INSERT INTO config (key, value) VALUES ('reprocess_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify({ ts: last.received_at, uuid: last.uuid } satisfies Cursor))
      .run()
  }

  const remaining = done
    ? 0
    : ((await db
        .prepare('SELECT COUNT(*) AS n FROM notifications_raw WHERE received_at > ?')
        .bind(rows.results[rows.results.length - 1]?.received_at ?? 0)
        .first<{ n: number }>())?.n ?? 0)

  return { processed: rows.results.length, done, remaining }
}
