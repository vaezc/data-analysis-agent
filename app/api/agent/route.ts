// ============================================================
// POST /api/agent  →  SSE 流
//
// 请求体 JSON：{ datasetId: string, message: string }
//
// 响应：text/event-stream，每条事件格式
//   data: <StreamEvent JSON>\n\n
//
// Phase 3 改造（持久化）：
//   - 不再从 body 读 previousMessages —— 后端自己从 DB 加载
//   - 进入 agent 前立刻 insert user message（即使 agent 挂掉用户消息也保留）
//   - 流过程中用 reducer 累积 assistant ChatMessage 状态
//   - 流结束在 finally 中保存 assistant message 到 DB
//
// 设计要点：
//   - 用标准 ReadableStream + TextEncoder，不依赖额外库
//   - runAgent 内部已 try/catch 并通过 emit 推 error 事件；外层 try 是防御性
//   - 必须在 finally 中 close controller，否则连接挂起
//   - 关闭代理/Nginx 缓冲（X-Accel-Buffering）防止事件被攒着不发
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runAgent } from '@/lib/agent'
import type { ChatCompletionMessageParam } from '@/lib/llm'
import {
  loadConversation,
  saveAssistantMessage,
  saveUserMessage,
} from '@/lib/db/messages'
import type { AgentStep, ChatMessage, StreamEvent } from '@/types'

export const runtime = 'nodejs'
// Vercel serverless 默认 timeout：Hobby 10s / Pro 60s / Fluid 800s。
// SSE 流式 + 多步 Agent 可能跑 30~60s，必须显式设置 maxDuration 上限。
// Vercel 会按账户 plan 上限自动 cap，多写无害。
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // ---------- 0. 鉴权 ----------
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: '请先登录', code: 'UNAUTHENTICATED' },
      { status: 401 },
    )
  }
  const userId = session.user.id

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
  const userText = message.trim()

  // 可选 images（vision multimodal）：data URL 数组
  const rawImages = body.images
  let userImages: string[] | undefined
  if (rawImages !== undefined) {
    if (
      !Array.isArray(rawImages) ||
      !rawImages.every((s) => typeof s === 'string' && s.startsWith('data:'))
    ) {
      return NextResponse.json(
        { error: 'images 必须是 data URL 字符串数组', code: 'INVALID_IMAGES' },
        { status: 400 },
      )
    }
    userImages = rawImages
  }

  // ---------- 2. 加载历史 + 入库用户消息（含 owner check） ----------
  let previousMessages: ChatCompletionMessageParam[] = []
  try {
    const conv = await loadConversation(datasetId, userId)
    previousMessages = conv.llmMessages
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // owner check 失败时数据层抛"数据集不存在或无权访问"——映射为 404
    const status = msg.includes('无权访问') || msg.includes('不存在') ? 404 : 500
    return NextResponse.json(
      { error: `加载历史失败：${msg}`, code: 'LOAD_HISTORY_FAILED' },
      { status },
    )
  }

  try {
    await saveUserMessage(datasetId, userId, userText, userImages)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `保存用户消息失败：${msg}`, code: 'SAVE_USER_FAILED' },
      { status: 500 },
    )
  }

  // ---------- 3. 构造 SSE 流 + 累积 assistant 状态 ----------
  const encoder = new TextEncoder()

  // 累积本轮 assistant 的 UI 状态（SSE 流结束后写入 DB）
  const assistant: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    steps: [],
    charts: [],
    reports: [],
    content: '',
  }
  // 累积本轮新增的 LLM messages（done 事件携带）
  let newLlmMessages: ChatCompletionMessageParam[] = []

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        // 1. 推给前端
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          // 客户端已断开，controller 已关闭。忽略即可。
        }
        // 2. 累积 assistant 状态（用于 DB 持久化）
        applyEventToAssistant(assistant, event)
        if (event.type === 'done') {
          // runAgent 的 done.messages 切片含 user + assistant + tool 序列
          // user 消息我们已经单独保存了（saveUserMessage），这里把它跳过
          newLlmMessages = (event.messages as ChatCompletionMessageParam[]).filter(
            (m) => m.role !== 'user',
          )
        }
      }

      try {
        await runAgent({
          datasetId,
          userId,
          userMessage: userText,
          userImages,
          previousMessages,
          onEvent: emit,
        })
      } catch (e) {
        // runAgent 内部已经处理；这里兜底
        const msg = e instanceof Error ? e.message : String(e)
        emit({ type: 'error', message: `Agent 流错误：${msg}` })
      } finally {
        // 保存 assistant message —— 即使流出错也要存（包含已经产生的部分 state）
        // 但完全空的 assistant（一个 event 都没收到）不存
        if (
          assistant.content ||
          assistant.steps.length > 0 ||
          assistant.charts.length > 0 ||
          assistant.reports.length > 0
        ) {
          try {
            await saveAssistantMessage(
              datasetId,
              userId,
              assistant,
              newLlmMessages,
            )
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            emit({ type: 'error', message: `保存对话失败：${msg}` })
          }
        }
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

// ============================================================
// SSE event → assistant ChatMessage reducer
//
// 与前端 hooks/use-agent.ts 的 applyEventToAssistant 同源逻辑。
// 服务端这一份用于在写库前累积出完整的 UI 形态。
// 直接 mutate 入参（性能 + 简单）。
// ============================================================

function applyEventToAssistant(
  msg: ChatMessage & { role: 'assistant' },
  event: StreamEvent,
): void {
  if (msg.role !== 'assistant') return

  switch (event.type) {
    case 'tool_start': {
      const step: AgentStep = {
        tool: event.tool,
        description: event.description,
        status: 'running',
      }
      msg.steps.push(step)
      // 清空 content：流式时中间 turn 可能有"我先看下数据"之类的文字
      msg.content = ''
      return
    }
    case 'tool_done': {
      for (let i = msg.steps.length - 1; i >= 0; i--) {
        if (msg.steps[i].tool === event.tool && msg.steps[i].status === 'running') {
          msg.steps[i].status = 'done'
          return
        }
      }
      return
    }
    case 'chart':
      msg.charts.push(event.chart)
      return
    case 'report':
      msg.reports.push(event.report)
      return
    case 'answer_delta':
      msg.content += event.text
      return
    case 'answer':
      msg.content = event.text
      return
    case 'error': {
      for (let i = msg.steps.length - 1; i >= 0; i--) {
        if (msg.steps[i].status === 'running') {
          msg.steps[i].status = 'error'
          return
        }
      }
      return
    }
    case 'done':
      // 由外层捕获 newLlmMessages，这里不动 UI 状态
      return
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
