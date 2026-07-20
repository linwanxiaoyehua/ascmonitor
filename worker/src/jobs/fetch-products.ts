// 产品目录同步（daily cron 顺带 + 手动触发）：ASC API 拉订阅/内购的 referenceName
// 成本：每 App 2 外部请求 + 1 batch 写；产品目录变化极少，每日一次足够

import { fetchProducts, loadAscCredentials } from '../lib/asc-api'
import { Budget } from '../lib/budget'

export async function fetchProductsJob(db: D1Database, budget = new Budget(40)): Promise<{ synced: number; skipped: string }> {
  const creds = await loadAscCredentials(db)
  budget.spend(1)
  if (!creds) return { synced: 0, skipped: 'ASC 凭证未配置' }

  const apps = await db
    .prepare('SELECT id, asc_app_id FROM apps WHERE asc_app_id IS NOT NULL')
    .all<{ id: number; asc_app_id: string }>()
  budget.spend(1)

  let synced = 0
  for (const app of apps.results) {
    if (budget.remaining < 4) break // 下轮续跑（upsert 幂等）
    try {
      const products = await fetchProducts(creds, app.asc_app_id)
      budget.spend(2)
      if (!products.length) continue
      const stmts = products.map((p) =>
        db
          .prepare(
            `INSERT INTO products (product_id, app_id, name, type, fetched_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(product_id) DO UPDATE SET name = excluded.name, type = excluded.type, fetched_at = excluded.fetched_at`
          )
          .bind(p.productId, app.id, p.name, p.type, Date.now())
      )
      await db.batch(stmts)
      budget.spend(1)
      synced += products.length
    } catch (err) {
      budget.spend(1)
      console.error(`fetch-products failed (app ${app.id}):`, err)
    }
  }
  return { synced, skipped: '' }
}
