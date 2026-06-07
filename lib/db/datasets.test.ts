// ============================================================
// CSV/Excel 解析层边界用例
//
// 覆盖纯函数：parseCSV / inferColumnType / coerceValue。
// 类型推断/转换作用于 string[][]，对 CSV 与 Excel 两条路径通用，故只需测一次。
// 测试如实记录当前行为，包含已知局限（L5：纯数字邮编会被判为 number）。
// 导入会拉起 lib/prisma（懒连接），但这些函数本身不碰 DB。
// ============================================================

import { describe, it, expect } from 'vitest'
import { parseCSV, inferColumnType, coerceValue } from '@/lib/db/datasets'

describe('parseCSV', () => {
  it('拆出 headers + rows', () => {
    const { headers, rows } = parseCSV('a,b,c\n1,2,3\n4,5,6')
    expect(headers).toEqual(['a', 'b', 'c'])
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('跳过空行', () => {
    const { rows } = parseCSV('a,b\n1,2\n\n3,4\n')
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('保留原始字符串不做 dynamicTyping（前导零不丢）', () => {
    const { rows } = parseCSV('zip,city\n007,NYC\n012,LA')
    expect(rows).toEqual([
      ['007', 'NYC'],
      ['012', 'LA'],
    ])
  })

  it('【已知局限】单列 CSV（无分隔符）会被 papaparse 判为无法探测分隔符而抛错', () => {
    // papaparse 关闭 header 后靠采样自动探测分隔符；只有一列时探测失败 → 报错。
    // 真实影响：单列 CSV 上传会失败。修法是 parseCSV 显式指定 delimiter:','（待评估）。
    expect(() => parseCSV('zip\n007\n012')).toThrow('解析失败')
  })

  it('带引号的字段含逗号不被拆列', () => {
    const { rows } = parseCSV('name,note\n"Doe, John",hi')
    expect(rows).toEqual([['Doe, John', 'hi']])
  })

  it('空输入抛解析错误', () => {
    expect(() => parseCSV('')).toThrow('CSV')
  })
})

describe('inferColumnType — 基本类型', () => {
  it('全整数 → number', () => {
    expect(inferColumnType(['1', '2', '300'])).toBe('number')
  })

  it('小数 → number', () => {
    expect(inferColumnType(['1.5', '2.0', '-3.14'])).toBe('number')
  })

  it('千分位 → number', () => {
    expect(inferColumnType(['1,234', '5,678,900'])).toBe('number')
  })

  it('布尔（大小写混合）→ boolean', () => {
    expect(inferColumnType(['true', 'FALSE', 'True'])).toBe('boolean')
  })

  it('日期（多格式）→ date', () => {
    expect(inferColumnType(['2024-01-01', '2024/12/31'])).toBe('date')
    expect(inferColumnType(['2024-1-1'])).toBe('date') // 1-2 位月日
    expect(inferColumnType(['01-02-2024'])).toBe('date') // dd-mm-yyyy
    expect(inferColumnType(['2024-01-01 13:45'])).toBe('date') // 带时间
  })

  it('普通文本 → string', () => {
    expect(inferColumnType(['apple', 'banana'])).toBe('string')
  })
})

describe('inferColumnType — 优先级与边界', () => {
  it('number 优先于 date：4 位年份判为 number 而非 date', () => {
    // 纯数字即便像年份也先命中 number（注释里写明的优先级 boolean>number>date）
    expect(inferColumnType(['1990', '2000'])).toBe('number')
  })

  it('number 优先于 date：8 位数字不被当日期', () => {
    expect(inferColumnType(['20240101', '20231231'])).toBe('number')
  })

  it('混合类型（数字+文本）→ 回退 string', () => {
    expect(inferColumnType(['1', '2', 'x'])).toBe('string')
  })

  it('布尔混入数字 → 回退 string', () => {
    expect(inferColumnType(['true', '1'])).toBe('string')
  })

  it('空值在判定前被过滤，不影响结论', () => {
    expect(inferColumnType(['1', '', '2', ''])).toBe('number')
  })

  it('全空 / 空数组 → string', () => {
    expect(inferColumnType(['', '', ''])).toBe('string')
    expect(inferColumnType([])).toBe('string')
  })

  it('【已知局限 L5】纯数字邮编被判为 number（前导零会在 coerce 时丢失）', () => {
    expect(inferColumnType(['007', '012', '345'])).toBe('number')
  })

  it('邮编混入非数字字符则回退 string（被保护）', () => {
    expect(inferColumnType(['007', '0A2'])).toBe('string')
  })
})

describe('coerceValue', () => {
  it('number：去千分位后转数值', () => {
    expect(coerceValue('1,234', 'number')).toBe(1234)
    expect(coerceValue('3.14', 'number')).toBe(3.14)
  })

  it('boolean：仅 true/TRUE/True 为真，其余为假', () => {
    expect(coerceValue('true', 'boolean')).toBe(true)
    expect(coerceValue('TRUE', 'boolean')).toBe(true)
    expect(coerceValue('false', 'boolean')).toBe(false)
    expect(coerceValue('False', 'boolean')).toBe(false)
  })

  it('date / string：原样保留字符串', () => {
    expect(coerceValue('2024-01-01', 'date')).toBe('2024-01-01')
    expect(coerceValue('hello', 'string')).toBe('hello')
  })

  it('空值统一转 null（任何类型）', () => {
    expect(coerceValue('', 'number')).toBeNull()
    expect(coerceValue('', 'string')).toBeNull()
    expect(coerceValue('', 'boolean')).toBeNull()
  })

  it('【已知局限 L5】前导零邮编按 number 转换会丢零', () => {
    expect(coerceValue('007', 'number')).toBe(7)
  })
})
