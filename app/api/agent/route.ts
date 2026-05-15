// ============================================================
// POST /api/agent  →  SSE 流
//
// 请求体 JSON：{ datasetId: string, message: string }
//
// 响应：text/event-stream，每条事件格式
//   data: <StreamEvent JSON>\n\n
//
// 设计要点：
//   - 用标准 ReadableStream + TextEncoder，不依赖额外库
//   - runAgent 内部已 try/catch 并通过 emit 推 error 事件；外层 try 是防御性
//   - 必须在 finally 中 close controller，否则连接挂起
//   - 关闭代理/Nginx 缓冲（X-Accel-Buffering）防止事件被攒着不发
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@/lib/agent'
import type { ChatCompletionMessageParam } from '@/lib/llm'
import type { StreamEvent } from '@/types'

export const runtime = 'nodejs'
// Vercel serverless 默认 timeout：Hobby 10s / Pro 60s / Fluid 800s。
// SSE 流式 + 多步 Agent 可能跑 30~60s，必须显式设置 maxDuration 上限。
// Vercel 会按账户 plan 上限自动 cap，多写无害。
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // ---------- 1. 解析 & 校验请求体 ----------
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: '请求体必须是合法 JSON', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  if (!isObject(body)) {
    return NextResponse.json(
      { error: '请求体必须是对象', code: 'INVALID_BODY' },
      { status: 400 },
    )
  }

  const datasetId = body.datasetId
  if (typeof datasetId !== 'string' || datasetId.length === 0) {
    return NextResponse.json(
      { error: '缺少 datasetId', code: 'MISSING_DATASET' },
      { status: 400 },
    )
  }

  const message = body.message
  if (typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json(
      { error: '缺少 message', code: 'MISSING_MESSAGE' },
      { status: 400 },
    )
  }

  // previousMessages 来自前端 llmHistory，前端把它当黑盒原样回传。
  // 这里只校验是数组（合法即可），不解构内部 — 由 runAgent 转给 LLM。
  const rawHistory = body.previousMessages
  if (rawHistory !== undefined && !Array.isArray(rawHistory)) {
    return NextResponse.json(
      { error: 'previousMessages 必须是数组', code: 'INVALID_HISTORY' },
      { status: 400 },
    )
  }
  const previousMessages = (rawHistory ?? []) as ChatCompletionMessageParam[]

  // ---------- 2. 构造 SSE 流 ----------
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          // 客户端已断开，controller 已关闭。忽略即可。
        }
      }

      try {
        await runAgent({
          datasetId,
          userMessage: message,
          previousMessages,
          onEvent: emit,
        })
      } catch (e) {
        // runAgent 内部已经处理；这里兜底
        const msg = e instanceof Error ? e.message : String(e)
        emit({ type: 'error', message: `Agent 流错误：${msg}` })
      } finally {
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 关闭代理/Nginx 对 SSE 的缓冲，确保事件实时推送
      'X-Accel-Buffering': 'no',
    },
  })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
