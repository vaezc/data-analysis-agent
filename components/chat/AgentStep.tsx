'use client'

import {
  BarChart3,
  Calculator,
  Check,
  Database,
  FileText,
  Loader2,
  X,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import type { AgentStep, ToolName } from '@/types'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICON: Record<ToolName, IconType> = {
  inspect_data: Database,
  run_analysis: Calculator,
  create_chart: BarChart3,
  generate_report: FileText,
}

interface AgentStepRowProps {
  step: AgentStep
  /** 是否为最后一步 —— 非最后一步在图标下方画时间线连接线 */
  isLast?: boolean
}

export function AgentStepRow({ step, isLast = true }: AgentStepRowProps) {
  const Icon = TOOL_ICON[step.tool]
  const isRunning = step.status === 'running'
  const isError = step.status === 'error'

  return (
    <div className="flex items-center gap-2.5 text-sm">
      {/* 图标 + 时间线连接线（非末步），让多步推理读作一条序列 */}
      <div className="relative shrink-0">
        <div
          className={`size-7 rounded-md grid place-items-center transition-colors ${
            isError
              ? 'bg-danger-soft text-danger'
              : isRunning
                ? 'bg-accent-soft text-accent'
                : 'bg-surface text-fg-muted'
          }`}
        >
          <Icon className="size-3.5" />
        </div>
        {!isLast && (
          <span
            className="absolute left-1/2 top-full h-1.5 w-px -translate-x-1/2 bg-border"
            aria-hidden
          />
        )}
      </div>
      <span
        className={`flex-1 ${isError ? 'text-danger' : 'text-fg-muted'}`}
      >
        {step.description}
      </span>
      {isRunning && (
        <Loader2 className="size-3.5 animate-spin text-accent" />
      )}
      {step.status === 'done' && (
        <Check className="size-3.5 text-success" />
      )}
      {isError && <X className="size-3.5 text-danger" />}
    </div>
  )
}
