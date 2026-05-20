// ============================================================
// 登录失败 rate limit
//
// 算法：滑动窗口 —— 最近 WINDOW_MS 内累计 >= MAX_FAILURES 次失败则锁定，
// 直到最早那一次失败超出窗口才解锁。
//
// 设计取舍：
//   - 用 email 不是 userId / IP：emails 是攻击目标本身，单 email 容易触发；
//     IP 跨用户共享（公司 NAT、CGNAT），不靠谱
//   - 只记失败：登录成功 clearFailedAttempts(email) 把历史清空；表里恒为"待评估的失败"
//   - 不存在的 email 也照样 record（防 email enumeration —— 不能给攻击者"这个邮箱不存在"的信号）
//
// 部署注意：
//   - 当前无自动清理，老数据会累积。Vercel cron 每天 DELETE WHERE created_at < NOW() - INTERVAL '7 days' 即可
//   - 单 lambda 多实例并发：DB 是真相源，并发 record 不会相互覆盖（INSERT 各写各的行）
// ============================================================

import { prisma } from '@/lib/prisma'

const WINDOW_MS = 15 * 60 * 1000 // 15 分钟滑动窗口
const MAX_FAILURES = 5 // 5 次失败触发锁定

export interface RateLimitResult {
  allowed: boolean
  /** 锁定剩余时间（毫秒），仅 allowed=false 时有意义 */
  remainingMs?: number
}

/**
 * 检查指定 email 是否被 rate limit。
 * 不会写库，纯查询；调用方决定下一步行为。
 */
export async function checkLoginRateLimit(
  email: string,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MS)
  const failures = await prisma.loginAttempt.findMany({
    where: {
      email,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_FAILURES,
    select: { createdAt: true },
  })

  if (failures.length < MAX_FAILURES) {
    return { allowed: true }
  }

  // 窗口内已满 MAX_FAILURES 次。锁定直到最早那次失败 + WINDOW_MS。
  // findMany desc，所以 failures[failures.length - 1] 是最早的
  const oldestInWindow = failures[failures.length - 1].createdAt
  const unlockAt = oldestInWindow.getTime() + WINDOW_MS
  const now = Date.now()
  const remainingMs = unlockAt - now

  if (remainingMs <= 0) {
    // 边界情况：最早那次刚好刚出窗口，下次 record 后才会重新滑动
    return { allowed: true }
  }
  return { allowed: false, remainingMs }
}

/**
 * 记录一次失败尝试。
 * 即便用户不存在也要记 —— 防 email enumeration（攻击者通过响应快慢分辨邮箱存在性）。
 */
export async function recordFailedAttempt(
  email: string,
  ipAddress?: string,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email, ipAddress },
  })
}

/**
 * 登录成功后清掉该 email 的全部失败记录。
 * 这样老的失败不会"留下来"在窗口里继续算数。
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { email },
  })
}
