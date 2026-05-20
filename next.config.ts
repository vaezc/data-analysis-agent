import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 这些包包含 native binding 或 schema engine 二进制（@prisma/client），
  // 让 turbopack/webpack 不要 inline 打包，运行时 require()，
  // 避免 .node 文件加载失败 / engine 找不到连接地址。
  // undici 是 Node 内置，instrumentation.ts 显式 import 但 Turbopack 不识别，标 external 走 runtime require。
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/engines", "undici"],
};

export default nextConfig;
