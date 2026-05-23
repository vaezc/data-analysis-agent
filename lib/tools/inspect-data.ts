// ============================================================
// 工具：inspect_data
//
// 查看数据集结构（列、类型、行数、null 统计、3 行样本）。
// Agent 在分析任何新数据集之前必须先调用。
// ============================================================

import { z } from 'zod'
import { defineTool } from './registry'
import { getDatasetSummary } from '@/lib/db/datasets'

const schema = z.object({
  dataset_id: z.string().min(1),
})

export const inspectDataTool = defineTool({
  name: 'inspect_data',
  description:
    '查看数据集的结构信息（列名、列类型、行数、null 统计、前 3 行样本）。' +
    '【必须步骤】：在调用 run_analysis 或 create_chart 之前,每个新的数据集必须先调用一次此工具,' +
    '以便了解数据形态。如果已经在当前对话中 inspect 过同一个 dataset_id,可以不重复调用。',
  uiDescription: '正在读取数据结构...',
  parameters: {
    type: 'object',
    properties: {
      dataset_id: {
        type: 'string',
        description: '要查看的数据集 ID,由系统在对话开始时告知。',
      },
    },
    required: ['dataset_id'],
    additionalProperties: false,
  },
  schema,
  async run(args, ctx) {
    const summary = await getDatasetSummary(args.dataset_id, ctx.userId)
    if (!summary) throw new Error(`数据集不存在：${args.dataset_id}`)
    return summary
  },
})
