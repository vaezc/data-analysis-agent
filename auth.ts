// ============================================================
// Auth.js 完整配置 —— 含 Credentials provider + Prisma
//
// 区别于 auth.config.ts：
//   - 这个文件有 Prisma / bcrypt 依赖，不能被 proxy.ts 引入
//   - 只在 Server Components / Route Handlers / Server Actions 中使用
//
// 导出：
//   - handlers     GET/POST 给 /api/auth/[...nextauth]/route.ts
//   - auth         await auth() 在服务端拿 session
//   - signIn       服务端调用（client component 用 next-auth/react 的 signIn）
//   - signOut      同上
// ============================================================

import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authConfig } from './auth.config'
import {
  checkLoginRateLimit,
  clearFailedAttempts,
  recordFailedAttempt,
} from '@/lib/auth/rate-limit'

/**
 * Rate limit 错误 —— 继承 CredentialsSignin 让 Auth.js v5 把 code 透传到前端。
 * 前端 signIn() 返回的 res.error 会等于 'RateLimit'，可据此显示具体文案。
 */
class RateLimitError extends CredentialsSignin {
  code = 'RateLimit'
}

/**
 * 邮箱未验证 —— 密码对但 emailVerified 是 null。前端可据 code 展示
 * "请查收验证邮件 + 重发链接" 提示。
 */
class EmailNotVerifiedError extends CredentialsSignin {
  code = 'EmailNotVerified'
}

/** 从 Web Request 提取客户端 IP。本地为 ::1，Vercel 走 x-forwarded-for。 */
function getClientIp(request: Request | undefined): string | undefined {
  if (!request) return undefined
  const headers = request.headers
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    // 第一个 IP 是原始客户端，后面是各级代理
    return forwarded.split(',')[0].trim()
  }
  return headers.get('x-real-ip') ?? undefined
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // PrismaAdapter 处理 OAuth 用户/Account 创建（Credentials 走自己的 authorize 不经 adapter）。
  // Adapter + JWT session 同时用：Adapter 管 OAuth 持久化，session 仍走 jwt（无 Session 表）。
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' }, // 无状态 session，适配 Vercel Serverless
  providers: [
    // ---------- OAuth providers ----------
    // allowDangerousEmailAccountLinking=true (Option A)：
    // 如果 OAuth 邮箱已被一个本地账号占用（即便是用密码注册的），自动 link 到同一 User。
    // 风险：攻击者控制了你的 Google 账号也能登进你的本地账号。
    // 因为 Google/GitHub 邮箱已被对方平台验证过，对 demo 项目可接受。
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    // ---------- Credentials provider（邮箱密码） ----------
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const rawEmail =
          typeof credentials?.email === 'string' ? credentials.email : null
        const password =
          typeof credentials?.password === 'string'
            ? credentials.password
            : null
        if (!rawEmail || !password) return null

        const email = rawEmail.toLowerCase()
        const ipAddress = getClientIp(request)

        // 1. Rate limit 检查 —— 在密码校验前拦，避免暴力破解烧 bcrypt CPU
        const limit = await checkLoginRateLimit(email)
        if (!limit.allowed) {
          // 抛 RateLimitError，code='RateLimit' 会传到前端 res.error
          throw new RateLimitError()
        }

        // 2. 查 user + bcrypt 校验
        const user = await prisma.user.findUnique({ where: { email } })
        if (!user) {
          // 不存在的 email 也记失败 —— 防 email enumeration
          await recordFailedAttempt(email, ipAddress)
          return null
        }

        // OAuth 用户 user.password === null：不能用密码登录，直接当失败处理
        // 注意：从外部看跟"密码错"无法区分（防 enumeration "这账号是 OAuth-only"）
        if (!user.password) {
          await recordFailedAttempt(email, ipAddress)
          return null
        }

        const ok = await bcrypt.compare(password, user.password)
        if (!ok) {
          await recordFailedAttempt(email, ipAddress)
          return null
        }

        // 3. 邮箱必须验证（密码对但没验证 → 提示用户去查邮箱）
        //    注意顺序：rate limit > 密码校验 > 邮箱验证
        //    把"邮箱未验证"放在密码校验后，避免攻击者用错密码探测"这邮箱是否存在且未验证"
        if (!user.emailVerified) {
          // 密码对的失败不计入 rate limit（避免合法用户被锁）
          throw new EmailNotVerifiedError()
        }

        // 4. 完全通过：清空该 email 的失败历史
        await clearFailedAttempts(email)
        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      },
    }),
  ],
})
