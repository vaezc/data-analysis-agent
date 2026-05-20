'use client'

// ============================================================
// SocialAuthButtons —— Google + GitHub 登录按钮
//
// 同时给 /login 和 /register 用。
// 点击后 next-auth signIn() 会跳到 provider 授权页 → 回 /api/auth/callback/<provider>
// → 由 PrismaAdapter 创建 / link User + Account → 回 /
//
// 按钮设计：
//   - Google：白底 + 彩色 G logo（Google 品牌指南要求）
//   - GitHub：黑底 + 白色字（GitHub 习惯）
//   - 灰色"或"分隔线下方再放邮箱密码表单
// ============================================================

import { signIn } from 'next-auth/react'
import { useState } from 'react'

export function SocialAuthButtons({ disabled }: { disabled?: boolean }) {
  // 防重复点击：点了之后 setLoading，等 OAuth 跳转
  const [loading, setLoading] = useState<'google' | 'github' | null>(null)

  const handle = (provider: 'google' | 'github') => {
    setLoading(provider)
    // callbackUrl='/' —— OAuth 成功后回首页
    signIn(provider, { callbackUrl: '/' })
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => handle('google')}
        disabled={disabled || loading !== null}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-fg transition duration-150 hover:bg-surface active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        <GoogleIcon />
        {loading === 'google' ? '跳转中…' : '使用 Google 继续'}
      </button>

      <button
        type="button"
        onClick={() => handle('github')}
        disabled={disabled || loading !== null}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-fg px-4 py-2.5 text-sm font-medium text-bg transition duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        <GitHubIcon />
        {loading === 'github' ? '跳转中…' : '使用 GitHub 继续'}
      </button>

      {/* 或分隔线 */}
      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-bg px-2 text-[11px] text-fg-subtle uppercase tracking-wider">
            或
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Icons —— 内联 SVG，无需额外依赖
// ============================================================

function GoogleIcon() {
  // Google G logo（官方多色版的简化 4 色）
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.51 5.51 0 0 1-2.39 3.62v3.01h3.86c2.26-2.08 3.58-5.15 3.58-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3.01c-1.07.72-2.44 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.11A11.997 11.997 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.197 7.197 0 0 1 0-4.56V6.61H1.29a12.01 12.01 0 0 0 0 10.78l3.98-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.94 11.94 0 0 0 12 0a11.997 11.997 0 0 0-10.71 6.61l3.98 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}
