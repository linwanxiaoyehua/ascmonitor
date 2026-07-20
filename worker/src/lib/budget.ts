// 统一子请求预算：免费层每次调用 ≤50 子请求，且 **D1 查询同样计入**
// （官方定义 subrequest 含对 KV/R2/D1 的请求，https://developers.cloudflare.com/workers/platform/limits/）
// 所有 cron 作业共享同一个 Budget 实例：外部 fetch 计 1、每条 D1 语句计 1、db.batch 计 1。
// 作业超预算即写游标退出，下轮 cron 续跑 —— 不再靠 try/catch 吞错苟活。

export class Budget {
  private used = 0

  constructor(private readonly limit = 45) {}

  /** 记账：外部 fetch = 1，单条 D1 语句 = 1，db.batch = 1 */
  spend(n = 1): void {
    this.used += n
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used)
  }

  get exhausted(): boolean {
    return this.used >= this.limit
  }
}
