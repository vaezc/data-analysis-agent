// ============================================================
// Agent 主循环
//
// 接口：runAgent({ datasetId, userMessage, onEvent }) → Promise<void>
//
// 流程：
//   1. 构造 messages（system + 历史 + 当前 user）
//   2. 循环最多 MAX_STEPS 次：
//      - 调 LLM
//      - 若返回 tool_calls：每个 tool_call 推 tool_start/tool_done 事件、执行、把结果塞回 messages
//      - 若返回 content（无 tool_calls）：推 answer 事件，结束
//   3. 任何错误捕获后推 error 事件，不让 SSE 连接挂掉
// ============================================================

import {
  chatCompletionStream,
  type ChatCompletionMessageParam,
} from '@/lib/llm'
import { TOOL_DEFINITIONS, TOOL_LIST } from '@/lib/tools/definitions'
import { executeTool, type ToolExecutionContext } from '@/lib/tools/executor'
import type { StreamEvent, ToolName } from '@/types'

const MAX_STEPS = 10

const SYSTEM_PROMPT = `你是一个数据分析 Agent，帮助用户分析 CSV/Excel 数据集。

工作流程：
1. 用户第一次问关于某个数据集的问题时，必须先调用 inspect_data 了解列结构
2. 根据需要调用 run_analysis 做计算（分组、统计、过滤、排序等）
3. **当 run_analysis 返回的数据适合可视化时，应该主动调用 create_chart**：
   - 分类对比（如不同区域 / 产品 / 渠道的指标对比）→ chart_type: 'bar'
   - 时间趋势（按日 / 月 / 年 / 季度的变化）→ chart_type: 'line'
   - 占比（部分占总体的比例，如各品类销售占比）→ chart_type: 'pie'
   - 两个连续变量的关系（如价格 vs 销量）→ chart_type: 'scatter'
   不要害怕调用图表工具，可视化对用户理解数据的帮助巨大
4. 只有当用户明确要求"生成报告"、"导出"等场景时才调用 generate_report
5. 最后用自然语言回答用户的问题

强制规则：
- 始终用中文回答用户
- 不要把工具的原始 JSON 输出给用户看，必须用自然语言总结关键结论
- 数字保留合理精度：金额超过万用"万/亿"单位，百分比保留 2 位小数
- 严禁编造数据集中不存在的列名或数值
- 同一轮内不要用完全相同的参数重复调用同一工具
- 工具失败（返回 { error }）时：先尝试修正参数重试一次，仍失败则告知用户并停止
- 工具结果中如包含 "_truncated" 字段，说明数据被系统截断（受 token 上下文限制）。回答时可以告知用户"基于前 N 项数据"，但不要把 "_truncated" 字段的内容原样展示给用户
- 调用 create_chart 时，labels 和每个 datasets[i].data 长度必须一致；pie 类型只能有 1 个 dataset
- 调用 generate_report 时：
  - summary 和 sections.content 用纯文字 + Markdown 标记（标题/列表/加粗/表格），禁止写 markdown 图片语法 \`![alt](url)\` —— 你没有图片 URL，且本轮已生成的 create_chart 图表会被自动嵌入到报告的"可视化图表"段落
  - 不要写"如下图所示"、"见图 1"等引用语，直接用文字描述结论
  - 不要在 sections 里再造一个"可视化图表"或"图表展示"章节（系统会自动插入），章节应聚焦于文字分析、结论、建议`

export interface RunAgentParams {
  /** 当前对话激活的数据集 ID */
  datasetId: string
  /** 用户当前轮的消息 */
  userMessage: string
  /** 历史消息（多轮对话用，Phase 1 单轮可不传） */
  previousMessages?: ChatCompletionMessageParam[]
  /** SSE 事件回调 */
  onEvent: (event: StreamEvent) => void
}

export async function runAgent(params: RunAgentParams): Promise<void> {
  const { datasetId, userMessage, previousMessages = [], onEvent } = params

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        SYSTEM_PROMPT +
        `\n\n当前数据集 ID：${datasetId}（调用工具时必须传入此 ID 作为 dataset_id 参数）`,
    },
    ...previousMessages,
    { role: 'user', content: userMessage },
  ]

  const ctx: ToolExecutionContext = { emit: onEvent }

  // 本轮开始时 messages 的长度（system + 历史），用于 done 事件计算"本轮新增"的切片
  const baseLength = messages.length - 1 // 减去刚 push 的 user message，让本轮新增从 user 开始

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // ---------- 流式调 LLM，累积本轮 chunks ----------
      const stream = await chatCompletionStream({
        messages,
        tools: TOOL_LIST,
      })

      let contentBuffer = ''
      let reasoningBuffer = ''
      // 多个 tool_calls 按 delta.index 累积，arguments 是 incremental 字符串
      const toolCallAccs = new Map<
        number,
        { id?: string; name?: string; args: string }
      >()

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue
        const delta = choice.delta

        // 文本 delta → 流式推给前端
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          contentBuffer += delta.content
          onEvent({ type: 'answer_delta', text: delta.content })
        }

        // DeepSeek V4 thinking mode 扩展字段（OpenAI SDK 类型不认识，断言取）
        const extDelta = delta as typeof delta & {
          reasoning_content?: string | null
        }
        if (typeof extDelta.reasoning_content === 'string') {
          reasoningBuffer += extDelta.reasoning_content
        }

        // tool_calls delta：按 index 分桶累积
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            const acc = toolCallAccs.get(idx) ?? { args: '' }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
            toolCallAccs.set(idx, acc)
          }
        }
      }

      // 组装完整 tool_calls
      const toolCalls = Array.from(toolCallAccs.entries())
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => ({
          id: acc.id ?? '',
          type: 'function' as const,
          function: { name: acc.name ?? '', arguments: acc.args },
        }))

      // 回填 messages（reasoning_content 必须 echo 回去，否则 DeepSeek V4 报 400）
      const replyMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content: contentBuffer,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      }
      if (reasoningBuffer) {
        ;(replyMsg as unknown as Record<string, unknown>).reasoning_content =
          reasoningBuffer
      }
      messages.push(replyMsg)

      // 终止条件：模型选择不再调用工具
      if (toolCalls.length === 0) {
        const text = contentBuffer.trim()
        if (text) {
          // 不再 emit answer：内容已经通过 answer_delta 流式推过了
          onEvent({ type: 'done', messages: messages.slice(baseLength) })
        } else {
          onEvent({ type: 'error', message: 'Agent 结束但未生成回答' })
        }
        return
      }

      // 执行所有 tool_calls
      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') {
          // 非 function 工具调用，直接给 LLM 返回错误，让它换策略
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: `不支持的 tool_call 类型：${toolCall.type}`,
            }),
          })
          continue
        }

        const name = toolCall.function.name
        if (!isToolName(name)) {
          onEvent({ type: 'error', message: `LLM 调用了未知工具：${name}` })
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `未知工具：${name}` }),
          })
          continue
        }

        // 解析 args + 提取 description（仅 run_analysis 工具的 args 带这个字段）
        let parsedArgs: unknown = {}
        let description = defaultDescription(name)
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments)
          if (
            isPlainObject(parsedArgs) &&
            typeof parsedArgs.description === 'string' &&
            parsedArgs.description.length > 0
          ) {
            description = parsedArgs.description
          }
        } catch {
          // JSON 解析失败时 executor 内部会再次校验并返回 { error }
        }

        onEvent({ type: 'tool_start', tool: name, description })
        const result = await executeTool(name, parsedArgs, ctx)
        onEvent({ type: 'tool_done', tool: name })

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
    }

    onEvent({
      type: 'error',
      message: `Agent 超过最大步数 ${MAX_STEPS}，自动终止`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onEvent({ type: 'error', message: `Agent 执行错误：${msg}` })
  }
}

// ---------- 辅助 ----------

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, name)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function defaultDescription(tool: ToolName): string {
  switch (tool) {
    case 'inspect_data':
      return '正在读取数据结构...'
    case 'run_analysis':
      return '正在分析数据...'
    case 'create_chart':
      return '正在生成图表...'
    case 'generate_report':
      return '正在生成报告...'
  }
}
