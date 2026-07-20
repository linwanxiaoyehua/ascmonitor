// 收入（/revenue/:sub?）：概况 | 订阅健康 | 明细 三个子页
// - 移动端：页内 .subnav 子页签（桌面隐藏，由侧边栏二级导航接管）
// - 全局口径开关（CaliberSwitch）唯一入口在此页头，作用于全部子页的金额模块
// 分发模式与 pages/settings 的 /settings/:section? 同构

import { useEffect } from 'react'
import { useLocation, useParams } from 'wouter'
import { CaliberSwitch } from '../../components/CaliberSwitch'
import { PageHeader, SegmentedControl } from '../../components/ui'
import { RevenueSummary } from './Summary'
import { RevenueHealth } from './Health'
import { RevenueDetail } from './Detail'

type Sub = 'summary' | 'health' | 'detail'

const SUB_OPTIONS: Array<{ value: Sub; label: string }> = [
  { value: 'summary', label: '概况' },
  { value: 'health', label: '订阅健康' },
  { value: 'detail', label: '明细' },
]

export function RevenuePage() {
  const params = useParams<{ sub?: string }>()
  const [, navigate] = useLocation()
  const sub: Sub = params.sub === 'health' || params.sub === 'detail' ? params.sub : 'summary'

  // 明细页可能已滚了几屏，切子页回到顶部
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [sub])

  return (
    <>
      <div className="hstack-center mt-3">
        <PageHeader title="收入" />
        <span className="ml-auto">
          <CaliberSwitch />
        </span>
      </div>

      <nav className="subnav" aria-label="收入子页">
        <SegmentedControl<Sub>
          options={SUB_OPTIONS}
          value={sub}
          onChange={(v) => navigate(v === 'summary' ? '/revenue' : `/revenue/${v}`)}
        />
      </nav>

      {sub === 'summary' && <RevenueSummary />}
      {sub === 'health' && <RevenueHealth />}
      {sub === 'detail' && <RevenueDetail />}
    </>
  )
}
