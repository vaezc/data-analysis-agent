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
}

export function AgentStepRow({ step }: AgentStepRowProps) {
  const Icon = TOOL_ICON[step.tool]
  const isRunning = step.status === 'running'
  const isError = step.status === 'error'

  return (
    <div className="flex items-center gap-2.5 text-sm">
      <div
        className={`size-7 shrink-0 rounded-md grid place-items-center transition-colors ${
          isError
            ? 'bg-danger-soft text-danger'
            : isRunning
              ? 'bg-accent-soft text-accent'
              : 'bg-surface text-fg-muted'
        }`}
      >
        <Icon className="size-3.5" />
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
