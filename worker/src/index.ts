import { Hono } from 'hono'
import type { Env } from './types'
import { webhook } from './routes/webhook'
import { api } from './routes/api'
import { push } from './routes/push'
import { fetchReviewsJob } from './jobs/fetch-reviews'
import { snapshotRatingsJob } from './jobs/snapshot-ratings'
import { fetchSalesJob } from './jobs/fetch-sales'
import { rollupDaily, utcDateString } from './lib/metrics'
import { evaluateFrequent, evaluateDaily } from './lib/alerts'
import { sendDailyDigest } from './lib/digest'

const app = new Hono<{ Bindings: Env }>()

app.route('/webhook', webhook)
app.route('/api', api)
app.route('/push', push)

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (controller.cron) {
      case '*/15 * * * *':
        ctx.waitUntil(fetchReviewsJob(env.DB).then(() => evaluateFrequent(env.DB)))
        break
      case '0 * * * *':
        // 预留：Phase 3 榜单/关键词抓取
        break
      case '0 1 * * *': {
        const yesterday = utcDateString(Date.now() - 86400_000)
        ctx.waitUntil(
          (async () => {
            await snapshotRatingsJob(env.DB)
            await fetchSalesJob(env.DB)
            await rollupDaily(env.DB, yesterday)
            await rollupDaily(env.DB, utcDateString(Date.now())) // 今日也刷一次快照
            await evaluateDaily(env.DB, yesterday)
            await sendDailyDigest(env.DB, yesterday)
          })()
        )
        break
      }
    }
  },
} satisfies ExportedHandler<Env>
