import { describe, it, expect } from 'vitest'
import { LruCache } from '@/lib/lru-cache'

describe('LruCache', () => {
  it('set / get 基本读写', () => {
    const c = new LruCache<string, number>(3)
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
    expect(c.size).toBe(1)
  })

  it('未命中返回 undefined', () => {
    const c = new LruCache<string, number>(3)
    expect(c.get('missing')).toBeUndefined()
  })

  it('超容量淘汰最久未用', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3) // a 被淘汰
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
    expect(c.size).toBe(2)
  })

  it('get 刷新最近使用，改变淘汰顺序', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a') // a 变为最近使用
    c.set('c', 3) // 此时最久未用是 b
    expect(c.has('b')).toBe(false)
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
  })

  it('更新已存在 key 不增长 size 且刷新 recency', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 11) // 更新 a，a 变最近
    expect(c.size).toBe(2)
    c.set('c', 3) // 淘汰最久未用 b
    expect(c.has('b')).toBe(false)
    expect(c.get('a')).toBe(11)
  })

  it('clear 清空', () => {
    const c = new LruCache<string, number>(2)
    c.set('a', 1)
    c.clear()
    expect(c.size).toBe(0)
    expect(c.get('a')).toBeUndefined()
  })

  it('非法容量抛错', () => {
    expect(() => new LruCache<string, number>(0)).toThrow('正整数')
    expect(() => new LruCache<string, number>(-1)).toThrow('正整数')
    expect(() => new LruCache<string, number>(1.5)).toThrow('正整数')
  })
})
