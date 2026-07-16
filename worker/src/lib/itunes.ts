// iTunes 公开接口：各国评论 RSS + Lookup 评分汇总
// 非官方稳定接口，注意限速与容错

const UA = 'ASCMonitor/1.0 (indie developer monitoring tool)'

export interface RssReview {
  id: string
  rating: number
  title: string
  body: string
  reviewer: string
  version: string
  updated: string
}

/** 抓取某国家的最新评论（RSS JSON，第 1 页约 50 条） */
export async function fetchRssReviews(ascAppId: string, country: string, page = 1): Promise<RssReview[]> {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${ascAppId}/sortby=mostrecent/json`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status === 404 || res.status === 403) return [] // 该国无评论或不可用
  if (!res.ok) throw new Error(`RSS ${country} ${res.status}`)
  const json = (await res.json()) as { feed?: { entry?: unknown } }
  const entries = json.feed?.entry
  if (!entries) return []
  const list = Array.isArray(entries) ? entries : [entries]
  return list
    .filter((e: any) => e['im:rating']) // 首条可能是 App 自身信息
    .map((e: any) => ({
      id: e.id.label,
      rating: Number(e['im:rating'].label),
      title: e.title?.label ?? '',
      body: e.content?.label ?? '',
      reviewer: e.author?.name?.label ?? '',
      version: e['im:version']?.label ?? '',
      updated: e.updated?.label ?? '',
    }))
}

export interface LookupResult {
  averageUserRating: number
  userRatingCount: number
}

/** Lookup：某国家的评分汇总 */
export async function fetchRatingSummary(ascAppId: string, country: string): Promise<LookupResult | null> {
  const url = `https://itunes.apple.com/lookup?id=${ascAppId}&country=${country}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const json = (await res.json()) as { resultCount: number; results: Array<Record<string, number>> }
  if (!json.resultCount) return null
  const app = json.results[0]
  return { averageUserRating: app.averageUserRating ?? 0, userRatingCount: app.userRatingCount ?? 0 }
}
