// ============================================================
// 消息持久化层（messages 表）
//
// 每条 messages 记录 = 一次对话轮：
//   - role: 'user'      → ui 是用户消息，llm 是 [{role:'user',content}]
//   - role: 'assistant' → ui 是 Agent 完整状态（含 steps/charts/reports/content）
//                         llm 是本轮新增的 OpenAI messages（assistant + tool 序列）
//
// loadConversation：拼出 UI 历史 + LLM 历史，供 hook 加载 / agent 构造上下文用
// saveUserMessage：进入 agent 前立刻入库，即使 agent 挂了用户消息也保留
// saveAssistantMessage：agent 流结束后由 API Route 在 finally 中保存
// ============================================================

import { getSupabase } from '@/lib/supabase'
import type { ChatCompletionMessageParam } from '@/lib/llm'
import type { ChatMessage } from '@/types'

interface MessageRow {
  id: string
  dataset_id: string
  role: 'user' | 'assistant'
  ui: ChatMessage
  llm: ChatCompletionMessageParam[]
  created_at: string
}

/**
 * 加载某个 dataset 的完整对话历史。
 * 返回：UI 历史 + LLM 历史（已展平：assistant 行的 llm 数组会展开拼到结果里）。
 */
export async function loadConversation(
  datasetId: string,
): Promise<{
  uiMessages: ChatMessage[]
  llmMessages: ChatCompletionMessageParam[]
}> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('messages')
    .select('id, dataset_id, role, ui, llm, created_at')
    .eq('dataset_id', datasetId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`加载对话历史失败：${error.message}`)

  const rows = (data ?? []) as MessageRow[]
  const uiMessages: ChatMessage[] = []
  const llmMessages: ChatCompletionMessageParam[] = []

  for (const row of rows) {
    uiMessages.push(row.ui)
    if (Array.isArray(row.llm)) {
      llmMessages.push(...row.llm)
    }
  }

  return { uiMessages, llmMessages }
}

/**
 * 仅加载 UI 历史，前端切换 dataset 时用。
 * 比 loadConversation 少传 llm 字段，省 payload。
 */
export async function listMessages(datasetId: string): Promise<ChatMessage[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('messages')
    .select('ui')
    .eq('dataset_id', datasetId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`加载消息列表失败：${error.message}`)
  return (data ?? []).map((r) => (r as { ui: ChatMessage }).ui)
}

export async function saveUserMessage(
  datasetId: string,
  content: string,
): Promise<ChatMessage> {
  const supabase = getSupabase()
  // 先生成 ID（虽然 DB 也会生成，但 ui.id 字段我们想跟 DB 的 id 对齐）
  // 简单做法：让 DB 生成 row id，自己生成 ui.id（UUID）
  const ui: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
  }
  const llm: ChatCompletionMessageParam[] = [{ role: 'user', content }]

  const { error } = await supabase
    .from('messages')
    .insert({ dataset_id: datasetId, role: 'user', ui, llm })

  if (error) throw new Error(`保存用户消息失败：${error.message}`)
  return ui
}

export async function saveAssistantMessage(
  datasetId: string,
  ui: ChatMessage,
  llm: ChatCompletionMessageParam[],
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('messages')
    .insert({ dataset_id: datasetId, role: 'assistant', ui, llm })

  if (error) throw new Error(`保存助手消息失败：${error.message}`)
}

export async function clearConversation(datasetId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('dataset_id', datasetId)
  if (error) throw new Error(`清空对话失败：${error.message}`)
}
