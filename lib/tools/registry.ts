// ============================================================
// 工具 Registry —— 自注册中心
//
// 借鉴 Hermes Agent 的设计：每个工具文件用 defineTool() 自注册，
// agent.ts 只通过本文件的 API 与工具交互，不关心具体工具种类。
//
// 设计要点：
//   - parameters（JSON Schema）手写：给 LLM 看的描述是 Agent 质量的关键，
//     不走自动派生避免丢失提示词调优
//   - schema（zod）独立维护：负责运行时校验 + args 类型推断，让 run()
//     函数里的 args 是强类型而不是 unknown
//   - executeTool 统一兜错：参数错误 / 业务错误 都转成 JSON 字符串
//     喂回 LLM，让模型自己决策（与原 executor.ts 一致）
// ============================================================

import type { z } from 'zod'
import type { ChatCompletionTool } from '@/lib/llm'
import type { StreamEvent, ToolName } from '@/types'

/** OpenAI function calling 的 parameters 形状（JSON Schema 对象） */
type FunctionParameters = NonNullable<
  Extract<ChatCompletionTool, { type: 'function' }>['function']['parameters']
>

export interface ToolExecutionContext {
  /** 工具执行中需要推给前端的业务事件（chart / report）。tool_start/tool_done 由 agent 推。 */
  emit: (event: StreamEvent) => void
  /** 当前登录用户 ID —— inspect / analysis 查数据集时做 owner check 用。 */
  userId: string
}

export interface ToolDefinition<TSchema extends z.ZodTypeAny> {
  /** 工具名（OpenAI function calling 协议的 name 字段） */
  name: ToolName
  /** 给 LLM 看的 schema description（决定模型何时调用此工具） */
  description: string
  /** 给前端展示的默认中文进度文案（现在进行时，如"正在读取数据结构..."） */
  uiDescription: string
  /** OpenAI function calling 的 parameters（JSON Schema），手写以保留 LLM 提示调优 */
  parameters: FunctionParameters
  /** zod schema，运行时校验 + 类型推断 */
  schema: TSchema
  /** 可选：从已校验的 args 派生动态 UI 文案（如 run_analysis 用 args.description） */
  uiDescriptionFrom?: (args: z.infer<TSchema>) => string
  /** 执行函数，args 由 zod 推断为强类型 */
  run: (
    args: z.infer<TSchema>,
    ctx: ToolExecutionContext,
  ) => Promise<unknown> | unknown
}

// ============================================================
// 全局注册表（module-level state）
//
// 工具文件在 import 时调用 defineTool() 自注册到这里。
// `lib/tools/index.ts` 用 side-effect import 保证所有工具都已注册。
// ============================================================

// 用 ZodTypeAny 擦除泛型供存储；调用 run 时由 schema.safeParse 还原类型
type AnyToolDefinition = ToolDefinition<z.ZodTypeAny>

const registry = new Map<ToolName, AnyToolDefinition>()

export function defineTool<TSchema extends z.ZodTypeAny>(
  def: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  if (registry.has(def.name)) {
    throw new Error(`重复注册工具：${def.name}`)
  }
  registry.set(def.name, def as unknown as AnyToolDefinition)
  return def
}

// ============================================================
// 对外 API（供 agent.ts 使用）
// ============================================================

/** 给 LLM 的 `tools` 字段：所有已注册工具的 OpenAI 格式定义 */
export function getToolList(): ChatCompletionTool[] {
  return Array.from(registry.values()).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/** 校验 LLM 返回的 tool 名是否为已注册工具 */
export function isToolName(name: string): name is ToolName {
  return registry.has(name as ToolName)
}

/**
 * 获取要推给前端的 tool_start description。
 * 优先用 uiDescriptionFrom 派生（需要 args 合法），失败回退 uiDescription。
 */
export function getToolUiDescription(name: string, rawArgs: unknown): string {
  const tool = registry.get(name as ToolName)
  if (!tool) return '正在执行...'
  if (tool.uiDescriptionFrom) {
    const parsed = tool.schema.safeParse(rawArgs)
    if (parsed.success) {
      try {
        const text = tool.uiDescriptionFrom(parsed.data)
        if (typeof text === 'string' && text.length > 0) return text
      } catch {
        // ignore，回退到默认
      }
    }
  }
  return tool.uiDescription
}

/**
 * 执行工具，返回 JSON 字符串（用作 LLM 的 tool result content）。
 *
 * 错误处理：
 *   - 未知工具：{ error: "未知工具：xxx" }
 *   - 参数校验失败：{ error: "参数 xxx：..." }
 *   - run() 抛错：{ error: <错误消息> }
 * 任何情况都不抛，保证 agent 主循环可以把错误塞回 messages 让 LLM 自我纠正。
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolExecutionContext,
): Promise<string> {
  const tool = registry.get(name as ToolName)
  if (!tool) {
    return JSON.stringify({ error: `未知工具：${name}` })
  }

  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.') || '(root)'
    const msg = first?.message || '参数校验失败'
    return JSON.stringify({ error: `参数 ${path}：${msg}` })
  }

  try {
    const result = await tool.run(parsed.data, ctx)
    return JSON.stringify(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return JSON.stringify({ error: msg })
  }
}
