// ============================================================
// DELETE /api/datasets/[id]   →  删除数据集（级联删除 messages）
//
// 级联由 Supabase schema 的 `on delete cascade` 完成，
// 这里只调 dataset-store.deleteDataset 即可。
// ============================================================

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { deleteDataset } from '@/lib/db/datasets'

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
      { error: '缺少 dataset id', code: 'MISSING_ID' },
      { status: 400 },
    )
  }

  try {
    const { count } = await deleteDataset(id, session.user.id)
    // count=0 表示数据集不存在 OR 不属于该 user —— 故意不区分（防越权探测）
    if (count === 0) {
      return NextResponse.json(
        { error: '数据集不存在', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: msg, code: 'DELETE_FAILED' },
      { status: 500 },
    )
  }
}
