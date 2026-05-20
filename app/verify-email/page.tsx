'use client'

// ============================================================
// /verify-email?token=xxx
//
// 流程：
//   1. 读 URL 的 token，POST /api/auth/verify-email
//   2. 成功 → 显示 "验证成功"，3 秒后跳 /login
//   3. 失败 → 显示原因（已过期 / 链接无效 / 已验证过）
//
// 注意 1：proxy.ts 已放行 /verify-email（未登录可访问）
// 注意 2：Next.js 16 要求 useSearchParams() 包在 <Suspense> 里，否则 prerender 失败
// ============================================================

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'

type Status =
  | { kind: 'verifying' }
  | { kind: 'success'; email: string }
  | { kind: 'error'; message: string; code?: string }

export default function VerifyEmailPage() {
  // 必须 Suspense 包住 —— useSearchParams 在 prerender 时 bail out
  return (
    <Suspense fallback={<VerifyingShell />}>
      <VerifyEmailInner />
    </Suspense>
  )
}

function VerifyingShell() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto size-12 rounded-2xl bg-surface grid place-items-center">
          <Loader2 className="size-6 text-fg-muted animate-spin" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-fg">验证中…</h1>
      </div>
    </div>
  )
}

function VerifyEmailInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>({ kind: 'verifying' })

  useEffect(() => {
    if (!token) {
      setStatus({
        kind: 'error',
        message: '缺少验证 token，请检查邮件链接',
        code: 'MISSING_TOKEN',
      })
      return
    }

    let cancelled = false
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          email?: string
          error?: string
          code?: string
        }
        if (cancelled) return
        if (data.ok && data.email) {
          setStatus({ kind: 'success', email: data.email })
          // 3 秒后跳登录页
          setTimeout(() => {
            if (!cancelled) window.location.href = '/login'
          }, 3000)
        } else {
          setStatus({
            kind: 'error',
            message: data.error || '验证失败',
            code: data.code,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: '网络错误，请稍后重试' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm text-center">
        {status.kind === 'verifying' && (
          <>
            <div className="mx-auto size-12 rounded-2xl bg-surface grid place-items-center">
              <Loader2 className="size-6 text-fg-muted animate-spin" />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-fg">
              验证中…
            </h1>
            <p className="mt-1.5 text-sm text-fg-muted">
              正在校验你的邮箱链接
            </p>
          </>
        )}

        {status.kind === 'success' && (
          <>
            <div className="mx-auto size-12 rounded-2xl bg-accent-soft grid place-items-center">
              <CheckCircle2 className="size-6 text-accent" strokeWidth={1.75} />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-fg">验证成功</h1>
            <p className="mt-1.5 text-sm text-fg-muted">
              {status.email} 已验证。3 秒后跳转登录…
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm text-accent hover:underline underline-offset-2"
            >
              立即登录 →
            </Link>
          </>
        )}

        {status.kind === 'error' && (
          <>
            <div className="mx-auto size-12 rounded-2xl bg-danger-soft grid place-items-center">
              <XCircle className="size-6 text-danger" strokeWidth={1.75} />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-fg">验证失败</h1>
            <p className="mt-1.5 text-sm text-fg-muted">{status.message}</p>
            <div className="mt-6 flex flex-col gap-2 items-center text-sm">
              {status.code === 'EXPIRED' && (
                <Link
                  href="/login"
                  className="text-accent hover:underline underline-offset-2"
                >
                  去登录页点击"重发验证邮件"
                </Link>
              )}
              {status.code === 'ALREADY_VERIFIED' && (
                <Link
                  href="/login"
                  className="text-accent hover:underline underline-offset-2"
                >
                  去登录 →
                </Link>
              )}
              {!status.code && (
                <Link
                  href="/login"
                  className="text-accent hover:underline underline-offset-2"
                >
                  返回登录
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
