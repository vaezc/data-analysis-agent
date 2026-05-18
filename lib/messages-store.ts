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
 * 滑动窗口大小：每次发给 LLM 的"历史"上限。
 *
 * 一对 user+assistant 算 2 条 messages 表行。设 40 → 最近 20 轮对话。
 * 不设 limit 时，长对话累计 token 会 linear 增长，撞上 DeepSeek 64K 窗口或
 * 烧钱。详见 LEARNING.md 6.2。
 */
const SLIDING_WINDOW_ROWS = 40

/**
 * 加载某个 dataset 的对话历史（用于 LLM 上下文）。
 * 仅返回最近 SLIDING_WINDOW_ROWS 条 messages 行展平后的 LLM messages。
 *
 * 返回 uiMessages 给调用方需要时用（当前 API Route 只用 llmMessages，
 * 但保留 uiMessages 兼容性，万一以后要在 server side 也用）。
 */
export async function loadConversation(
  datasetId: string,
): Promise<{
  uiMessages: ChatMessage[]
  llmMessages: ChatCompletionMessageParam[]
}> {
  const supabase = getSupabase()
  // 取最近 N 条：order DESC + limit + 内存反转回正序
  // PostgreSQL/Supabase 不支持 "ORDER BY ASC LIMIT N FROM END"，标准做法是 DESC + LIMIT
  const { data, error } = await supabase
    .from('messages')
    .select('id, dataset_id, role, ui, llm, created_at')
    .eq('dataset_id', datasetId)
    .order('created_at', { ascending: false })
    .limit(SLIDING_WINDOW_ROWS)

  if (error) throw new Error(`加载对话历史失败：${error.message}`)

  const rows = ((data ?? []) as MessageRow[]).reverse()
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
  images?: string[],
): Promise<ChatMessage> {
  const supabase = getSupabase()
  // 先生成 ID（虽然 DB 也会生成，但 ui.id 字段我们想跟 DB 的 id 对齐）
  // 简单做法：让 DB 生成 row id，自己生成 ui.id（UUID）
  const hasImages = images && images.length > 0
  const ui: ChatMessage = hasImages
    ? { id: crypto.randomUUID(), role: 'user', content, images }
    : { id: crypto.randomUUID(), role: 'user', content }

  const llm: ChatCompletionMessageParam[] = hasImages
    ? [
        {
          role: 'user',
          content: [
            { type: 'text', text: content },
            ...images.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ],
        },
      ]
    : [{ role: 'user', content }]

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

/**
 * 按 ui.id 删除一条对话消息，**配对删除**。
 *
 * 为什么配对：OpenAI 协议要求 user / assistant 配对，单独删 user 会留下"孤立
 * assistant"——下次 loadConversation 拼出的 LLM messages 数组就不合法（assistant
 * 前面没有 user 触发），后端发请求会 400。
 *
 * 配对规则：
 *   - 删 user → 同时删它**之后**第一条 assistant（按 created_at）
 *   - 删 assistant → 同时删它**之前**最后一条 user
 *   - 如果找不到配对（孤立消息），单独删
 *
 * 注意：前端的 message.id 是 ui jsonb 字段里的 UUID，不是 DB row id，
 * 所以查询用 `ui->>id` JSONB 路径操作符。
 *
 * 返回被删消息的 ui.id 列表，前端用它从 React state 移除对应消息。
 */
export async function deleteMessagePair(
  uiMessageId: string,
): Promise<string[]> {
  const supabase = getSupabase()

  // 1. 按 ui.id 找该消息（DB 字段查询：ui->>id 操作符提取 JSONB 内的 id）
  const { data: msg, error: e1 } = await supabase
    .from('messages')
    .select('id, dataset_id, role, ui, created_at')
    .eq('ui->>id', uiMessageId)
    .maybeSingle<{
      id: string
      dataset_id: string
      role: 'user' | 'assistant'
      ui: ChatMessage
      created_at: string
    }>()

  if (e1) throw new Error(`查询消息失败：${e1.message}`)
  if (!msg) throw new Error('消息不存在')

  // 2. 找配对消息（按时间相邻）
  type PairedRow = { id: string; ui: ChatMessage }
  let pairedRow: PairedRow | null = null

  if (msg.role === 'user') {
    const { data } = await supabase
      .from('messages')
      .select('id, ui')
      .eq('dataset_id', msg.dataset_id)
      .eq('role', 'assistant')
      .gt('created_at', msg.created_at)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<PairedRow>()
    pairedRow = data
  } else {
    const { data } = await supabase
      .from('messages')
      .select('id, ui')
      .eq('dataset_id', msg.dataset_id)
      .eq('role', 'user')
      .lt('created_at', msg.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<PairedRow>()
    pairedRow = data
  }

  // 3. 一起删（按 DB row id；JSONB 字段查询无法直接用于 IN 列表）
  const dbIdsToDelete = pairedRow ? [msg.id, pairedRow.id] : [msg.id]
  const { error: e2 } = await supabase
    .from('messages')
    .delete()
    .in('id', dbIdsToDelete)
  if (e2) throw new Error(`删除消息失败：${e2.message}`)

  // 4. 返回前端 ui.id 列表
  const uiIdsDeleted = [msg.ui.id]
  if (pairedRow) uiIdsDeleted.push(pairedRow.ui.id)
  return uiIdsDeleted
}
