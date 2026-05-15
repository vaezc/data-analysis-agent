'use client'

import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

/**
 * 全局 client providers。
 *
 * next-themes 处理：
 *  - 跟随系统 / 强制 light / 强制 dark 三态
 *  - localStorage 持久化
 *  - SSR 防 FOUC（首屏闪烁）— 配合 html 上的 suppressHydrationWarning
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
