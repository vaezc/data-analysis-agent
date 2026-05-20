// ============================================================
// Next.js 16 instrumentation hook —— 服务启动时执行一次
//
// 用途：本机开发时，如果环境变量配了 HTTP_PROXY / HTTPS_PROXY，
// 让 Node fetch（undici）也走这个代理。否则 Node 20 默认会忽略代理环境变量
// 直连，导致 OAuth provider（如 Google OIDC discovery）拉不通。
//
// 生产部署（Vercel）网络通畅，不需要代理 —— 不设置代理变量时这段直接跳过。
// ============================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy

  if (!proxy) return

  // undici 是 Node 内置 HTTP 客户端（fetch 用的就是它），无需 npm install
  const { setGlobalDispatcher, ProxyAgent } = await import('undici')
  setGlobalDispatcher(new ProxyAgent(proxy))
  console.log('[instrumentation] fetch via proxy:', proxy)
}
