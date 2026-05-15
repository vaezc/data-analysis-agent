'use client'

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import type { AgentStep } from '@/types'
import { AgentStepRow } from './AgentStep'

interface StepListProps {
  steps: AgentStep[]
}

/**
 * Agent 步骤列表 —— 始终以一行 summary 形态显示，节省垂直空间让 answer 区视口可见。
 *
 *   执行中：[spinner] 正在按区域汇总销售额...        ▾   ← 跟随 running step
 *   完成： [check]   3 步分析已完成                ▾
 *   失败： [alert]   执行失败                     ▾   （强制展开）
 *
 * 点击 chevron 展开完整步骤列表。
 */
export function StepList({ steps }: StepListProps) {
  const hasError = steps.some((s) => s.status === 'error')
  const runningStep = steps.find((s) => s.status === 'running')
  const allDone =
    steps.length > 0 && steps.every((s) => s.status === 'done')

  // 出错时强制展开，否则默认折叠
  const [open, setOpen] = useState(false)
  const isOpen = open || hasError

  if (isOpen) {
    return (
      <div className="rounded-md border border-border bg-surface/40 p-2.5 space-y-1.5">
        <div className="flex items-center justify-between pb-1">
          <span className="text-[11px] uppercase tracking-wider text-fg-subtle font-medium">
            执行步骤
          </span>
          {!hasError && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-[11px] text-fg-subtle transition-colors duration-150 hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
            >
              <ChevronUp className="size-3" />
              收起
            </button>
          )}
        </div>
        {steps.map((step, i) => (
          <AgentStepRow key={i} step={step} />
        ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group inline-flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-sm transition duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {hasError ? (
        <>
          <AlertCircle className="size-3.5 text-danger shrink-0 animate-fade-in" />
          <span className="text-danger animate-fade-in">执行失败</span>
        </>
      ) : runningStep ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-accent shrink-0" />
          {/* key={description} 让文字切换时 remount 触发淡入动画，避免突变 */}
          <span
            key={runningStep.description}
            className="text-fg-muted animate-text-swap"
          >
            {runningStep.description}
          </span>
        </>
      ) : allDone ? (
        <>
          <Check className="size-3.5 text-success shrink-0 animate-fade-in" />
          <span className="text-fg-muted animate-fade-in">
            {steps.length} 步分析已完成
          </span>
        </>
      ) : (
        <span className="text-fg-muted">{steps.length} 步</span>
      )}
      <ChevronDown className="size-3.5 text-fg-subtle transition-transform duration-150 group-hover:translate-y-0.5" />
    </button>
  )
}
