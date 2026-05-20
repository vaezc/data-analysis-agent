'use client'

// ============================================================
// UserMenu —— Sidebar 底部用户卡片
//
// Client Component（要嵌进 client 的 page.tsx，不能用 Server Component）：
//   - useSession() 从 SessionProvider 拿 session（含 user.email）
//   - signOut() 调 Auth.js 客户端登出 + redirect /login
//
// 设计：紧凑卡片，邮箱 + Logout 一排，与 ThemeToggle 风格统一。
// ============================================================

import { LogOut } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'

export function UserMenu() {
  const { data: session } = useSession()

  // 未登录 / 加载中：不渲染（页面已被 proxy.ts 拦掉了，正常不会到这里）
  if (!session?.user?.email) return null

  const email = session.user.email
  // 邮箱长时只显示 @ 前缀，避免破坏布局
  const displayName = email.length > 22 ? email.split('@')[0] : email

  return (
    <div className="flex items-center gap-2 px-2 py-2">
      {/* 头像占位（首字母大写） */}
      <div className="size-7 shrink-0 grid place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent uppercase">
        {email[0]}
      </div>

      <div className="flex-1 min-w-0">
        <div
          className="text-xs font-medium text-fg truncate"
          title={email}
        >
          {displayName}
        </div>
      </div>

      <button
        type="button"
        onClick={() => signOut({ redirectTo: '/login' })}
        aria-label="退出登录"
        title="退出登录"
        className="size-7 inline-flex items-center justify-center rounded-md text-fg-subtle transition duration-150 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <LogOut className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  )
}
