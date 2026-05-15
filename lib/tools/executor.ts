// ============================================================
// 工具执行器
//
// 入口：executeTool(name, args, ctx) → 返回 string（喂给 LLM 的 tool result）
//
// 设计要点：
//   - 错误不抛，捕获后转成 JSON 字符串作为工具结果，让 LLM 自己决定怎么办
//   - chart / report 这类业务事件通过 ctx.emit 推 SSE，不放进 tool result
//   - run_analysis 用二次 LLM 调用生成 JS，再用 node:vm 沙箱执行
//     —— Phase 2 接 E2B 后，替换 execAnalysis 一个函数即可
// ============================================================

import vm from 'node:vm'
import { chatCompletion } from '@/lib/llm'
import { getDataset, getDatasetSummary } from '@/lib/dataset-store'
import type {
  AnalysisResult,
  ChartConfig,
  ChartDataset,
  ChartType,
  Column,
  ReportConfig,
  ReportSection,
  Row,
  StreamEvent,
  ToolName,
} from '@/types'

export interface ToolExecutionContext {
  /** 工具执行中需要推给前端的业务事件（chart / report）。tool_start/tool_done 由 agent 推。 */
  emit: (event: StreamEvent) => void
}

// ============================================================
// 主入口
// ============================================================

export async function executeTool(
  toolName: ToolName,
  args: unknown,
  ctx: ToolExecutionContext,
): Promise<string> {
  try {
    switch (toolName) {
      case 'inspect_data':
        return JSON.stringify(execInspect(args))
      case 'run_analysis':
        return JSON.stringify(await execAnalysis(args))
      case 'create_chart':
        return JSON.stringify(execChart(args, ctx))
      case 'generate_report':
        return JSON.stringify(execReport(args, ctx))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return JSON.stringify({ error: msg })
  }
}

// ============================================================
// 参数辅助
// ============================================================

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v == null || Array.isArray(v)) {
    throw new Error('工具参数必须是对象')
  }
  return v as Record<string, unknown>
}

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || v === '') {
    throw new Error(`参数 ${key} 必须是非空字符串`)
  }
  return v
}

// ============================================================
// inspect_data
// ============================================================

function execInspect(rawArgs: unknown) {
  const args = asObject(rawArgs)
  const id = asString(args, 'dataset_id')
  const summary = getDatasetSummary(id)
  if (!summary) throw new Error(`数据集不存在：${id}`)
  return summary
}

// ============================================================
// run_analysis
// ============================================================

const ANALYSIS_SYSTEM_PROMPT = `你是数据分析代码生成器。根据用户的自然语言意图，生成一段 JavaScript 代码计算分析结果。

执行环境：
- 变量 \`rows\` 是 Array<Record<string, unknown>>，每个元素代表一行数据
- 全局可用：Math, Object, Array, Number, String, Boolean, Date, JSON
- 禁止使用 require/import/fs/process/setTimeout/Promise 等

输出要求：
- 只输出代码，不要 markdown 围栏（不要 \`\`\`js）、不要解释、不要 import
- 必须以 return 语句结束
- 必须使用提供的真实列名
- 处理可能的 null/undefined 值（用 ?? 兜底）
- 结果要可被 JSON.stringify

示例：
列：region(string), sales(number)
意图：按 region 分组对 sales 求和，按总和降序

输出：
const grouped = rows.reduce((acc, r) => {
  const k = r.region
  acc[k] = (acc[k] ?? 0) + Number(r.sales ?? 0)
  return acc
}, {})
return Object.entries(grouped)
  .map(([region, total]) => ({ region, total }))
  .sort((a, b) => b.total - a.total)`

async function execAnalysis(rawArgs: unknown): Promise<AnalysisResult> {
  const args = asObject(rawArgs)
  const datasetId = asString(args, 'dataset_id')
  const intent = asString(args, 'intent')
  const description = asString(args, 'description')

  const ds = getDataset(datasetId)
  if (!ds) throw new Error(`数据集不存在：${datasetId}`)

  const code = await generateAnalysisCode(ds.columns, ds.rows.slice(0, 2), intent)
  const result = runInSandbox(code, ds.rows)

  return { description, data: truncateForLLM(result) }
}

// ============================================================
// Tool result 截断
//
// 目的：控制单次 tool result 的 token 占用，防止长对话累积爆炸。
//
// 估算口径（粗算保守）：
//   - JSON 字符串长度 / 4 ≈ token 数
//   - 中文 1 token ≈ 2 char，英文 1 token ≈ 4 char，混合按 4 算
//
// 策略：
//   - 数组超 MAX_ARRAY_ITEMS：切前 N + _truncated 元信息提示
//   - 单条结果（或截断后）JSON 仍超 MAX_CHARS：再次警告
//   - _truncated 字段让 LLM 知道有遗漏，可在回答里说"基于前 N 项数据"
// ============================================================

const TOOL_RESULT_LIMITS = {
  MAX_ARRAY_ITEMS: 30,
  MAX_CHARS: 6000, // ≈ 1500 token
} as const

function truncateForLLM(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS) {
      return {
        items: value.slice(0, TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS),
        _truncated: {
          original_length: value.length,
          shown: TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS,
          hint: `共 ${value.length} 项，仅展示前 ${TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS} 项。如需完整结果请改进 intent（如加 limit / top N / 过滤条件）让结果更聚焦。`,
        },
      }
    }
    return value
  }

  // 非数组兜底：罕见但要防止"返回个超大对象"的情况
  const jsonLen = JSON.stringify(value).length
  if (jsonLen > TOOL_RESULT_LIMITS.MAX_CHARS) {
    return {
      _truncated: {
        original_chars: jsonLen,
        hint: `结果较大（${jsonLen} 字符），请改进 intent 让结果更聚焦`,
      },
    }
  }
  return value
}

async function generateAnalysisCode(
  columns: Column[],
  sample: Row[],
  intent: string,
): Promise<string> {
  const schemaStr = columns.map((c) => `${c.name}(${c.type})`).join(', ')
  const userMsg =
    `列：${schemaStr}\n` +
    `样本（前 ${sample.length} 行）：${JSON.stringify(sample)}\n` +
    `意图：${intent}`

  const completion = await chatCompletion({
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.2,
  })

  let code = completion.choices[0]?.message?.content?.trim() ?? ''
  // 去掉 LLM 偶尔加上的 markdown 围栏
  code = code
    .replace(/^```(?:javascript|js|typescript|ts)?\s*\n/, '')
    .replace(/\n?```$/, '')
    .trim()
  if (!code) throw new Error('LLM 未生成代码')
  if (!/\breturn\b/.test(code)) {
    throw new Error('LLM 生成的代码缺少 return 语句')
  }
  return code
}

function runInSandbox(code: string, rows: Row[]): unknown {
  const context = vm.createContext({
    rows,
    Math,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Date,
    JSON,
  })
  const wrapped = `(() => { ${code} })()`
  try {
    return vm.runInContext(wrapped, context, {
      timeout: 5000,
      breakOnSigint: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`分析代码执行失败：${msg}`)
  }
}

// ============================================================
// create_chart
// ============================================================

const CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'scatter']

function execChart(
  rawArgs: unknown,
  ctx: ToolExecutionContext,
): { ok: true; title: string } {
  const chart = parseChartConfig(asObject(rawArgs))
  ctx.emit({ type: 'chart', chart })
  return { ok: true, title: chart.title }
}

function parseChartConfig(args: Record<string, unknown>): ChartConfig {
  const chart_type = asString(args, 'chart_type')
  if (!CHART_TYPES.includes(chart_type as ChartType)) {
    throw new Error(`chart_type 非法：${chart_type}`)
  }
  const title = asString(args, 'title')

  const labels = args.labels
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string')) {
    throw new Error('labels 必须是 string[]')
  }

  const rawDatasets = args.datasets
  if (!Array.isArray(rawDatasets) || rawDatasets.length === 0) {
    throw new Error('datasets 必须是非空数组')
  }
  if (chart_type === 'pie' && rawDatasets.length > 1) {
    throw new Error('pie 类型只能包含 1 个 dataset')
  }

  const datasets: ChartDataset[] = rawDatasets.map((d, i) => {
    const obj = asObject(d)
    const label = asString(obj, 'label')
    const data = obj.data
    if (!Array.isArray(data) || !data.every((n) => typeof n === 'number')) {
      throw new Error(`datasets[${i}].data 必须是 number[]`)
    }
    if (data.length !== labels.length) {
      throw new Error(
        `datasets[${i}].data 长度（${data.length}）与 labels 长度（${labels.length}）不一致`,
      )
    }
    return { label, data }
  })

  return { chart_type: chart_type as ChartType, title, labels, datasets }
}

// ============================================================
// generate_report
// ============================================================

function execReport(
  rawArgs: unknown,
  ctx: ToolExecutionContext,
): { ok: true; title: string } {
  const report = parseReportConfig(asObject(rawArgs))
  ctx.emit({ type: 'report', report })
  return { ok: true, title: report.title }
}

function parseReportConfig(args: Record<string, unknown>): ReportConfig {
  const title = asString(args, 'title')
  const summary = asString(args, 'summary')

  const rawSections = args.sections
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    throw new Error('sections 必须是非空数组')
  }
  const sections: ReportSection[] = rawSections.map((s, i) => {
    const obj = asObject(s)
    try {
      return { heading: asString(obj, 'heading'), content: asString(obj, 'content') }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`sections[${i}]：${msg}`)
    }
  })

  return { title, summary, sections }
}
