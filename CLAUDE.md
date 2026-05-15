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

环境变量配置（`.env.local`）：
```
LLM_PROVIDER=deepseek
LLM_API_KEY=your_key_here
LLM_MODEL=deepseek-chat
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
| 数据解析 | papaparse (CSV) + xlsx (Excel) | 在 API Route 服务端解析 |
| 图表 | Recharts | 不要用 Chart.js |
| 状态管理 | React useState + Zustand（如需跨组件） | 不引入 Redux |
| 数据存储 | Phase 1: 内存 Map / Phase 2: Supabase | 见下方阶段计划 |
| 代码沙箱 | Phase 1: 内置 JS / Phase 2: E2B | 同上 |

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

放在 `lib/tools/definitions.ts`，OpenAI 函数调用格式。

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
│   │   ├── agent/route.ts       # SSE 流式 Agent
│   │   ├── upload/route.ts      # 文件上传解析
│   │   └── dataset/[id]/route.ts # 查询数据集元信息
│   ├── page.tsx                  # 主对话界面
│   └── layout.tsx
├── components/
│   ├── chat/
│   │   ├── ChatPanel.tsx         # 消息列表 + 输入框
│   │   ├── MessageBubble.tsx     # 单条消息
│   │   ├── AgentStep.tsx         # Agent 步骤进度（运行中/完成）
│   │   └── ChartRenderer.tsx     # 图表渲染
│   ├── upload/
│   │   └── FileUploader.tsx      # 拖拽上传 + 预览
│   └── ui/                       # 基础组件（Button/Input 等，自己写）
├── lib/
│   ├── llm.ts                    # LLM provider 抽象
│   ├── agent.ts                  # Agent 主循环
│   ├── dataset-store.ts          # 数据集存储（内存 → Supabase）
│   └── tools/
│       ├── definitions.ts        # Tool schema
│       └── executor.ts           # Tool 执行逻辑
├── hooks/
│   └── use-agent.ts              # 消费 SSE 流的 React Hook
└── types/
    └── index.ts                  # 全局类型定义
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

必须完成：
- [ ] `lib/llm.ts` DeepSeek 接入
- [ ] `lib/tools/definitions.ts` 4 个工具定义
- [ ] `lib/tools/executor.ts` 工具执行（用 JS 实现 inspect 和 run_analysis）
- [ ] `lib/agent.ts` 主循环 + SSE 推送
- [ ] `lib/dataset-store.ts` 内存存储
- [ ] `app/api/upload/route.ts` CSV/Excel 解析
- [ ] `app/api/agent/route.ts` SSE 流式接口
- [ ] `hooks/use-agent.ts` 前端 SSE 消费
- [ ] 最简 UI（能上传 + 能聊天 + 能看到 Agent 步骤）

**Phase 1 验收脚本：**
```bash
# 1. 上传销售数据 CSV
curl -F "file=@sales.csv" http://localhost:3000/api/upload

# 2. 提问
# 浏览器对话："这份数据有多少行？平均销售额是多少？"
# 期望：Agent 调用 inspect_data + run_analysis，给出准确数字
```

### Phase 2（Week 2）— 完整 Agent 体验
- [ ] E2B 沙箱接入（替换 executor.ts 中的内置计算）
- [ ] Recharts 图表渲染
- [ ] 多轮对话上下文保持
- [ ] Agent 步骤折叠展开的 UI 打磨
- [ ] 错误处理完善

### Phase 3（Week 3）— 生产可用
- [ ] Supabase 持久化（数据集 + 对话历史）
- [ ] 报告导出（Markdown 下载）
- [ ] 部署到 Vercel
- [ ] 准备 2~3 个 Demo 数据集

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

**当前状态：** Phase 1，未开始

**下一步：** 初始化 Next.js 项目骨架 + 安装依赖
