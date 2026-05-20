<div align="center">

<img src="public/image.png" alt="Data Analysis Agent" width="120" />

# Data Analysis Agent

**用自然语言分析数据 —— 一个生产级 LLM Agent 项目**

上传 CSV / Excel，用大白话提问，看 AI Agent 实时拆解、计算、出图、写结论。

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-V4-6366F1)](https://platform.deepseek.com)
[![Live](https://img.shields.io/badge/Live-Demo-22c55e?logo=vercel)](https://data-analysis-agent-omega.vercel.app)

[🌐 **Live Demo**](https://data-analysis-agent-omega.vercel.app) · [📖 学习笔记](./LEARNING.md) · [📊 进度看板](./PROGRESS.md)

</div>

---

## 项目定位

让 **不会写 SQL / Python 的业务用户** 也能做数据分析。

把 Excel 丢进去，用自然语言提问，Agent 自主决定每一步要调用什么工具（看数据 → 计算 → 出图 → 给结论），**全过程实时流式展示**，让用户能看到 AI 的每一个动作。

### 一次完整交互

```
用户:    哪个区域销售额最高？

Agent:   [Database]    正在读取数据结构...         ✓
         [Calculator]  正在按区域汇总销售额...    ✓
         [BarChart]    正在生成图表...            ✓

         华东区域销售额最高，达 **44,700** 元，
         比第二名华北（31,500）高出 42%。

         [📊 柱状图已渲染]
         [📄 下载 .html 报告]
```

每一步可见、每一个数字可追溯。导出的 HTML 报告**离线可双击打开**，内嵌图表 SVG，普通用户友好。

---

## 演示

> 截图占位 — 添加 2~3 张：上传界面 / Agent 流式步骤 / 图表 + 报告下载
>
> 建议录一段 30s GIF 放这里（Loom / CleanShot 都可）

<!--
![上传界面](docs/screenshots/upload.png)
![Agent 流式步骤](docs/screenshots/agent-streaming.png)
![图表与报告](docs/screenshots/chart-report.png)
-->

---

## 核心特性

- 🤖 **多步 Agent 推理** — 自动调用 `inspect_data` → `run_analysis` → `create_chart` → `generate_report`
- 🌊 **全程流式** — 文字 / 工具步骤 / 图表 / 报告通过 SSE 实时推送
- 🧠 **支持 DeepSeek V4 thinking mode** — `reasoning_content` 字段按协议回 echo
- 🗃️ **真 SQL 执行** — LLM 生成 SQLite SQL → better-sqlite3 `:memory:` 执行，支持 GROUP BY / 窗口函数 / CTE
- 💾 **Prisma + Postgres 持久化** — datasets / messages / users 三表，migration 进 git，刷新不丢数据
- 🔐 **邮箱密码登录** — Auth.js v5 + bcrypt(12) + JWT session，`proxy.ts` 路由级保护、owner 校验防越权
- 📊 **4 种图表类型** — bar / line / pie / scatter，基于 Recharts，主题色自动跟随
- 📄 **HTML 报告导出** — 内嵌 SVG 图表，离线可双击打开，无外部依赖
- 🌗 **明 / 暗主题** — 14 个语义化 CSS 变量，组件零硬编码颜色
- 🔄 **每数据集独立历史** — 切换数据集互不污染上下文 + sticky-to-bottom 滚动
- 🌐 **Provider 抽象** — DeepSeek / OpenAI / Claude 通过环境变量切换
- 🛡️ **三层 SQL 安全** — 只允 SELECT/WITH 开头 + 禁 DDL/DML 关键字 + `:memory:` per-query
- ✨ **动态提问建议** — LLM 根据 dataset schema 生成自然中文示例问题（替代硬编码模板）
- ✂️ **Token 控制** — tool result 截断 + 滑动窗口（最近 40 条消息），长对话不爆上下文
- 🎯 **一键试用** — 内置 2 个 demo 数据集，新用户零门槛体验

---

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **Next.js 16** (App Router, Turbopack) | 全栈一体，API Route 不用单独搭后端 |
| 语言 | **TypeScript strict** | 类型在 SSE / tool / LLM 协议间流转，必须 strict |
| LLM | **DeepSeek V4** (OpenAI 兼容) | 中文好、价格低、支持 Tool Use 与 thinking mode |
| 流式 | **原生 SSE + ReadableStream** | 单向流足够；WebSocket 是双向通信，本场景过度设计 |
| 持久化 | **Prisma + Postgres**（Supabase 仅作宿主） | datasets + messages + users 三张表；migration 进 git 可追溯 |
| 鉴权 | **Auth.js v5** + bcryptjs | Credentials provider + JWT session + `proxy.ts` 路由保护 |
| 图表 | **Recharts** | React 原生 + SVG 输出（可抓取嵌入报告） |
| 样式 | **Tailwind v4** + CSS variables | `@theme inline` 让 token 体系天然落地 |
| 主题 | next-themes | SSR 安全、不闪 |
| Markdown | react-markdown + remark-gfm | 14 个元素 custom map，贴合对话紧凑场景 |
| 解析 | papaparse + **exceljs** | 服务端解析；exceljs 替代 xlsx 解 CVE |
| SQL 执行 | **better-sqlite3** `:memory:` | 替代 node:vm 沙箱；真 SQL 引擎 + 三层防御 |
| 报告 | marked + inline CSS | 离线可读 + 内嵌 SVG 图表 |

---

## 架构核心

Agent 主循环是整个项目的心脏（[`lib/agent.ts`](./lib/agent.ts)，约 250 行）：

```mermaid
sequenceDiagram
    actor U as 用户
    participant FE as React (useAgent)
    participant API as /api/agent (SSE)
    participant Agent as runAgent
    participant LLM as DeepSeek V4
    participant Tool as 工具执行器

    U->>FE: 上传 CSV + 提问
    FE->>API: POST { datasetId, message, previousMessages }
    API->>Agent: runAgent({ ..., onEvent })

    loop step < MAX_STEPS
        Agent->>LLM: chatCompletionStream(messages, tools)
        LLM-->>Agent: chunks (content / reasoning / tool_calls)
        Agent-->>FE: SSE answer_delta (流式文本)

        alt 有 tool_calls
            Agent-->>FE: SSE tool_start
            Agent->>Tool: execute (inspect / analysis / chart / report)
            Tool-->>FE: SSE chart / report (via ctx.emit)
            Tool-->>Agent: result JSON
            Agent-->>FE: SSE tool_done
        else 无 tool_calls (结束)
            Agent-->>FE: SSE done (本轮新增 messages)
        end
    end
```

完整数据形态变换 + 真实 JSON 示例见 [`LEARNING.md § 2.4`](./LEARNING.md)。

---

## 快速开始

### 环境要求

- **Node.js 20+**（生产环境跑 24.x）
- **DeepSeek API Key** — [platform.deepseek.com](https://platform.deepseek.com) 注册有免费额度

### 本地启动

```bash
git clone https://github.com/vaezc/data-analysis-agent.git
cd data-analysis-agent
npm install

# 配置环境变量（分两个文件，照 .env.example 填）
cp .env.example .env.local
# .env 放数据库连接（Prisma CLI 只认 .env）
cat > .env <<EOF
DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://...:5432/postgres"
EOF
# .env.local 放 LLM key、AUTH_SECRET 等
# 生成 AUTH_SECRET: openssl rand -base64 32

# 初始化数据库表结构
npx prisma migrate deploy   # 生产/CI 用 deploy；本地开发用 prisma migrate dev

# 启动
npm run dev
```

浏览器打开 http://localhost:3000

### 试一下

1. 上传 `scripts/sample.csv`（项目自带的小销售数据）
2. 输入 "**哪个区域销售额最高？**"
3. 看 Agent 一步步推理

### 部署到 Vercel

```bash
# 1. push 到自己的 GitHub 仓库
# 2. Vercel 导入项目
# 3. 添加环境变量（Production scope）：
#    LLM_PROVIDER          = deepseek
#    LLM_API_KEY           = sk-xxx
#    LLM_MODEL             = deepseek-v4-flash
#    DATABASE_URL          = postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1
#    DIRECT_URL            = postgresql://...:5432/postgres
#    AUTH_SECRET           = <openssl rand -base64 32>
#    AUTH_URL              = https://<your-domain>.vercel.app
#    AUTH_TRUST_HOST       = true   # Vercel preview / 自定义域名必加
# 4. 在 build command 里加 prisma migrate deploy：
#    "build": "prisma migrate deploy && next build"
# 5. Deploy
```

---

## 项目结构

```
data-analysis-agent/
├── app/
│   ├── api/
│   │   ├── agent/route.ts                # SSE Agent 端点
│   │   ├── upload/route.ts               # 文件上传 + 解析
│   │   ├── datasets/
│   │   │   ├── route.ts                  # GET 列表
│   │   │   └── [id]/
│   │   │       ├── route.ts              # DELETE
│   │   │       └── suggestions/route.ts  # GET LLM 生成的提问建议
│   │   └── messages/route.ts             # GET 历史 / DELETE 清空
│   ├── page.tsx                          # 主对话界面 + sidebar
│   └── globals.css                       # 14 个语义 CSS token
├── lib/
│   ├── agent.ts                          # ★ Agent 主循环
│   ├── llm.ts                            # Provider 抽象
│   ├── supabase.ts                       # Supabase server client 单例
│   ├── dataset-store.ts                  # 数据集 CRUD（Supabase 后端）
│   ├── messages-store.ts                 # 对话消息持久化 + 滑动窗口
│   ├── suggestions.ts                    # LLM 生成自然中文提问建议
│   └── tools/
│       ├── definitions.ts                # 工具 schema（给 LLM 看）
│       ├── executor.ts                   # 工具执行 + 截断
│       └── sqlite-runner.ts              # ★ better-sqlite3 SQL 沙箱
├── hooks/
│   └── use-agent.ts                      # SSE 消费 + per-dataset 历史
├── components/chat/
│   ├── ChatPanel.tsx                     # 输入区 + sticky-to-bottom 滚动
│   ├── MessageBubble.tsx
│   ├── ChartRenderer.tsx
│   ├── ReportCard.tsx                    # HTML 导出 + 内嵌 SVG
│   └── StepList.tsx
└── types/index.ts                  # 全局类型（StreamEvent / ChatMessage）
```

---

## 推荐阅读路径

| 想了解什么 | 看哪里 |
|---|---|
| **Agent 主循环 + 三种 delta 累积** | [`lib/agent.ts`](./lib/agent.ts) · [LEARNING.md § 3.1](./LEARNING.md) |
| **SSE 流式协议 + UTF-8 安全** | [`hooks/use-agent.ts`](./hooks/use-agent.ts) · [LEARNING.md § 3.2](./LEARNING.md) |
| **Tool result 截断（控 token）** | [`lib/tools/executor.ts`](./lib/tools/executor.ts) · [LEARNING.md § 6.2](./LEARNING.md) |
| **HTML 报告内嵌 SVG 图表** | [`components/chat/ReportCard.tsx`](./components/chat/ReportCard.tsx) · [LEARNING.md § 4.3](./LEARNING.md) |
| **Sticky-to-bottom 滚动** | [`components/chat/ChatPanel.tsx`](./components/chat/ChatPanel.tsx) · [LEARNING.md § 4.2](./LEARNING.md) |
| **为什么不用 Zustand**（状态管理决策） | [LEARNING.md § 3.8](./LEARNING.md) |

---

## 文档导览

- **[`LEARNING.md`](./LEARNING.md)** — 学习笔记 + 面试备忘
  - Mermaid 时序图 / 流程图
  - 9 个核心架构决策（带"为什么"）
  - 5 个实现亮点深度展开
  - 25+ 道面试问答（按系统设计 / 性能 / 安全 / 调试 / 业务 / 编码六类）
  - 附录：一次完整请求的数据流追踪（含真实 JSON 示例）
- **[`PROGRESS.md`](./PROGRESS.md)** — 项目蓝图 + 局限登记册 + 优化项 backlog
- **[`CLAUDE.md`](./CLAUDE.md)** — 开发规范与约束

---

## Roadmap

- [x] **Phase 1** — Agent 主循环、工具系统、SSE 流式
- [x] **Phase 2** — Recharts 图表、明暗主题、流式 answer、多轮上下文
- [x] **Phase 3** — HTML 报告 + Supabase 持久化 + Vercel 上线
- [x] **安全 / 性能 polish**
  - xlsx → exceljs（解 CVE）
  - node:vm → better-sqlite3 真 SQL 执行（解 vm 不安全 + 不支持 async）
  - 滑动窗口 + tool result 截断（控 LLM token）
- [x] **UX polish**
  - 错误条 dismiss、数据集删除、New Chat、HistorySkeleton
  - Demo 数据集 + 一键试用按钮
  - LLM 生成的动态提问建议
- [x] **Vision 多模态架构** — 后端协议层 ready，前端 UI 待 vision-capable LLM 启用
- [ ] **E2B 沙箱** — 替代 better-sqlite3 跑真 Python（需付费 API key）
- [ ] **二次 LLM 调用缓存** — 同 intent 复用，省 token
- [ ] **多 Excel sheet 支持** — 当前只读第一个
- [ ] **可观测性** — 耗时、token、失败率监控

完整登记见 [`PROGRESS.md`](./PROGRESS.md)。

---

## License

MIT

---

<div align="center">

Built with [Claude Code](https://claude.com/claude-code).

</div>
