// ============================================================
// 全局类型定义
//
// 组织方式：按领域分块（工具 / 数据集 / 图表 / 报告 / SSE / 前端状态）
// 命名约定：interface 用于对象形状，type 用于联合 / 字面量 / 别名
// ============================================================

// ---------- 工具 ----------

/** Agent 可调用的 4 个工具名 */
export type ToolName =
  | 'inspect_data'
  | 'run_analysis'
  | 'create_chart'
  | 'generate_report'

// ---------- 数据集 ----------

/** CSV/Excel 解析后推断的列类型 */
export type ColumnType = 'string' | 'number' | 'date' | 'boolean'

export interface Column {
  name: string
  type: ColumnType
  /** null / 空字符串 / NaN 的总数，inspect_data 工具会用到 */
  nullCount: number
}

/** 单行数据：列名 → 值（papaparse header:true 的输出形态） */
export type Row = Record<string, unknown>

/** 内存中存储的完整数据集 */
export interface Dataset {
  id: string
  /** 原始文件名（含扩展名） */
  name: string
  columns: Column[]
  rows: Row[]
  /** 创建时间（毫秒时间戳） */
  createdAt: number
}

/** inspect_data 工具的返回结构 */
export interface DatasetSummary {
  dataset_id: string
  name: string
  columns: Column[]
  rowCount: number
  /** 前 3 行样本，给 LLM 看数据形态 */
  sampleRows: Row[]
}

// ---------- 分析结果 ----------

/**
 * run_analysis 工具的返回。
 * Phase 1 用通用形态：description 是 LLM 友好的说明，data 是结构化结果。
 * 不强约束 data 的形状，由具体 intent 决定（聚合返回数组、统计返回对象等）。
 */
export interface AnalysisResult {
  description: string
  data: unknown
}

// ---------- 图表 ----------

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter'

export interface ChartDataset {
  label: string
  data: number[]
}

/**
 * Chart.js 风格的图表配置。
 * Recharts 渲染时由 ChartRenderer 把 labels + datasets 拍平成 Recharts 的 data 数组。
 */
export interface ChartConfig {
  chart_type: ChartType
  title: string
  labels: string[]
  datasets: ChartDataset[]
}

// ---------- 报告 ----------

export interface ReportSection {
  heading: string
  /** Markdown 内容 */
  content: string
}

export interface ReportConfig {
  title: string
  summary: string
  sections: ReportSection[]
}

// ---------- SSE 流式事件 ----------

/**
 * 后端通过 SSE 推给前端的事件联合类型。
 * 前端 use-agent hook 按 type 字段分发到对应消息字段。
 *
 * `done` 仅在 happy path（answer 推送后）发出，携带本轮新增的 LLM 格式 message，
 * 前端原样保存到 llmHistory，下次发送时回传给后端构成多轮上下文。
 * 前端把 `messages` 当作黑盒（unknown[]），不解构 — 类型只在后端 lib/agent.ts 内部需要。
 */
export type StreamEvent =
  | { type: 'tool_start'; tool: ToolName; description: string }
  | { type: 'tool_done'; tool: ToolName }
  | { type: 'chart'; chart: ChartConfig }
  | { type: 'report'; report: ReportConfig }
  /** 流式 chunk：每次到达的文本片段（前端追加到 content） */
  | { type: 'answer_delta'; text: string }
  /** 非流式 / fallback：一次性完整文本（前端替换 content） */
  | { type: 'answer'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; messages: unknown[] }

// ---------- 前端状态 ----------

/** 前端展示的单个 Agent 步骤（对应一次工具调用的进度） */
export interface AgentStep {
  tool: ToolName
  description: string
  status: 'running' | 'done' | 'error'
}

/**
 * 对话消息（前端状态）。
 * 用户消息只有文字；Agent 消息聚合了步骤、图表和最终回答三块。
 */
export type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string
      role: 'assistant'
      steps: AgentStep[]
      charts: ChartConfig[]
      reports: ReportConfig[]
      /** 最终文字回答（Markdown） */
      content: string
    }
