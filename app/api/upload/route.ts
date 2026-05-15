// ============================================================
// POST /api/upload
//
// 接收 multipart/form-data 的 file 字段，解析后存入 dataset-store，
// 返回数据集元信息（不返回完整 rows，避免大响应）。
//
// 错误响应统一格式（按 CLAUDE.md 规范）：{ error: string, code?: string }
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createDataset } from '@/lib/dataset-store'

// 显式声明 Node runtime：papaparse / xlsx / Buffer 都要 Node API，Edge 不行
export const runtime = 'nodejs'

// 单文件大小上限（防 DoS）。Vercel hobby 上限 4.5MB，自部署可调更高。
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

const ALLOWED_EXTS = new Set(['csv', 'xlsx', 'xls'])

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return errorResponse('缺少 file 字段', 'NO_FILE', 400)
    }

    if (file.size === 0) {
      return errorResponse('文件为空', 'EMPTY_FILE', 400)
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse(
        `文件过大：${(file.size / 1024 / 1024).toFixed(1)} MB，上限 ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
        'FILE_TOO_LARGE',
        413,
      )
    }

    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (!ALLOWED_EXTS.has(ext)) {
      return errorResponse(
        `不支持的文件类型：.${ext}（仅支持 csv / xlsx / xls）`,
        'UNSUPPORTED_TYPE',
        400,
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const dataset = createDataset(file.name, buffer)

    return NextResponse.json({
      id: dataset.id,
      name: dataset.name,
      columns: dataset.columns,
      rowCount: dataset.rows.length,
      createdAt: dataset.createdAt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(msg, 'UPLOAD_FAILED', 400)
  }
}

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}
