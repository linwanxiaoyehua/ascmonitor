// 评论卡片：展示 + 开发者回复（仅 asc 源可回复；回复状态徽标 未回复/待发布/已发布）

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Review } from '../lib/api'
import { countryFlag, countryName, timeAgo } from '../lib/format'
import { toast } from '../lib/toast'
import { Stars } from './Icon'
import { Sheet } from './Sheet'
import { Badge } from './ui'

const RESPONSE_LABEL: Record<string, string> = {
  PUBLISHED: '已回复',
  PENDING_PUBLISH: '回复待发布',
}

export function ReviewCard({ review: r }: { review: Review }) {
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const queryClient = useQueryClient()
  const canReply = r.source === 'asc' // 仅 ASC 源可平台内回复
  const responded = r.response_state != null

  const reply = useMutation({
    mutationFn: () =>
      api(`/api/reviews/${encodeURIComponent(r.id)}/reply`, { method: 'POST', body: JSON.stringify({ body: text.trim() }) }),
    onSuccess: () => {
      toast.success('回复已提交，发布后几小时内显示')
      setReplying(false)
      setText('')
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })

  return (
    <article className="review-card">
      <div className="meta">
        <Stars rating={r.rating} />
        {r.country && (
          <span title={countryName(r.country)}>
            {countryFlag(r.country) || r.country.toUpperCase()} {countryName(r.country)}
          </span>
        )}
        {r.review_version && <span>v{r.review_version}</span>}
        <span className="ellipsis">{r.reviewer}</span>
        {canReply && !responded && <Badge tone="info">未回复</Badge>}
        <span className="ml-auto" style={{ flex: 'none' }}>{timeAgo(r.created_at)}</span>
      </div>
      {r.title && <div className="rtitle">{r.title}</div>}
      <div className="rbody">{r.body}</div>
      {r.tags.length > 0 && (
        <div className="tags-row">
          {r.tags.map((t) => (
            <span className="badge tone-info" key={t}>{t}</span>
          ))}
        </div>
      )}

      {responded ? (
        <div className="review-reply">
          <div className="rr-head">
            <Badge tone={r.response_state === 'PUBLISHED' ? 'success' : 'warning'}>
              {RESPONSE_LABEL[r.response_state!] ?? '已回复'}
            </Badge>
            {r.responded_at && <span className="muted">{timeAgo(r.responded_at)}</span>}
          </div>
          <div className="rr-body">{r.response_body}</div>
        </div>
      ) : canReply ? (
        <div className="rr-actions">
          <button className="ghost" onClick={() => setReplying(true)}>回复</button>
        </div>
      ) : null}

      <Sheet open={replying} onClose={() => setReplying(false)} title="回复评论">
        <div className="rr-context">
          <Stars rating={r.rating} /> {r.title || r.body}
        </div>
        <div className="field">
          <label htmlFor="reply-text">你的回复</label>
          <textarea id="reply-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入回复内容…" />
        </div>
        <button className="primary btn-block" onClick={() => text.trim() && reply.mutate()} disabled={reply.isPending || !text.trim()}>
          {reply.isPending ? '提交中…' : '发布回复'}
        </button>
        <p className="muted hint">
          回复需要 ASC API Key 具备 Admin / App Manager / Customer Support 角色；发布后通常几小时内在 App Store 显示
        </p>
      </Sheet>
    </article>
  )
}
