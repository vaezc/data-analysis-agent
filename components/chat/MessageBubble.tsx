'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types'
import { ChartRenderer } from './ChartRenderer'
import { ReportCard } from './ReportCard'
import { StepList } from './StepList'

interface MessageBubbleProps {
  message: ChatMessage
  /** 是否正在流式接收（用于显示 thinking indicator）*/
  isStreaming?: boolean
  /** 是否是最后一条消息（thinking indicator 只在最后一条显示） */
  isLast?: boolean
}

export function MessageBubble({
  message,
  isStreaming = false,
  isLast = false,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-message-in">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[15px] text-accent-fg leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // 显示 thinking 的条件：流式中 + 最后一条 + 没有 content + 没有 step 在 running
  // 这正好覆盖了"工具都完成了但 final answer 还没开始流"的空档
  const noRunningStep = message.steps.every((s) => s.status !== 'running')
  const noContent = !message.content.trim()
  const showThinking = isStreaming && isLast && noContent && noRunningStep

  return (
    <div className="flex gap-3 animate-message-in">
      {/* AI 头像 —— 用品牌图，背景放大居中让机器人主体填满圆形 */}
      <div
        className="size-8 shrink-0 rounded-full bg-no-repeat shadow-sm shadow-fg/10"
        style={{
          backgroundImage: 'url(/image.png)',
          backgroundSize: '320%',
          backgroundPosition: '50% 30%',
        }}
        aria-label="AI"
        role="img"
      />
      <div className="flex-1 min-w-0 space-y-3">
        {message.steps.length > 0 && <StepList steps={message.steps} />}
        {message.charts.map((chart, i) => (
          <ChartRenderer key={i} chart={chart} chartKey={`${message.id}-${i}`} />
        ))}
        {message.reports.map((report, i) => (
          <ReportCard
            key={i}
            report={report}
            charts={message.charts}
            chartKeys={message.charts.map((_, j) => `${message.id}-${j}`)}
          />
        ))}
        {message.content && (
          // Final answer 气泡：accent-soft tint 让"结论"视觉成块
          // rounded-tl-sm 呼应用户气泡的 rounded-br-sm
          <div className="rounded-2xl rounded-tl-sm border border-accent/15 bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-fg animate-fade-in">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {showThinking && <ThinkingIndicator />}
      </div>
    </div>
  )
}

function ThinkingIndicator() {
  // h-8 与 AI 头像同高，让 thinking 状态时头像和 indicator 视觉居中对齐
  return (
    <div className="flex h-8 items-center gap-2 text-sm text-fg-muted animate-fade-in">
      <span className="flex gap-1 items-end h-3.5">
        <span className="size-1.5 rounded-full bg-fg-subtle animate-typing-dot" />
        <span className="size-1.5 rounded-full bg-fg-subtle animate-typing-dot [animation-delay:200ms]" />
        <span className="size-1.5 rounded-full bg-fg-subtle animate-typing-dot [animation-delay:400ms]" />
      </span>
      <span>正在思考</span>
    </div>
  )
}

// ============================================================
// Markdown 元素 → token-based 样式
//
// 不引入 @tailwindcss/typography，手写让样式贴合 chat 紧凑场景。
// 所有颜色用语义 token，主题切换自动生效。
// ============================================================

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold text-fg first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold text-fg first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold text-fg first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-2.5 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2.5 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-fg">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline underline-offset-2"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-fg-muted">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <code className="block font-mono text-[13px] text-fg">
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-surface px-1 py-0.5 font-mono text-[13px] text-fg">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-2.5 overflow-x-auto rounded-md border border-border bg-surface p-3 last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  // Notion 风：只横线、无列线
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-fg-muted">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-fg-muted">{children}</td>
  ),
}
