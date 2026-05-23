// ============================================================
// 工具：run_analysis
//
// 二次 LLM 把自然语言 intent 翻译成 SQLite SQL，better-sqlite3 :memory:
// 执行并返回聚合结果。结果数组超阈值会截断并附 _truncated 提示。
// ============================================================

import { z } from 'zod'
import { defineTool } from './registry'
import { chatCompletion } from '@/lib/llm'
import { getDataset } from '@/lib/db/datasets'
import { runSQLOnDataset } from '@/lib/tools/sqlite-runner'
import type { AnalysisResult, Column, Row } from '@/types'

const schema = z.object({
  dataset_id: z.string().min(1),
  intent: z.string().min(1),
  description: z.string().min(1),
})

const ANALYSIS_SYSTEM_PROMPT = `你是数据分析 SQL 生成器。根据用户的自然语言意图，生成一条 SQLite SQL 查询。

执行环境：
- 表名固定为 \`data\`
- 列名**必须用双引号包裹**（如 "region"），支持中文 / 空格 / 关键字
- SQL 方言：SQLite（GROUP BY / HAVING / ORDER BY / LIMIT / CTE / 窗口函数都支持）
- 数据类型：number → REAL，boolean → INTEGER (0/1)，date → TEXT（ISO 格式 YYYY-MM-DD）

输出要求：
- 只输出一条 SELECT 或 WITH 语句，不要 markdown 围栏（不要 \`\`\`sql）、不要解释
- 必须使用提供的真实列名
- 处理 null 用 COALESCE 或 IFNULL
- 字符串字面量用单引号
- **严禁** INSERT / UPDATE / DELETE / DROP / ALTER / ATTACH / PRAGMA 等修改性语句

示例：
列：region(string), sales(number)
意图：按 region 分组对 sales 求和，按总和降序

输出：
SELECT "region", SUM(COALESCE("sales", 0)) AS total
FROM data
GROUP BY "region"
ORDER BY total DESC`

// ============================================================
// Tool result 截断
//
// 单次 tool result 的 token 占用上限，防长对话累积爆炸。
// 估算：JSON 字符数 / 4 ≈ token；MAX_CHARS 6000 ≈ 1500 token。
// _truncated 字段让 LLM 知道有遗漏，可在回答里说"基于前 N 项"。
// ============================================================

const TOOL_RESULT_LIMITS = {
  MAX_ARRAY_ITEMS: 30,
  MAX_CHARS: 6000,
} as const

function truncateForLLM(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS) {
      return {
        items: value.slice(0, TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS),
        _truncated: {
          original_length: value.length,
          shown: TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS,
          hint: `共 ${value.length} 项，仅展示前 ${TOOL_RESULT_LIMITS.MAX_ARRAY_ITEMS} 项。如需完整结果请改进 intent（如加 limit / top N / 过滤条件）让结果更聚焦。`,
        },
      }
    }
    return value
  }
  const jsonLen = JSON.stringify(value).length
  if (jsonLen > TOOL_RESULT_LIMITS.MAX_CHARS) {
    return {
      _truncated: {
        original_chars: jsonLen,
        hint: `结果较大（${jsonLen} 字符），请改进 intent 让结果更聚焦`,
      },
    }
  }
  return value
}

async function generateAnalysisSQL(
  columns: Column[],
  sample: Row[],
  intent: string,
): Promise<string> {
  const schemaStr = columns.map((c) => `"${c.name}"(${c.type})`).join(', ')
  const userMsg =
    `列：${schemaStr}\n` +
    `样本（前 ${sample.length} 行）：${JSON.stringify(sample)}\n` +
    `意图：${intent}`

  const completion = await chatCompletion({
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.2,
    debugTag: 'sql-gen (2nd LLM)',
  })

  let sql = completion.choices[0]?.message?.content?.trim() ?? ''
  sql = sql
    .replace(/^```(?:sql|sqlite)?\s*\n/i, '')
    .replace(/\n?```$/, '')
    .trim()
  if (!sql) throw new Error('LLM 未生成 SQL')
  return sql
}

export const runAnalysisTool = defineTool({
  name: 'run_analysis',
  description:
    '对数据集执行分析计算（分组聚合、过滤、排序、统计等）。' +
    'intent 用自然语言描述具体要算什么，越具体越好；' +
    'description 是给用户看的简短步骤说明，用现在进行时（如"正在按区域汇总销售额..."）。',
  uiDescription: '正在分析数据...',
  uiDescriptionFrom: (args) => args.description,
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
  schema,
  async run(args, ctx): Promise<AnalysisResult> {
    const ds = await getDataset(args.dataset_id, ctx.userId)
    if (!ds) throw new Error(`数据集不存在：${args.dataset_id}`)

    const sql = await generateAnalysisSQL(
      ds.columns,
      ds.rows.slice(0, 2),
      args.intent,
    )
    const result = runSQLOnDataset(sql, ds.columns, ds.rows)

    return { description: args.description, data: truncateForLLM(result) }
  },
})
