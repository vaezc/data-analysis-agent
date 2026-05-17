// ============================================================
// SQLite 沙箱（替换 node:vm）
//
// 用 better-sqlite3 跑只读 SQL 查询替代之前的 LLM 生成 JS + vm 执行。
// 优势：
//   - 真正的 SQL 引擎：GROUP BY / ORDER BY / JOIN / 窗口函数 / CTE
//   - LLM 输出 SQL 比 JS 更容易正确
//   - SQLite 是世界上最被审计过的 DB 之一，安全性远超 node:vm
//   - better-sqlite3 native binding，毫秒级查询
//
// 安全策略：
//   - 必须 SELECT 或 WITH 开头（拒绝写入类语句）
//   - 拒绝 DDL/DML keyword（DROP/DELETE/UPDATE/INSERT/ALTER/ATTACH...）
//   - 每次新建 :memory: DB，查询结束立即 close（无状态泄漏）
//   - 实际写入只在我们自己控制的 CREATE TABLE + INSERT 阶段
//
// 列名映射：
//   - SQLite 列名用双引号包，支持中文 / 空格 / 关键字冲突
//   - boolean → INTEGER (0/1)，date → TEXT（ISO string）
// ============================================================

import Database from 'better-sqlite3'
import type { Column, ColumnType, Row } from '@/types'

const DANGEROUS_KEYWORDS =
  /\b(DROP|DELETE|UPDATE|INSERT|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REPLACE|CREATE|TRUNCATE)\b/i

function validateReadOnlySQL(sql: string): void {
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    throw new Error('仅允许 SELECT / WITH 查询语句')
  }
  if (DANGEROUS_KEYWORDS.test(sql)) {
    throw new Error('SQL 包含不允许的关键字（DDL/DML）')
  }
}

function toSqliteType(t: ColumnType): string {
  switch (t) {
    case 'number':
      return 'REAL'
    case 'boolean':
      return 'INTEGER'
    case 'date':
    case 'string':
    default:
      return 'TEXT'
  }
}

function coerceForSQLite(
  v: unknown,
  type: ColumnType,
): string | number | null {
  if (v == null) return null
  if (type === 'boolean') return v ? 1 : 0
  if (type === 'number') return typeof v === 'number' ? v : Number(v)
  return String(v)
}

/**
 * 把 rows 加载到内存 SQLite，跑用户 SQL，返回结果。
 * 用完即销毁，无持久化。
 */
export function runSQLOnDataset(
  userSQL: string,
  columns: Column[],
  rows: Row[],
): Record<string, unknown>[] {
  validateReadOnlySQL(userSQL)

  const db = new Database(':memory:')
  try {
    // 1. 创建表
    const columnDefs = columns
      .map((c) => `"${c.name.replace(/"/g, '""')}" ${toSqliteType(c.type)}`)
      .join(', ')
    db.exec(`CREATE TABLE data (${columnDefs})`)

    // 2. 批量插入（事务包裹，比逐行快 10x+）
    if (rows.length > 0) {
      const placeholders = columns.map(() => '?').join(', ')
      const insert = db.prepare(`INSERT INTO data VALUES (${placeholders})`)
      const insertAll = db.transaction((rowsToInsert: Row[]) => {
        for (const row of rowsToInsert) {
          const values = columns.map((c) =>
            coerceForSQLite(row[c.name], c.type),
          )
          insert.run(...values)
        }
      })
      insertAll(rows)
    }

    // 3. 跑用户 SQL（已经过 validate）
    const stmt = db.prepare(userSQL)
    return stmt.all() as Record<string, unknown>[]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`SQL 执行失败：${msg}`)
  } finally {
    db.close()
  }
}
