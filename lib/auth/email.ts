// ============================================================
// 邮箱验证 —— token 生成 / 邮件发送 / token 校验
//
// 设计要点：
//   - token：crypto.randomBytes(32).toString('base64url')，43 字符，不可猜
//     生产建议存 SHA-256 hash（demo 简化为存原值）
//   - 过期 24 小时；过期后用户可调 resend 重发
//   - 验证成功立即删 token（一次性，防重放）
//   - 发件人：onboarding@resend.dev（Resend 默认 sandbox，无需 verify domain）
//     注意：sandbox 模式只能发到 Resend 账号的注册邮箱；其他地址需要 verify 自己的 domain
//   - 失败不抛（已注册成功了，邮件失败可以重发） —— 由调用方决定怎么处理
// ============================================================

import crypto from 'node:crypto'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const RESEND_THROTTLE_MS = 60 * 1000 // 重发节流 60s

let _resend: Resend | null = null
function getResend(): Resend {
  if (_resend) return _resend
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY 未配置（去 https://resend.com 拿一个）')
  }
  _resend = new Resend(apiKey)
  return _resend
}

function getSender(): string {
  return process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
}

function getAppUrl(): string {
  return process.env.AUTH_URL || 'http://localhost:3000'
}

/**
 * 生成验证 token、写入 DB、发送邮件。
 * 节流：60s 内对同一 userId 重复调用会被拒绝（防 spam）。
 *
 * @returns 成功发送 / token-existing throttle 时返回 token；发送失败返回 null
 */
export async function sendVerificationEmail(params: {
  userId: string
  email: string
  /** 是否是重发场景（resend endpoint 用）。注册时调用传 false */
  isResend?: boolean
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { userId, email, isResend = false } = params

  // 节流（重发场景才检查；注册首次调用直接发）
  if (isResend) {
    const latest = await prisma.emailVerificationToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (latest) {
      const sinceLast = Date.now() - latest.createdAt.getTime()
      if (sinceLast < RESEND_THROTTLE_MS) {
        const wait = Math.ceil((RESEND_THROTTLE_MS - sinceLast) / 1000)
        return { ok: false, reason: `请等待 ${wait} 秒后再试` }
      }
    }
  }

  // 生成 token 并入库
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.emailVerificationToken.create({
    data: { token, userId, expiresAt },
  })

  // 构造验证链接
  const verifyUrl = `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`

  // 发送邮件
  try {
    const { error } = await getResend().emails.send({
      from: `Data Analysis Agent <${getSender()}>`,
      to: email,
      subject: '验证你的邮箱 - Data Analysis Agent',
      html: renderEmailHtml(verifyUrl),
      text: `请打开此链接验证邮箱：${verifyUrl}\n\n链接 24 小时内有效。如果不是你本人操作，忽略即可。`,
    })
    if (error) {
      console.error('[sendVerificationEmail] Resend 报错:', error)
      return { ok: false, reason: error.message || '邮件发送失败' }
    }
    return { ok: true }
  } catch (e) {
    console.error('[sendVerificationEmail] 异常:', e)
    return {
      ok: false,
      reason: e instanceof Error ? e.message : '邮件发送失败',
    }
  }
}

/**
 * 校验 token，成功后：
 *   1. 标记 user.emailVerified = now
 *   2. 删除该 token（一次性，防重放）
 *
 * 返回 user.email 让调用方用于成功页提示；失败返回原因。
 */
export async function verifyEmailToken(
  token: string,
): Promise<
  | { ok: true; email: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_VERIFIED' }
> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!record) {
    return { ok: false, reason: 'NOT_FOUND' }
  }
  if (record.expiresAt.getTime() < Date.now()) {
    // 过期了 —— 顺手删，避免 DB 累积
    await prisma.emailVerificationToken.delete({
      where: { id: record.id },
    })
    return { ok: false, reason: 'EXPIRED' }
  }
  if (record.user.emailVerified) {
    // 已验证过 —— 把 token 删了避免重复
    await prisma.emailVerificationToken.delete({
      where: { id: record.id },
    })
    return { ok: false, reason: 'ALREADY_VERIFIED' }
  }

  // 标记验证 + 删 token（同一事务）
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.delete({
      where: { id: record.id },
    }),
  ])

  return { ok: true, email: record.user.email }
}

// ============================================================
// HTML 模板 —— inline CSS 兼容主流邮件客户端
// ============================================================

function renderEmailHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证邮箱</title>
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#18181b;">验证你的邮箱</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#52525b;">
                欢迎使用 Data Analysis Agent。请点击下方按钮完成邮箱验证：
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;">
                验证邮箱
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#71717a;">
                按钮无法点击？复制以下链接到浏览器：
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:#52525b;word-break:break-all;">
                ${verifyUrl}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f4f4f5;border-top:1px solid #e4e4e7;">
              <p style="margin:0;font-size:11px;color:#71717a;">
                链接 24 小时内有效。如果不是你本人操作，忽略即可。
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
