// ============================================================
// DELETE /api/datasets/[id]   →  删除数据集（级联删除 messages）
//
// 级联由 Supabase schema 的 `on delete cascade` 完成，
// 这里只调 dataset-store.deleteDataset 即可。
// ============================================================

import { NextResponse } from 'next/server'
import { deleteDataset } from '@/lib/dataset-store'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json(
      { error: '缺少 dataset id', code: 'MISSING_ID' },
      { status: 400 },
    )
  }

  try {
    await deleteDataset(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: msg, code: 'DELETE_FAILED' },
      { status: 500 },
    )
  }
}
