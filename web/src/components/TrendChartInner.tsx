// Recharts 实现层（独立 chunk）。页面请 import TrendChart，不要直接 import 这里。
// 色板走 tokens.css 的 --chart-*；tooltip 走 .chart-tooltip 类

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export interface TrendSeries {
  key: string
  name: string
  color?: string
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

const DEFAULT_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)',
]

const DOT_LIMIT = 14
const DASH_PATTERNS = [undefined, '5 3', '2 3', '8 3 2 3']

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
          <span>{p.name}: <strong>{format(p.value)}</strong></span>
        </div>
      ))}
    </div>
  )
}

export default function TrendChartInner({ type, data, series, format, axisFormat, height = 200 }: TrendChartProps) {
  if (!data.length) {
    return <div className="chart-empty">暂无数据</div>
  }
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
    grid: <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />,
    tooltip: <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }} />,
    legend: showLegend ? (
      <Legend
        iconType="circle"
        iconSize={8}
        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        formatter={(value: string) => <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{value}</span>}
      />
    ) : null,
  }

  const colorOf = (s: TrendSeries, i: number) => s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]
  const margin = { top: 6, right: 6, left: 0, bottom: 0 }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'bar' ? (
        <BarChart data={data} margin={margin}>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stackId} fill={colorOf(s, i)} radius={s.stackId ? 0 : [4, 4, 0, 0]} maxBarSize={22} />
          ))}
        </BarChart>
      ) : type === 'area' ? (
        <AreaChart data={data} margin={margin}>
          <defs>
            {series.map((s, i) => {
              const c = colorOf(s, i)
              return (
                <linearGradient key={`grad-${s.key}`} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={c} stopOpacity={0.02} />
                </linearGradient>
              )
            })}
          </defs>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={colorOf(s, i)}
              strokeWidth={2.2}
              strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
              fill={`url(#grad-${s.key})`}
              dot={data.length <= DOT_LIMIT ? { r: 3, strokeWidth: 0, fill: colorOf(s, i) } : false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
            />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={data} margin={margin}>
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={colorOf(s, i)}
              strokeWidth={2.2}
              strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
              dot={data.length <= DOT_LIMIT ? { r: 3, strokeWidth: 0, fill: colorOf(s, i) } : false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
