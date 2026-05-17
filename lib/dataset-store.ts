// ============================================================
// 数据集存储与解析
//
// 解析逻辑（CSV/Excel 解析 + 列类型推断 + 值转换）保留不变。
// 存储改用 Supabase（Phase 3）：
//   - 解决 Vercel Serverless 跨函数内存隔离问题
//   - 支持刷新页面 / 多 tab / 跨设备访问历史 dataset
//
// 公开 API（全部异步）：
//   createDataset()       上传 → 解析 → 入 Supabase datasets 表
//   getDataset()          完整数据（含 rows）
//   getDatasetSummary()   inspect_data 工具的返回结构
//   listDatasets()        前端侧边栏用，不含 rows
//   deleteDataset()       删除（级联删除 messages，由外键 on delete cascade 完成）
// ============================================================

import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { getSupabase } from '@/lib/supabase'
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

// ============================================================
// Supabase 表行 ↔ Dataset 转换
//
// DB 字段命名（snake_case）→ TS（camelCase）；created_at（ISO string）→ ms timestamp
// ============================================================

interface DatasetRow {
  id: string
  name: string
  columns: Column[]
  rows: Row[]
  row_count: number
  created_at: string
}

function rowToDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    rows: row.rows,
    createdAt: new Date(row.created_at).getTime(),
  }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 解析上传的文件并入库。filename 用来判断 CSV/Excel 与展示。
 */
export async function createDataset(
  filename: string,
  buffer: Buffer,
): Promise<Dataset> {
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

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('datasets')
    .insert({
      name: filename,
      columns,
      rows,
      row_count: rows.length,
    })
    .select('*')
    .single<DatasetRow>()

  if (error) throw new Error(`保存数据集失败：${error.message}`)
  return rowToDataset(data)
}

export async function getDataset(id: string): Promise<Dataset | undefined> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('datasets')
    .select('*')
    .eq('id', id)
    .maybeSingle<DatasetRow>()

  if (error) throw new Error(`查询数据集失败：${error.message}`)
  if (!data) return undefined
  return rowToDataset(data)
}

export async function getDatasetSummary(
  id: string,
): Promise<DatasetSummary | undefined> {
  // 只取必要字段；sampleRows 用 JSONB 切片函数从 rows 取前 3 个，避免拉全量
  // Supabase 不支持直接的 JSONB 片段查询，所以仍拉 rows 后在内存切。
  // 单表 1GB JSONB 上限，几千行 dataset 量级查询毫秒级，可接受。
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('datasets')
    .select('id, name, columns, rows, row_count')
    .eq('id', id)
    .maybeSingle<Pick<DatasetRow, 'id' | 'name' | 'columns' | 'rows' | 'row_count'>>()

  if (error) throw new Error(`查询数据集失败：${error.message}`)
  if (!data) return undefined
  return {
    dataset_id: data.id,
    name: data.name,
    columns: data.columns,
    rowCount: data.row_count,
    sampleRows: data.rows.slice(0, 3),
  }
}

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

export async function listDatasets(): Promise<DatasetMeta[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('datasets')
    .select('id, name, columns, row_count, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`列举数据集失败：${error.message}`)

  type ListRow = Pick<DatasetRow, 'id' | 'name' | 'columns' | 'row_count' | 'created_at'>
  return (data as ListRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    columns: row.columns,
    rowCount: row.row_count,
    createdAt: new Date(row.created_at).getTime(),
  }))
}

export async function deleteDataset(id: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.from('datasets').delete().eq('id', id)
  if (error) throw new Error(`删除数据集失败：${error.message}`)
}
