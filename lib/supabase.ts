// ============================================================
// Supabase server client
//
// 设计要点：
//   - 单例：避免每次请求重建 client
//   - 用 SERVICE_ROLE_KEY 绕过 RLS（后端可信环境）
//   - 永远只在服务端 import：service role key 不能进 client bundle
//   - DO NOT 在 Edge runtime 使用（service_role 不该出现在边缘）
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('SUPABASE_URL 未配置')
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 未配置')
  }

  _client = createClient(url, key, {
    auth: {
      // 后端用 service_role，不需要持久化 session
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  return _client
}
