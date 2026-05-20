'use client'

import { ThemeProvider } from 'next-themes'
import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'

/**
 * 全局 client providers。
 *
 * - ThemeProvider：跟随系统 / 强制 light / 强制 dark；localStorage 持久化；SSR 防 FOUC
 * - SessionProvider：让 useSession() 在客户端可用（UserMenu / 任何需要读 session 的 client component）
 *   SessionProvider 自己用 SWR-like 缓存，一个 tab 内不会重复 fetch session
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </SessionProvider>
  )
}
