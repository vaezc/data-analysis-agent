'use client'

// ============================================================
// 图表渲染：把 LLM 输出的 Chart.js 风格 ChartConfig 转成 Recharts 渲染。
//
// ChartConfig 是 labels[] + datasets[{label,data[]}] 形态（Chart.js 风格），
// Recharts 要 Record<string, number>[] 形态（每行一个对象），
// 由 toTabular() 做转换。
//
// 颜色：
//  - 单 dataset 用 accent
//  - 多 dataset 用 PALETTE 轮转
//  - 主题切换通过 CSS 变量自动跟随（axis/grid/tooltip 全 token-based）
// ============================================================

import { useState, type ReactElement } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartConfig, ChartType } from '@/types'

// 与设计语言协调的图表配色：accent indigo 打头，后接互补色
// 全部选 500 档（在 light/dark 都有合理对比度）
const PALETTE = [
  '#6366f1', // indigo-500   (= accent)
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#a855f7', // purple-500
] as const

const CHART_LABEL: Record<ChartType, string> = {
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  scatter: '散点图',
}

interface ChartRendererProps {
  chart: ChartConfig
  /** 给 ReportCard 抓 SVG 用的稳定 key（messageId-chartIndex），不传则不可被报告嵌入 */
  chartKey?: string
}

export function ChartRenderer({ chart, chartKey }: ChartRendererProps) {
  const [showJson, setShowJson] = useState(false)
  const points = chart.datasets.reduce((sum, d) => sum + d.data.length, 0)

  return (
    <div
      data-chart-key={chartKey}
      className="rounded-lg border border-border bg-card overflow-hidden animate-fade-in"
    >
      <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg truncate">
            {chart.title}
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5">
            {CHART_LABEL[chart.chart_type]} · {points} 个数据点
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="shrink-0 ml-3 rounded-md px-2 py-1 text-xs text-fg-muted transition duration-150 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {showJson ? '收起数据' : '查看数据'}
        </button>
      </div>

      <div className="p-3">
        {/* height 用 number（而非 parent 100%）避免 ResponsiveContainer 初次测量到 0 的警告 */}
        <ResponsiveContainer width="100%" height={280}>
          {renderChart(chart)}
        </ResponsiveContainer>
      </div>

      {showJson && (
        <div className="border-t border-border bg-bg">
          <pre className="max-h-48 overflow-auto p-3 text-[11px] text-fg-muted leading-relaxed">
            {JSON.stringify(chart, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================
// 分发：4 个图表类型 → Recharts 组件
// ============================================================

function renderChart(chart: ChartConfig): ReactElement {
  switch (chart.chart_type) {
    case 'bar':
      return <BarView chart={chart} />
    case 'line':
      return <LineView chart={chart} />
    case 'pie':
      return <PieView chart={chart} />
    case 'scatter':
      return <ScatterView chart={chart} />
  }
}

// ============================================================
// 数据转换
// ============================================================

function toTabular(chart: ChartConfig) {
  return chart.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label }
    for (const ds of chart.datasets) {
      row[ds.label] = ds.data[i] ?? 0
    }
    return row
  })
}

// ============================================================
// 共享样式（axis / tooltip / grid 全部走 token）
// ============================================================

const AXIS_TICK = { fill: 'var(--fg-muted)', fontSize: 11 }
const AXIS_LINE = { stroke: 'var(--border)' }

const TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'var(--fg)',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
  },
  labelStyle: { color: 'var(--fg-muted)', fontSize: '11px', marginBottom: 4 },
  itemStyle: { color: 'var(--fg)', padding: 0 },
  cursor: { fill: 'var(--surface)', opacity: 0.4 },
} as const

const LEGEND_PROPS = {
  wrapperStyle: { fontSize: 12, color: 'var(--fg-muted)' },
} as const

// ============================================================
// Bar / Line
// ============================================================

function BarView({ chart }: { chart: ChartConfig }) {
  const data = toTabular(chart)
  return (
    <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="var(--border)"
        vertical={false}
      />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <Tooltip {...TOOLTIP_PROPS} />
      {chart.datasets.length > 1 && <Legend {...LEGEND_PROPS} />}
      {chart.datasets.map((ds, i) => (
        <Bar
          key={ds.label}
          dataKey={ds.label}
          fill={PALETTE[i % PALETTE.length]}
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
        />
      ))}
    </BarChart>
  )
}

function LineView({ chart }: { chart: ChartConfig }) {
  const data = toTabular(chart)
  return (
    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="var(--border)"
        vertical={false}
      />
      <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <Tooltip {...TOOLTIP_PROPS} />
      {chart.datasets.length > 1 && <Legend {...LEGEND_PROPS} />}
      {chart.datasets.map((ds, i) => (
        <Line
          key={ds.label}
          type="monotone"
          dataKey={ds.label}
          stroke={PALETTE[i % PALETTE.length]}
          strokeWidth={2}
          dot={{ r: 3, fill: PALETTE[i % PALETTE.length] }}
          activeDot={{ r: 5 }}
        />
      ))}
    </LineChart>
  )
}

// ============================================================
// Pie
// ============================================================

function PieView({ chart }: { chart: ChartConfig }) {
  const ds = chart.datasets[0]
  if (!ds) return <EmptyHint text="饼图缺少 dataset" />
  const data = chart.labels.map((name, i) => ({
    name,
    value: ds.data[i] ?? 0,
  }))
  return (
    <PieChart>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        outerRadius="75%"
        innerRadius="0%"
        paddingAngle={2}
        label={({ name, percent }) =>
          `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
        }
        labelLine={{ stroke: 'var(--fg-subtle)' }}
        style={{ fontSize: 11 }}
      >
        {data.map((_, i) => (
          <Cell
            key={i}
            fill={PALETTE[i % PALETTE.length]}
            stroke="var(--card)"
            strokeWidth={2}
          />
        ))}
      </Pie>
      <Tooltip {...TOOLTIP_PROPS} />
    </PieChart>
  )
}

// ============================================================
// Scatter
// 我们的 schema 是 labels[]+data[]（分类形态），scatter 通常需要 (x,y) 对。
// 简化：label 能转 number 就用，否则用 index。
// ============================================================

function ScatterView({ chart }: { chart: ChartConfig }) {
  return (
    <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis type="number" dataKey="x" name="x" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <YAxis type="number" dataKey="y" name="y" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={AXIS_LINE} />
      <Tooltip {...TOOLTIP_PROPS} cursor={{ strokeDasharray: '3 3' }} />
      {chart.datasets.length > 1 && <Legend {...LEGEND_PROPS} />}
      {chart.datasets.map((ds, i) => {
        const points = chart.labels.map((lab, idx) => ({
          x: Number(lab) || idx,
          y: ds.data[idx] ?? 0,
        }))
        return (
          <Scatter
            key={ds.label}
            name={ds.label}
            data={points}
            fill={PALETTE[i % PALETTE.length]}
          />
        )
      })}
    </ScatterChart>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="h-full w-full grid place-items-center text-xs text-fg-subtle">
      {text}
    </div>
  )
}
