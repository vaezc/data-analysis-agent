'use client'

import { AlertCircle, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { AgentStep } from '@/types'
import { AgentStepRow } from './AgentStep'

interface StepListProps {
  steps: AgentStep[]
}

/**
 * Agent 步骤列表 —— header 常驻显示一行 summary，点击展开明细。
 *
 *   执行中：[spinner] 正在按区域汇总销售额...        ⌄
 *   完成： [check]   3 步分析已完成                ⌄
 *   失败： [alert]   执行失败                     ⌃（强制展开）
 *
 * 展开/收起用 grid-template-rows 0fr↔1fr 做平滑高度过渡（无需测量高度），
 * chevron 旋转跟随；出错时强制展开。
 */
export function StepList({ steps }: StepListProps) {
  const hasError = steps.some((s) => s.status === 'error')
  const runningStep = steps.find((s) => s.status === 'running')
  const allDone = steps.length > 0 && steps.every((s) => s.status === 'done')

  const [open, setOpen] = useState(false)
  const isOpen = open || hasError

  return (
    <div
      className={`rounded-md transition-colors duration-200 ${
        isOpen ? 'border border-border bg-surface/40' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={hasError}
        aria-expanded={isOpen}
        className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          hasError ? 'cursor-default' : 'hover:bg-surface'
        }`}
      >
        {hasError ? (
          <>
            <AlertCircle className="size-3.5 shrink-0 text-danger animate-fade-in" />
            <span className="text-danger animate-fade-in">执行失败</span>
          </>
        ) : runningStep ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
            {/* key={description} 让文字切换时 remount 触发淡入，避免突变 */}
            <span
              key={runningStep.description}
              className="text-fg-muted animate-text-swap"
            >
              {runningStep.description}
            </span>
          </>
        ) : allDone ? (
          <>
            <Check className="size-3.5 shrink-0 text-success animate-fade-in" />
            <span className="text-fg-muted animate-fade-in">
              {steps.length} 步分析已完成
            </span>
          </>
        ) : (
          <span className="text-fg-muted">{steps.length} 步</span>
        )}

        {!hasError && (
          <ChevronDown
            className={`ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform duration-200 ${
              isOpen ? 'rotate-180' : 'group-hover:translate-y-0.5'
            }`}
          />
        )}
      </button>

      {/* grid-rows 技巧：0fr→1fr 平滑高度过渡，内层 overflow-hidden 裁剪 */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-1.5 border-t border-border/70 px-2.5 py-2">
            {steps.map((step, i) => (
              <AgentStepRow key={i} step={step} isLast={i === steps.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
