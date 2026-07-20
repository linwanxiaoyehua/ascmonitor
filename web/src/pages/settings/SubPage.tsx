// 设置二级页外壳：返回按钮 + 标题（桌面也保留，区别于一级页大标题）

import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { Icon } from '../../components/Icon'

export function SubPage({ title, children }: { title: string; children: ReactNode }) {
  const [, navigate] = useLocation()
  return (
    <div className="narrow">
      <div className="page-header sub">
        <button className="topbar-action back-btn" aria-label="返回设置" onClick={() => navigate('/settings')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}
