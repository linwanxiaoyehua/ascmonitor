// 设置 · App 管理：列表 + Sheet 编辑/添加

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AppRow } from '../../lib/api'
import { toast } from '../../lib/toast'
import { AppIcon } from '../../components/AppIcon'
import { Icon } from '../../components/Icon'
import { Sheet } from '../../components/Sheet'
import { ListRow, Section, Skeleton } from '../../components/ui'
import { SubPage } from './SubPage'

export function AppsSection() {
  const queryClient = useQueryClient()
  const { data: apps, isPending } = useQuery({ queryKey: ['apps'], queryFn: () => api<AppRow[]>('/api/apps') })
  const [editing, setEditing] = useState<AppRow | null>(null)
  const [adding, setAdding] = useState(false)

  const [editName, setEditName] = useState('')
  const [editAppleId, setEditAppleId] = useState('')
  const [newBundleId, setNewBundleId] = useState('')
  const [newName, setNewName] = useState('')
  const [newAppleId, setNewAppleId] = useState('')

  const openEdit = (app: AppRow) => {
    setEditing(app)
    setEditName(app.name)
    setEditAppleId(app.asc_app_id ?? '')
  }

  const updateMutation = useMutation({
    mutationFn: (app: AppRow) =>
      api(`/api/apps/${app.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName || undefined, asc_app_id: editAppleId || undefined }),
      }),
    onSuccess: () => {
      toast.success('已保存')
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['apps'] })
    },
  })

  const addMutation = useMutation({
    mutationFn: () =>
      api('/api/apps', {
        method: 'POST',
        body: JSON.stringify({ bundle_id: newBundleId, name: newName || undefined, asc_app_id: newAppleId || undefined }),
      }),
    onSuccess: () => {
      toast.success('已添加')
      setAdding(false)
      setNewBundleId('')
      setNewName('')
      setNewAppleId('')
      queryClient.invalidateQueries({ queryKey: ['apps'] })
    },
  })

  return (
    <SubPage title="App 管理">
      <Section title="App 列表">
        {isPending ? (
          <Skeleton variant="rows" count={2} />
        ) : (
          <div className="list">
            {(apps ?? []).map((a) => (
              <ListRow
                key={a.id}
                leading={<AppIcon url={a.icon_url} name={a.name} size={32} />}
                title={a.name}
                detail={`${a.bundle_id} · Apple ID: ${a.asc_app_id ?? '未设置'}`}
                trailing="chevron"
                onPress={() => openEdit(a)}
              />
            ))}
            <ListRow
              leading={<span className="row-icon tone-success"><Icon name="plus" size={16} /></span>}
              title={<span className="accent-text">手动添加 App</span>}
              onPress={() => setAdding(true)}
            />
          </div>
        )}
        <p className="muted hint">
          收到 Store 通知的 App 会自动出现；填写 Apple ID 后开始抓取评论评分
        </p>
      </Section>

      {/* 编辑 Sheet（替代原生 prompt） */}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.bundle_id}>
        <div className="field">
          <label htmlFor="edit-name">名称</label>
          <input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="edit-apple-id">App Apple ID（App Store 链接中 id 后的数字）</label>
          <input id="edit-apple-id" value={editAppleId} onChange={(e) => setEditAppleId(e.target.value)} placeholder="1234567890" inputMode="numeric" autoComplete="off" />
        </div>
        <button className="primary btn-block" onClick={() => editing && updateMutation.mutate(editing)} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? '保存中…' : '保存'}
        </button>
      </Sheet>

      {/* 添加 Sheet */}
      <Sheet open={adding} onClose={() => setAdding(false)} title="添加 App">
        <div className="field">
          <label htmlFor="new-bundle-id">Bundle ID（必填）</label>
          <input id="new-bundle-id" value={newBundleId} onChange={(e) => setNewBundleId(e.target.value)} placeholder="com.example.app" autoComplete="off" autoCapitalize="none" />
        </div>
        <div className="field">
          <label htmlFor="new-name">名称（可选）</label>
          <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="我的 App" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="new-apple-id">App Apple ID（可选）</label>
          <input id="new-apple-id" value={newAppleId} onChange={(e) => setNewAppleId(e.target.value)} placeholder="1234567890" inputMode="numeric" autoComplete="off" />
        </div>
        <button className="primary btn-block" onClick={() => newBundleId.trim() && addMutation.mutate()} disabled={addMutation.isPending || !newBundleId.trim()}>
          {addMutation.isPending ? '添加中…' : '添加'}
        </button>
      </Sheet>
    </SubPage>
  )
}
