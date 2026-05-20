'use client'

// ============================================================
// /register —— 邮箱密码注册页
//
// 流程：
//   1. 前端校验邮箱格式 + 密码长度 + 两次密码一致
//   2. POST /api/auth/register
//   3. 成功 → 自动登录（调 signIn）→ 跳 /
//   4. 失败 → 把 error.message 展示给用户（409 邮箱已注册 / 400 弱密码 等）
// ============================================================

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, Mail } from 'lucide-react'
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons'

const MIN_PASSWORD_LENGTH = 6
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormState =
  | { kind: 'form' }
  | { kind: 'submitted'; email: string; emailSent: boolean; warning?: string }

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState<FormState>({ kind: 'form' })

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const cleanEmail = email.trim()

    // 前端校验（服务端也会再校验一次，双重保险）
    if (!cleanEmail || !password) return
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError('邮箱格式不正确')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`)
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        email?: string
        verificationEmailSent?: boolean
        verificationEmailError?: string
      }
      if (!res.ok) {
        setError(data.error || `注册失败 (HTTP ${res.status})`)
        return
      }

      // 注册成功 → 切到 "请查收邮件" 视图（不再自动登录）
      setState({
        kind: 'submitted',
        email: cleanEmail,
        emailSent: data.verificationEmailSent ?? false,
        warning: data.verificationEmailError,
      })
    } catch {
      setError('网络错误，请检查连接')
    } finally {
      setSubmitting(false)
    }
  }

  // 提交后视图：请查收邮件
  if (state.kind === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto size-12 rounded-2xl bg-accent-soft grid place-items-center">
            {state.emailSent ? (
              <CheckCircle2 className="size-6 text-accent" strokeWidth={1.75} />
            ) : (
              <Mail className="size-6 text-accent" strokeWidth={1.75} />
            )}
          </div>
          <h1 className="mt-5 text-xl font-semibold text-fg">
            {state.emailSent ? '请查收验证邮件' : '注册成功'}
          </h1>
          <p className="mt-2 text-sm text-fg-muted leading-relaxed">
            {state.emailSent ? (
              <>
                我们向 <span className="text-fg font-medium">{state.email}</span>{' '}
                发送了一封验证邮件。请点击邮件中的链接完成验证。
              </>
            ) : (
              <>
                账号已创建，但邮件发送失败：{state.warning}
              </>
            )}
          </p>
          <p className="mt-4 text-xs text-fg-subtle">
            没收到？检查垃圾邮件文件夹，或者去登录页点击"重发验证邮件"。
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-accent hover:underline underline-offset-2"
          >
            返回登录 →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
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
          <h1 className="mt-5 text-xl font-semibold text-fg">注册</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            创建账号开始使用 Data Analysis Agent
          </p>
        </div>

        {/* OAuth 登录 —— 一键注册（OAuth 来的用户邮箱已被对方验证，跳过验证邮件） */}
        <div className="mt-8">
          <SocialAuthButtons disabled={submitting} />
        </div>

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
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
            required
            minLength={MIN_PASSWORD_LENGTH}
            hint={`至少 ${MIN_PASSWORD_LENGTH} 个字符`}
          />
          <Field
            id="confirmPassword"
            label="确认密码"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            disabled={submitting}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !email.trim() ||
              !password ||
              !confirmPassword
            }
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg shadow-sm shadow-accent/25 transition duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:bg-surface disabled:text-fg-subtle disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:opacity-100"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? '注册中…' : '注册'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-fg-muted">
          已有账号？{' '}
          <Link
            href="/login"
            className="text-accent hover:underline underline-offset-2"
          >
            登录
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
  hint?: string
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
  hint,
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
      {hint && (
        <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>
      )}
    </div>
  )
}
