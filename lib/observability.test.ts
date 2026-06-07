import { describe, it, expect } from 'vitest'
import { AgentMetrics } from '@/lib/observability'

describe('AgentMetrics.summarize', () => {
  it('空集合：全 0', () => {
    const m = new AgentMetrics(0)
    const s = m.summarize(100)
    expect(s.wallMs).toBe(100)
    expect(s.llm.calls).toBe(0)
    expect(s.tools.calls).toBe(0)
    expect(s.tools.byTool).toEqual({})
  })

  it('聚合 LLM token 与失败数', () => {
    const m = new AgentMetrics(0)
    m.recordLlm({ label: 'step=0', durationMs: 100, promptTokens: 50, completionTokens: 20, totalTokens: 70, ok: true })
    m.recordLlm({ label: 'step=1', durationMs: 200, promptTokens: 80, completionTokens: 30, totalTokens: 110, ok: false })
    const s = m.summarize(500)
    expect(s.llm.calls).toBe(2)
    expect(s.llm.failures).toBe(1)
    expect(s.llm.promptTokens).toBe(130)
    expect(s.llm.completionTokens).toBe(50)
    expect(s.llm.totalTokens).toBe(180)
    expect(s.llm.totalDurationMs).toBe(300)
  })

  it('按工具分组统计 calls / failures / 平均耗时', () => {
    const m = new AgentMetrics(0)
    m.recordTool({ tool: 'inspect_data', durationMs: 10, ok: true })
    m.recordTool({ tool: 'run_analysis', durationMs: 100, ok: true })
    m.recordTool({ tool: 'run_analysis', durationMs: 300, ok: false })
    const s = m.summarize(1000)
    expect(s.tools.calls).toBe(3)
    expect(s.tools.failures).toBe(1)
    expect(s.tools.totalDurationMs).toBe(410)
    expect(s.tools.byTool.inspect_data).toEqual({
      calls: 1,
      failures: 0,
      totalDurationMs: 10,
      avgDurationMs: 10,
    })
    expect(s.tools.byTool.run_analysis).toEqual({
      calls: 2,
      failures: 1,
      totalDurationMs: 400,
      avgDurationMs: 200,
    })
  })

  it('wallMs = endMs - startedAtMs', () => {
    const m = new AgentMetrics(1000)
    expect(m.summarize(1750).wallMs).toBe(750)
  })

  it('耗时四舍五入为整数', () => {
    const m = new AgentMetrics(0)
    m.recordTool({ tool: 't', durationMs: 10.4, ok: true })
    m.recordTool({ tool: 't', durationMs: 10.4, ok: true })
    const s = m.summarize(0.6)
    expect(s.wallMs).toBe(1)
    expect(s.tools.byTool.t.totalDurationMs).toBe(21)
    expect(s.tools.byTool.t.avgDurationMs).toBe(11) // round(21/2)=round(10.5)=11
  })
})
