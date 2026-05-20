// ============================================================
// POST /api/auth/verify-email   →   消费 token，标记 user.emailVerified
//
// 前端 /verify-email 页面读 URL ?token=... → POST 这个端点 → 成功跳 /login
//
// 返回：
//   200 { ok: true, email }
//   400 { error, code: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_VERIFIED' | 'MISSING_TOKEN' }
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { verifyEmailToken } from '@/lib/auth/email'

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

  const token =
    typeof body === 'object' && body !== null && 'token' in body
      ? (body as { token: unknown }).token
      : null
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json(
      { error: '缺少 token', code: 'MISSING_TOKEN' },
      { status: 400 },
    )
  }

  const result = await verifyEmailToken(token)
  if (!result.ok) {
    const message =
      result.reason === 'NOT_FOUND'
        ? '验证链接无效'
        : result.reason === 'EXPIRED'
          ? '验证链接已过期，请重新发送'
          : '邮箱已验证过，无需重复操作'
    return NextResponse.json(
      { error: message, code: result.reason },
      { status: result.reason === 'ALREADY_VERIFIED' ? 200 : 400 },
    )
  }

  return NextResponse.json({ ok: true, email: result.email })
}
