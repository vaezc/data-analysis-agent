'use client'

// ============================================================
// useAgent —— 前端消费 /api/agent 的 SSE 流，把事件映射成 React 状态
//
// 用法：
//   const { messages, send, isStreaming, error, reset } = useAgent({ datasetId })
//   await send('哪个区域销售额最高？')
//
// Phase 3 改造（持久化）：
//   - 切换 datasetId 时 → GET /api/messages 加载历史
//   - 不再前端持有 llmHistory（之前的 llmHistoryRef + storeRef Map 模式）
//   - send 时不传 previousMessages —— 后端自己从 DB 加载
//   - done 事件前端不再 append history —— 后端已经保存
//
// 实现要点：
//   - POST 不能用 EventSource，用 fetch + ReadableStream.getReader 手动读
//   - TextDecoder 必须传 stream:true，否则 UTF-8 多字节字符被切断会乱码
//   - 维护 buffer 字符串按 \n\n 切分事件，TCP 不保证一次 read 是完整事件
//   - tool_done 用顺序栈匹配（找最后一个同名 running step 标 done）
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AgentStep, ChatMessage, StreamEvent } from '@/types'

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>

interface UseAgentParams {
  /** 当前激活的数据集 ID；为 null 时 send 会报错 */
  datasetId: string | null
}

interface UseAgentReturn {
  messages: ChatMessage[]
  /**
   * 发送一条用户消息（可附图片）并消费 Agent 的 SSE 响应。
   * images 是 data URL 数组（data:image/...;base64,...），需要 vision-capable LLM
   */
  send: (text: string, images?: string[]) => Promise<void>
  /** 是否正在接收 SSE 事件 */
  isStreaming: boolean
  /** 切换 dataset 后正在从 DB 加载历史。UI 据此显示骨架/控制滚动定位 */
  isLoadingHistory: boolean
  /** 最近一次错误的消息，新一次 send 开始时清空 */
  error: string | null
  /** 手动清除当前错误（× 按钮用） */
  clearError: () => void
  /** 清空当前数据集的对话（前端 state + DB）。"New Chat" 按钮调用。 */
  reset: () => Promise<void>
  /** 删除指定 ui.id 的消息（配对删除）。前端 message hover 时显示的 trash 按钮调用。 */
  deleteMessage: (messageId: string) => Promise<void>
  /** 正在被删除的消息 ui.id 列表（已 fetch 成功，等待动画完成才从 messages 移除） */
  deletingIds: string[]
}

export function useAgent({ datasetId }: UseAgentParams): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 切换 datasetId 时：取消进行中的请求，从 DB 加载历史
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    // Dataset switches deliberately reset transient UI state before loading history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsStreaming(false)
    setError(null)

    if (!datasetId) {
      setMessages([])
      setIsLoadingHistory(false)
      return
    }

    let cancelled = false
    // 进入 loading 态：清空消息 + 标记加载中。ChatPanel 据此跳过滚动动画
    setIsLoadingHistory(true)
    setMessages([])

    fetch(`/api/messages?datasetId=${encodeURIComponent(datasetId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<ChatMessage[]>
      })
      .then((data) => {
        if (cancelled) return
        // 一次 setState 同时更新 messages 和 loading 状态，React 会 batch 成一次 render
        setMessages(data)
        setIsLoadingHistory(false)
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(`加载历史失败：${msg}`)
        setIsLoadingHistory(false)
      })

    return () => {
      cancelled = true
    }
  }, [datasetId])

  const reset = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = null

    // 先调 DELETE 清 DB；DB 失败也要清前端 state（避免不一致挂死）
    if (datasetId) {
      try {
        const res = await fetch(
          `/api/messages?datasetId=${encodeURIComponent(datasetId)}`,
          { method: 'DELETE' },
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`清空对话失败：${msg}`)
        // 不 return —— 仍然清前端 state，否则用户卡在错误态
      }
    }

    setMessages([])
    setError(null)
    setIsStreaming(false)
  }, [datasetId])

  const send = useCallback(
    async (text: string, images?: string[]) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (!datasetId) {
        setError('请先选择数据集')
        return
      }
      if (isStreaming) return

      const assistantId = crypto.randomUUID()
      const hasImages = images && images.length > 0

      // 立刻在 UI 显示用户消息 + 空 assistant 占位（带 spinner）
      // 注意：这里用的 user message id 是前端临时 UUID。
      // 刷新后从 DB 加载会替换成后端 UUID，对用户透明。
      setMessages((prev) => [
        ...prev,
        hasImages
          ? {
              id: crypto.randomUUID(),
              role: 'user',
              content: trimmed,
              images,
            }
          : { id: crypto.randomUUID(), role: 'user', content: trimmed },
        {
          id: assistantId,
          role: 'assistant',
          steps: [],
          charts: [],
          reports: [],
          content: '',
        },
      ])
      setError(null)
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 不再传 previousMessages —— 后端从 DB 加载历史
          body: JSON.stringify({
            datasetId,
            message: trimmed,
            ...(hasImages ? { images } : {}),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const body = (await response
            .json()
            .catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${response.status}`)
        }
        if (!response.body) throw new Error('响应缺少 body')

        await consumeSSE(response.body, (event) => {
          handleEvent(assistantId, event, setMessages, setError)
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          // 用户主动 reset 触发的取消，不算错误
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [datasetId, isStreaming],
  )

  const clearError = useCallback(() => setError(null), [])

  // 删除的两阶段：先 mark deletingIds（触发 UI 淡出动画），等动画完才真 filter
  const [deletingIds, setDeletingIds] = useState<string[]>([])

  /**
   * 动画时长，需与 MessageBubble 的 CSS transition duration 一致。
   * 220ms 与项目其它进出场动画（animate-message-in）对齐，节奏统一。
   */
  const DELETE_ANIM_MS = 220

  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(
        `/api/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { deletedIds: string[] }

      // 阶段 1：标记 deletingIds，UI 上对应消息开始淡出 / 缩放
      setDeletingIds((prev) => [...prev, ...data.deletedIds])

      // 阶段 2：等动画跑完后，真正从 messages 移除 + 清理 deletingIds
      // 用 setTimeout 串行而非 await Promise，避免阻塞——并发删多条时各自独立 timer
      setTimeout(() => {
        setMessages((prev) =>
          prev.filter((m) => !data.deletedIds.includes(m.id)),
        )
        setDeletingIds((prev) =>
          prev.filter((id) => !data.deletedIds.includes(id)),
        )
      }, DELETE_ANIM_MS)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`删除消息失败：${msg}`)
    }
  }, [])

  return {
    messages,
    send,
    isStreaming,
    isLoadingHistory,
    error,
    clearError,
    reset,
    deleteMessage,
    deletingIds,
  }
}

// ============================================================
// SSE 流解析
// ============================================================

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      // 防御性：流结束时如果还有残留事件（理论上不应该有，标准 SSE 必须 \n\n 结尾）
      if (buffer.trim()) {
        const event = parseSSEEvent(buffer)
        if (event) onEvent(event)
      }
      return
    }
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const event = parseSSEEvent(rawEvent)
      if (event) onEvent(event)
    }
  }
}

function parseSSEEvent(raw: string): StreamEvent | null {
  // 我们后端只输出单行 `data: <json>`，不输出 event:/id:/retry:
  const line = raw.split('\n').find((l) => l.startsWith('data:'))
  if (!line) return null
  const json = line.slice(5).trimStart()
  try {
    return JSON.parse(json) as StreamEvent
  } catch {
    return null
  }
}

// ============================================================
// 事件 → 状态更新
// ============================================================

function handleEvent(
  assistantId: string,
  event: StreamEvent,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  setError: Dispatch<SetStateAction<string | null>>,
): void {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === assistantId && m.role === 'assistant'
        ? applyEventToAssistant(m, event)
        : m,
    ),
  )
  if (event.type === 'error') {
    setError(event.message)
  }
}

function applyEventToAssistant(
  msg: AssistantMessage,
  event: StreamEvent,
): AssistantMessage {
  switch (event.type) {
    case 'tool_start': {
      const newStep: AgentStep = {
        tool: event.tool,
        description: event.description,
        status: 'running',
      }
      // 清空 content：流式时中间 turn 可能有"我先看下数据"之类的文字 delta，
      // 工具调用一开始就把已累积的中间文字清掉，确保最终 answer 区只有真正的 final answer
      return { ...msg, steps: [...msg.steps, newStep], content: '' }
    }
    case 'tool_done': {
      // 顺序栈匹配：标记最后一个同名 running step 为 done
      const steps = [...msg.steps]
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].tool === event.tool && steps[i].status === 'running') {
          steps[i] = { ...steps[i], status: 'done' }
          break
        }
      }
      return { ...msg, steps }
    }
    case 'chart': {
      return { ...msg, charts: [...msg.charts, event.chart] }
    }
    case 'report': {
      return { ...msg, reports: [...msg.reports, event.report] }
    }
    case 'answer_delta': {
      // 流式 chunk：追加到 content（打字机效果）
      return { ...msg, content: msg.content + event.text }
    }
    case 'answer': {
      // 非流式 fallback：替换为完整文本
      return { ...msg, content: event.text }
    }
    case 'error': {
      // 把当前最后一个 running 步骤标 error
      const steps = [...msg.steps]
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].status === 'running') {
          steps[i] = { ...steps[i], status: 'error' }
          break
        }
      }
      return { ...msg, steps }
    }
    case 'done': {
      // 后端已保存到 DB，前端不需要做什么
      // 刷新页面时通过 GET /api/messages 重新加载即可
      return msg
    }
  }
}
