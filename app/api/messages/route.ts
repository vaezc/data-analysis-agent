// ============================================================
// GET  /api/messages?datasetId=xxx  →  该数据集的对话历史（UI 形态）
// POST /api/messages/clear          →  清空（暂未实现；预留给"新对话"按钮）
//
// 前端切换 dataset 时由 useAgent hook 调用，加载历史消息渲染。
// 只返回 ui 字段（ChatMessage 形态），不返回 llm（后端内部用）。
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { listMessages } from '@/lib/messages-store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get('datasetId')
  if (!datasetId) {
    return NextResponse.json(
      { error: '缺少 datasetId 查询参数', code: 'MISSING_DATASET' },
      { status: 400 },
    )
  }

  try {
    const messages = await listMessages(datasetId)
    return NextResponse.json(messages)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: msg, code: 'LIST_MESSAGES_FAILED' },
      { status: 500 },
    )
  }
}
