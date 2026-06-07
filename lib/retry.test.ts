import { describe, it, expect, vi } from 'vitest'
import { withRetry, isRetryableError } from '@/lib/retry'

describe('isRetryableError', () => {
  it('限流 / 超时 / 5xx 可重试', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
    expect(isRetryableError({ status: 408 })).toBe(true)
    expect(isRetryableError({ status: 500 })).toBe(true)
    expect(isRetryableError({ status: 503 })).toBe(true)
  })

  it('4xx 参数错 / 鉴权错不可重试', () => {
    expect(isRetryableError({ status: 400 })).toBe(false)
    expect(isRetryableError({ status: 401 })).toBe(false)
    expect(isRetryableError({ status: 404 })).toBe(false)
  })

  it('网络抖动 code 可重试，未知 code 不可重试', () => {
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetryableError({ code: 'NOPE' })).toBe(false)
  })

  it('普通 Error / 非对象 → 不可重试', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false)
    expect(isRetryableError('str')).toBe(false)
    expect(isRetryableError(null)).toBe(false)
  })
})

describe('withRetry', () => {
  const noSleep = () => Promise.resolve()

  it('首次成功只调用一次', async () => {
    const fn = vi.fn(async () => 'ok')
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('瞬时失败后重试成功', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      if (n < 3) throw { status: 429 }
      return 'recovered'
    })
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('不可重试错误立即抛出（只调用一次）', async () => {
    const fn = vi.fn(async () => {
      throw { status: 400 }
    })
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toEqual({
      status: 400,
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('持续可重试失败 → 耗尽后抛（maxRetries+1 次）', async () => {
    const fn = vi.fn(async () => {
      throw { status: 503 }
    })
    await expect(
      withRetry(fn, { maxRetries: 2, sleep: noSleep }),
    ).rejects.toEqual({ status: 503 })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('退避延时指数增长，onRetry 收到正确信息', async () => {
    const delays: number[] = []
    const fn = vi.fn(async () => {
      throw { status: 500 }
    })
    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms)
        },
      }),
    ).rejects.toBeDefined()
    expect(delays).toEqual([100, 200, 400]) // 100 * 2^0,1,2
  })
})
