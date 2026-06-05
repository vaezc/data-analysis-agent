import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// ============================================================
// Prisma 7 配置（CLI / migration 专用）
//
// Prisma 7 把连接 URL 从 schema.prisma 移到这里。本文件只服务于 CLI
// 命令（migrate dev / deploy / status、db pull 等），运行时查询不读它
// —— 运行时连接由 lib/prisma.ts 的 @prisma/adapter-pg 提供。
//
// 为什么 datasource.url 填 DIRECT_URL 而非 DATABASE_URL：
//   migration 要跑 DDL + advisory lock，需要 session 级直连（5432）。
//   Supavisor 事务池（6543, DATABASE_URL）不持久会话状态，跑迁移不可靠。
//   这与 Prisma 6 时 `directUrl` 的职责完全一致，只是换了落脚点。
//
// 环境变量：Prisma 7 不再自动加载 .env，需显式 import 'dotenv/config'。
// ============================================================

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
})
