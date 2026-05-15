// ============================================================
// 工具定义（4 个）
//
// 这些是给 LLM 看的 schema，决定模型何时调用何工具、传什么参数。
// description 写不好，模型会调错或不调，是 Agent 行为质量的关键来源。
//
// 格式遵循 OpenAI Function Calling 规范；DeepSeek 完全兼容。
// 实际执行逻辑在 lib/tools/executor.ts。
// ============================================================

import type { ChatCompletionTool } from '@/lib/llm'
import type { ToolName } from '@/types'

const inspect_data: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'inspect_data',
    description:
      '查看数据集的结构信息（列名、列类型、行数、null 统计、前 3 行样本）。' +
      '【必须步骤】：在调用 run_analysis 或 create_chart 之前，每个新的数据集必须先调用一次此工具，' +
      '以便了解数据形态。如果已经在当前对话中 inspect 过同一个 dataset_id，可以不重复调用。',
    parameters: {
      type: 'object',
      properties: {
        dataset_id: {
          type: 'string',
          description: '要查看的数据集 ID，由系统在对话开始时告知。',
        },
      },
      required: ['dataset_id'],
      additionalProperties: false,
    },
  },
}

const run_analysis: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_analysis',
    description:
      '对数据集执行分析计算（分组聚合、过滤、排序、统计等）。' +
      'intent 用自然语言描述具体要算什么，越具体越好；' +
      'description 是给用户看的简短步骤说明，用现在进行时（如"正在按区域汇总销售额..."）。',
    parameters: {
      type: 'object',
      properties: {
        dataset_id: {
          type: 'string',
          description: '数据集 ID。',
        },
        intent: {
          type: 'string',
          description:
            '用自然语言精确描述分析意图。示例：' +
            '"按 region 列分组并对 sales 列求和，按总和降序排列"，' +
            '"过滤出 status = active 的行后，对 revenue 求平均值与中位数"。' +
            '务必使用数据集真实存在的列名（先 inspect_data 确认）。',
        },
        description: {
          type: 'string',
          description:
            '给用户看的步骤说明，中文，现在进行时，不超过 20 字。例如："正在按区域汇总销售额..."。',
        },
      },
      required: ['dataset_id', 'intent', 'description'],
      additionalProperties: false,
    },
  },
}

const create_chart: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_chart',
    description:
      '生成图表并展示给用户。仅在已通过 run_analysis 拿到可视化的聚合数据后调用。' +
      'labels 与 datasets[].data 长度必须相等。pie 类型只能有 1 个 dataset。',
    parameters: {
      type: 'object',
      properties: {
        chart_type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter'],
          description:
            '图表类型：bar=分类对比，line=趋势，pie=占比，scatter=两变量关系。',
        },
        title: {
          type: 'string',
          description: '图表标题，简短中文。',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'X 轴标签（柱/线/散点）或扇区标签（饼图）。',
        },
        datasets: {
          type: 'array',
          description:
            '一组或多组数据。多组用于对比（例如不同年份的同一指标）。',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: '该组数据的名称，例如 "2024 年" 或 "销售额"。',
              },
              data: {
                type: 'array',
                items: { type: 'number' },
                description: '与 labels 等长的数值数组。',
              },
            },
            required: ['label', 'data'],
            additionalProperties: false,
          },
        },
      },
      required: ['chart_type', 'title', 'labels', 'datasets'],
      additionalProperties: false,
    },
  },
}

const generate_report: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_report',
    description:
      '将本次分析整理为报告供用户下载（HTML 格式）。' +
      '本轮已通过 create_chart 生成的图表会被系统自动嵌入到报告的"可视化图表"段落，' +
      '因此你不要在 summary 或 sections.content 里使用 markdown 图片语法 `![alt](url)`，也不要自己造图表章节。' +
      '专注用文字呈现关键结论与分析。' +
      '仅在用户明确要求"生成报告"、"导出"、"总结成文档"等场景下调用，不要主动调用。',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '报告标题。',
        },
        summary: {
          type: 'string',
          description: '一段话核心结论，2~4 句，Markdown。',
        },
        sections: {
          type: 'array',
          description: '正文章节，按逻辑顺序排列。',
          items: {
            type: 'object',
            properties: {
              heading: {
                type: 'string',
                description: '章节标题（不含 # 符号）。',
              },
              content: {
                type: 'string',
                description:
                  '章节正文，Markdown 格式，可包含列表、表格、加粗等。',
              },
            },
            required: ['heading', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'summary', 'sections'],
      additionalProperties: false,
    },
  },
}

/**
 * 按名称索引的工具定义表。
 * executor.ts 用 toolName 反查 schema，agent.ts 用 Object.values 传给 LLM。
 */
export const TOOL_DEFINITIONS: Record<ToolName, ChatCompletionTool> = {
  inspect_data,
  run_analysis,
  create_chart,
  generate_report,
}

/** 传给 LLM `tools` 字段的数组 */
export const TOOL_LIST: ChatCompletionTool[] = Object.values(TOOL_DEFINITIONS)
