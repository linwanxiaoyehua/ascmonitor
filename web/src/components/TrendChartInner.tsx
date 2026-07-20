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

const DEFAULT_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)',
]

/** 数据点少时逐点标记；30 天序列全打点会糊成一片，交给 hover 的 activeDot */
const DOT_LIMIT = 14

/** 第二条及之后的序列改虚线：色相之外再加一重编码，色盲用户也能区分 */
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
          {p.name} {format(p.value)}
        </div>
      ))}
    </div>
  )
}

export default function TrendChartInner({ type, data, series, format, axisFormat, height = 200 }: TrendChartProps) {
  if (!data.length) {
    return <div className="chart-empty">暂无数据</div>
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
    // 图例文字不能用序列色 —— 那是为 2px 线条调的（3:1），落到 12px 文字上只有 3.1:1。
    // 色块保留序列色，文字走 --text-2。
    legend: showLegend ? (
      <Legend
        iconType="circle"
        iconSize={8}
        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        formatter={(value: string) => <span style={{ color: 'var(--text-2)' }}>{value}</span>}
      />
    ) : null,
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
          {/* 不用渐变填充：渐变会把视觉重量压在色块上而非趋势线上。
              保留 7% 单色底以维持 area 的语义重量，其余交给 2px 描边。 */}
          {axisProps.grid}{axisProps.xAxis}{axisProps.yAxis}{axisProps.tooltip}{axisProps.legend}
          {series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={colorOf(s, i)}
              strokeWidth={2}
              strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
              fill={colorOf(s, i)}
              fillOpacity={0.07}
              dot={data.length <= DOT_LIMIT ? { r: 2.5, strokeWidth: 0, fill: colorOf(s, i) } : false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
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
              strokeWidth={2}
              strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
              dot={data.length <= DOT_LIMIT ? { r: 2.5, strokeWidth: 0, fill: colorOf(s, i) } : false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
