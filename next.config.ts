import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是 native binding，作为外部依赖让运行时 require()，
  // 避免 turbopack/webpack inline 打包导致 .node 文件加载失败
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
