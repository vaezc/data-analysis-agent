// ============================================================
// 数据集存储与解析
//
// Phase 1：内存 Map，进程重启即丢。
// Phase 2/3：替换实现为 Supabase；保持 public API 签名不变即可。
//
// 公开 API：
//   createDataset()       上传文件 → 解析 → 推断类型 → 入库
//   getDataset()          完整数据（含 rows）
//   getDatasetSummary()   inspect_data 工具的返回结构
//   listDatasets()        前端侧边栏用，不含 rows
// ============================================================

import { randomUUID } from 'node:crypto'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type {
  Column,
  ColumnType,
  Dataset,
  DatasetSummary,
  Row,
} from '@/types'

// ---------- 存储 ----------

const store = new Map<string, Dataset>()

// ---------- 解析：文件 → 二维字符串数组 + headers ----------

interface RawTable {
  headers: string[]
  rows: string[][]
}

function parseCSV(text: string): RawTable {
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

function parseExcel(buffer: Buffer): RawTable {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) throw new Error('Excel 文件没有 sheet')
  const sheet = wb.Sheets[firstSheetName]
  // raw:false → 用 cell 的格式化字符串（保留前导零、日期可读形式）
  // header:1 → 输出二维数组而不是 object
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })
  if (data.length === 0) throw new Error('Excel 第一个 sheet 为空')
  const [headers, ...rows] = data
  return {
    headers: headers.map(String),
    rows: rows.map((r) => r.map((cell) => (cell == null ? '' : String(cell)))),
  }
}

// ---------- 类型推断 ----------

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
function inferColumnType(values: string[]): ColumnType {
  const sample = values.filter((v) => v !== '' && v != null).slice(0, 50)
  if (sample.length === 0) return 'string'
  if (sample.every(isBooleanLike)) return 'boolean'
  if (sample.every(isNumberLike)) return 'number'
  if (sample.every(isDateLike)) return 'date'
  return 'string'
}

function coerceValue(value: string, type: ColumnType): unknown {
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

// ---------- 公开 API ----------

/**
 * 解析上传的文件并入库。filename 用来判断 CSV/Excel 与展示。
 */
export function createDataset(
  filename: string,
  buffer: Buffer,
): Dataset {
  const ext = filename.toLowerCase().split('.').pop()
  let raw: RawTable
  if (ext === 'csv') {
    raw = parseCSV(buffer.toString('utf-8'))
  } else if (ext === 'xlsx' || ext === 'xls') {
    raw = parseExcel(buffer)
  } else {
    throw new Error(`不支持的文件类型：.${ext}（仅支持 csv / xlsx / xls）`)
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

  const dataset: Dataset = {
    id: randomUUID(),
    name: filename,
    columns,
    rows,
    createdAt: Date.now(),
  }
  store.set(dataset.id, dataset)
  return dataset
}

export function getDataset(id: string): Dataset | undefined {
  return store.get(id)
}

export function getDatasetSummary(id: string): DatasetSummary | undefined {
  const ds = store.get(id)
  if (!ds) return undefined
  return {
    dataset_id: ds.id,
    name: ds.name,
    columns: ds.columns,
    rowCount: ds.rows.length,
    sampleRows: ds.rows.slice(0, 3),
  }
}

export interface DatasetMeta {
  id: string
  name: string
  rowCount: number
  columnCount: number
  createdAt: number
}

export function listDatasets(): DatasetMeta[] {
  return Array.from(store.values())
    .map((ds) => ({
      id: ds.id,
      name: ds.name,
      rowCount: ds.rows.length,
      columnCount: ds.columns.length,
      createdAt: ds.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
