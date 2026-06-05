// ============================================================
// SQLite 沙箱单测 —— runSQLOnDataset
//
// 重点测三层防御（白名单前缀 / 危险关键字 / 用完即销毁）+ 类型强转
// + 中文列名 + 边界（空表、引号转义、非法 SQL）。
// 纯函数、无 DB / 网络依赖，毫秒级跑完。
// ============================================================

import { describe, it, expect } from 'vitest'
import { runSQLOnDataset } from '@/lib/tools/sqlite-runner'
import type { Column, Row } from '@/types'

const SALES_COLS: Column[] = [
  { name: 'region', type: 'string', nullCount: 0 },
  { name: 'sales', type: 'number', nullCount: 0 },
  { name: 'active', type: 'boolean', nullCount: 0 },
]

const SALES_ROWS: Row[] = [
  { region: '华东', sales: 100, active: true },
  { region: '华东', sales: 50, active: false },
  { region: '华北', sales: 80, active: true },
]

describe('runSQLOnDataset — 正常查询', () => {
  it('GROUP BY + SUM 聚合返回正确结果', () => {
    const rows = runSQLOnDataset(
      'SELECT "region", SUM("sales") AS total FROM data GROUP BY "region" ORDER BY total DESC',
      SALES_COLS,
      SALES_ROWS,
    )
    expect(rows).toEqual([
      { region: '华东', total: 150 },
      { region: '华北', total: 80 },
    ])
  })

  it('支持 WITH（CTE）开头的查询', () => {
    const rows = runSQLOnDataset(
      'WITH t AS (SELECT "sales" FROM data) SELECT SUM("sales") AS s FROM t',
      SALES_COLS,
      SALES_ROWS,
    )
    expect(rows).toEqual([{ s: 230 }])
  })

  it('中文列名经双引号正常查询', () => {
    const cols: Column[] = [{ name: '区域', type: 'string', nullCount: 0 }]
    const data: Row[] = [{ 区域: '北京' }, { 区域: '上海' }]
    const rows = runSQLOnDataset(
      'SELECT COUNT(*) AS n FROM data WHERE "区域" = \'北京\'',
      cols,
      data,
    )
    expect(rows).toEqual([{ n: 1 }])
  })

  it('boolean 强转为 0/1 后可在 SQL 过滤', () => {
    const rows = runSQLOnDataset(
      'SELECT COUNT(*) AS n FROM data WHERE "active" = 1',
      SALES_COLS,
      SALES_ROWS,
    )
    expect(rows).toEqual([{ n: 2 }])
  })

  it('number 列接受字符串数字并按数值计算', () => {
    const data: Row[] = [{ region: 'A', sales: '30', active: true }]
    const rows = runSQLOnDataset(
      'SELECT SUM("sales") AS total FROM data',
      SALES_COLS,
      data,
    )
    expect(rows).toEqual([{ total: 30 }])
  })

  it('null 值保留为 NULL，COALESCE 可兜底', () => {
    const data: Row[] = [
      { region: 'A', sales: null, active: true },
      { region: 'A', sales: 10, active: true },
    ]
    const rows = runSQLOnDataset(
      'SELECT SUM(COALESCE("sales", 0)) AS total FROM data',
      SALES_COLS,
      data,
    )
    expect(rows).toEqual([{ total: 10 }])
  })

  it('空表（无行）也能跑，返回空结果', () => {
    const rows = runSQLOnDataset(
      'SELECT COUNT(*) AS n FROM data',
      SALES_COLS,
      [],
    )
    expect(rows).toEqual([{ n: 0 }])
  })

  it('列名含双引号被正确转义', () => {
    const cols: Column[] = [{ name: 'a"b', type: 'number', nullCount: 0 }]
    const data: Row[] = [{ 'a"b': 5 }]
    const rows = runSQLOnDataset('SELECT SUM("a""b") AS s FROM data', cols, data)
    expect(rows).toEqual([{ s: 5 }])
  })
})

describe('runSQLOnDataset — 安全防御', () => {
  it('大小写不敏感：小写 select 放行', () => {
    const rows = runSQLOnDataset('select count(*) as n from data', SALES_COLS, SALES_ROWS)
    expect(rows).toEqual([{ n: 3 }])
  })

  it('前导空白不影响前缀判断', () => {
    const rows = runSQLOnDataset('   \n  SELECT 1 AS one', SALES_COLS, SALES_ROWS)
    expect(rows).toEqual([{ one: 1 }])
  })

  it.each([
    ['EXPLAIN', 'EXPLAIN SELECT * FROM data'],
    ['空字符串', ''],
    ['纯注释', '-- just a comment'],
  ])('非 SELECT/WITH 前缀被拒：%s', (_label, sql) => {
    expect(() => runSQLOnDataset(sql, SALES_COLS, SALES_ROWS)).toThrow(
      '仅允许 SELECT / WITH 查询语句',
    )
  })

  it.each([
    ['DROP', 'SELECT 1; DROP TABLE data'],
    ['DELETE', 'SELECT 1; DELETE FROM data'],
    ['INSERT', 'SELECT 1; INSERT INTO data VALUES (1)'],
    ['UPDATE', 'SELECT 1; UPDATE data SET sales = 0'],
    ['ALTER', 'SELECT 1; ALTER TABLE data ADD x'],
    ['ATTACH', 'SELECT 1; ATTACH DATABASE \'x\' AS y'],
    ['PRAGMA', 'SELECT 1; PRAGMA table_info(data)'],
    ['CREATE', 'SELECT 1; CREATE TABLE x (a)'],
    ['REPLACE', 'SELECT 1; REPLACE INTO data VALUES (1)'],
  ])('危险关键字被拒：%s', (_label, sql) => {
    expect(() => runSQLOnDataset(sql, SALES_COLS, SALES_ROWS)).toThrow(
      'SQL 包含不允许的关键字',
    )
  })

  it('非法 SQL（不存在的列）抛"SQL 执行失败"', () => {
    expect(() =>
      runSQLOnDataset('SELECT "nonexistent" FROM data', SALES_COLS, SALES_ROWS),
    ).toThrow('SQL 执行失败')
  })
})
