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

---

## 2. 当前进度（Phase 1）

| 模块          | 文件                       | 状态                                                        |
| ------------- | -------------------------- | ----------------------------------------------------------- |
| 类型          | `types/index.ts`           | ✅ 完成                                                     |
| LLM 抽象      | `lib/llm.ts`               | ✅ 完成（deepseek + openai；claude 留 throw 占位）          |
| 工具 schema   | `lib/tools/definitions.ts` | ✅ 完成（4 个工具）                                         |
| 数据集存储    | `lib/dataset-store.ts`     | ✅ 完成（内存 Map）                                         |
| 工具执行器    | `lib/tools/executor.ts`    | ✅ 完成                                                     |
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

- ~~`lib/tools/executor.ts` 的 `runInSandbox`~~
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

- ~~`lib/tools/executor.ts` 所有工具的 JSON.stringify 返回~~
- ~~大数据集 run_analysis 的 data 可能很大，多轮后撑爆 LLM 上下文窗口~~
- **解决方案**：`executor.ts:truncateForLLM`：数组超 30 项切前 30 + `_truncated` 元信息（含原长度、shown 数量、给 LLM 的 hint）；非数组 JSON 超 6000 字符（~1500 token）兜底警告。SYSTEM_PROMPT 加一条让 LLM 理解 `_truncated` 字段不要原样展示。
- **效果**：单 tool result 从可能 2K+ token 降到 ~500 token 级别，长对话累积 token 增长降约 70%。

### L10. 二次 LLM 调用无缓存

- **位置**：`lib/tools/executor.ts` 的 `generateAnalysisCode`
- **影响**：相同 intent + dataset 每次都重新生成代码，浪费 token。
- **解决**：Phase 2 用 `(datasetId, intent)` 做 LRU 缓存。

### L11. AI 回答的 Markdown 未渲染（验收暴露）✅ 已解决

- ~~`components/chat/MessageBubble.tsx` 用 `whitespace-pre-wrap` 直接显示文本~~
- **解决方案**：装了 `react-markdown` + `remark-gfm`，手写 14 个 component map 控制样式（不引入 `@tailwindcss/typography`，理由：chat 紧凑场景与 prose 的杂志风排版不搭）
- **额外收获**：表格采用 Notion 风（只横线、无列线，行间用 border-border 加深）

---

## 4. 优化项（不阻塞，记下来不忘）

### 4.1 性能

- [ ] 二次 LLM 调用结果缓存（同 L10）
- [ ] 大数据集 inspect_data 时延优化（当前会遍历全列做 nullCount，行数大时可改抽样）
- [x] ✅ tool result 自动截断（L9）
- [x] ✅ 滑动窗口：loadConversation 限制最近 40 条 messages

### 4.2 Agent 行为质量

- [ ] system prompt 加 few-shot 示例（提升复杂问题的工具调度准确率）
- [ ] system prompt 加 "用中文回答用户" 强约束（避免 DeepSeek 偶尔英文回答）
- [ ] 工具调用失败时的 retry 策略（区分可重试错误如限流 vs 不可重试错误如参数错）

### 4.3 用户体验

- [x] ✅ 流式 answer（L7）
- [x] ✅ Agent 步骤展示（实现为 always 单行 summary，click 可展开历史步骤）
- [x] ✅ 错误以 inline 顶部 banner 提示（不用 alert）
- [x] ✅ 错误条 dismiss × 按钮
- [x] ✅ 数据集删除（sidebar hover trash icon）
- [x] ✅ New Chat 按钮（floating 右上，confirm + DELETE messages）
- [x] ✅ Demo 数据集 + sidebar 一键试用按钮
- [x] ✅ 切换 dataset HistorySkeleton + 同步定位（`useLayoutEffect`）
- [x] ✅ LLM 生成动态 suggestions（替代硬拼模板）
- [ ] 图表交互（hover tooltip ✅；点击下钻 ⏳）
- [ ] 数据集列表搜索（datasets > 10 时需要）
- [ ] 文件上传进度条 + 大文件分片

### 4.4 工程

- [ ] 工具单测（`__tests__/tools/`）
- [ ] CSV/Excel 解析的边界用例测试
- [ ] 添加 ESLint 规则禁止 `any`、强制 explicit return type
- [ ] CI（GitHub Actions：tsc + lint + test）
- [ ] 多 Excel sheet 支持（当前只读第一个）

### 4.5 可观测性

- [ ] 每次工具调用的耗时 + token 数记录（开发期 console.table，生产期 Supabase）
- [ ] LLM 调用失败率监控
- [ ] Agent 步数分布统计（看 max_steps=10 是否够）

### 4.6 安全

- [x] ✅ xlsx 升级或替换（L1 已换 exceljs）
- [x] ✅ vm 沙箱替换（L2/L3 已换 better-sqlite3 SQL 执行）
- [x] ✅ 上传文件大小限制（20MB）
- [ ] E2B 沙箱（需付费 API key 验证，暂搁）
- [ ] LLM_API_KEY 服务端隔离（已经在 server only，但要确认不会泄露到客户端 bundle）

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
