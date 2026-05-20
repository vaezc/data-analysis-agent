// ============================================================
// 消息持久化层（Prisma 版）
//
// 替代 lib/messages-store.ts。公开 API 函数签名兼容，
// 调用方（/api/agent、/api/messages、/api/messages/[id]）无需改逻辑。
//
// 关键设计：
//   - 每条 messages 记录 = 一次对话轮（user 或 assistant）
//   - ui jsonb：前端展示用 ChatMessage（含 ui.id —— 前端生成的 UUID）
//   - llm jsonb：OpenAI 协议格式（messages 序列片段，下次回传给 LLM）
//   - 滑动窗口：取最近 SLIDING_WINDOW_ROWS 条，避免 token 无限增长
//   - 配对删除：删 user 同时删之后的 assistant（反之亦然），
//     避免 OpenAI 协议非法（assistant 必须有前置 user 触发）
//
// JSONB 查询的边界：
//   - 简单 CRUD 用标准 Prisma client
//   - 按 ui.id（前端 UUID）查询用 $queryRaw + `ui->>id` 操作符
//     （Prisma 的 json path filter 写法在 cuid/UUID 这类场景不如裸 SQL 直观）
// ============================================================

import { prisma } from '@/lib/prisma'
import type { ChatCompletionMessageParam } from '@/lib/llm'
import type { ChatMessage } from '@/types'

/**
 * 滑动窗口大小：每次发给 LLM 的"历史"上限。
 *
 * 一对 user+assistant 算 2 条 messages 表行。设 40 → 最近 20 轮对话。
 * 不设 limit 时，长对话累计 token 会 linear 增长，撞上 DeepSeek 64K 窗口或
 * 烧钱。详见 LEARNING.md 6.2。
 */
const SLIDING_WINDOW_ROWS = 40

/**
 * 所有 message 操作前先做 owner check —— 确认 dataset 属于 userId。
 * 不属于 / 不存在都抛 Error，路由层捕获后返回 404（保持模糊，不区分"不存在"vs"无权访问"）。
 * 这是简单 multi-tenancy 的标准做法。
 */
async function assertDatasetOwner(
  datasetId: string,
  userId: string,
): Promise<void> {
  const ds = await prisma.dataset.findFirst({
    where: { id: datasetId, userId },
    select: { id: true }, // 只要确认存在
  })
  if (!ds) throw new Error('数据集不存在或无权访问')
}

/**
 * 加载某个 dataset 的对话历史（用于 LLM 上下文）。
 * 仅返回最近 SLIDING_WINDOW_ROWS 条 messages 行展平后的 LLM messages。
 *
 * 取最近 N 条的标准做法：order DESC + take + 内存反转回正序。
 * PostgreSQL 不支持 "ORDER BY ASC LIMIT N FROM END" 这种语义。
 */
export async function loadConversation(
  datasetId: string,
  userId: string,
): Promise<{
  uiMessages: ChatMessage[]
  llmMessages: ChatCompletionMessageParam[]
}> {
  await assertDatasetOwner(datasetId, userId)
  const rows = await prisma.message.findMany({
    where: { datasetId },
    orderBy: { createdAt: 'desc' },
    take: SLIDING_WINDOW_ROWS,
    select: { ui: true, llm: true },
  })

  // 反转回时间正序
  rows.reverse()

  const uiMessages: ChatMessage[] = []
  const llmMessages: ChatCompletionMessageParam[] = []

  for (const row of rows) {
    uiMessages.push(row.ui as unknown as ChatMessage)
    const llmArr = row.llm as unknown as ChatCompletionMessageParam[] | null
    if (Array.isArray(llmArr)) {
      llmMessages.push(...llmArr)
    }
  }

  return { uiMessages, llmMessages }
}

/**
 * 仅加载 UI 历史，前端切换 dataset 时用。
 * 比 loadConversation 少传 llm 字段，省 payload。
 */
export async function listMessages(
  datasetId: string,
  userId: string,
): Promise<ChatMessage[]> {
  await assertDatasetOwner(datasetId, userId)
  const rows = await prisma.message.findMany({
    where: { datasetId },
    orderBy: { createdAt: 'asc' },
    select: { ui: true },
  })
  return rows.map((r) => r.ui as unknown as ChatMessage)
}

export async function saveUserMessage(
  datasetId: string,
  userId: string,
  content: string,
  images?: string[],
): Promise<ChatMessage> {
  await assertDatasetOwner(datasetId, userId)
  // 前端期望 ui.id 是稳定 UUID，独立于 DB row 的 cuid
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

  await prisma.message.create({
    data: {
      datasetId,
      role: 'user',
      ui: ui as unknown as object,
      llm: llm as unknown as object,
    },
  })
  return ui
}

export async function saveAssistantMessage(
  datasetId: string,
  userId: string,
  ui: ChatMessage,
  llm: ChatCompletionMessageParam[],
): Promise<void> {
  await assertDatasetOwner(datasetId, userId)
  await prisma.message.create({
    data: {
      datasetId,
      role: 'assistant',
      ui: ui as unknown as object,
      llm: llm as unknown as object,
    },
  })
}

export async function clearConversation(
  datasetId: string,
  userId: string,
): Promise<void> {
  await assertDatasetOwner(datasetId, userId)
  await prisma.message.deleteMany({ where: { datasetId } })
}

/**
 * 按 ui.id 配对删除消息。
 *
 * 配对规则：
 *   - 删 user → 同时删它**之后**第一条 assistant（按 createdAt）
 *   - 删 assistant → 同时删它**之前**最后一条 user
 *   - 如果找不到配对（孤立消息），单独删
 *
 * 实现要点：
 *   - 第一步用 $queryRaw（JSONB 路径查询 ui->>id），Prisma 的 json path filter
 *     在 cuid/UUID 这种字符串值上写法繁琐，裸 SQL 一行更清晰
 *   - 后续配对查询 + 删除都用标准 Prisma client
 *
 * 返回被删消息的 ui.id 列表，前端用它从 React state 移除对应消息。
 */
export async function deleteMessagePair(
  uiMessageId: string,
  userId: string,
): Promise<string[]> {
  // 1. 按 ui->>id 找该消息，**并同时 JOIN datasets 校验 owner**——
  //    单条 SQL 既找到目标又验证权限，比"找到再二次查 owner"少一次 roundtrip
  const found = await prisma.$queryRaw<
    {
      id: string
      dataset_id: string
      role: 'user' | 'assistant'
      ui: unknown
      created_at: Date
    }[]
  >`
    SELECT m.id, m.dataset_id, m.role, m.ui, m.created_at
    FROM messages m
    INNER JOIN datasets d ON d.id = m.dataset_id
    WHERE m.ui->>'id' = ${uiMessageId}
      AND d.user_id = ${userId}
    LIMIT 1
  `

  const msg = found[0]
  // 找不到可能是"不存在"或"不属于当前 user"——故意不区分（不泄露存在性）
  if (!msg) throw new Error('消息不存在')

  // 2. 找配对消息
  const paired =
    msg.role === 'user'
      ? await prisma.message.findFirst({
          where: {
            datasetId: msg.dataset_id,
            role: 'assistant',
            createdAt: { gt: msg.created_at },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, ui: true },
        })
      : await prisma.message.findFirst({
          where: {
            datasetId: msg.dataset_id,
            role: 'user',
            createdAt: { lt: msg.created_at },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, ui: true },
        })

  // 3. 一起删
  const dbIdsToDelete = paired ? [msg.id, paired.id] : [msg.id]
  await prisma.message.deleteMany({ where: { id: { in: dbIdsToDelete } } })

  // 4. 返回前端 ui.id 列表（前端用来 filter state）
  const msgUi = msg.ui as { id: string }
  const uiIdsDeleted = [msgUi.id]
  if (paired) {
    const pairedUi = paired.ui as unknown as { id: string }
    uiIdsDeleted.push(pairedUi.id)
  }
  return uiIdsDeleted
}
