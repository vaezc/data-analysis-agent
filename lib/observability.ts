// ============================================================
// Agent 可观测性：每轮 runAgent 的 LLM / 工具调用指标
//
// 收集每次 LLM 调用（耗时 + token + 成败）与每次工具调用（耗时 + 成败），
// 在一轮结束时输出结构化汇总。summarize() 是纯聚合，便于单测。
//
// sink 策略：始终打一行结构化 [agent-metrics] JSON（Vercel 日志可检索）；
// dev 额外 console.table 出每工具明细。生产接 Supabase 留待后续（不阻塞）。
// 时间由调用方测量后传入（caller 持 performance.now()），收集器只做聚合，
// 因此测试无需伪造时钟。
// ============================================================

export interface LlmCallMetric {
  /** 调用点标识，如 'agent step=0' / 'sql-gen' */
  label: string
  durationMs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  ok: boolean
}

export interface ToolCallMetric {
  tool: string
  durationMs: number
  ok: boolean
}

export interface PerToolStat {
  calls: number
  failures: number
  totalDurationMs: number
  avgDurationMs: number
}

export interface AgentMetricsSummary {
  wallMs: number
  llm: {
    calls: number
    failures: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    totalDurationMs: number
  }
  tools: {
    calls: number
    failures: number
    totalDurationMs: number
    byTool: Record<string, PerToolStat>
  }
}

function round(n: number): number {
  return Math.round(n)
}

export class AgentMetrics {
  private readonly llmCalls: LlmCallMetric[] = []
  private readonly toolCalls: ToolCallMetric[] = []

  /** 整轮墙钟起点。注入便于测试；默认 performance.now()。 */
  constructor(private readonly startedAtMs: number = performance.now()) {}

  recordLlm(m: LlmCallMetric): void {
    this.llmCalls.push(m)
  }

  recordTool(m: ToolCallMetric): void {
    this.toolCalls.push(m)
  }

  /** 纯聚合，无副作用。endMs 注入便于测试墙钟。 */
  summarize(endMs: number = performance.now()): AgentMetricsSummary {
    const byTool: Record<string, PerToolStat> = {}
    for (const t of this.toolCalls) {
      const s =
        byTool[t.tool] ??
        (byTool[t.tool] = {
          calls: 0,
          failures: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
        })
      s.calls += 1
      if (!t.ok) s.failures += 1
      s.totalDurationMs += t.durationMs
    }
    for (const s of Object.values(byTool)) {
      s.totalDurationMs = round(s.totalDurationMs)
      s.avgDurationMs = s.calls > 0 ? round(s.totalDurationMs / s.calls) : 0
    }

    return {
      wallMs: round(endMs - this.startedAtMs),
      llm: {
        calls: this.llmCalls.length,
        failures: this.llmCalls.filter((c) => !c.ok).length,
        promptTokens: this.llmCalls.reduce((a, c) => a + c.promptTokens, 0),
        completionTokens: this.llmCalls.reduce(
          (a, c) => a + c.completionTokens,
          0,
        ),
        totalTokens: this.llmCalls.reduce((a, c) => a + c.totalTokens, 0),
        totalDurationMs: round(
          this.llmCalls.reduce((a, c) => a + c.durationMs, 0),
        ),
      },
      tools: {
        calls: this.toolCalls.length,
        failures: this.toolCalls.filter((c) => !c.ok).length,
        totalDurationMs: round(
          this.toolCalls.reduce((a, c) => a + c.durationMs, 0),
        ),
        byTool,
      },
    }
  }

  /** 输出汇总。一行结构化 JSON（始终）+ dev 下每工具明细表。 */
  log(tag: string): void {
    const s = this.summarize()
    console.log(`[agent-metrics] ${tag}`, JSON.stringify(s))
    if (
      process.env.NODE_ENV !== 'production' &&
      Object.keys(s.tools.byTool).length > 0
    ) {
      console.table(s.tools.byTool)
    }
  }
}
