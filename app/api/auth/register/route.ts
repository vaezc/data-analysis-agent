// ============================================================
// POST /api/auth/register
//
// 邮箱密码注册：
//   - 邮箱 / 密码必填，密码 >= 6 字符
//   - bcrypt cost factor = 12（推荐安全级别，单次 hash ~250ms）
//   - 邮箱重复返回 409，让前端展示"该邮箱已注册"
//   - 错误响应统一格式：{ error: string, code?: string }
//
// 该路由是未登录可访问的——proxy.ts 的 matcher 已经把 /api/auth/* 排除掉。
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/auth/email'

export const runtime = 'nodejs'

const BCRYPT_COST = 12
const MIN_PASSWORD_LENGTH = 6
// 邮箱粗校验：本地部分 + @ + 域名（不卡 RFC 5322 极端情况，避免误伤）
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('请求体必须是合法 JSON', 'INVALID_JSON', 400)
  }
  if (!isObject(body)) {
    return errorResponse('请求体必须是对象', 'INVALID_BODY', 400)
  }

  const rawEmail = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : null

  if (!rawEmail) {
    return errorResponse('邮箱不能为空', 'MISSING_EMAIL', 400)
  }
  if (!EMAIL_REGEX.test(rawEmail)) {
    return errorResponse('邮箱格式不正确', 'INVALID_EMAIL', 400)
  }
  if (!password) {
    return errorResponse('密码不能为空', 'MISSING_PASSWORD', 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(
      `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`,
      'PASSWORD_TOO_SHORT',
      400,
    )
  }

  // 统一小写存储，避免 "Foo@x.com" / "foo@x.com" 注册两个账号
  const email = rawEmail.toLowerCase()

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return errorResponse('该邮箱已注册', 'EMAIL_EXISTS', 409)
    }

    const hashed = await bcrypt.hash(password, BCRYPT_COST)
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
      select: { id: true, email: true, name: true, createdAt: true },
    })

    // 发送验证邮件 —— 失败不阻塞注册响应（用户可在登录页点"重发"再试）
    // 不 await 也可，但这里 await 让响应里能告诉前端邮件是否发出
    const mail = await sendVerificationEmail({
      userId: user.id,
      email: user.email,
    })

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.getTime(),
        verificationEmailSent: mail.ok,
        // 失败时把 reason 给前端展示（"网络问题"之类），但不暴露 Resend 详细错
        verificationEmailError: mail.ok ? undefined : '邮件发送失败，请稍后在登录页点击"重发验证邮件"',
      },
      { status: 201 },
    )
  } catch (e) {
    // 不把 stack 暴露给客户端；服务端 log 可看
    console.error('[POST /api/auth/register] failed:', e)
    return errorResponse('注册失败，请稍后重试', 'REGISTER_FAILED', 500)
  }
}

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
