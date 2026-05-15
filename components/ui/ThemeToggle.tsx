'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

/**
 * 主题切换按钮（light ⇄ dark）。
 *
 * SSR 时 resolvedTheme 是 undefined，等 client 挂载后才知道真实主题，
 * 否则首次渲染会闪一下错误图标。用 mounted state 防闪烁。
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '切换到浅色模式' : '切换到深色模式'}
      className="inline-flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-xs text-fg-muted transition duration-150 hover:bg-surface hover:text-fg active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {isDark ? (
        <Moon className="size-3.5 shrink-0" />
      ) : (
        <Sun className="size-3.5 shrink-0" />
      )}
      <span>{mounted ? (isDark ? '深色' : '浅色') : '主题'}</span>
    </button>
  )
}
