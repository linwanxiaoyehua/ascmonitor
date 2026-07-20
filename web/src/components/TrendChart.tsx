// TrendChart：Recharts 的唯一入口（包装层隔离依赖，将来可换库）
// recharts 经 lazy 进独立 chunk —— 首屏不背 55KB 图表库

import { lazy, Suspense } from 'react'
import { Skeleton } from './ui'
import type { TrendChartProps } from './TrendChartInner'

const Inner = lazy(() => import('./TrendChartInner'))

export type { TrendChartProps, TrendSeries } from './TrendChartInner'

export function TrendChart(props: TrendChartProps) {
  return (
    <Suspense fallback={<Skeleton variant="chart" />}>
      <Inner {...props} />
    </Suspense>
  )
}
