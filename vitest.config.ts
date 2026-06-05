import { defineConfig } from 'vitest/config'
import path from 'node:path'

// 手写 `@` alias 对齐 tsconfig 的 paths（@/* → ./*）。
// 不用 vite-tsconfig-paths 插件：它是 ESM-only，在本项目（无 "type":"module"）
// 的 CJS 配置加载链路下会触发 ERR_REQUIRE_ESM（Node < 20.19）。手写零依赖更稳。
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', '__tests__/**/*.test.ts'],
    // better-sqlite3 是原生模块，交给 Node 原样 require，不要让 vite 转译
    server: { deps: { external: ['better-sqlite3'] } },
  },
})
