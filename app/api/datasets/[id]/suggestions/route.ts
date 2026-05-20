// ============================================================
// GET /api/datasets/[id]/suggestions
//   → 用 LLM 根据该数据集的列结构 + 样本生成自然中文提问建议（3 条）
//
// 前端切换 dataset 时由 ChatPanel 调用，渲染为可点击的示例问题。
// 加载期间前端用模板 fallback，加载完后替换。
//
// 不缓存到 DB：每次都现生（约 1 秒 + ¥0.001）。前端做会话内 ref Map 缓存
// 避免同一 session 重复调用。
// ============================================================

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDataset } from '@/lib/db/datasets'
import { generateSuggestions } from '@/lib/suggestions'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(
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
    const ds = await getDataset(id, session.user.id)
    if (!ds) {
      return NextResponse.json(
        { error: '数据集不存在', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const suggestions = await generateSuggestions({
      columns: ds.columns,
      sampleRows: ds.rows.slice(0, 3),
    })
    return NextResponse.json({ suggestions })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: msg, code: 'GENERATE_FAILED' },
      { status: 500 },
    )
  }
}
