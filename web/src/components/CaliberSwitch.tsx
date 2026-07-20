// 全局收入口径开关（唯一入口：收入页头）；其他页面只读消费 useCaliber()

import { setCaliber, useCaliber, type RevenueCaliber } from '../lib/caliber'
import { SegmentedControl } from './ui'

export function CaliberSwitch() {
  const caliber = useCaliber()
  return (
    <SegmentedControl<RevenueCaliber>
      options={[
        { value: 'gross', label: '客户价' },
        { value: 'net', label: '净得' },
        { value: 'billed', label: '账单' },
      ]}
      value={caliber}
      onChange={setCaliber}
    />
  )
}
