import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 7 生成的 client（自动生成，不检查）
    "lib/generated/**",
  ]),
  // 收紧类型约束：禁 any（用 unknown + 守卫替代）。
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // 导出边界显式标返回类型——只约束库代码，不波及 React 组件
  // （tsx 里返回 JSX 的组件标注返回类型收益低、噪声大）。
  {
    files: ["lib/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
]);

export default eslintConfig;
