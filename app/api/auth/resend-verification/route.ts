// ============================================================
// POST /api/auth/resend-verification  →  重新发送验证邮件
//
// 节流：60s 内对同一用户重复调用 → 429
// 已验证邮箱的用户调用 → 400（无需重发）
// 不存在邮箱调用 → 仍返回 200（防 enumeration —— 不告诉用户"这邮箱不存在"）
//
// 防滥用：当前节流只在用户级别（lib/auth/email.ts 内置）。
// 真生产应叠加 IP 级 rate limit，避免攻击者用脚本枚举邮箱地址耗尽 Resend 额度。
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/auth/email'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: '请求体必须是合法 JSON', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  const rawEmail =
    typeof body === 'object' && body !== null && 'email' in body
      ? (body as { email: unknown }).email
      : null
  if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
    return NextResponse.json(
      { error: '缺少邮箱', code: 'MISSING_EMAIL' },
      { status: 400 },
    )
  }

  const email = rawEmail.trim().toLowerCase()
  const user = await prisma.user.findUnique({ where: { email } })

  // 邮箱不存在：返回 ok，不告诉攻击者（enumeration 防御）
  if (!user) {
    return NextResponse.json({ ok: true })
  }

  // 已验证：明确告诉用户（这是登录态用户，不是 enumeration 风险）
  if (user.emailVerified) {
    return NextResponse.json(
      { error: '邮箱已验证，无需重发', code: 'ALREADY_VERIFIED' },
      { status: 400 },
    )
  }

  const result = await sendVerificationEmail({
    userId: user.id,
    email: user.email,
    isResend: true,
  })

  if (!result.ok) {
    // 区分节流（429）和真实发送失败（500）
    const isThrottle = result.reason.includes('请等待')
    return NextResponse.json(
      {
        error: result.reason,
        code: isThrottle ? 'THROTTLED' : 'SEND_FAILED',
      },
      { status: isThrottle ? 429 : 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
