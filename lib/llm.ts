// ============================================================
// LLM Provider 抽象层
//
// 业务代码（agent.ts）只调用 chatCompletion()，不关心底层是哪家。
// 切换 provider 通过环境变量：LLM_PROVIDER / LLM_API_KEY / LLM_MODEL。
//
// Phase 1 支持：
//   - deepseek（OpenAI 兼容，baseURL 切换即可）
//   - openai
// 未实现：
//   - claude（需要 @anthropic-ai/sdk，等需要时再装）
// ============================================================

import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

type LlmProvider = 'deepseek' | 'openai' | 'claude'

interface LlmConfig {
  provider: LlmProvider
  apiKey: string
  model: string
  baseURL?: string
}

// 各 provider 的默认模型与 baseURL
const PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { model: string; baseURL?: string }
> = {
  deepseek: {
    // V4 默认。复杂任务可在 .env.local 覆盖为 'deepseek-v4-pro'。
    // 旧名 'deepseek-chat' / 'deepseek-reasoner' 将在 2026/07/24 弃用。
    model: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com/v1',
  },
  openai: {
    model: 'gpt-4o',
  },
  claude: {
    model: 'claude-sonnet-4-5',
  },
}

// 单例：避免每次调用都重建 client
let _client: OpenAI | null = null
let _config: LlmConfig | null = null

function loadConfig(): LlmConfig {
  if (_config) return _config

  const provider = (process.env.LLM_PROVIDER ?? 'deepseek') as LlmProvider
  if (!['deepseek', 'openai', 'claude'].includes(provider)) {
    throw new Error(
      `LLM_PROVIDER 非法："${provider}"，可选值：deepseek | openai | claude`,
    )
  }

  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    // 详细诊断信息只输出到服务端日志（Vercel Function Logs），不暴露给客户端
    // 只输出 key 名和 typeof，永远不读取 value
    console.error('[LLM Config Error]', {
      typeof_LLM_API_KEY: typeof process.env.LLM_API_KEY,
      available_LLM_keys: Object.keys(process.env).filter((k) =>
        k.startsWith('LLM_'),
      ),
      VERCEL_ENV: process.env.VERCEL_ENV,
    })
    throw new Error('LLM_API_KEY 未配置，请检查服务端环境变量（详见服务端日志）')
  }

  const defaults = PROVIDER_DEFAULTS[provider]
  _config = {
    provider,
    apiKey,
    model: process.env.LLM_MODEL ?? defaults.model,
    baseURL: defaults.baseURL,
  }
  return _config
}

function getClient(): OpenAI {
  if (_client) return _client
  const cfg = loadConfig()

  if (cfg.provider === 'claude') {
    throw new Error(
      'Claude provider 暂未实现。需要安装 @anthropic-ai/sdk 并在此处接入。',
    )
  }

  // deepseek 与 openai 都用 OpenAI SDK（DeepSeek 接口完全兼容）
  _client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  return _client
}

export interface ChatCompletionParams {
  messages: ChatCompletionMessageParam[]
  tools?: ChatCompletionTool[]
  /** 默认 0.7；analysis 类任务可调低（如 0.2） */
  temperature?: number
  /** 可选 tag，用于在 debug log 里标识这是哪个调用点（如 'agent' / 'sql-gen'） */
  debugTag?: string
}

// ============================================================
// Debug logging：设置 LLM_DEBUG=1 启用
//
// 打开后会把每次 LLM 请求 + 响应打到终端（仅服务端日志可见）。
// 用 [LLM #N tag →] / [LLM #N tag ←] 配对，方便追溯主 Agent vs 二级 LLM。
// 长字段截断到 LLM_DEBUG_MAX_CHARS（默认 1000），LLM_DEBUG=full 关闭截断。
// ============================================================

let _callCounter = 0

function isDebug(): boolean {
  return Boolean(process.env.LLM_DEBUG)
}

function truncFor(s: string): string {
  if (process.env.LLM_DEBUG === 'full') return s
  const max = Number(process.env.LLM_DEBUG_MAX_CHARS) || 1000
  if (s.length <= max) return s
  return `${s.slice(0, max)}…[+${s.length - max} chars]`
}

function summarizeMessages(
  messages: ChatCompletionMessageParam[],
): unknown[] {
  return messages.map((m) => {
    const role = m.role
    const content =
      typeof m.content === 'string'
        ? truncFor(m.content)
        : Array.isArray(m.content)
          ? m.content.map((p) =>
              p.type === 'text'
                ? { type: 'text', text: truncFor(p.text) }
                : { type: p.type, '...': true },
            )
          : m.content
    // assistant 的 tool_calls / tool role 的 tool_call_id 都打出来
    const out: Record<string, unknown> = { role, content }
    if ('tool_calls' in m && m.tool_calls) {
      out.tool_calls = m.tool_calls.map((tc) =>
        tc.type === 'function'
          ? {
              id: tc.id,
              name: tc.function.name,
              arguments: truncFor(tc.function.arguments),
            }
          : { id: tc.id, type: tc.type },
      )
    }
    if ('tool_call_id' in m && m.tool_call_id) {
      out.tool_call_id = m.tool_call_id
    }
    return out
  })
}

function logRequest(
  label: string,
  cfg: LlmConfig,
  params: ChatCompletionParams,
  streaming: boolean,
): void {
  if (!isDebug()) return
  console.log(
    `\n[LLM ${label} →]${streaming ? ' (stream)' : ''}`,
    JSON.stringify(
      {
        model: cfg.model,
        temperature: params.temperature ?? 0.7,
        tools:
          params.tools?.map((t) =>
            t.type === 'function' ? t.function.name : t.type,
          ) ?? null,
        messages: summarizeMessages(params.messages),
      },
      null,
      2,
    ),
  )
}

function logResponseNonStream(
  label: string,
  resp: ChatCompletion,
): void {
  if (!isDebug()) return
  const choice = resp.choices[0]
  console.log(
    `\n[LLM ${label} ←]`,
    JSON.stringify(
      {
        finish_reason: choice?.finish_reason,
        content: choice?.message.content
          ? truncFor(choice.message.content)
          : null,
        tool_calls: choice?.message.tool_calls?.map((tc) =>
          tc.type === 'function'
            ? {
                id: tc.id,
                name: tc.function.name,
                arguments: truncFor(tc.function.arguments),
              }
            : { id: tc.id, type: tc.type },
        ),
        usage: resp.usage,
      },
      null,
      2,
    ),
  )
}

function logResponseStreamSummary(
  label: string,
  summary: {
    finish_reason: string | null
    content: string
    reasoning: string
    toolCalls: { name: string; args: string }[]
  },
): void {
  if (!isDebug()) return
  console.log(
    `\n[LLM ${label} ←] (stream done)`,
    JSON.stringify(
      {
        finish_reason: summary.finish_reason,
        content: summary.content ? truncFor(summary.content) : null,
        reasoning_chars: summary.reasoning.length,
        reasoning_preview: summary.reasoning
          ? truncFor(summary.reasoning)
          : null,
        tool_calls: summary.toolCalls.map((tc) => ({
          name: tc.name,
          arguments: truncFor(tc.args),
        })),
      },
      null,
      2,
    ),
  )
}

/**
 * 调用 LLM 进行一轮对话（非流式）。
 * 调用方需自己处理 tool_calls 并把结果加入 messages 后再调用一次。
 */
export async function chatCompletion(
  params: ChatCompletionParams,
): Promise<ChatCompletion> {
  const cfg = loadConfig()
  const client = getClient()

  const label = `#${++_callCounter}${params.debugTag ? ` ${params.debugTag}` : ''}`
  logRequest(label, cfg, params, false)

  const resp = await client.chat.completions.create({
    model: cfg.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tools ? 'auto' : undefined,
    temperature: params.temperature ?? 0.7,
  })

  logResponseNonStream(label, resp)
  return resp
}

/**
 * 流式版本。返回 AsyncIterable<ChatCompletionChunk>，调用方 for-await 消费。
 * 调用方负责累积 chunk 的 content / tool_calls / reasoning_content。
 *
 * 注：实际上是 async generator——await 返回 generator 本身，再 for-await 消费。
 */
export async function* chatCompletionStream(params: ChatCompletionParams) {
  const cfg = loadConfig()
  const client = getClient()

  const label = `#${++_callCounter}${params.debugTag ? ` ${params.debugTag}` : ''}`
  logRequest(label, cfg, params, true)

  const stream = await client.chat.completions.create({
    model: cfg.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tools ? 'auto' : undefined,
    temperature: params.temperature ?? 0.7,
    stream: true,
    // 让最后一个 chunk 携带 usage（token 数），供可观测性统计。
    // OpenAI 兼容；DeepSeek 同样在 stream 末尾回 usage。
    stream_options: { include_usage: true },
  })

  // 累积流式 chunk 用于完成后打 summary。yield 原样透传，不影响调用方。
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  const toolAcc = new Map<number, { name: string; args: string }>()

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (choice) {
      const delta = choice.delta as {
        content?: string | null
        reasoning_content?: string | null
        tool_calls?: Array<{
          index: number
          function?: { name?: string; arguments?: string }
        }>
      }
      if (delta?.content) content += delta.content
      if (delta?.reasoning_content) reasoning += delta.reasoning_content
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const cur = toolAcc.get(tc.index) ?? { name: '', args: '' }
          if (tc.function?.name) cur.name = tc.function.name
          if (tc.function?.arguments) cur.args += tc.function.arguments
          toolAcc.set(tc.index, cur)
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason
    }
    yield chunk
  }

  logResponseStreamSummary(label, {
    finish_reason: finishReason,
    content,
    reasoning,
    toolCalls: [...toolAcc.values()],
  })
}

// re-export 类型，让 agent.ts 等业务模块只需 import 自 '@/lib/llm'
export type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool }
