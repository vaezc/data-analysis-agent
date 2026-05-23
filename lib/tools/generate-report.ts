// ============================================================
// 工具：generate_report
//
// 把对话整理为 HTML 报告（前端下载）。图表由系统自动嵌入，
// LLM 不应在 content 里使用 markdown 图片语法。
// ============================================================

import { z } from 'zod'
import { defineTool } from './registry'

const sectionSchema = z.object({
  heading: z.string().min(1),
  content: z.string().min(1),
})

const schema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sections: z.array(sectionSchema).min(1),
})

export const generateReportTool = defineTool({
  name: 'generate_report',
  description:
    '将本次分析整理为报告供用户下载（HTML 格式）。' +
    '本轮已通过 create_chart 生成的图表会被系统自动嵌入到报告的"可视化图表"段落，' +
    '因此你不要在 summary 或 sections.content 里使用 markdown 图片语法 `![alt](url)`，也不要自己造图表章节。' +
    '专注用文字呈现关键结论与分析。' +
    '仅在用户明确要求"生成报告"、"导出"、"总结成文档"等场景下调用，不要主动调用。',
  uiDescription: '正在生成报告...',
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
              description: '章节正文，Markdown 格式，可包含列表、表格、加粗等。',
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
  schema,
  run(args, ctx) {
    ctx.emit({ type: 'report', report: args })
    return { ok: true, title: args.title }
  },
})
