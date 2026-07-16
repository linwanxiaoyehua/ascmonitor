// 评论关键词规则打标（规则存 tag_rules，pattern 为大小写不敏感正则）

export interface TagRule {
  tag: string
  pattern: string
}

export function matchTags(text: string, rules: TagRule[]): string[] {
  const tags = new Set<string>()
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern, 'i').test(text)) tags.add(rule.tag)
    } catch {
      // 无效正则跳过
    }
  }
  return [...tags]
}

export async function tagReview(db: D1Database, reviewId: string, title: string, body: string): Promise<string[]> {
  const rules = await db.prepare('SELECT tag, pattern FROM tag_rules WHERE enabled = 1').all<TagRule>()
  const tags = matchTags(`${title}\n${body}`, rules.results)
  for (const tag of tags) {
    await db.prepare('INSERT OR IGNORE INTO review_tags (review_id, tag) VALUES (?, ?)').bind(reviewId, tag).run()
  }
  return tags
}
