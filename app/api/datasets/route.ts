// ============================================================
// GET /api/datasets   →  列表（含 columns，按 created_at desc 排序）
//
// 前端启动时 page.tsx 调用，初始化 sidebar 数据集列表。
// ============================================================

import { NextResponse } from 'next/server'
import { listDatasets } from '@/lib/dataset-store'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const list = await listDatasets()
    return NextResponse.json(list)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: msg, code: 'LIST_FAILED' },
      { status: 500 },
    )
  }
}
