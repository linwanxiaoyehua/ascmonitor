import { Hono } from 'hono'
import type { Env } from './types'
import { webhook } from './routes/webhook'
import { api } from './routes/api'
import { push } from './routes/push'
import { fetchReviewsJob } from './jobs/fetch-reviews'
import { snapshotRatingsJob } from './jobs/snapshot-ratings'
import { fetchSalesJob } from './jobs/fetch-sales'
import { fetchProductsJob } from './jobs/fetch-products'
import { rollupCohortsJob } from './jobs/rollup-cohorts'
import { syncBuildStatusJob } from './jobs/sync-build-status'
import { rollupDaily, updateFxRates, utcDateString } from './lib/metrics'
import { evaluateFrequent, evaluateDaily } from './lib/alerts'
import { sendDailyDigest } from './lib/digest'
import { Budget } from './lib/budget'

const app = new Hono<{ Bindings: Env }>()

app.route('/webhook', webhook)
app.route('/api', api)
app.route('/push', push)

/** signed_payload（含 x5c 证书链，单条 5-15KB）90 天后置空；结构化列保留 */
async function cleanupRawPayloads(db: D1Database): Promise<void> {
  await db
    .prepare("UPDATE notifications_raw SET signed_payload = '' WHERE received_at < ? AND signed_payload != ''")
    .bind(Date.now() - 90 * 86400_000)
    .run()
}

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (controller.cron) {
      case '*/15 * * * *': {
        const budget = new Budget(40)
        ctx.waitUntil(fetchReviewsJob(env.DB, budget).then(() => evaluateFrequent(env.DB)))
        break
      }
      case '0 * * * *':
        // 预留：Phase 5 ASO wheel（关键词排名 / 榜单快照）
        break
      case '0 3 * * 1': {
        // weekly：LTV cohort 物化（P5 追加 Suggest 采集 + 榜单降采样）
        const budget = new Budget(40)
        ctx.waitUntil(rollupCohortsJob(env.DB, budget))
        break
      }
      case '0 1 * * *': {
        const yesterday = utcDateString(Date.now() - 86400_000)
        ctx.waitUntil(
          (async () => {
            // 统一预算：必做的便宜项在前，可断点续跑的抓取项用剩余预算
            const budget = new Budget(45)
            await updateFxRates(env.DB)
            budget.spend(3)
            await rollupDaily(env.DB, yesterday)
            await rollupDaily(env.DB, utcDateString(Date.now())) // 今日也刷一次快照
            budget.spend(12)
            await evaluateDaily(env.DB, yesterday)
            await sendDailyDigest(env.DB, yesterday)
            await cleanupRawPayloads(env.DB)
            budget.spend(8)
            // 抓取项：超预算自动断点，明日 cron 续跑（幂等 / done-set / 游标）
            // 构建状态对账排在抓取项最前：它是 webhook 漏投的兜底，比目录/快照更怕拖延
            if (!budget.exhausted) await syncBuildStatusJob(env.DB, budget)
            if (!budget.exhausted) await fetchProductsJob(env.DB, budget)
            if (!budget.exhausted) await snapshotRatingsJob(env.DB, budget)
            if (!budget.exhausted) await fetchSalesJob(env.DB, budget)
          })()
        )
        break
      }
    }
  },
} satisfies ExportedHandler<Env>
