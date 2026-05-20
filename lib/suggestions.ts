// ============================================================
// 用 LLM 根据 dataset schema + 样本生成 3 个自然的中文提问建议
//
// 为什么不用纯模板：
//   模板硬拼"哪个 region 的 units 最高"，列名是英文时句子割裂、读起来生硬。
//   LLM 能根据列名语义（region 是地区、units 是数量等）写出更自然的中文。
//
// 调用时机：前端切换 dataset 时 fetch 一次（API 端点会做会话内缓存）。
// 成本：每次约 300-500 input token + 100 output token ≈ ¥0.001
// ============================================================

import { chatCompletion } from '@/lib/llm'
import type { Column, Row } from '@/types'

const SYSTEM_PROMPT = `你是数据分析助手。根据用户上传的数据列结构和样本，
生成 3 个适合该数据集的中文提问建议，让普通用户能直接点击使用。

要求：
1. 用流畅自然的中文表达，不要生硬地直接拼接英文列名
   - 列名是英文时，用引号或上下文让句子读起来不割裂
   - 反例（不要这样）："哪个 region 的 units 最高"
   - 正例：'哪个区域的销量最高？' 或 '不同 region 的 units 分布如何？'
2. 三个问题应该角度不同（如：分组对比 / 时间趋势 / 整体统计）
3. 每个问题独立一行，不要编号、不要解释、不要 markdown
4. 每个问题控制在 25 个字以内
5. 用问号或更口语化的疑问结尾`

interface GenerateParams {
  columns: Column[]
  sampleRows: Row[]
}

export async function generateSuggestions({
  columns,
  sampleRows,
}: GenerateParams): Promise<string[]> {
  const schemaStr = columns
    .map((c) => `${c.name}(${c.type})`)
    .join(', ')
  const userMsg = `列：${schemaStr}\n样本（前 ${sampleRows.length} 行）：${JSON.stringify(sampleRows)}`

  const completion = await chatCompletion({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.7, // 适度随机让建议有变化
    debugTag: 'suggestions',
  })

  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('LLM 未返回内容')

  // 按行切，去掉 markdown 围栏 / 列表符号 / 编号 / 引号包裹
  const lines = text
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.、)]\s*/, '')
        .replace(/^["「『]|["」』]$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0 && line.length < 60)

  if (lines.length === 0) throw new Error('LLM 返回内容解析后为空')
  return lines.slice(0, 3)
}
