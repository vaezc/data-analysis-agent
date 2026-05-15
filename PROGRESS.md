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

### L1. `xlsx@0.18.5` 存在已知 CVE

- **风险**：CVE-2023-30533（prototype pollution）、CVE-2024-22363（ReDoS）
- **影响**：仅在 Excel 解析路径，CSV 不受影响。Phase 1 单用户 demo 攻击面窄。
- **解决**：Phase 3 上线前迁到 SheetJS CDN 版本或换 `exceljs`。

### L2. `node:vm` 不是真正的安全沙箱

- **位置**：`lib/tools/executor.ts` 的 `runInSandbox`
- **风险**：历史上有上下文逃逸 CVE；用户输入间接通过 LLM 进入 vm。
- **缓解**：globals 白名单（无 process/require/setTimeout/Promise）、5s timeout。
- **解决**：Phase 2 接 E2B 沙箱，替换 `execAnalysis` 一个函数即可。

### L3. `vm` 不支持 async/Promise

- **影响**：LLM 生成的 JS 不能用 await。当前不需要。
- **解决**:Phase 2 E2B 解决（Python 异步本来就不同模型）。

### L4. Next.js dev 模式 HMR 会清空内存 Map

- **位置**：`lib/dataset-store.ts` 模块级 `Map`
- **影响**：开发时改代码 → 数据集丢失需重传。生产 `next start` 单实例运行无问题。
- **解决**：Phase 3 Supabase 持久化彻底解决；Phase 1/2 可接受。

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

### L8. Agent 没有对话历史持久化

- **影响**：刷新页面对话丢失。
- **当前状态**：内存里 per-dataset 独立历史（`hooks/use-agent.ts` 用 `Map<datasetId, {messages, llmHistory}>` + useEffect cleanup），切换数据集互不污染；多轮上下文通过 `done` 事件携带 LLM messages 在前端累积、下次 send 时回传。
- **解决**：Phase 3 Supabase 持久化到数据库才能解决刷新丢失。

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
- [ ] tool result 自动截断（同 L9）

### 4.2 Agent 行为质量

- [ ] system prompt 加 few-shot 示例（提升复杂问题的工具调度准确率）
- [ ] system prompt 加 "用中文回答用户" 强约束（避免 DeepSeek 偶尔英文回答）
- [ ] 工具调用失败时的 retry 策略（区分可重试错误如限流 vs 不可重试错误如参数错）

### 4.3 用户体验

- [x] ✅ 流式 answer（同 L7）
- [x] ✅ Agent 步骤展示（实现为 always 单行 summary，比折叠更直接；click 可展开历史步骤）
- [x] ✅ 错误以 inline 顶部 banner 提示（不用 alert）
- [ ] 图表交互（hover tooltip ✅；点击下钻 ⏳）
- [ ] 数据集列表搜索 + 删除（删除按钮缺失）
- [ ] 错误条 dismiss × 按钮
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

- [ ] Phase 3 前：xlsx 升级或替换（同 L1）
- [ ] Phase 3 前：E2B 沙箱（同 L2）
- [ ] 上传文件大小限制（防 DoS）
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

**Phase 3 已完成项（2026-05-14）：**

- ✅ **报告导出（HTML）**：`generate_report` 工具落地，`ReportCard` 卡片渲染 + 一键下载独立 HTML（marked 转换 + inline CSS，offline 双击可看）

---

### 当前状态（2026-05-14）

**Phase 2 收尾**：只剩 E2B 沙箱（L2/L3）。Demo 用 `node:vm` 完全够用，可推到 Phase 3 后。

**Phase 3 进行中**：
- ✅ 报告导出
- ⏳ Supabase 持久化（L8）
- ⏳ Vercel 部署
- ⏳ 2~3 个 Demo 数据集

### 上线前必做扫尾（按优先级）

1. **xlsx CVE 升级或替换**（L1）— 上线前必做
2. **错误条 dismiss × 按钮** — 5 分钟，UX 必备
3. **数据集删除** — 20 分钟，UX 必备
4. **上传文件大小限制**（4.6）— 防 DoS
5. **多 dataset 切换稳定性回测** — 来回切 + 中途 streaming 边界用例

### 推荐路径

**🅰️ 修复扫尾（~1 小时）→ 🅱️ Vercel 部署（~1.5 小时）→ 🅲️ Demo 物料（~30 分钟）**

一个下午能拿到可分享的 demo URL。Supabase 持久化 / E2B 沙箱可推到上线后再做。
