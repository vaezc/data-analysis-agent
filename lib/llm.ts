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

  return client.chat.completions.create({
    model: cfg.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tools ? 'auto' : undefined,
    temperature: params.temperature ?? 0.7,
  })
}

/**
 * 流式版本。返回 AsyncIterable<ChatCompletionChunk>，调用方 for-await 消费。
 * 调用方负责累积 chunk 的 content / tool_calls / reasoning_content。
 */
export function chatCompletionStream(params: ChatCompletionParams) {
  const cfg = loadConfig()
  const client = getClient()

  return client.chat.completions.create({
    model: cfg.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tools ? 'auto' : undefined,
    temperature: params.temperature ?? 0.7,
    stream: true,
  })
}

// re-export 类型，让 agent.ts 等业务模块只需 import 自 '@/lib/llm'
export type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool }
