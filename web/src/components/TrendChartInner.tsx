// Recharts 实现层（独立 chunk）。页面请 import TrendChart，不要直接 import 这里。
// 色板走 tokens.css 的 --chart-*；tooltip 走 .chart-tooltip 类

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export interface TrendSeries {
  key: string
  name: string
  color?: string // CSS 变量或颜色值，缺省按序取 --chart-1..6
  stackId?: string
}

export interface TrendChartProps {
  type: 'bar' | 'line' | 'area'
  /** 每行含 date(YYYY-MM-DD) 与各 series key 的数值 */
  data: Array<Record<string, string | number>>
  series: TrendSeries[]
  format: (v: number) => string
  /** Y 轴刻度紧凑格式（缺省用 format）；金额建议传 fmtUsdCompact */
  axisFormat?: (v: number) => string
  height?: number
}

const DEFAULT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']

function ChartTooltip({
  active, payload, label, format,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color?: string; fill?: string }>
  label?: string
  format: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((p) => (
        <div className="tt-row" key={p.name}>
          <span className="tt-swatch" style={{ background: p.color ?? p.fill }} />
          {p.name} {format(p.value)}
        </div>
      ))}
    </div>
  )
}

export default function TrendChartInner({ type, data, series, format, axisFormat, height = 200 }: TrendChartProps) {
  if (!data.length) {
    return (
      <div className="muted" style={{ textAlign: 'center', padding: '48px 0' }}>暂无数据</div>
    )
  }
  // 移动端密度：X 轴只标首末日期
  const ticks = data.length > 1 ? [data[0].date as string, data[data.length - 1].date as string] : undefined
  const showLegend = series.length > 1
  const axisProps = {
    xAxis: (
      <XAxis
        dataKey="date"
        ticks={ticks}
        tickFormatter={(d: string) => d.slice(5)}
        tick={{ fontSize: 11, fill: 'var(--text-3)' }}
        axisLine={false}
        tickLine={false}
        interval="preserveStartEnd"
      />
    ),
    // Y 轴显示紧凑刻度（原来 hide，看不出量级）
    yAxis: (
      <YAxis
        domain={[0, 'auto'] as const}
        tickFormatter={axisFormat ?? format}
        tick={{ fontSize: 11, fill: 'var(--text-3)' }}
        axisLine={false}
        tickLine={false}
        width={48}
        tickCount={4}
      />
    ),
    grid: <CartesianGrid vertical={false} stroke="var(--chart-grid)" />,
    tooltip: <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: 'var(--chart-grid)', stroke: 'var(--border-strong)' }} />,
    legend: showLegend ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} /> : null,
  }

  const colorOf = (s: TrendSeries, i: number) => s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]
  const margin = { top: 4, right: 4, left: 0, bottom: 0 }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'bar' ? (
        <BarChart data={data} margin={margin}>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stackId} fill={colorOf(s, i)} radius={s.stackId ? 0 : [3, 3, 0, 0]} maxBarSize={22} />
          ))}
        </BarChart>
      ) : type === 'area' ? (
        <AreaChart data={data} margin={margin}>
          {/* 渐变填充：顶部 22% → 底部透明（chart 准则：fill ~20% opacity，突出趋势不压数据） */}
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`tc-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={0.22} />
                <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Area key={s.key} dataKey={s.key} name={s.name} stroke={colorOf(s, i)} fill={`url(#tc-grad-${i})`} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={margin}>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={colorOf(s, i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
