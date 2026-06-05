// ============================================================
// Prisma client 单例（Prisma 7 + driver adapter）
//
// 设计要点：
//   - Prisma 7 不再用 Rust binary，运行时连接由 @prisma/adapter-pg
//     （node-postgres）提供。连接 URL 用 DATABASE_URL（Supavisor 池化 6543）。
//   - PrismaClient 从生成目录 import（lib/generated/prisma），不再是 @prisma/client。
//   - HMR-safe：dev 下 Next.js 反复 reload，用 globalThis 缓存避免连接池泄漏。
//   - 永远只在服务端 import：generated client + pg 不能进 client bundle。
//   - migration 走 DIRECT_URL（5432 直连），配置在 prisma.config.ts，与运行时解耦。
// ============================================================

import { PrismaClient } from '@/lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    // dev 打 query 日志方便排错；prod 只打 error
    log:
      process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
