// ============================================================
// 工具 Registry 单测 —— executeTool / getToolUiDescription / isToolName
//
// 通过 side-effect import 真实工具（同 agent.ts 的用法），既测 registry
// 的统一兜错 / 文案派生逻辑，也顺带冒烟验证 4 个工具能自注册成功。
// 只触达 create_chart（纯函数 run）与 run_analysis 的 uiDescriptionFrom
// （仅 safeParse，不进 run），不依赖 DB / LLM。
// ============================================================

import { describe, it, expect } from 'vitest'
import '@/lib/tools' // 触发 4 个工具自注册
import {
  executeTool,
  getToolUiDescription,
  isToolName,
  type ToolExecutionContext,
} from '@/lib/tools/registry'
import type { StreamEvent } from '@/types'

function makeCtx(): { ctx: ToolExecutionContext; events: StreamEvent[] } {
  const events: StreamEvent[] = []
  return {
    ctx: { emit: (e) => events.push(e), userId: 'test-user' },
    events,
  }
}

const validChartArgs = {
  chart_type: 'bar',
  title: '区域销售',
  labels: ['华东', '华北'],
  datasets: [{ label: '销售额', data: [150, 80] }],
}

describe('isToolName', () => {
  it('已注册工具返回 true', () => {
    expect(isToolName('create_chart')).toBe(true)
    expect(isToolName('run_analysis')).toBe(true)
    expect(isToolName('inspect_data')).toBe(true)
    expect(isToolName('generate_report')).toBe(true)
  })

  it('未知工具返回 false', () => {
    expect(isToolName('drop_table')).toBe(false)
  })
})

describe('executeTool', () => {
  it('合法 create_chart：emit chart 事件并返回精简 JSON', async () => {
    const { ctx, events } = makeCtx()
    const out = await executeTool('create_chart', validChartArgs, ctx)

    expect(JSON.parse(out)).toEqual({ ok: true, title: '区域销售' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'chart' })
  })

  it('未知工具返回 error JSON（不抛）', async () => {
    const { ctx } = makeCtx()
    const out = await executeTool('nope', {}, ctx)
    expect(JSON.parse(out)).toEqual({ error: '未知工具：nope' })
  })

  it('参数校验失败返回 error JSON，含字段路径', async () => {
    const { ctx, events } = makeCtx()
    // labels 长度 2，data 长度 1 → 触发 superRefine 的长度校验
    const out = await executeTool(
      'create_chart',
      { ...validChartArgs, datasets: [{ label: 'x', data: [1] }] },
      ctx,
    )
    const parsed = JSON.parse(out) as { error?: string }
    expect(parsed.error).toContain('datasets.0.data')
    expect(events).toHaveLength(0) // 校验未过，run 不执行
  })

  it('业务约束失败（pie 多 dataset）走 error JSON', async () => {
    const { ctx } = makeCtx()
    const out = await executeTool(
      'create_chart',
      {
        chart_type: 'pie',
        title: '占比',
        labels: ['a'],
        datasets: [
          { label: 'p', data: [1] },
          { label: 'q', data: [1] },
        ],
      },
      ctx,
    )
    const parsed = JSON.parse(out) as { error?: string }
    expect(parsed.error).toContain('pie 类型只能包含 1 个 dataset')
  })
})

describe('getToolUiDescription', () => {
  it('run_analysis 用 uiDescriptionFrom 派生动态文案', () => {
    const text = getToolUiDescription('run_analysis', {
      dataset_id: 'd1',
      intent: '按区域求和',
      description: '正在按区域汇总销售额...',
    })
    expect(text).toBe('正在按区域汇总销售额...')
  })

  it('run_analysis 参数非法时回退静态 uiDescription', () => {
    const text = getToolUiDescription('run_analysis', { bad: true })
    expect(text).toBe('正在分析数据...')
  })

  it('无 uiDescriptionFrom 的工具返回静态 uiDescription', () => {
    expect(getToolUiDescription('create_chart', validChartArgs)).toBe(
      '正在生成图表...',
    )
  })

  it('未知工具返回通用兜底文案', () => {
    expect(getToolUiDescription('nope', {})).toBe('正在执行...')
  })
})
