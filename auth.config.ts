// ============================================================
// Auth.js 配置 —— Edge-safe 部分（无 Prisma / 无 bcrypt）
//
// 这个文件被 proxy.ts 引入，proxy 跑在 Node.js runtime 但走 middleware 路径，
// 必须保持轻量：不能 import Prisma client（含 schema engine binary，体积大）、
// 也不能 import bcrypt（native binding）。
//
// 完整 auth 配置在 auth.ts 里，那里有 Prisma + Credentials provider。
// ============================================================

import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    /**
     * proxy.ts 调这个回调决定每次请求是否放行。
     * 返回 true / false / Response（重定向）。
     *
     * 规则：
     *   - 未登录 + 访问鉴权页（/login /register）→ 放行
     *   - 未登录 + 访问其他 → 重定向到 /login
     *   - 已登录 + 访问鉴权页 → 重定向到 /
     *   - 已登录 + 访问其他 → 放行
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      // /verify-email 是从邮件链接进来的，用户此刻一定未登录，要放行
      const isAuthPage =
        nextUrl.pathname.startsWith('/login') ||
        nextUrl.pathname.startsWith('/register') ||
        nextUrl.pathname.startsWith('/verify-email')

      if (isAuthPage) {
        // /verify-email 即便登录用户访问也允许（"已验证过"的提示对老用户也有用）
        // /login /register 登录用户访问跳 /
        if (
          isLoggedIn &&
          !nextUrl.pathname.startsWith('/verify-email')
        ) {
          return Response.redirect(new URL('/', nextUrl))
        }
        return true
      }

      if (!isLoggedIn) {
        // API 路径返回 401 JSON（fetch/curl 友好）；
        // 页面路径返回 false → Auth.js 默认重定向到 /login
        if (nextUrl.pathname.startsWith('/api/')) {
          return new Response(
            JSON.stringify({ error: '请先登录', code: 'UNAUTHENTICATED' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return false
      }

      return true
    },
    /**
     * 把 user.id 塞进 JWT token（默认只有 email / name / image）。
     * 没有这步，session.user.id 是 undefined，路由 owner check 拿不到 userId。
     */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    /**
     * 把 token.id 暴露给 session.user，让业务代码 await auth() 后能拿到。
     */
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string
      }
      return session
    },
  },
  providers: [], // proxy.ts 不需要 provider —— 完整列表在 auth.ts 里
} satisfies NextAuthConfig
