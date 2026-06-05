import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 这些含 native binding 或运行时 driver，让 turbopack/webpack 不要 inline 打包，
  // 运行时 require()，避免 .node 加载失败 / 连接驱动被错误打包。
  // Prisma 7：无 Rust engine（@prisma/engines 已移除），运行时走 @prisma/adapter-pg + pg。
  // undici 是 Node 内置，instrumentation.ts 显式 import 但 Turbopack 不识别，标 external 走 runtime require。
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/adapter-pg", "pg", "undici"],
};

export default nextConfig;
