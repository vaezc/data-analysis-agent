// ============================================================
// DELETE /api/messages/[id]
//   → 删除指定 ui.id 的消息（配对删除，保持 LLM 上下文合法）
//
// 见 lib/messages-store.ts:deleteMessagePair 的配对规则。
// 返回 { deletedIds: string[] } 给前端从 React state 移除对应消息。
// ============================================================

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { deleteMessagePair } from '@/lib/db/messages'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 },
    )
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json(
      { error: '缺少 message id', code: 'MISSING_ID' },
      { status: 400 },
    )
  }

  try {
    const deletedIds = await deleteMessagePair(id, session.user.id)
    return NextResponse.json({ deletedIds })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('不存在') ? 404 : 500
    return NextResponse.json(
      { error: msg, code: 'DELETE_FAILED' },
      { status },
    )
  }
}
