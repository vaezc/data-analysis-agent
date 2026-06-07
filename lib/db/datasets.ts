// ============================================================
// 数据集存储与解析（Prisma 版）
//
// 替代 lib/dataset-store.ts。公开 API 函数签名完全兼容，
// 调用方（app/api/upload、app/api/datasets、app/api/datasets/[id]）无需改动。
//
// 设计要点：
//   - 解析逻辑（CSV/Excel + 类型推断 + 值转换）保留不变
//   - DB 访问改用 Prisma client
//   - listDatasets 用 Postgres jsonb_array_length 算 rowCount（O(1)，
//     基于 JSONB header 计数，无需 load 整个 rows 数组），避免侧边栏拉几十 MB
//   - columns / rows 是 Prisma Json 类型（实际就是 JSONB），通过 cast 还原成 TS 类型
// ============================================================

import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { prisma } from '@/lib/prisma'
import type {
  Column,
  ColumnType,
  Dataset,
  DatasetSummary,
  Row,
} from '@/types'

// ============================================================
// 解析：文件 → 二维字符串数组 + headers
// ============================================================

interface RawTable {
  headers: string[]
  rows: string[][]
}

// 导出纯解析/推断函数供单测直接覆盖（不经 DB）。它们无副作用，
// 类型推断/转换作用于 string[][]，对 CSV 与 Excel 两条路径通用。
export function parseCSV(text: string): RawTable {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    // 不开 dynamicTyping：保留原始字符串，自己做类型推断与转换，
    // 避免 "001" 邮编被吃成 1、日期被乱猜等问题。
  })
  if (result.errors.length > 0) {
    const first = result.errors[0]
    throw new Error(`CSV 解析失败：${first.message}（第 ${first.row} 行）`)
  }
  const data = result.data
  if (data.length === 0) throw new Error('CSV 文件为空')
  const [headers, ...rows] = data
  return { headers: headers.map(String), rows }
}

async function parseExcel(buffer: Buffer): Promise<RawTable> {
  // 改用 exceljs（活跃维护、npm 主源、无 CVE）。xlsx@0.18.x 有 CVE-2023-30533
  // (prototype pollution) 和 CVE-2024-22363 (ReDoS)，后续版本只通过 SheetJS CDN
  // 分发，不在 npm 上。exceljs 不支持二进制 .xls 格式，对应 ALLOWED_EXTS 调整。
  //
  // exceljs API 异步且行索引从 1 开始（[0] 总是 undefined，要跳过）。
  const workbook = new ExcelJS.Workbook()
  // exceljs 的 Buffer 类型定义与 @types/node 24+ 的 Buffer 类型冲突
  // （ArrayBufferLike 泛型差异），运行时完全兼容，断言绕过即可
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  )
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Excel 文件没有 sheet')

  const data: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values 是 1-indexed 数组（[0] 是 undefined），切掉
    const values = row.values as unknown as (
      | string
      | number
      | boolean
      | Date
      | null
      | undefined
    )[]
    const cells = values.slice(1).map((v) => {
      if (v == null) return ''
      if (v instanceof Date) return v.toISOString().slice(0, 10) // YYYY-MM-DD
      return String(v)
    })
    data.push(cells)
  })

  if (data.length === 0) throw new Error('Excel 第一个 sheet 为空')
  const [headers, ...rows] = data
  return { headers, rows }
}

// ============================================================
// 类型推断
// ============================================================

const DATE_REGEX =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/

function isNumberLike(v: string): boolean {
  if (v === '') return false
  // 允许整数 / 小数 / 千分位（去掉逗号后能转 number）
  const cleaned = v.replace(/,/g, '')
  return cleaned !== '' && !Number.isNaN(Number(cleaned))
}

function isBooleanLike(v: string): boolean {
  return /^(true|false|TRUE|FALSE|True|False)$/.test(v)
}

function isDateLike(v: string): boolean {
  return DATE_REGEX.test(v)
}

/**
 * 取前 50 个非空样本推断列类型。判断优先级：boolean > number > date > string。
 * 顺序原因：纯数字字符串能通过 Date.parse 也可能符合日期正则，因此 number 必须先判。
 */
export function inferColumnType(values: string[]): ColumnType {
  const sample = values.filter((v) => v !== '' && v != null).slice(0, 50)
  if (sample.length === 0) return 'string'
  if (sample.every(isBooleanLike)) return 'boolean'
  if (sample.every(isNumberLike)) return 'number'
  if (sample.every(isDateLike)) return 'date'
  return 'string'
}

export function coerceValue(value: string, type: ColumnType): unknown {
  if (value == null || value === '') return null
  switch (type) {
    case 'number':
      return Number(value.replace(/,/g, ''))
    case 'boolean':
      return /^(true|TRUE|True)$/.test(value)
    case 'date':
    case 'string':
      return value
  }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 数据集元信息（不含 rows）。与前端 UploadedDataset 形态对齐，
 * 同时被 /api/upload 响应和 /api/datasets GET 复用。
 */
export interface DatasetMeta {
  id: string
  name: string
  columns: Column[]
  rowCount: number
  createdAt: number
}

/**
 * 解析上传的文件并入库。filename 用来判断 CSV/Excel 与展示。
 * userId：当前登录用户 —— 由调用方从 session 拿，决定数据所属。
 */
export async function createDataset(
  userId: string,
  filename: string,
  buffer: Buffer,
): Promise<Dataset> {
  const ext = filename.toLowerCase().split('.').pop()
  let raw: RawTable
  if (ext === 'csv') {
    raw = parseCSV(buffer.toString('utf-8'))
  } else if (ext === 'xlsx') {
    raw = await parseExcel(buffer)
  } else {
    throw new Error(`不支持的文件类型：.${ext}（仅支持 csv / xlsx）`)
  }

  const { headers, rows: rawRows } = raw

  // 逐列推断类型
  const columns: Column[] = headers.map((name, colIdx) => {
    const colValues = rawRows.map((r) => r[colIdx] ?? '')
    const type = inferColumnType(colValues)
    const nullCount = colValues.filter((v) => v == null || v === '').length
    return { name, type, nullCount }
  })

  // 按推断类型转换值
  const rows: Row[] = rawRows.map((rawRow) => {
    const row: Row = {}
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      row[col.name] = coerceValue(rawRow[i] ?? '', col.type)
    }
    return row
  })

  const created = await prisma.dataset.create({
    data: {
      userId,
      name: filename,
      // Prisma Json 字段接受任意可序列化对象；运行时存为 JSONB
      columns: columns as unknown as object,
      rows: rows as unknown as object,
    },
  })

  return {
    id: created.id,
    name: created.name,
    columns,
    rows,
    createdAt: created.createdAt.getTime(),
  }
}

/**
 * 拿单个数据集（必须传 userId 做 owner check，防越权）。
 * 找不到 / 不属于该 user 都返回 undefined —— 调用方靠返回值判 404。
 */
export async function getDataset(
  id: string,
  userId: string,
): Promise<Dataset | undefined> {
  // findFirst（不是 findUnique）—— 复合条件 (id, userId) 不是唯一索引
  const row = await prisma.dataset.findFirst({ where: { id, userId } })
  if (!row) return undefined
  return {
    id: row.id,
    name: row.name,
    columns: row.columns as unknown as Column[],
    rows: row.rows as unknown as Row[],
    createdAt: row.createdAt.getTime(),
  }
}

export async function getDatasetSummary(
  id: string,
  userId: string,
): Promise<DatasetSummary | undefined> {
  const row = await prisma.dataset.findFirst({
    where: { id, userId },
    select: { id: true, name: true, columns: true, rows: true },
  })
  if (!row) return undefined
  const rows = row.rows as unknown as Row[]
  return {
    dataset_id: row.id,
    name: row.name,
    columns: row.columns as unknown as Column[],
    rowCount: rows.length,
    sampleRows: rows.slice(0, 3),
  }
}

/**
 * 列当前用户的所有数据集。
 * 用 Postgres 原生 jsonb_array_length 算 rowCount（O(1)，基于 JSONB header），
 * 避免拉全量 rows JSONB。这是这一层最关键的性能优化点。
 *
 * 不能用 prisma.dataset.findMany + select 拿到 row_count——
 * Prisma 不支持 Json 字段的 length 子查询。所以走 $queryRaw。
 */
export async function listDatasets(userId: string): Promise<DatasetMeta[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string
      name: string
      columns: unknown
      row_count: bigint
      created_at: Date
    }[]
  >`
    SELECT
      id,
      name,
      columns,
      jsonb_array_length(rows) AS row_count,
      created_at
    FROM datasets
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    columns: row.columns as Column[],
    // jsonb_array_length 返回 bigint（Postgres int8），TS 端转 number
    rowCount: Number(row.row_count),
    createdAt: row.created_at.getTime(),
  }))
}

/**
 * 删除数据集（必须 owner check）。
 * 用 deleteMany + 复合 where 一步搞定 —— 不属于该 user 的数据集 count=0 不报错。
 * 调用方需要"删了 0 条"也算 404 时，可以检查返回值，但当前路由直接 200。
 */
export async function deleteDataset(
  id: string,
  userId: string,
): Promise<{ count: number }> {
  // 级联删除 messages 由 schema 的 onDelete: Cascade 自动处理
  return prisma.dataset.deleteMany({ where: { id, userId } })
}
