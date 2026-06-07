// ============================================================
// 通用重试（指数退避）
//
// 用于把 LLM API 的"瞬时失败"（限流 429 / 服务端 5xx / 网络超时）
// 自动重试，而对"确定性失败"（4xx 参数错 / 鉴权 401）立即抛出——
// 重试这类错误只会浪费时间和 token。
//
// 设计：sleep 可注入便于测试；isRetryable 可覆盖。
// 默认对 OpenAI SDK 的 APIError（带 .status）与 Node 网络错误（带 .code）判定。
// ============================================================

const RETRYABLE_NET_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
])

/** 是否值得重试：限流 / 请求超时 / 5xx / 常见网络抖动。其余（含 4xx 参数错）不重试。 */
export function isRetryableError(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false

  const status = (e as { status?: unknown }).status
  if (typeof status === 'number') {
    return status === 429 || status === 408 || (status >= 500 && status <= 599)
  }

  const code = (e as { code?: unknown }).code
  if (typeof code === 'string') return RETRYABLE_NET_CODES.has(code)

  return false
}

export interface RetryOptions {
  /** 最大重试次数（不含首次）。默认 2 → 最多 3 次尝试。 */
  maxRetries?: number
  /** 首次退避基数 ms，之后指数增长。默认 300 → 300 / 600 / ... */
  baseDelayMs?: number
  /** 自定义可重试判定。默认 isRetryableError。 */
  isRetryable?: (e: unknown) => boolean
  /** 每次重试前回调（用于日志 / 指标）。attempt 从 1 计。 */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void
  /** 睡眠实现，注入便于测试。默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 执行 fn，瞬时失败按指数退避重试。
 * 不可重试错误 / 重试耗尽 → 抛出最后一次的错误。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 300
  const isRetryable = opts.isRetryable ?? isRetryableError
  const sleep = opts.sleep ?? defaultSleep

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) throw error
      const delayMs = baseDelayMs * 2 ** attempt
      opts.onRetry?.({ attempt: attempt + 1, error, delayMs })
      await sleep(delayMs)
    }
  }
}
