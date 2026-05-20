// ============================================================
// Next.js 16 proxy（旧版叫 middleware.ts，v16 重命名）
//
// 所有请求都经过这里：
//   - authConfig.callbacks.authorized 决定是否放行
//   - 未登录访问受保护页面 → 自动跳 /login
//   - 已登录访问 /login /register → 自动跳 /
//
// 关键约束：
//   - 只 import authConfig，绝不 import auth.ts
//     auth.ts 含 Prisma client（schema engine binary），proxy 路径会被打包
//     成 edge 兼容代码，引入 Prisma 会让整个 proxy 失败
//   - 全部 callback 必须是同步或返回 fetch-edge 兼容的 Response
// ============================================================

import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

export default NextAuth(authConfig).auth

export const config = {
  // 排除：
  //   /api/auth/*    Auth.js 内置接口（自己要能访问，不然死循环）
  //   /api/auth/register  我们自己的注册接口（未登录也要能访问）
  //   _next/*        Next.js 静态资源
  //   favicon / icon Web manifest 资源
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|icon.png).*)'],
}
