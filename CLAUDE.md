# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本文件指导 Claude Code 开发本项目。开始任何编码前请完整阅读。

---

## 开发命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 类型检查（不输出文件）
npx tsc --noEmit

# Lint
npm run lint

# 上传接口测试（Phase 1 验收）
curl -F "file=@scripts/sample.csv" http://localhost:3000/api/upload
```

环境变量分两个文件：

**`.env`**（Prisma CLI 读这个）：
```
DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://...:5432/postgres"
```

**`.env.local`**（Next.js / 应用代码读这个）：
```
LLM_PROVIDER=deepseek
LLM_API_KEY=your_key_here
LLM_MODEL=deepseek-v4-flash

AUTH_SECRET="<openssl rand -base64 32>"
AUTH_URL=http://localhost:3000
```

完整模板见 `.env.example`。

常用 Prisma 命令：
```bash
npx prisma migrate dev --name <description>  # 改完 schema 后跑这个，自动生成 + 应用 migration
npx prisma generate                          # 改完 schema 但没改 DB（如修类型）
npx prisma studio                            # 本地 GUI 看数据
```

---

## 项目背景

**Data Analysis Agent** — 让非技术人员通过自然语言分析 CSV/Excel 数据的工具。

**核心交互：**
1. 用户上传数据文件
2. 用自然语言提问（"哪个区域销售额最高"）
3. Agent 自动多步推理：理解数据 → 计算 → 生成图表 → 给结论
4. 全过程实时展示 Agent 的每一步动作

**项目定位：** 求职作品集 / 公司 AI 转型方案 POC。需要做到生产可用级别，2~3 周完成。

---

## 技术栈

| 层 | 选型 | 注意事项 |
|---|---|---|
| 框架 | Next.js 16 (App Router) | 使用 Server Components 默认；注意 v16 破坏性变化（见下方） |
| 语言 | TypeScript (strict) | 不允许 any，必须显式类型 |
| 样式 | Tailwind CSS v4 | 不引入额外 UI 库，组件自己写 |
| LLM | **DeepSeek API**（OpenAI 兼容） | 详见下方 LLM 集成章节 |
| 数据解析 | papaparse (CSV) + exceljs (Excel) | 在 API Route 服务端解析。xlsx 因 CVE 已弃用 |
| 图表 | Recharts | 不要用 Chart.js |
| 状态管理 | React useState + Zustand（如需跨组件） | 不引入 Redux |
| 数据存储 | **Prisma + Postgres**（Supabase 仅作 Postgres 宿主） | datasets / messages / users 三张表；migration 走 `prisma migrate dev` |
| 鉴权 | **Auth.js v5**（Credentials provider） | bcryptjs 哈希、JWT session、`proxy.ts` 路由保护 |
| SQL 沙箱 | **better-sqlite3** `:memory:` | 替代 node:vm；二级 LLM 生成 SELECT，三层防御 |

**严格约束：**
- 不引入未列出的第三方库，需要新依赖时先在对话中说明理由
- 不使用任何 React Server Action（统一用 API Route，便于调试）
- 不使用 `useEffect` 触发数据加载，用 React Query 或 SWR
- 所有异步操作必须有 loading 和 error 状态

### Next.js 16 关键变化（不同于训练数据中的 14/15）

> AGENTS.md 已提示："This is NOT the Next.js you know"。写代码前如果不确定 API，先查 `node_modules/next/dist/docs/`。

- **动态 API 是异步的**：`params`、`searchParams`、`cookies()`、`headers()`、`draftMode()` 全部返回 Promise，必须 `await`
  ```ts
  // Route Handler 示例
  export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params
  }
  ```
- **`npm run lint` 直接跑 `eslint`**（不是 `next lint`），使用 ESLint 9 flat config（`eslint.config.mjs`）
- **默认启用 Turbopack**（脚手架已加 `--turbopack`），`next dev` 走 Turbopack
- **React 19.2**：可以用 `use()` Hook 读取 Promise；`forwardRef` 不再必需（ref 作为普通 prop）
- **Tailwind v4**：配置移到 CSS（`@import "tailwindcss"` + `@theme`），不再有 `tailwind.config.js`
- **`middleware.ts` 改名 `proxy.ts`**：导出函数名也从 `middleware` 改为 `proxy`。Auth.js v5 官方很多示例仍是旧写法，**不能直接复制**

---

## 鉴权（Auth.js v5 + Prisma）

**两个 auth 文件必须严格分离**（这是 Auth.js v5 的标准结构）：

| 文件 | 用途 | 能 import 什么 |
|---|---|---|
| `auth.config.ts` | 给 `proxy.ts` 引入的 edge-safe 部分 | 仅类型 + callbacks，**不能 import Prisma / bcrypt** |
| `auth.ts` | 完整配置（Credentials + OAuth + Prisma） | 任意（只在 server side 使用） |
| `proxy.ts` | 路由保护入口 | **只 import `auth.config.ts`** —— 引入 `auth.ts` 会让 Prisma 走 edge runtime 报错 |

**关键设计：**
- `session.strategy = 'jwt'`：无状态，适配 Vercel Serverless（DB session 每次请求多一次 SELECT）
- `PrismaAdapter + JWT` 共用：Adapter 管 OAuth 用户/Account 持久化，session 仍走 JWT（无 Session 表）
- `bcrypt cost factor = 12`：单次 hash ~250ms，被验证够安全
- 邮箱**统一小写存储**：避免 `Foo@x.com` / `foo@x.com` 注册两个账号
- `proxy.ts` 的 matcher 必须排除 `/api/auth/*` 和 `/api/auth/register`，否则注册接口自己被拦
- 已登录访问 `/login` `/register` 自动重定向 `/`；未登录访问其他页面跳 `/login`

**JWT callback 必须把 `user.id` 写进 token**，session callback 再暴露给 `session.user.id`——默认 next-auth session 里没有 `id`。

### Provider 矩阵

| Provider | 文件 | 关键点 |
|---|---|---|
| Credentials | `auth.ts` `authorize()` | bcrypt 校验 + rate limit 前置 + 邮箱验证后置 |
| Google | `auth.ts` providers | `allowDangerousEmailAccountLinking: true`（OAuth 邮箱与本地账号自动 link，Option A 风险已接受） |
| GitHub | 同上 | 同上 |

`authorize()` 的执行顺序（**改顺序前先想清楚**）：

1. **Rate limit 检查** → `checkLoginRateLimit(email)`，超限抛 `RateLimitError`（code='RateLimit'）。放第一位是为了不让暴力破解烧 bcrypt CPU。
2. **bcrypt 校验** → 不存在的 user / OAuth-only 用户 / 密码错都走 `recordFailedAttempt(email)` + `return null`（防 email enumeration —— 三种失败外部看起来一样）。
3. **邮箱验证状态** → `!user.emailVerified` 抛 `EmailNotVerifiedError`（code='EmailNotVerified'）。放在密码校验**之后**，避免攻击者用错密码探测"这邮箱是否存在且未验证"。
4. **成功** → `clearFailedAttempts(email)` 清历史，返回 `{ id, email, name }`。

### 邮箱验证（`lib/auth/email.ts` + Resend）

- **Token**：`crypto.randomBytes(32).toString('base64url')`，43 字符，24h 过期
- **存储**：明文存 DB（生产建议存 SHA-256 hash，demo 简化）
- **一次性**：验证成功在同一事务里 `user.emailVerified = now()` + `delete token`
- **重发节流**：60s 内同一 userId 不允许重发，返回剩余等待秒数
- **发件人**：`onboarding@resend.dev`（Resend sandbox，**只能发到注册邮箱**），生产换 verified domain
- **失败不阻塞注册**：注册接口 await 邮件发送，把 `verificationEmailSent` 状态回给前端，用户可在登录页点"重发"
- **enumeration 防御**：`/api/auth/resend-verification` 对不存在的邮箱也返回 200

### 登录失败 rate limit（`lib/auth/rate-limit.ts`）

- **算法**：滑动窗口 —— 15 分钟内累计 5 次失败触发锁定，直到最早那次出窗口
- **key 是 email 不是 IP**：IP 跨用户共享（公司 NAT、CGNAT）不靠谱；email 是攻击目标本身
- **不存在的 email 也记**：防 email enumeration（攻击者通过响应快慢分辨邮箱存在性）
- **登录成功清历史**：`clearFailedAttempts(email)` `deleteMany`，老失败不留尾巴
- **DB 累积清理**：当前无自动清，每条 ~100 字节，1 万条 ~1 MB。生产可加 Vercel cron 每天 `DELETE WHERE created_at < NOW() - INTERVAL '7 days'`

### OAuth（Google + GitHub）

- **新增表** `accounts`：next-auth 标准 schema，**字段名故意 snake_case**（`access_token` / `expires_at` 等），PrismaAdapter 直接按这些字段写，不可改 camelCase
- **`User.password` 可空**：OAuth 用户没设过密码；`authorize()` 里 `!user.password → return null`（外部看起来跟"密码错"一样，防 enumeration "这账号是 OAuth-only"）
- **`allowDangerousEmailAccountLinking: true`**：若 Google 邮箱已被本地账号占用，自动 link 到同一 User。风险：攻击者控制 Google 账号即能登本地账号；对 demo 可接受
- **回调 URL**：Google `<AUTH_URL>/api/auth/callback/google`，GitHub `<AUTH_URL>/api/auth/callback/github`
- **环境变量**（未配置就不启用）：`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

---

## 数据层（Prisma）

**目录结构：**

```
lib/
├── prisma.ts          # PrismaClient 单例（HMR-safe）
├── db/
│   ├── datasets.ts    # createDataset / getDataset / listDatasets / deleteDataset
│   └── messages.ts    # loadConversation / saveUserMessage / saveAssistantMessage / deleteMessagePair
└── auth/
    ├── email.ts       # sendVerificationEmail / verifyEmailToken（Resend）
    └── rate-limit.ts  # checkLoginRateLimit / recordFailedAttempt / clearFailedAttempts
```

**Schema 关键：**
- 6 张表：`users` / `accounts` / `datasets` / `messages` / `login_attempts` / `email_verification_tokens`
- 表名 snake_case（`@@map`），字段 camelCase（**`accounts` 表故意保留 snake_case** —— next-auth 协议要求）
- `columns` / `rows` / `ui` / `llm` 用 `Json`（→ Postgres JSONB）
- 级联：`User → Dataset → Message` 全 `onDelete: Cascade`；`User → Account` / `User → EmailVerificationToken` 同样级联
- `LoginAttempt` **不外键到 User**：要对不存在的 email 也记账（防 enumeration）
- 列出 datasets 时用 **`jsonb_array_length(rows)` O(1)** 算 rowCount，避免拉全量

**Migration 演进（5 条全部入 git，按时间顺序）：**
1. `20260519145908_init` —— Dataset + Message
2. `20260520013006_add_user_and_owner` —— User + Dataset.userId 外键
3. `20260520064951_add_login_attempts` —— LoginAttempt 表（rate limit 用）
4. `20260520091850_add_email_verification` —— User.emailVerified + EmailVerificationToken
5. `20260520110805_add_oauth_accounts` —— User.password 改可空 + image 字段 + Account 表（OAuth）

**连接字符串（`.env`，不在 `.env.local`！Prisma CLI 只读 `.env`）：**

```
DATABASE_URL  # 端口 6543（Supavisor pooler）+ ?pgbouncer=true&connection_limit=1，应用运行时用
DIRECT_URL    # 端口 5432（直连），仅 migration 用
```

**密码含特殊字符必须 URL 编码**：`@` → `%40`，`]` → `%5D`，等等。

**Prisma 7（driver adapter 架构，2026-06 升级）关键点：**
- **Node ≥ 20.19**（`.nvmrc` 锁 20、`engines.node` 写明）。Prisma 7 preinstall 在低版本直接拒装。
- **连接 URL 不在 schema**：`schema.prisma` 的 datasource 只剩 `provider`。运行时连接（DATABASE_URL/6543）由 `lib/prisma.ts` 的 `@prisma/adapter-pg` 提供；CLI/migration 的连接（DIRECT_URL/5432）配在根目录 **`prisma.config.ts`**（需 `import 'dotenv/config'` 显式加载 .env）。
- **client 生成到项目目录**：generator `prisma-client` 输出到 `lib/generated/prisma`（已 gitignore，install/build 由 `prisma generate` 重生成）。import 走 `@/lib/generated/prisma/client`，不再是 `@prisma/client`。
- **无 Rust engine**：`@prisma/engines` 已移除。Turbopack external 列表相应改为：

```ts
// next.config.ts —— 含 native binding / 运行时 driver 的包标 external
serverExternalPackages: ['better-sqlite3', '@prisma/client', '@prisma/adapter-pg', 'pg', 'undici']
```

---

## LLM 集成（关键）

### DeepSeek 是 OpenAI 兼容的

```ts
import OpenAI from 'openai'

const llm = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
})

// V4 模型（推荐）：
//   - deepseek-v4-flash  快速 + 性价比，默认选择，支持 Tool Use
//   - deepseek-v4-pro    高推理强度，更贵，复杂任务用
// 旧名 deepseek-chat / deepseek-reasoner 将在 2026/07/24 弃用，
// 当前是 v4-flash 非思考/思考模式的别名（可用但建议迁移到正式名）。
// V4 的 tool calling 比 V3 更激进（更多自我纠正），可能需要把 MAX_STEPS 上调。
```

### Provider 抽象层

`lib/llm.ts` 必须实现 provider 切换能力。配置通过环境变量：

```
LLM_PROVIDER=deepseek          # deepseek | openai | claude
LLM_API_KEY=xxx
LLM_MODEL=deepseek-v4-flash    # 可选覆盖，默认 deepseek-v4-flash
```

后续切换 OpenAI/Claude 不应改业务代码，只改环境变量。

### Tool Use 关键事实

- DeepSeek 的 function calling 完全对齐 OpenAI 格式
- 使用 `tools` + `tool_choice: 'auto'` 让模型自主决定
- 一次响应可能包含多个 `tool_calls`，必须**全部执行**后再继续对话
- `tool` role 的消息必须紧跟在带 `tool_calls` 的 assistant 消息后

---

## Agent 主循环（核心架构）

```
用户消息 → 加入 messages
  ↓
while (未结束 && steps < MAX_STEPS):
    调用 LLM (messages + tools)
    ↓
    if finish_reason === 'stop':
        推送 answer 事件给前端
        break
    ↓
    if 有 tool_calls:
        for each tool_call:
            推送 tool_start 事件
            执行 tool
            推送 tool_done 事件
            收集 tool_result
        把 assistant_message + tool_results 加入 messages
        继续循环
```

**实现位置：** `lib/agent.ts`

**关键要点：**
- `MAX_STEPS = 10`，防止无限循环
- 每个工具执行都通过 `onEvent` 回调把进度推给前端（SSE）
- Tool result 必须是 string（JSON.stringify）
- 错误不要 throw，捕获后通过 event 推送给用户

---

## 工具定义（4 个）

**自注册 registry 模式**（借鉴 Hermes Agent）：每个工具一个文件，用 `defineTool({...})` 在 import 时自注册到 `lib/tools/registry.ts` 的中心表。`agent.ts` 只通过 `getToolList()` / `executeTool()` / `getToolUiDescription()` 与工具交互，不关心具体种类。

每个工具文件同时包含：
- `description`：给 LLM 看的 schema description（决定何时调用）
- `uiDescription`：给前端看的默认中文进度文案（"正在..."）
- `parameters`：OpenAI function calling 的 JSON Schema（手写，保留 LLM 提示词调优）
- `schema`：zod schema，负责运行时校验 + `run()` 函数里的 args 类型推断
- `uiDescriptionFrom`（可选）：从已校验的 args 派生动态进度文案（如 `run_analysis` 用 `args.description`）
- `run`：执行函数，errors 抛出即可，registry 统一兜成 `{ error: ... }` JSON 喂回 LLM

新增工具流程：在 `lib/tools/` 加新文件 → 在 `lib/tools/index.ts` 加一行 `import './xxx'` → 在 `types/index.ts` 的 `ToolName` 联合加一项。

### 1. `inspect_data`
查看数据集结构。**Agent 必须在任何分析前先调用这个。**
- 输入：`dataset_id`
- 输出：列名、类型、行数、3 行样本、null 统计

### 2. `run_analysis`
执行数据分析计算。
- 输入：`dataset_id`, `intent`（自然语言描述意图）, `description`（给用户看的步骤说明）
- 输出：结构化分析结果
- **Phase 1：** 在 Node.js 用 JS 实现常见聚合（groupBy、stats、filter）
- **Phase 2：** 接 E2B 沙箱跑真 Python（pandas）

### 3. `create_chart`
生成图表配置。
- 输入：`chart_type` (bar/line/pie/scatter), `title`, `labels`, `datasets`
- 输出：通过回调推给前端渲染（不存数据库）

### 4. `generate_report`
将本次对话整理成 Markdown 报告。
- 输入：`title`, `summary`, `sections`
- 输出：可下载的 Markdown 文件

---

## 文件结构

```
data-agent/
├── app/
│   ├── api/
│   │   ├── agent/route.ts                    # SSE 流式 Agent
│   │   ├── upload/route.ts                   # 文件上传解析
│   │   ├── datasets/...                      # 数据集 CRUD
│   │   ├── messages/[id]/route.ts            # 消息配对删除
│   │   └── auth/
│   │       ├── [...nextauth]/route.ts        # Auth.js handlers
│   │       ├── register/route.ts             # 邮箱密码注册 + 触发验证邮件
│   │       ├── verify-email/route.ts         # 消费验证 token
│   │       └── resend-verification/route.ts  # 重发验证邮件（60s 节流）
│   ├── login/page.tsx                        # Credentials + Google + GitHub 入口
│   ├── register/page.tsx                     # 注册表单
│   ├── verify-email/page.tsx                 # 客户端读 ?token → POST verify-email
│   ├── page.tsx                              # 主对话界面
│   └── layout.tsx
├── components/
│   ├── chat/                                 # 消息 / 步骤 / 图表 / 报告
│   ├── upload/FileUploader.tsx
│   ├── auth/UserMenu.tsx                     # sidebar 底部头像 + 退出
│   └── ui/                                   # 基础组件，自己写
├── lib/
│   ├── llm.ts                                # LLM provider 抽象
│   ├── agent.ts                              # Agent 主循环
│   ├── prisma.ts                             # PrismaClient 单例
│   ├── suggestions.ts                        # LLM 生成动态 suggestions
│   ├── db/
│   │   ├── datasets.ts
│   │   └── messages.ts
│   ├── auth/
│   │   ├── email.ts                          # Resend 邮箱验证发送 + token 校验
│   │   └── rate-limit.ts                     # 登录失败滑动窗口
│   └── tools/
│       ├── registry.ts                       # defineTool + executeTool + getToolList + getToolUiDescription
│       ├── index.ts                          # 副作用 import 触发各工具自注册 + re-export
│       ├── inspect-data.ts                   # 工具 1
│       ├── run-analysis.ts                   # 工具 2（含 uiDescriptionFrom 动态文案）
│       ├── create-chart.ts                   # 工具 3
│       ├── generate-report.ts                # 工具 4
│       └── sqlite-runner.ts                  # better-sqlite3 :memory: SQL 沙箱
├── auth.ts                                   # 完整 NextAuth 配置（Prisma + bcrypt）
├── auth.config.ts                            # edge-safe 配置（给 proxy.ts 用）
├── proxy.ts                                  # 路由保护（原 middleware.ts，Next.js 16 改名）
├── hooks/use-agent.ts                        # 消费 SSE 流
└── types/index.ts                            # 全局类型定义
```

**文件命名规范：**
- 组件：`PascalCase.tsx`
- 工具/库：`kebab-case.ts`
- Hook：`use-xxx.ts`

---

## SSE 流式协议

Agent 通过 Server-Sent Events 向前端推送多种事件类型：

```ts
type StreamEvent =
  | { type: 'tool_start'; tool: string; description: string }
  | { type: 'tool_done'; tool: string }
  | { type: 'chart'; chart: ChartConfig }
  | { type: 'report'; report: ReportConfig }
  | { type: 'answer'; text: string }       // 最终文字回答
  | { type: 'error'; message: string }
```

**前端消费：** `hooks/use-agent.ts` 用 `fetch` + `ReadableStream` 读取，不用 EventSource（不支持 POST）。

**事件格式（每个事件之间 `\n\n`）：**
```
data: {"type":"tool_start","tool":"inspect_data","description":"正在读取数据结构..."}

data: {"type":"tool_done","tool":"inspect_data"}
```

---

## UI / UX 要求

### 主界面布局
- 左侧：数据集列表 + 上传入口（占 25%）
- 右侧：对话区域（占 75%）
- 顶部：当前数据集名称 + 切换按钮

### Agent 步骤的视觉表达（Demo 核心）
每个工具调用渲染为一行：
```
[图标] 正在读取数据结构...     [Spinner]   ← running
[图标] 正在读取数据结构  ✓                 ← done
```
工具图标用 lucide-react：`Database` / `Calculator` / `BarChart` / `FileText`

### 消息展示
- 用户消息：右对齐，浅色背景
- Agent 消息：左对齐，包含三块内容：
  1. Agent 步骤列表（折叠可展开）
  2. 图表（如有）
  3. 最终文字回答（Markdown 渲染）

### 设计调性
- 简洁专业，不花哨
- 主色：单一品牌色 + 中性灰阶
- 字体：英文 Inter，中文系统字体
- 图表色板自定义（不用 Recharts 默认色）

---

## 数据流示例（完整一轮对话）

```
[Frontend]
用户输入"哪个区域销售额最高" + datasetId
  ↓ POST /api/agent (SSE)
[Backend - agent.ts]
runAgent() 启动循环
  ↓
LLM 决定调用 inspect_data
  → emit { type:'tool_start', tool:'inspect_data', description:'正在读取数据结构...' }
  → 执行 inspectData()，返回列结构 JSON
  → emit { type:'tool_done', tool:'inspect_data' }
  ↓
LLM 看到列结构后调用 run_analysis
  → emit { type:'tool_start', tool:'run_analysis', description:'正在按区域汇总销售额...' }
  → 执行聚合计算
  → emit { type:'tool_done', tool:'run_analysis' }
  ↓
LLM 调用 create_chart
  → emit { type:'chart', chart: {...} }
  ↓
LLM 生成最终回答
  → emit { type:'answer', text:'华东区域销售额最高，达 XXX 万...' }
  ↓
[Frontend - use-agent hook]
按 event 类型更新对应消息的 steps / charts / content 字段
```

---

## 编码规范

### TypeScript
- 所有函数参数和返回值都要标类型
- 不用 `any`，必要时用 `unknown` + 类型守卫
- 接口用 `interface`，联合类型/工具类型用 `type`
- 导出类型用 `export type { ... }`

### React
- 函数组件 + Hooks，不用 class
- Props 接口命名 `XxxProps`，定义在组件文件顶部
- 事件处理函数命名 `handleXxx`
- 不写 default props，用解构默认值

### 错误处理
- API Route 必须 try/catch，返回标准错误格式：`{ error: string, code?: string }`
- Agent 循环里的错误捕获后通过 SSE 事件推送，不要让连接挂掉
- 前端通过 toast / inline 错误提示，不用 alert

### Git Commit
- 使用 conventional commits：`feat:` / `fix:` / `refactor:` / `chore:`
- 单次 commit 单个目的，不混合

---

## 阶段计划

### Phase 1（Week 1）— 跑通核心链路
**目标：** 上传 CSV → 提问 → 拿到正确回答

已完成：
- [x] `lib/llm.ts` DeepSeek 接入
- [x] `lib/tools/` 4 个工具（Phase 5 重构为自注册 registry：每个工具一个文件 + zod 校验）
- [x] `lib/agent.ts` 主循环 + SSE 推送
- [x] 数据集存储（Phase 4 迁到 Prisma：`lib/db/datasets.ts`）
- [x] `app/api/upload/route.ts` CSV/Excel 解析
- [x] `app/api/agent/route.ts` SSE 流式接口
- [x] `hooks/use-agent.ts` 前端 SSE 消费
- [x] 完整 UI（数据集列表 / 对话 / 图表 / 报告卡片 / 主题切换）

**Phase 1 验收脚本：**
```bash
# 1. 上传销售数据 CSV
curl -F "file=@sales.csv" http://localhost:3000/api/upload

# 2. 提问
# 浏览器对话："这份数据有多少行？平均销售额是多少？"
# 期望：Agent 调用 inspect_data + run_analysis，给出准确数字
```

### Phase 2（Week 2）— 完整 Agent 体验
- [ ] E2B 沙箱接入（替换 `run-analysis.ts` 当前的 SQLite 路径）
- [ ] Recharts 图表渲染
- [ ] 多轮对话上下文保持
- [ ] Agent 步骤折叠展开的 UI 打磨
- [ ] 错误处理完善

### Phase 3（Week 3）— 生产可用 ✅
- [x] Supabase 持久化（数据集 + 对话历史）
- [x] 报告导出（HTML 下载，含内嵌 SVG 图表）
- [x] 部署到 Vercel
- [x] 准备 demo 数据集 + 一键试用

### Phase 4（Week 4）— 用户鉴权 + Prisma 迁移 ✅
- [x] 数据访问层从 `@supabase/supabase-js` 迁到 Prisma（schema 演进 2 次 migration）
- [x] Auth.js v5 接入：Credentials provider + JWT + bcrypt
- [x] `proxy.ts` 路由保护（Next.js 16 新名）+ API 路径返回 401 JSON（不重定向）
- [x] `/api/auth/register` 注册接口
- [x] 6 个分析路由加 `auth()` + owner check（数据层强制传 userId，编译期防漏）
- [x] 登录 / 注册页面 + Header UserMenu（用户邮箱 + 退出按钮）

### Phase 5（2026-05）— 工具系统重构 ✅
- [x] `lib/tools/` 拆分：单体 `definitions.ts` + `executor.ts` → 自注册 registry + 4 个单工具文件
- [x] `lib/tools/registry.ts`：`defineTool()` / `executeTool()` / `getToolList()` / `getToolUiDescription()`
- [x] 引入 zod（已通过 openai SDK 间接安装，^4.4.3）做运行时校验 + args 类型推断，消除 `asObject` / `asString` 模板
- [x] `agent.ts` 的 `defaultDescription` 工具特例派发逻辑搬到 registry 的 `uiDescriptionFrom`
- [x] 灵感：Nous Research Hermes Agent 的 tool registry 模式

### Phase 6（2026-05-20）— 鉴权完整化 ✅
> 三件事一并落地（同一 day，三条 migration），都建在 Phase 4 的 Auth.js 骨架上。
- [x] **登录失败 rate limit**：`LoginAttempt` 表 + 滑动窗口（15min / 5 次）；放在 bcrypt 校验**前**，防止暴力破解烧 CPU
- [x] **邮箱验证**：Resend 接入 + `EmailVerificationToken` 表 + 24h TTL + 一次性消费 + 60s 重发节流 + `/verify-email` 页面
- [x] **OAuth (Google + GitHub)**：`Account` 表（snake_case 字段，PrismaAdapter 协议）+ `User.password` 改可空 + `allowDangerousEmailAccountLinking`（Option A）
- [x] `authorize()` 顺序固化：rate limit → bcrypt → emailVerified（避免 enumeration / 不烧 CPU）
- [x] 三种错误抛 `CredentialsSignin` 子类（`RateLimitError` / `EmailNotVerifiedError`），code 透传前端定制文案

---

## 给 Claude Code 的明确指令

当我让你"实现 xxx"时：

1. **不要一次性写完整个项目**。按 Phase 1 的检查项，每次只完成 1~2 个文件，让我 review。
2. **不要假设依赖已安装**。新增 npm 包时必须先说明，等我确认。
3. **不要写 mock 数据塞进生产代码**。测试数据放在 `scripts/` 或 `__tests__/`。
4. **类型先行**。修改/新增功能前，先看 `types/index.ts` 是否有现成类型可用。
5. **遇到歧义先问**。比如"用户希望保存对话历史吗"这类决策，问我而不是自己定。
6. **测试时给具体命令**。不要说"你可以测试一下"，要给出 `curl` 或浏览器操作步骤。

---

## 当前阶段

> 在开始编码前，请确认你已经阅读到这里。每次新会话先回复："已阅读 CLAUDE.md，当前处于 Phase X，下一步任务是 YYY"，等我确认后再动手。

**当前状态：** Phase 6（鉴权完整化）✅ **完成**

**已落地的 Phase 列表：**
- Phase 1 核心链路 ✅
- Phase 2 完整 Agent 体验 ✅（E2B 沙箱搁置，better-sqlite3 替代）
- Phase 3 生产可用（Supabase + Vercel + 报告导出 + demo 数据集）✅
- Phase 4 用户鉴权 + Prisma 全栈迁移 ✅
- Phase 5 工具系统重构（自注册 registry + zod）✅
- Phase 6 鉴权完整化（rate limit + 邮箱验证 + OAuth）✅

**下一步候选**（按优先级，等用户拍板）：
- **Prisma 6 → 7 升级**（独立立项，详见 PROGRESS.md §6.6）—— 唯一真正的"未做"项
- E2B 沙箱（需付费 API key，长期搁置）
- 工具单测 / CI（GitHub Actions：tsc + lint + test）
- 可观测性：tool 耗时 / token 数 / 失败率监控
- 二次 LLM 调用结果缓存（同 intent + dataset 复用，省 token）
