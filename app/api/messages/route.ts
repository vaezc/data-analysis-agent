// ============================================================
// GET    /api/messages?datasetId=xxx  →  该数据集的对话历史（UI 形态）
// DELETE /api/messages?datasetId=xxx  →  清空该数据集的所有对话（New Chat）
//
// GET：前端切换 dataset 时由 useAgent hook 调用，加载历史消息渲染。
//      只返回 ui 字段（ChatMessage 形态），不返回 llm（后端内部用）。
// DELETE：用户点 "New Chat" 按钮触发，删除该 dataset 的所有 messages 行。
//      dataset 本身保留——只是清空对话历史，便于重新开始。
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { clearConversation, listMessages } from '@/lib/db/messages'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 },
    )
  }

  const datasetId = req.nextUrl.searchParams.get('datasetId')
  if (!datasetId) {
    return NextResponse.json(
      { error: '缺少 datasetId 查询参数', code: 'MISSING_DATASET' },
      { status: 400 },
    )
  }

  try {
    const messages = await listMessages(datasetId, session.user.id)
    return NextResponse.json(messages)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('无权访问') ? 404 : 500
    return NextResponse.json(
      { error: msg, code: 'LIST_MESSAGES_FAILED' },
      { status },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 },
    )
  }

  const datasetId = req.nextUrl.searchParams.get('datasetId')
  if (!datasetId) {
    return NextResponse.json(
      { error: '缺少 datasetId 查询参数', code: 'MISSING_DATASET' },
      { status: 400 },
    )
  }

  try {
    await clearConversation(datasetId, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('无权访问') ? 404 : 500
    return NextResponse.json(
      { error: msg, code: 'CLEAR_FAILED' },
      { status },
    )
  }
}
