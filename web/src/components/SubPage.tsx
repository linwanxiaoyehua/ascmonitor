// 二级页外壳：返回按钮 + 标题
// 返回走显式路径而非 history.back()，深链进来也能回到正确的上级
// 桌面隐藏（位置由侧边栏二级导航 + 顶栏面包屑指示），见 components.css

import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { Icon } from './Icon'

export function SubPage({
  title, backTo, backLabel = '返回', width = 'narrow', children,
}: {
  title: string
  backTo: string
  backLabel?: string
  width?: 'narrow' | 'narrow-lg'
  children: ReactNode
}) {
  const [, navigate] = useLocation()
  return (
    <div className={width}>
      <div className="page-header sub">
        <button className="topbar-action back-btn" aria-label={backLabel} onClick={() => navigate(backTo)}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}
