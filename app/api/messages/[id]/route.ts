// ============================================================
// DELETE /api/messages/[id]
//   → 删除指定 ui.id 的消息（配对删除，保持 LLM 上下文合法）
//
// 见 lib/messages-store.ts:deleteMessagePair 的配对规则。
// 返回 { deletedIds: string[] } 给前端从 React state 移除对应消息。
// ============================================================

import { NextResponse } from 'next/server'
import { deleteMessagePair } from '@/lib/messages-store'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json(
      { error: '缺少 message id', code: 'MISSING_ID' },
      { status: 400 },
    )
  }

  try {
    const deletedIds = await deleteMessagePair(id)
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
