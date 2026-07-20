// 设置 · 接入与凭证：Webhook URL + ASC API 凭证

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from '../../lib/toast'
import { Icon } from '../../components/Icon'
import { ListRow, Section } from '../../components/ui'
import { SubPage } from '../../components/SubPage'

export function ConnectSection() {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/webhook/assn`
  const { data: configKeys } = useQuery({ queryKey: ['config-keys'], queryFn: () => api<string[]>('/api/config') })

  const [ascKeyId, setAscKeyId] = useState('')
  const [ascIssuerId, setAscIssuerId] = useState('')
  const [ascKey, setAscKey] = useState('')
  const [vendorNumber, setVendorNumber] = useState('')
  const queryClient = useQueryClient()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* http 环境无剪贴板权限时忽略 */ }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const puts: Array<[string, string]> = []
      if (ascKeyId) puts.push(['asc_key_id', ascKeyId])
      if (ascIssuerId) puts.push(['asc_issuer_id', ascIssuerId])
      if (ascKey) puts.push(['asc_private_key', ascKey])
      if (vendorNumber) puts.push(['asc_vendor_number', vendorNumber])
      for (const [key, value] of puts) {
        await api(`/api/config/${key}`, { method: 'PUT', body: JSON.stringify({ value }) })
      }
    },
    onSuccess: () => {
      toast.success('凭证已保存')
      queryClient.invalidateQueries({ queryKey: ['config-keys'] })
    },
  })

  const ascConfigured = (configKeys ?? []).filter((k) => k.startsWith('asc_')).length >= 3

  return (
    <SubPage title="接入与凭证" backTo="/settings" backLabel="返回设置">
      <Section title="App Store 服务器通知">
        <div className="list">
          <ListRow
            leading={<span className={`row-icon ${copied ? 'tone-success' : 'tone-accent'}`}><Icon name={copied ? 'check' : 'zap'} size={16} /></span>}
            title={copied ? '已复制' : '服务器通知 URL'}
            detail={url}
            trailing={<span className="row-action-text">复制</span>}
            onPress={copy}
          />
        </div>
        <p className="muted hint">
          粘贴到 App Store Connect → App 信息 → App Store 服务器通知 → 生产服务器 URL（选择 Version 2）
        </p>
      </Section>

      <Section title="App Store Connect API 凭证">
        <div className="field">
          <label htmlFor="asc-key-id">Key ID</label>
          <input id="asc-key-id" value={ascKeyId} onChange={(e) => setAscKeyId(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="asc-issuer-id">Issuer ID</label>
          <input id="asc-issuer-id" value={ascIssuerId} onChange={(e) => setAscIssuerId(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="asc-key">私钥（.p8 文件内容）</label>
          <textarea id="asc-key" rows={4} value={ascKey} onChange={(e) => setAscKey(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="asc-vendor">Vendor Number（账单数据用，ASC「付款与财务报告」页可查）</label>
          <input id="asc-vendor" value={vendorNumber} onChange={(e) => setVendorNumber(e.target.value)} placeholder="8xxxxxxx" inputMode="numeric" autoComplete="off" />
        </div>
        <button className="primary btn-block" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? '保存中…' : '保存凭证'}
        </button>
        <p className="muted hint" role="status">
          {ascConfigured ? '已配置（用于拉取可回复评论与账单报告；敏感值只写不读回）' : '未配置（可选，用于拉取可回复评论与账单报告）'}
        </p>
      </Section>
    </SubPage>
  )
}
