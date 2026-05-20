// ============================================================
// Prisma client 单例
//
// 设计要点：
//   - HMR-safe：dev 环境 Next.js 会反复 reload 模块，
//     用 globalThis 缓存避免连接句柄泄漏。
//   - 永远只在服务端 import：Prisma 客户端含 schema engine binary，不能进 client bundle。
//   - 连接池由 DATABASE_URL 上的 Supavisor pooler 处理（端口 6543），
//     migration 走 DIRECT_URL（端口 5432）—— schema.prisma 里已配。
// ============================================================

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // dev 打 query 日志方便排错；prod 只打 error
    log:
      process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
