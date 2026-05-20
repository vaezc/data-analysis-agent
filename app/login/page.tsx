'use client'

// ============================================================
// /login —— 邮箱密码登录页
//
// 设计：
//   - 居中卡片，不显示侧栏（独立路由没引 sidebar）
//   - 用 next-auth/react 的 signIn('credentials', ...)
//   - 失败时展示 'CredentialsSignin' 标准错误 → 中文文案
//   - 已登录用户进入此页时 proxy.ts 自动跳 /
// ============================================================

import { useState, type FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { Loader2, Mail } from 'lucide-react'
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /** 上次失败是不是因为邮箱未验证 —— 用来显示"重发验证邮件"链接 */
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resendState, setResendState] = useState<{
    status: 'idle' | 'sending' | 'sent' | 'error'
    message?: string
  }>({ status: 'idle' })

  const handleResend = async () => {
    if (!email.trim()) return
    setResendState({ status: 'sending' })
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (res.ok && data.ok) {
        setResendState({ status: 'sent', message: '已重发，请查收邮箱' })
      } else {
        setResendState({
          status: 'error',
          message: data.error || '重发失败',
        })
      }
    } catch {
      setResendState({ status: 'error', message: '网络错误' })
    }
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email.trim() || !password) return

    setSubmitting(true)
    setError(null)
    setNeedsVerification(false)
    setResendState({ status: 'idle' })
    try {
      const res = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false, // 自己处理错误展示，不让 next-auth 跳 /api/auth/error
      })
      if (!res) {
        setError('登录失败，请稍后重试')
        return
      }
      if (res.error) {
        // 根据 code 区分不同错误（auth.ts 用 CredentialsSignin 子类抛）
        const code = res.code || res.error
        if (code === 'RateLimit') {
          setError('登录尝试过多，请稍后再试（最多 5 次失败，15 分钟解锁）')
        } else if (code === 'EmailNotVerified') {
          setError('邮箱尚未验证，请先查收注册时的验证邮件')
          setNeedsVerification(true)
        } else {
          setError('邮箱或密码错误')
        }
        return
      }
      // 成功 → 手动跳 /（next-auth 不带 redirect: false 才会自动跳，但我们要绕过它的错误页）
      window.location.href = '/'
    } catch {
      setError('网络错误，请检查连接')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo + 标题 */}
        <div className="text-center">
          <div
            className="mx-auto size-12 rounded-2xl bg-no-repeat shadow-sm shadow-fg/10"
            style={{
              backgroundImage: 'url(/image.png)',
              backgroundSize: '320%',
              backgroundPosition: '50% 30%',
            }}
            aria-label="Data Analysis Agent"
            role="img"
          />
          <h1 className="mt-5 text-xl font-semibold text-fg">登录</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            欢迎回到 Data Analysis Agent
          </p>
        </div>

        {/* OAuth 登录 */}
        <div className="mt-8">
          <SocialAuthButtons disabled={submitting} />
        </div>

        {/* 邮箱密码表单 */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          aria-busy={submitting}
        >
          <Field
            id="email"
            label="邮箱"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            disabled={submitting}
            required
          />
          <Field
            id="password"
            label="密码"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
            required
            minLength={6}
          />

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {needsVerification && (
            <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 flex items-center gap-2">
              <Mail className="size-3.5 shrink-0 text-accent" />
              {resendState.status === 'sent' || resendState.status === 'error' ? (
                <span
                  className={`text-xs ${
                    resendState.status === 'sent'
                      ? 'text-accent'
                      : 'text-danger'
                  }`}
                >
                  {resendState.message}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendState.status === 'sending' || !email.trim()}
                  className="text-xs text-accent hover:underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resendState.status === 'sending'
                    ? '发送中…'
                    : '重发验证邮件 →'}
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg shadow-sm shadow-accent/25 transition duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:bg-surface disabled:text-fg-subtle disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:opacity-100"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-fg-muted">
          还没有账号？{' '}
          <Link
            href="/register"
            className="text-accent hover:underline underline-offset-2"
          >
            注册
          </Link>
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  id: string
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  required?: boolean
  disabled?: boolean
  minLength?: number
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
  disabled,
  minLength,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-fg-muted mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none transition duration-150 focus:border-accent/40 focus:ring-2 focus:ring-accent/15 disabled:bg-surface disabled:text-fg-subtle disabled:cursor-not-allowed"
      />
    </div>
  )
}
