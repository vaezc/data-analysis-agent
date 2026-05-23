// ============================================================
// 工具：create_chart
//
// 业务事件（图表配置）通过 ctx.emit 推 SSE，不进 tool result。
// LLM 拿到的只是 { ok: true, title }，不会把 chart 数据再复述一遍。
// ============================================================

import { z } from 'zod'
import { defineTool } from './registry'
import type { ChartType } from '@/types'

const CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'scatter']

const datasetItemSchema = z.object({
  label: z.string().min(1),
  data: z.array(z.number()),
})

const schema = z
  .object({
    chart_type: z.enum(CHART_TYPES),
    title: z.string().min(1),
    labels: z.array(z.string()),
    datasets: z.array(datasetItemSchema).min(1),
  })
  .superRefine((val, ctx) => {
    if (val.chart_type === 'pie' && val.datasets.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['datasets'],
        message: 'pie 类型只能包含 1 个 dataset',
      })
    }
    val.datasets.forEach((d, i) => {
      if (d.data.length !== val.labels.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['datasets', i, 'data'],
          message: `长度（${d.data.length}）与 labels 长度（${val.labels.length}）不一致`,
        })
      }
    })
  })

export const createChartTool = defineTool({
  name: 'create_chart',
  description:
    '生成图表并展示给用户。仅在已通过 run_analysis 拿到可视化的聚合数据后调用。' +
    'labels 与 datasets[].data 长度必须相等。pie 类型只能有 1 个 dataset。',
  uiDescription: '正在生成图表...',
  parameters: {
    type: 'object',
    properties: {
      chart_type: {
        type: 'string',
        enum: ['bar', 'line', 'pie', 'scatter'],
        description:
          '图表类型：bar=分类对比，line=趋势，pie=占比，scatter=两变量关系。',
      },
      title: {
        type: 'string',
        description: '图表标题，简短中文。',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'X 轴标签（柱/线/散点）或扇区标签（饼图）。',
      },
      datasets: {
        type: 'array',
        description: '一组或多组数据。多组用于对比（例如不同年份的同一指标）。',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: '该组数据的名称，例如 "2024 年" 或 "销售额"。',
            },
            data: {
              type: 'array',
              items: { type: 'number' },
              description: '与 labels 等长的数值数组。',
            },
          },
          required: ['label', 'data'],
          additionalProperties: false,
        },
      },
    },
    required: ['chart_type', 'title', 'labels', 'datasets'],
    additionalProperties: false,
  },
  schema,
  run(args, ctx) {
    ctx.emit({ type: 'chart', chart: args })
    return { ok: true, title: args.title }
  },
})
