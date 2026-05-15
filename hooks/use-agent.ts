'use client'

// ============================================================
// useAgent —— 前端消费 /api/agent 的 SSE 流，把事件映射成 React 状态
//
// 用法：
//   const { messages, send, isStreaming, error, reset } = useAgent({ datasetId })
//   await send('哪个区域销售额最高？')
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

/** 每个数据集的对话存档（UI 消息 + LLM 黑盒历史） */
interface DatasetHistory {
  messages: ChatMessage[]
  llmHistory: unknown[]
}

interface UseAgentParams {
  /** 当前激活的数据集 ID；为 null 时 send 会报错 */
  datasetId: string | null
}

interface UseAgentReturn {
  messages: ChatMessage[]
  /** 发送一条用户消息并消费 Agent 的 SSE 响应 */
  send: (text: string) => Promise<void>
  /** 是否正在接收 SSE 事件 */
  isStreaming: boolean
  /** 最近一次错误的消息，新一次 send 开始时清空 */
  error: string | null
  /** 清空当前数据集的对话（不影响其他数据集），并取消进行中的请求 */
  reset: () => void
}

export function useAgent({ datasetId }: UseAgentParams): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // LLM 格式的历史，前端当黑盒维护（不解构内部）。每轮 done 事件后 append。
  const llmHistoryRef = useRef<unknown[]>([])

  // ---- 多数据集独立存档 ----
  // 切换 datasetId 时不丢历史：旧 dataset 的对话存进 Map，新 dataset 从 Map 取出。
  // 各数据集的 LLM 上下文相互隔离（不会污染）— 因为切换时 swap 整个 llmHistory。
  const storeRef = useRef<Map<string, DatasetHistory>>(new Map())
  // 跟踪最新 messages 供 useEffect cleanup 读取（避免 stale closure）
  const messagesRef = useRef<ChatMessage[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setError(null)
    setIsStreaming(false)
    llmHistoryRef.current = []
    if (datasetId) {
      storeRef.current.delete(datasetId)
    }
  }, [datasetId])

  // dataset 切换：保存离开的（cleanup）+ 加载进入的（effect body）。
  // 单次切换的时序：
  //   1. cleanup 跑：把 messagesRef / llmHistoryRef 当前值写到 storeRef 的旧 datasetId
  //   2. body 跑：从 storeRef 读新 datasetId 的存档，setMessages + 重置 refs
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    setError(null)

    if (datasetId) {
      const stored = storeRef.current.get(datasetId)
      const initial = stored?.messages ?? []
      setMessages(initial)
      messagesRef.current = initial
      llmHistoryRef.current = stored?.llmHistory ?? []
    } else {
      setMessages([])
      messagesRef.current = []
      llmHistoryRef.current = []
    }

    return () => {
      if (datasetId) {
        storeRef.current.set(datasetId, {
          messages: messagesRef.current,
          llmHistory: llmHistoryRef.current,
        })
      }
    }
  }, [datasetId])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (!datasetId) {
        setError('请先选择数据集')
        return
      }
      if (isStreaming) return

      const assistantId = crypto.randomUUID()

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed },
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
          body: JSON.stringify({
            datasetId,
            message: trimmed,
            previousMessages: llmHistoryRef.current,
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
          if (event.type === 'done') {
            // 多轮上下文：把本轮新增的 LLM messages append 到 history
            llmHistoryRef.current = [
              ...llmHistoryRef.current,
              ...event.messages,
            ]
            return
          }
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

  return { messages, send, isStreaming, error, reset }
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
      // done 事件由 send() 内部直接处理（更新 llmHistoryRef），UI 不响应
      return msg
    }
  }
}
