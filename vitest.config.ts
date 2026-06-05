import { defineConfig } from 'vitest/config'

// 手写 `@` alias 对齐 tsconfig 的 paths（@/* → ./*），零额外依赖。
// 项目为 ESM（package.json "type":"module"），用 import.meta.dirname 取目录，
// 不能用 CJS 的 __dirname。
export default defineConfig({
  resolve: {
    alias: { '@': import.meta.dirname },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', '__tests__/**/*.test.ts'],
    // better-sqlite3 是原生模块，交给 Node 原样 require，不要让 vite 转译
    server: { deps: { external: ['better-sqlite3'] } },
  },
})
