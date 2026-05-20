// ============================================================
// Auth.js 的 catch-all route handler
//
// 处理：
//   /api/auth/signin      登录页 (next-auth 内置)
//   /api/auth/signout     登出
//   /api/auth/session     拿当前 session
//   /api/auth/csrf        CSRF token
//   /api/auth/callback/*  OAuth 回调
//
// 我们注册的 /api/auth/register 不在此列 —— 它是独立路由。
// ============================================================

import { handlers } from '@/auth'

export const { GET, POST } = handlers
