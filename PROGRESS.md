# PROGRESS.md

> 项目进度看板 + 蓝图 + 局限/优化登记册。
> 每完成一个文件 / 模块，更新本文档。
> CLAUDE.md 是给 Claude 看的设计指令；本文档是给人看的状态快照。

---

## 1. 项目蓝图

**目标**：让非技术用户通过自然语言分析 CSV/Excel 数据，Agent 多步推理并实时展示每一步。
**周期**：2~3 周。
**定位**：求职作品集 / 公司 AI 转型 POC，需达生产可用级别。

### Phase 1（Week 1）— 跑通核心链路

**验收**：上传 CSV → 自然语言提问 → Agent 调用工具 → 得到正确答案。

### Phase 2（Week 2）— 完整 Agent 体验

- E2B 沙箱替换 `node:vm`（跑真 pandas）
- Recharts 图表渲染
- 多轮对话上下文保持
- Agent 步骤折叠 UI 打磨
- 错误处理完善

### Phase 3（Week 3）— 生产可用

- Supabase 持久化（数据集 + 对话历史）
- 报告导出（Markdown 下载）
- Vercel 部署
- 2~3 个 Demo 数据集

### Phase 4（Week 4）— 用户鉴权 + Prisma 迁移

**目标**：从 `@supabase/supabase-js` 迁到 Prisma 统一数据层，加邮箱密码登录，为后续多租户做基础。

- 数据访问层 Supabase SDK → Prisma 全栈迁移（两次 migration 进 git）
- Auth.js v5（Credentials + JWT + bcrypt(12)）
- `proxy.ts` 路由保护（Next.js 16 改名）
- 注册接口 / 登录页 / Header 退出按钮
- 5 个分析路由加 `auth()` + owner check

### Phase 5（2026-05-23）— 工具系统重构

**目标**：借鉴 Nous Research Hermes Agent 的自注册 registry 模式，把 4 个工具从单体 `definitions.ts` + `executor.ts` 拆成单文件、加 zod 校验，让"新增工具的边际成本"降到最低。

- `lib/tools/registry.ts` 提供 `defineTool` / `executeTool` / `getToolList` / `getToolUiDescription`
- 每个工具一个文件：`schema` / `handler` / `uiDescription` / 动态文案派生 写在一起
- `agent.ts` 的 `defaultDescription` 工具特例派发逻辑搬到 registry 的 `uiDescriptionFrom`
- 引入 zod（已通过 openai SDK 间接安装 ^4.4.3）做运行时校验 + args 类型推断

### Phase 6（2026-05-20）— 鉴权完整化

**目标**：在 Phase 4 的 Auth.js 骨架上一并落地登录暴力破解防御、邮箱验证、OAuth 三大件，把"鉴权"从"能用"提到"生产级"。

- 三条 migration 同日合并（`add_login_attempts` + `add_email_verification` + `add_oauth_accounts`）
- 登录失败滑动窗口（15min / 5 次）+ 关键放在 bcrypt **前**
- Resend 邮件验证（24h TTL + 一次性 + 60s 重发节流）
- Google + GitHub OAuth（PrismaAdapter + JWT 共用）
- `authorize()` 顺序固化：rate limit → bcrypt → emailVerified
- 三种 `CredentialsSignin` 子类把 error code 透传到前端，定制中文文案

---

## 2. 当前进度（Phase 1）

| 模块          | 文件                       | 状态                                                        |
| ------------- | -------------------------- | ----------------------------------------------------------- |
| 类型          | `types/index.ts`           | ✅ 完成                                                     |
| LLM 抽象      | `lib/llm.ts`               | ✅ 完成（deepseek + openai；claude 留 throw 占位）          |
| 工具系统      | `lib/tools/*`              | ✅ 完成（4 个工具，Phase 5 重构为自注册 registry）          |
| 数据集存储    | `lib/dataset-store.ts`     | ✅ 完成（内存 Map）                                         |
| Agent 主循环  | `lib/agent.ts`             | ✅ 完成                                                     |
| 上传 API      | `app/api/upload/route.ts`  | ✅ 完成（已 curl 验证：上传成功 + 类型推断正确 + 错误处理） |
| Agent SSE API | `app/api/agent/route.ts`   | ✅ 完成（已 curl 验证：参数校验 + SSE 通道 + 错误事件流）   |
| 前端 SSE Hook | `hooks/use-agent.ts`       | ✅ 完成                                                     |
| 最简 UI       | `app/page.tsx` + 5 个组件  | ✅ 完成（SSR 已验证 200 + 关键文字渲染）                    |

**脚手架附加：**

- ✅ `create-next-app` 完成（Next.js 16.2.6 + React 19.2.4 + TS + Tailwind v4 + Turbopack）
- ✅ `.env.local.example` 模板 + `.gitignore` 调整
- ✅ CLAUDE.md 已更新 Next.js 16 关键变化

---

## 3. 已知局限（按影响排序）

### L1. `xlsx@0.18.5` 存在已知 CVE ✅ 已解决（2026-05-17）

- ~~CVE-2023-30533（prototype pollution）、CVE-2024-22363（ReDoS）~~
- **解决方案**：换 `exceljs`（活跃维护、npm 主源、无 CVE）。改 `parseExcel` 用 ExcelJS API，async 化（exceljs 接口本身就是 async）。ALLOWED_EXTS 去掉 `.xls`（exceljs 不支持二进制 xls 格式，仅 xlsx OOXML）。

### L2. `node:vm` 不是真正的安全沙箱 ✅ 已解决（2026-05-17）

- ~~`lib/tools/executor.ts` 的 `runInSandbox`（已合并入 `lib/tools/run-analysis.ts`）~~
- ~~历史上有上下文逃逸 CVE；用户输入间接通过 LLM 进入 vm~~
- **解决方案**：换 `better-sqlite3` (SQLite 内存数据库)。LLM 生成 SQL 而不是 JS，跑在 SQLite 引擎里——SQLite 是世界上最被审计过的 DB 之一，安全性远超 vm。三层防御：(1) 必须 SELECT/WITH 开头；(2) 拒绝 DDL/DML keyword 正则；(3) 每次 `:memory:` 新建 + 用完即销毁。`next.config.ts` 加 `serverExternalPackages: ['better-sqlite3']` 处理 native binding 部署。

### L3. `vm` 不支持 async/Promise ✅ 已解决（2026-05-17）

- ~~LLM 生成的 JS 不能用 await~~
- **解决方案**：随 L2 一起，已迁移到 SQL。SQL 本身没有 async 概念。better-sqlite3 是同步 API。

### L4. Next.js dev 模式 HMR 会清空内存 Map ✅ 已解决（2026-05-17）

- ~~`lib/dataset-store.ts` 模块级 `Map`~~
- ~~开发时改代码 → 数据集丢失需重传~~
- **解决方案**：随 L8 一起，dataset-store 迁到 Supabase，模块级 Map 删除。HMR 不再丢数据。

### L5. CSV 类型推断的边界情况

- **位置**：`lib/dataset-store.ts` 的 `inferColumnType`
- **已处理**：前导零字符串保留为 string、千分位 `1,234` 识别为 number、boolean 优先级 > number > date。
- **未处理**：Unix 时间戳整数、混合类型列（"N/A" + 数字）、ISO 8601 不带 T 分隔符等极端格式。
- **解决**：遇到具体数据再补，不预设。

### L6. SSE `tool_start` / `tool_done` 没有 `step_id`

- **位置**：`types/index.ts` 的 `StreamEvent`
- **影响**：同一轮 LLM 响应里并发调同一工具，前端用顺序栈配对会脆弱。
- **解决**：DeepSeek 当前实测一轮里少有并发。Phase 2 若遇到再加 `step_id` 字段。

### L7. LLM 输出非流式 ✅ 已解决

- ~~`answer` 一次性推送，没有打字机效果。~~
- **解决方案**：`lib/agent.ts` 改为 `chatCompletionStream`，按 chunk 累积 content/reasoning/tool_calls deltas；新增 `answer_delta` SSE 事件，前端 hook 在 `case 'answer_delta'` append content。
- **额外收获**：DeepSeek V4 thinking mode 的 `reasoning_content` 扩展字段在 reply 时必须回 echo，否则 V4 400。

### L8. Agent 没有对话历史持久化 ✅ 已解决（2026-05-17）

- ~~刷新页面对话丢失~~
- ~~Vercel Serverless 跨函数（/api/upload vs /api/agent）内存不共享，dataset 跨函数找不到~~
- **解决方案**：上 Supabase 持久化。
  - 新建 `datasets` 表（id / name / columns / rows JSONB / row_count / created_at）
  - 新建 `messages` 表（dataset_id / role / ui JSONB / llm JSONB / created_at）
  - `lib/dataset-store.ts` 全改 Supabase queries（async API）
  - 新建 `lib/messages-store.ts` 管理对话持久化
  - 新建 `/api/datasets` GET + `/api/messages` GET
  - `/api/agent` 改：不再从 body 读 previousMessages；入口立刻 saveUserMessage；流过程 reducer 累积 assistant state；finally 保存 assistant message
  - `hooks/use-agent.ts` 大幅简化：去掉 storeRef / llmHistoryRef / messagesRef；切换 dataset 时 fetch /api/messages
- **额外收获**：切换 dataset 加 skeleton + `useLayoutEffect` 同步定位到底（无滚动动画），交互更专业。
- **效果**：解决 Vercel demo 无法工作 + 刷新丢历史 + HMR 丢数据（同时解 L4）。

### L9. tool result 没做截断 ✅ 已解决（2026-05-15）

- ~~`lib/tools/executor.ts` 所有工具的 JSON.stringify 返回（Phase 5 后逻辑搬到 `lib/tools/run-analysis.ts`）~~
- ~~大数据集 run_analysis 的 data 可能很大，多轮后撑爆 LLM 上下文窗口~~
- **解决方案**：`run-analysis.ts:truncateForLLM`：数组超 30 项切前 30 + `_truncated` 元信息（含原长度、shown 数量、给 LLM 的 hint）；非数组 JSON 超 6000 字符（~1500 token）兜底警告。SYSTEM_PROMPT 加一条让 LLM 理解 `_truncated` 字段不要原样展示。
- **效果**：单 tool result 从可能 2K+ token 降到 ~500 token 级别，长对话累积 token 增长降约 70%。

### L10. 二次 LLM 调用无缓存 ✅ 已解决（2026-06）

- ~~**位置**：`lib/tools/run-analysis.ts` 的 `generateAnalysisSQL`~~
- ~~**影响**：相同 intent + dataset 每次都重新生成代码，浪费 token。~~
- **解决方案**：`lib/lru-cache.ts` 通用 LRU（100 条）+ run-analysis 按 `(datasetId, intent)` 缓存生成的 SQL。只缓存执行成功的 SQL（先执行后写）；数据集不可变，结构 SQL 安全复用；serverless 暖实例内有效。

### L11. AI 回答的 Markdown 未渲染（验收暴露）✅ 已解决

- ~~`components/chat/MessageBubble.tsx` 用 `whitespace-pre-wrap` 直接显示文本~~
- **解决方案**：装了 `react-markdown` + `remark-gfm`，手写 14 个 component map 控制样式（不引入 `@tailwindcss/typography`，理由：chat 紧凑场景与 prose 的杂志风排版不搭）
- **额外收获**：表格采用 Notion 风（只横线、无列线，行间用 border-border 加深）

---

## 4. 优化项（不阻塞，记下来不忘）

### 4.1 性能

- [x] ✅ 二次 LLM 调用结果缓存（L10：lib/lru-cache + run-analysis 按 (datasetId,intent) 缓存 SQL）
- [ ] 大数据集 inspect_data 时延优化（当前会遍历全列做 nullCount，行数大时可改抽样）
- [x] ✅ tool result 自动截断（L9）
- [x] ✅ 滑动窗口：loadConversation 限制最近 40 条 messages

### 4.2 Agent 行为质量

- [ ] system prompt 加 few-shot 示例（提升复杂问题的工具调度准确率）
- [x] ✅ system prompt 已有"始终用中文回答用户"强制规则（agent.ts SYSTEM_PROMPT）
- [ ] 工具调用失败时的 retry 策略（区分可重试错误如限流 vs 不可重试错误如参数错）

### 4.3 用户体验

- [x] ✅ 流式 answer（L7）
- [x] ✅ Agent 步骤展示（单行 summary + 点击展开）→ 打磨：grid-rows 平滑展开动效 + chevron 旋转 + 步骤间时间线连接线
- [x] ✅ 错误以 inline 顶部 banner 提示（不用 alert）
- [x] ✅ 错误条 dismiss × 按钮
- [x] ✅ 数据集删除（sidebar hover trash icon）
- [x] ✅ New Chat 按钮（floating 右上，confirm + DELETE messages）
- [x] ✅ Demo 数据集 + sidebar 一键试用按钮
- [x] ✅ 切换 dataset HistorySkeleton + 同步定位（`useLayoutEffect`）
- [x] ✅ LLM 生成动态 suggestions（替代硬拼模板）
- [ ] 图表交互（hover tooltip ✅；点击下钻 ⏳）
- [x] ✅ 数据集列表搜索（≥6 个时显示搜索框，按名字实时过滤，计数显示 命中/总数）
- [x] ✅ 文件上传进度条（XHR upload.onprogress，百分比填充 +「解析中」阶段）；大文件分片仍未做

### 4.4 工程

- [x] ✅ 工具系统重构：自注册 registry + zod 校验（Phase 5，借鉴 Hermes Agent）
- [x] ✅ 工具单测（vitest，`lib/tools/*.test.ts`：sqlite-runner 23 + registry 10 = 33）
- [x] ✅ CSV/Excel 解析的边界用例测试（lib/db/datasets.test.ts，25 例：类型推断优先级/千分位/混合/空值）
- [ ] 添加 ESLint 规则禁止 `any`、强制 explicit return type
- [x] ✅ CI（GitHub Actions：prisma generate + tsc + lint + test，push/PR 触发）
- [ ] 多 Excel sheet 支持（当前只读第一个）

### 4.5 可观测性

- [x] ✅ 每次工具调用的耗时 + token 数记录（lib/observability.ts，[agent-metrics] 结构化日志 + dev console.table）
- [x] ✅ LLM 调用失败率监控（AgentMetrics 记每步 LLM 成败 + 汇总 failures）
- [x] ✅ Agent 步数（LLM calls）+ 每工具调用次数/耗时分布（summarize byTool）
- 生产期把 [agent-metrics] 日志接 Supabase / 日志 drain（留待后续，不阻塞）

### 4.6 安全

- [x] ✅ xlsx 升级或替换（L1 已换 exceljs）
- [x] ✅ vm 沙箱替换（L2/L3 已换 better-sqlite3 SQL 执行）
- [x] ✅ 上传文件大小限制（20MB）
- [ ] E2B 沙箱（需付费 API key 验证，暂搁）
- [x] ✅ LLM_API_KEY 服务端隔离已核查（build 后 grep .next/static：无 key 明文 / 无 LLM_API_KEY / 无 baseURL）。可选加 `import 'server-only'` 编译期守卫（需装 server-only 包）

---

## 5. 下一步

**🎉 Phase 1 端到端验收通过（2026-05-13）**

测试场景：上传 `scripts/sample.csv`，提问"哪个区域销售额最高？"
- ✅ Agent 自动调 `inspect_data` → `run_analysis`，步骤实时显示
- ✅ 数字完全正确：华东 44,700 / 华北 31,500 / 华南 25,800
- ✅ DeepSeek V4 `reasoning_content` 回填逻辑 OK

**Phase 2 已完成项（2026-05-13 ~ 2026-05-14）：**

- ✅ **Markdown 渲染（L11 解决）**：react-markdown + remark-gfm + 14 元素 custom map
- ✅ **双主题（light / dark）落地**：
  - `globals.css` 定义 14 个语义 token（bg / fg / fg-muted / card / surface / border / accent / danger / success ...）
  - light 用 zinc-50/900 系，dark 用 zinc-950/50 系，主色 indigo-600 → indigo-500
  - `next-themes` 接入：跟随系统 / localStorage 持久化 / SSR 防 FOUC
  - 侧栏底部 ThemeToggle 切换按钮
  - 6 个组件全部 token 化，**0 个硬编码颜色 class**
- ✅ **Recharts 图表渲染**：4 种类型（bar/line/pie/scatter），自定义 PALETTE，axis/grid/tooltip 全 token 化跟随主题，可展开查看原始数据
- ✅ **流式 answer（L7 解决）**：`chatCompletionStream` + `answer_delta` 事件，打字机效果
- ✅ **多轮对话上下文**：per-dataset Map 存档 + done 事件回传 LLM messages，切换数据集互不污染
- ✅ **UI/UX polish**：参考 Notion 原型、品牌 logo 接入（`public/image.png`）、消息淡入动画、流式输入框 floating 设计、prefers-reduced-motion 适配

**Phase 3 已完成项：**

- ✅ **报告导出（HTML）**（2026-05-14）：`generate_report` 工具 + `ReportCard` 卡片 + 内嵌 SVG 图表 + 一键下载独立 HTML
- ✅ **Vercel 部署**（2026-05-15）：项目上线
- ✅ **Supabase 持久化**（2026-05-17）：datasets + messages 表（详见 L8）
- ✅ **切换 dataset 体验 polish**（2026-05-17）：HistorySkeleton + `useLayoutEffect` 同步定位

---

### 当前状态（2026-05-17）

**Phase 2 收尾**：只剩 E2B 沙箱（L2/L3）。Demo 用 `node:vm` 完全够用。

**Phase 3 完成度：~85%**
- ✅ 报告导出
- ✅ Supabase 持久化（L8 解决，附带解 L4）
- ✅ Vercel 部署
- ✅ Demo 数据集 + 一键试用
- ⏳ README 截图/GIF（用户后续补）

### 2026-05-17 收尾完成清单

- ✅ 错误条 dismiss × 按钮
- ✅ 数据集删除按钮（sidebar hover）
- ✅ New Chat 按钮（清空对话历史）
- ✅ 上传文件大小限制（20MB）
- ✅ Demo 数据集 + 一键试用按钮
- ✅ xlsx → exceljs（解 L1）
- ✅ 滑动窗口（loadConversation 限制最近 40 条 messages，约 20 轮）
- ✅ better-sqlite3 替换 node:vm 沙箱（解 L2 + L3，run_analysis 改跑 SQL）
- ✅ Vision 多模态架构（user message 支持 images，OpenAI multimodal 协议；前端 UI 暂时隐藏，待切 vision-capable LLM 启用）

### 2026-05-18 UX 微调

- ✅ Vision 上传 UI 暂时隐藏（DeepSeek V4 不支持 image，避免误导用户）
- ✅ 输入框 placeholder 与 EmptyState 示例问题：从硬编码改为根据当前 dataset 的 columns 动态生成
- ✅ Suggestions 升级为 LLM 生成自然中文：新增 `lib/suggestions.ts` + `GET /api/datasets/[id]/suggestions`；前端切 dataset 时 fetch，会话内 `useRef<Map>` 缓存避免重复调用；加载期间用模板做 fallback

### 剩余可选项（真正的 nice-to-have）

1. **E2B 沙箱**：需要付费 API key 才能测试，跳过
2. **二次 LLM 缓存**（L10）：高频重复 query 才有价值
3. **多 Excel sheet 支持**：当前只读第一个 sheet
4. **可观测性**：耗时、token 数、失败率监控
5. **DuckDB**：比 SQLite 更强的 OLAP 能力（但包体积爆 Vercel hobby 50MB 限制）

底线：**项目已完整可用**，所有"必做"和"应该做"都已落地。

---

## 6. Phase 4 进度（2026-05-19 ~ 2026-05-20）

### 6.1 Prisma 全栈迁移（S1–S5）✅

- **动机**：方案 C —— 抛弃 `supabase-js`，全部切 Prisma，统一数据层。Supabase 保留为 Postgres 宿主。面试讲法更完整（一次真实的 ORM 迁移故事）。
- **变化**：
  - 删除 `lib/supabase.ts`、`lib/dataset-store.ts`、`lib/messages-store.ts`
  - 新增 `lib/prisma.ts`（HMR-safe 单例）
  - 新增 `lib/db/datasets.ts`、`lib/db/messages.ts`（接口与旧版兼容，零业务代码改动）
  - `prisma/schema.prisma` 定义 Dataset + Message + User + relations
  - 第一次 migration `init`（仅 Dataset + Message）
  - `next.config.ts` 加 `@prisma/client` + `@prisma/engines` 到 `serverExternalPackages`（Turbopack 必须）
- **优化亮点**：
  - `listDatasets` 用 **`jsonb_array_length(rows)` O(1) 算 rowCount**（基于 JSONB header），不拉全量 rows 数据
  - `deleteMessagePair` 用 `$queryRaw` 配合 JSONB 路径操作符 `ui->>id` 查前端 UUID，标准 Prisma 配合裸 SQL 各取所长
- **现状**：上传 / 列表 / 对话 / 配对删除 / 级联删除全跑通

### 6.2 Auth.js v5 接入（S6–S7）✅

- **第二次 migration `add_user_and_owner`**：加 User 表 + Dataset.userId 外键 + 索引 + 级联
- **两文件 auth 架构**（Auth.js v5 标准）：
  - `auth.config.ts` —— Edge-safe，给 `proxy.ts` 用，不 import Prisma / bcrypt
  - `auth.ts` —— 完整配置，含 Credentials provider + Prisma + bcrypt
- **Next.js 16 改名**：`middleware.ts` → `proxy.ts`，函数名 `middleware` → `proxy`
- **JWT session 策略**：无状态，jwt callback 把 user.id 注入 token，session callback 暴露给 `session.user.id`
- **`/api/auth/register`**：bcrypt cost=12，邮箱小写归一化，重复 409 / 弱密码 400 / 格式 400
- **完整闭环验证**：
  - 未登录访问 `/api/upload` → 重定向 `/login`（proxy.ts 拦截）
  - Credentials login（cookie jar）→ 302
  - `/api/auth/session` 返回 `{ user: { id, email } }`
  - 登录后上传 CSV → Dataset.userId 正确归属

### 6.3 多租户化 + UI（S8–S10）✅

**S8 数据层 + 6 路由 owner check**：
- 数据层全部接收 `userId` 参数 + Prisma `where: { ..., userId }` 做编译期保护
- `deleteMessagePair` 用 SQL JOIN 一次查 owner —— 比"先查再二次验证"少一次 roundtrip
- 6 个路由（agent / datasets / datasets/[id] / datasets/[id]/suggestions / messages / messages/[id]）全加 `auth()` 401
- `auth.config.ts` polish：API 路径返回 401 JSON（fetch 友好），页面路径维持 302 重定向

**S9 UI**：
- `app/login/page.tsx` —— signIn('credentials', ...) + CredentialsSignin 错误中文映射
- `app/register/page.tsx` —— 双密码校验 + 成功自动登录跳首页
- `components/auth/UserMenu.tsx` —— 头像 + 邮箱 + 退出按钮，集成进 sidebar 底部
- `app/providers.tsx` —— 加 SessionProvider 让 client 组件 useSession()

**S10 验收（14/14 全过）**：
未登录 / → 重定向；未登录 /api/* → 401 JSON；/login + /register 公开 200；注册返回 user.id（邮箱小写归一化）；DB 密码 bcrypt $2b$12$ / 60 字符；Credentials login 302；session 含 user.id；登录后上传成功；Dataset.userId 匹配登录用户；完整对话 → 2 条消息入库；退出后 /api/* 再次 401；A 看不到 B 的 dataset；A 越权访问 B 资源 → 404（不区分"不存在"vs"无权"）；A 越权删 B message → SQL JOIN 拦截。

### 6.4 Phase 4 踩坑登记

#### L12. Prisma CLI 只读 `.env`，不读 `.env.local` ✅ 已解决

- **症状**：`npx prisma validate` 报 `Environment variable not found: DIRECT_URL`，但 `.env.local` 明明有
- **根因**：Prisma CLI 不读 `.env.local`，只读 `.env`
- **解决**：DB 连接字符串放 `.env`（这文件 gitignored）；应用 secret 放 `.env.local`。两个文件都被 Next.js 加载，但 Prisma CLI 只看 `.env`
- **面试讲点**：每个工具的 env 加载约定可能不同，遇到"我明明配了"的玄学错误，先确认这个工具读哪个文件

#### L13. Supabase 密码含 `@` `]` 等字符未 URL 编码 ✅ 已解决

- **症状**：Prisma 报 "Can't reach database server"，但密码是对的
- **根因**：Postgres 连接 URI 用 `@` 分隔用户名/密码和主机，密码里裸 `@` 会让解析器把它当分隔符
- **解决**：URL 编码（`@` → `%40`，`]` → `%5D`）。`.env.example` 加注释提示
- **面试讲点**：URI 字符的"保留字符"规则——`:` `@` `/` `?` `#` `[` `]` 等都要编码

#### L14. Turbopack 打包 Prisma 时 schema engine 路径丢失 ✅ 已解决

- **症状**：直连 Node 测试 OK，但 Next.js dev 调 Prisma 报 "Can't reach database server"
- **根因**：Turbopack 把 `@prisma/client` 内联打包后，schema engine binary 找不到（这是 native binding 的通病，跟 `better-sqlite3` 同类）
- **解决**：`next.config.ts` 加 `serverExternalPackages: ['better-sqlite3', '@prisma/client', '@prisma/engines']`
- **面试讲点**：含 native binding 的包永远要标 external——`.node` 文件 / engine binary 不能被打包工具吃掉

#### L15. Supavisor pooler 端口 6543 vs 直连 5432

- **位置**：`.env` 的 `DATABASE_URL` vs `DIRECT_URL`
- **设计**：应用代码走 6543（pooler，复用连接 + 适配 Serverless 冷启动）；Prisma migration 走 5432（直连，pooler 不支持 prepared statements 之类的 DDL 流量）
- **配置加 `?pgbouncer=true&connection_limit=1`**：告诉 Prisma 走 PgBouncer + 限制每实例连接数避免打爆免费版的 ~60 个连接配额
- **面试讲点**：Serverless + Postgres 的连接池问题——每个 lambda 实例独立开连接，必须用 pooler 中转，否则免费 plan 一冷启动一波就爆

### 6.6 待选优化（Phase 5+ 候选）

- ~~**Prisma 6 → 7 升级**~~ ✅ 2026-06 完成（详见 §8）。实际改动比预估多两项：
  连接 URL 移出 schema 到 `prisma.config.ts`、`directUrl` 被并入单一 `url` 概念、Node ≥20.19 硬门槛
- ~~注册时发邮件验证~~ ✅ Phase 6 完成（详见 §7.2）
- ~~OAuth provider（Google / GitHub）~~ ✅ Phase 6 完成（详见 §7.3）
- ~~登录失败 rate limit~~ ✅ Phase 6 完成（详见 §7.1，DB 实现，不走 Vercel KV）
- MFA / TOTP（敏感操作二次验证）

### 6.5 文档同步状态

- [x] CLAUDE.md：技术栈表 + Auth.js / Prisma 专节 + Phase 4 阶段计划
- [x] README.md：技术栈 + Setup（DATABASE_URL/AUTH_*）+ 部署说明
- [x] PROGRESS.md：本节
- [x] LEARNING.md：4.X 新亮点（Prisma 迁移、Auth.js 双文件、JWT、jsonb 优化、L12-L15 踩坑）
- [x] INTERVIEW.md：新增 STAR 故事 + Q&A + 简历文案 + 数字速查更新
- [x] FLOW.md：§11 路径更新（lib/messages-store.ts → lib/db/messages.ts 等）

---

## 7. Phase 6 进度（2026-05-20）— 鉴权完整化

> Phase 4 落地了 Credentials + JWT + bcrypt 的基础闭环。Phase 6 在同一 day 把生产级鉴权该有的三件事一次性补齐：登录暴力破解防御、邮箱验证、OAuth。三条 migration 紧挨着合进 git，逻辑上属于同一阶段，故归入 Phase 6。

### 7.1 登录失败 rate limit ✅

**新增**：`prisma/migrations/20260520064951_add_login_attempts` + `lib/auth/rate-limit.ts`（87 行）

**算法**：滑动窗口
- 15 分钟窗口 + 5 次失败阈值
- 查窗口内 desc 排序 take 5 → 不满 5 直接放行；满 5 取最早一次 + 15min = 解锁时间
- 边界：最早那次刚好出窗口 → 视为放行（下次 record 时窗口自然滑动）

**关键设计**：
- **key 是 email 不是 IP**：IP 跨用户共享（公司 NAT / CGNAT）不靠谱；email 是攻击目标本身
- **不存在的 email 也照样 record**：防 email enumeration（攻击者通过响应快慢分辨邮箱存在性）
- **登录成功 `clearFailedAttempts(email)`**：老失败不留尾巴，否则合法用户慢慢累积失败也会被锁
- **`LoginAttempt` 不外键到 User**：因为可能针对不存在用户暴力破解，外键反而限制了
- 在 `auth.ts` `authorize()` 里放**最前面**，bcrypt 之前：防止攻击者烧 CPU

**清理策略**：当前不自动清，每条 ~100 字节，1 万条 ~1 MB。生产可加 Vercel cron 每天 `DELETE WHERE created_at < NOW() - INTERVAL '7 days'`。

**前端文案**：`RateLimitError` 继承 `CredentialsSignin`，`code='RateLimit'` 透传到 `res.error`，登录页可定制中文文案"登录失败次数过多，请稍后重试"。

### 7.2 邮箱验证 ✅

**新增**：
- `prisma/migrations/20260520091850_add_email_verification` —— `User.emailVerified DateTime?` + `email_verification_tokens` 表
- `lib/auth/email.ts`（约 210 行，含 HTML 邮件模板）
- `app/api/auth/verify-email/route.ts` + `app/api/auth/resend-verification/route.ts`
- `app/verify-email/page.tsx` —— 客户端读 `?token=` → POST verify-email
- `package.json` 新增 `resend ^6.12.3`

**关键设计**：
- **Token**：`crypto.randomBytes(32).toString('base64url')` = 43 字符，不可猜
- **DB 直接存原值**（生产应存 SHA-256 hash，demo 简化）
- **24h TTL** + **一次性**：验证成功在同一事务里 `user.emailVerified = now()` + `delete token`
- **过期 token 顺手删**：避免 DB 累积
- **重发 60s 节流**：查 `findFirst orderBy createdAt desc`，距上次 < 60s 拒绝
- **enumeration 防御**：`/api/auth/resend-verification` 对不存在邮箱也返回 200
- **发件人**：`onboarding@resend.dev`（Resend sandbox，**只能发到注册邮箱**）；生产需 verified domain
- **注册不阻塞**：邮件发送失败时仍返回 201，把 `verificationEmailSent: false + verificationEmailError` 给前端，用户可在登录页点"重发"

**`authorize()` 中的位置**：放在 bcrypt 校验**之后**。理由：
- 放在 bcrypt 前会让攻击者用错密码探测"这邮箱是否存在且未验证"
- 密码对的"未验证"失败**不计入 rate limit**（避免合法用户因为没验证邮箱被锁）

### 7.3 OAuth (Google + GitHub) ✅

**新增**：
- `prisma/migrations/20260520110805_add_oauth_accounts` —— `accounts` 表 + `User.password` 改可空 + `User.image` 字段
- `auth.ts` 新增两个 OAuth provider + `PrismaAdapter`

**关键设计**：
- **PrismaAdapter + JWT session 共用**：Adapter 管 OAuth 用户/Account 表的持久化（这是 PrismaAdapter 必须的工作）；session 仍走 JWT（不建 Session 表，无状态适配 Vercel）
- **`Account` 表字段名**：**故意 snake_case**（`access_token` / `expires_at` / `provider_account_id`），这是 next-auth 协议要求 —— PrismaAdapter 直接按这些字段名 INSERT，**改成 camelCase 会运行时报错**
- **`User.password` 改可空**：OAuth 用户没设过密码；Credentials `authorize()` 里加 `!user.password → return null`（外部看起来跟"密码错"一样，防 enumeration "这账号是 OAuth-only"）
- **`allowDangerousEmailAccountLinking: true`**：若 Google 邮箱已被本地账号占用，自动 link 到同一 User
  - 风险：攻击者控制对方 Google 账号即能登本地账号
  - 取舍：OAuth provider 已经验证过邮箱归属，对 demo 项目可接受
- **复合唯一 `(provider, providerAccountId)`**：同一 Google 账号不能绑两个本应用 User
- **回调 URL**：`<AUTH_URL>/api/auth/callback/google` + `<AUTH_URL>/api/auth/callback/github`
- **环境变量**：未配置就不启用，`auth.ts` 直接读 `process.env.GOOGLE_CLIENT_ID` 等（空字符串时 next-auth 会跳过）

### 7.4 文档同步状态（Phase 6）

- [x] CLAUDE.md：鉴权章节补 Provider 矩阵 + authorize() 顺序 + 三个子专节（email / rate limit / OAuth）；migration 列表 2 → 5；当前状态更新
- [x] PROGRESS.md：本节
- [x] README.md：核心特性「生产级鉴权」+ 鉴权技术栈表（三 provider + 邮箱验证 + rate limit）
- [ ] LEARNING.md：Phase 6 三件事的踩坑 / 设计取舍（后续单独立项）
- [ ] INTERVIEW.md：rate limit / email verification / OAuth 的 STAR 故事（后续单独立项）

---

## 8. Prisma 6 → 7 升级（2026-06-05）

> v7 把 Rust query engine 换成 driver adapter 架构（包体减 ~85%、cold start 更快、L14 Turbopack binary 问题消失）。独立分支 `chore/prisma-7-upgrade`，CI 安全网下进行。

### 8.1 实际破坏性变更（比立项预估多）

| 变更 | v6 | v7 |
|---|---|---|
| generator | `prisma-client-js`，输出进 node_modules | `prisma-client` + 必填 `output`，输出到 `lib/generated/prisma`（gitignore） |
| 运行时引擎 | Rust binary | `@prisma/adapter-pg`（node-postgres），无 binary |
| 连接 URL | schema 的 `datasource.url` / `directUrl` | **移出 schema**：运行时连接在 `lib/prisma.ts` 的 adapter；CLI/migration 连接在根目录 `prisma.config.ts` |
| `directUrl` | 独立字段 | 概念并入单一 `url`；本项目仍需直连迁移，故 `prisma.config.ts.datasource.url = env('DIRECT_URL')` |
| 模块格式 | CJS | ESM（package.json `"type":"module"`） |
| client import | `@prisma/client` | `@/lib/generated/prisma/client` |
| Node | 18+ | **≥20.19 硬门槛**（preinstall 拒装低版本） |

### 8.2 改动清单

- `package.json`：`"type":"module"` + `engines.node>=20.19` + prisma/@prisma/client 升 7 + 装 `@prisma/adapter-pg`/`pg`/`@types/pg`
- `prisma/schema.prisma`：generator 改 `prisma-client`+`output`；datasource 只留 `provider`
- `prisma.config.ts`（新）：CLI/migration 连接（DIRECT_URL）+ `import 'dotenv/config'`
- `lib/prisma.ts`：从 generated 路径 import + `new PrismaPg({connectionString: DATABASE_URL})`，保留 HMR 单例
- `next.config.ts`：external 去 `@prisma/engines`，加 `@prisma/adapter-pg`/`pg`
- `vitest.config.ts`：`__dirname` → `import.meta.dirname`（ESM）
- `.nvmrc`（新，=20）+ CI 改用 `node-version-file`
- `.gitignore`：忽略 `/lib/generated/`

### 8.3 验证（全绿）

- `prisma migrate status`：5 migration 全在，schema up to date（CLI 走 prisma.config.ts + DIRECT_URL）
- 运行时冒烟：PrismaPg adapter 走 Supavisor 事务池（6543）真实查询 `user.count` / `dataset.findMany`（JSONB+关系）/ 重复查询无 prepared statement 报错 —— **事务池兼容性确认 OK**
- `tsc --noEmit` / `eslint` / `vitest`（33）/ `next build`（17 路由）全过

### 8.4 文档同步

- [x] CLAUDE.md：数据层加 Prisma 7 专节（Node 门槛 / URL 移位 / generated 路径 / external 列表）
- [x] DEPLOY.md：§4 补 Node ≥20.19 + prisma.config.ts 说明
- [x] PROGRESS.md：本节
- [x] README.md：技术栈表
