// 收入（/revenue/:sub?）：概况 | 订阅健康 | 明细 三个子页
// - 移动端：页内 .subnav 子页签（桌面隐藏，由侧边栏二级导航接管）
// - 子页签是真链接（SegmentedLinks），可 ⌘/中键新开
// - 全局口径开关（CaliberSelect）唯一入口在顶栏（收入页时由 AppShell 渲染），作用于全部子页金额模块
// 分发模式与 pages/settings 的 /settings/:section? 同构

import { useLocation, useParams } from 'wouter'
import { activeChild, activeTab, REVENUE_SUBS } from '../../lib/nav'
import { PageHeader, SegmentedLinks } from '../../components/ui'
import { RevenueSummary } from './Summary'
import { RevenueHealth } from './Health'
import { RevenueDetail } from './Detail'

type Sub = 'summary' | 'health' | 'detail'

export function RevenuePage() {
  const params = useParams<{ sub?: string }>()
  const [location] = useLocation()
  const sub: Sub = params.sub === 'health' || params.sub === 'detail' ? params.sub : 'summary'
  // 最长匹配，否则 /revenue/health 会把「概况」也点亮
  const current = activeChild(activeTab(location), location)?.path

  return (
    <>
      <PageHeader title="收入" />

      <nav className="subnav" aria-label="收入子页">
        <SegmentedLinks options={REVENUE_SUBS} isActive={(p) => p === current} label="收入子页" />
      </nav>

      {sub === 'summary' && <RevenueSummary />}
      {sub === 'health' && <RevenueHealth />}
      {sub === 'detail' && <RevenueDetail />}
    </>
  )
}
