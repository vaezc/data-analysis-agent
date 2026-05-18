# INTERVIEW.md — 面试讲稿与速查

> 配套 [`LEARNING.md`](./LEARNING.md) 食用。LEARNING 是详细学习材料（厚），这份是**演讲稿 + 速查**（薄），全是可以直接背、改、抄的内容。

## 怎么用这份文档

| 时机 | 看哪段 |
|---|---|
| 面试前一晚 | 通读一遍，重点是 §4「5 个核心故事」 |
| 面试前 10 分钟 | 默背 §3「电梯演讲」+ §5「必背数据流图」 |
| 面试中遇到深问 | 查 §6「高频问题精答」 |
| 投简历 | 直接抄 §2「简历文案」 |
| 面试结尾"你有什么问题问我" | 用 §9「反问招聘官」 |

---

## 1. 一段话讲清楚

> **Data Analysis Agent**——让不会写 SQL/Python 的业务用户上传 CSV/Excel，用自然语言提问，AI Agent 自主多步推理（看数据 → 跑 SQL → 出图 → 写报告），全过程实时流式展示。Next.js 16 + DeepSeek V4 + Supabase + better-sqlite3，已部署 Vercel，[live demo](https://data-analysis-agent-omega.vercel.app)。

---

## 2. 简历文案

### 中文一句话版

> **Data Analysis Agent**｜LLM Agent 个人项目｜Next.js 16 + DeepSeek V4 + Supabase
> 让业务用户用自然语言分析数据。SSE 流式 + 多步 tool calling + SQLite 沙箱跑 LLM 生成的 SQL，[live demo](https://data-analysis-agent-omega.vercel.app)。

### 中文两行版（简历常用）

```
Data Analysis Agent (LLM Agent 个人项目)              github.com/vaezc/data-analysis-agent
Next.js 16 / React 19 / TypeScript / DeepSeek V4 / Supabase / SSE / better-sqlite3
• 实现完整 Agent 主循环（while + MAX_STEPS + 三种 delta 累积），支持 DeepSeek V4 thinking mode
  协议 reasoning_content 回 echo；SSE 流式推送工具步骤 / 图表 / 报告 / token 增量
• 二级 LLM 生成 SQLite SQL 替代 vm 沙箱（SELECT-only + 关键字白名单 + :memory:）；解决了
  vm 历史 CVE 与 prototype pollution 风险，sandbox 安全性显著提升
• Vercel Serverless 跨函数内存隔离问题诊断 + 上线后 2 小时上 Supabase 持久化（datasets/
  messages 双表）；附带解决刷新丢历史问题
• Token 管理：tool result 自动截断 + 滑动窗口（loadConversation 最近 40 条），长对话累积
  token 增长降约 70%
```

### 英文一句话版（for LinkedIn）

> **Data Analysis Agent** | LLM Agent side project | Next.js 16 + DeepSeek V4 + Supabase
> Natural-language data analysis for non-technical users. Multi-step tool-calling agent with SSE streaming, LLM-generated SQL in SQLite sandbox, ~3000 LOC. [Live demo](https://data-analysis-agent-omega.vercel.app)

### 英文 LinkedIn 帖子版（公开发布用）

```
Just shipped a production-grade LLM Agent that lets non-technical users
analyze CSV/Excel via natural language. 🚀

Three lessons that surprised me:

1. "Local works ≠ prod works." Vercel Serverless functions don't share
   in-memory Map state across endpoints. Debugged via Function Logs,
   migrated to Supabase persistence within 2 hours.

2. node:vm is not a real sandbox. Replaced LLM-generated JS execution
   with better-sqlite3 :memory: + SELECT-only validation. SQLite is one
   of the most audited DBs in the world — far safer than vm.

3. DuckDB is great but 115MB. Hit Vercel hobby 50MB function limit
   immediately. Sometimes "smaller and good enough" wins over "biggest
   and best."

Stack: Next.js 16 (App Router + Turbopack) / TypeScript strict /
DeepSeek V4 (with thinking mode echo) / Supabase / Recharts / SSE /
better-sqlite3 / exceljs.

Live demo + source: [URL]
```

---

## 3. 电梯演讲

### 30 秒版本

> "这是一个 LLM Agent 项目，让不懂 SQL 的业务用户直接用自然语言分析 Excel。我做了完整的 Agent 主循环——SSE 流式、多步 tool calling、自己实现了 thinking mode 协议适配。最关键的是上线后踩了一个 Serverless 跨函数内存隔离的坑，2 小时内上了 Supabase 完整持久化。技术栈 Next.js 16 + DeepSeek V4，部署在 Vercel 上。"

**关键节奏**：定位（10s）+ 核心技术（10s）+ 上线故事（10s）。

### 1 分钟版本（被问"详细讲讲"）

> "项目定位是让业务用户上传 CSV 后用大白话问问题，Agent 自动决定怎么算、出图、写报告，全过程实时展示——每一步可见、每个数字可追溯。
>
> 技术核心是 Agent 主循环：while 循环最多 10 步，每轮调 LLM 流式拿 chunks，按三种 delta 累积——content / reasoning_content / tool_calls。reasoning_content 是 DeepSeek V4 thinking mode 的扩展字段，必须回 echo，否则下次请求 400。
>
> 工具系统有 4 个：inspect_data 看结构、run_analysis 跑 SQL、create_chart 出图、generate_report 出报告。run_analysis 是亮点——二级 LLM 根据用户 intent 生成 SQLite SQL，better-sqlite3 :memory: 执行，三层防御做安全。这套设计的精髓是关注点分离：Agent 决策做什么，二级 LLM 决定怎么算。
>
> 已经部署在 Vercel，做了 Supabase 持久化、HTML 报告导出、双主题、流式滚动等。完整的 12 个 commit + 4 份文档在 GitHub。"

---

## 4. 5 个核心故事（STAR 框架）

每个故事讲 **2-3 分钟**。准备好被追问"具体怎么实现的"。

### 故事 1：Serverless 跨函数内存隔离（产线意识）⭐ 强烈推荐主动讲

**S 背景**：项目本地跑得好好的，部署到 Vercel 后用户上传 CSV 没问题，但接着问问题就报"数据集不存在"。

**T 任务**：诊断 + 修复 + 总结教训。

**A 行动**：
1. 看 Vercel Function Logs 发现确实是 dataset 查不到
2. 加详细 console.error 输出 env 状态 + dataset store keys
3. 突然意识到：`/api/upload` 和 `/api/agent` 在 Vercel 上是**两个独立 Lambda function**，内存 Map 跨函数完全不共享
4. 即使 fluid compute 让实例 warm 也不行——cross-endpoint 永远不通
5. 决策：直接上 Supabase 持久化（不做临时 KV 中转）
6. 2 小时内完成：建 datasets / messages 双表 → 改 dataset-store.ts 从 Map 到 Supabase queries → 改 agent route 不再从前端读 history、改成从 DB 加载 → 改前端 hook 不再维护 llmHistory

**R 结果**：
- demo 上线可用
- **顺便解决了 L8**（刷新丢对话历史）和 **L4**（HMR 内存 Map 清空）
- 学到：**"本地能跑 ≠ 生产能跑"**——Serverless 的 invocation model 是必须早期理解的

**追问可能**：
- Q: 为什么不上 Redis / Vercel KV？  
  A: dataset 是结构化数据 + 对话历史也是结构化，Postgres 更自然。KV 适合 cache，不是 source of truth。
- Q: Supabase 怎么选的？  
  A: 免费 tier 够、Postgres 标准、JS client 简洁、Serverless 友好。
- Q: 怎么处理 RLS？详见 LEARNING.md §3.x。

### 故事 2：vm → SQLite 沙箱迁移（安全演进）

**S**：第一版 run_analysis 工具用二级 LLM 生成 JavaScript，再用 `node:vm.runInContext` 执行。

**T**：发现两个问题——
1. **安全**：node:vm 不是真沙箱，历史有上下文逃逸 CVE，globals 白名单也只是缓解。LLM 生成的 JS 间接受用户输入影响。
2. **能力**：JS 写 group by 啰嗦，LLM 偶尔写错（错变量、忘 ?? 兜底）。

**A**：评估三个替代方案——
- DuckDB native binding（@duckdb/node-api）：115 MB，**爆 Vercel Hobby 50MB function 限制**
- DuckDB-WASM：30 MB，但 Node 端 worker 配置复杂
- ✅ **better-sqlite3**：~5MB Linux x64 prebuilt，native binding，Vercel 完美兼容

最终方案：换 better-sqlite3，让 LLM 生成 SQLite SQL 而不是 JS。
- 三层防御：必须 SELECT/WITH 开头 + 拒绝 DDL/DML 关键字 + `:memory:` per-query
- next.config.ts 加 `serverExternalPackages: ['better-sqlite3']` 处理 native binding 部署

**R**：
- SQL 表达能力 >> JS（GROUP BY / 窗口函数 / CTE 直接可用）
- SQLite 是世界最被审计过的 DB，安全性远超 vm
- LLM 生成 SQL 比 JS 准确率高很多（SQL 是训练数据里最多的代码之一）

**追问可能**：
- Q: 为什么不用 DuckDB？  
  A: 包 115MB 爆 Vercel hobby 50MB function 限制，免费 plan 不能用。SQLite 对 demo 规模完全够。
- Q: 怎么防 SQL injection？  
  A: 不是用户直接写 SQL——LLM 生成的，且过三层校验（SELECT/WITH 前缀 + banned keyword + :memory: 隔离）。
- Q: 为什么不去掉 vm 用 Pyodide?  
  A: WASM Python 包大、启动慢、生态比 SQL 弱。SQL 才是数据分析母语。

### 故事 3：Agent 主循环 + 三种 delta 累积（核心架构）

**S**：要实现一个能多步推理的 Agent——LLM 流式输出，过程中决定调工具，工具返回结果后继续思考，直到给出最终答案。

**T**：核心循环要处理：
- 流式 chunks 累积
- 多种 delta 类型（content / reasoning_content / tool_calls）
- tool_calls 按 index 拼接 incremental arguments
- 终止条件
- 错误隔离（错误是事件不是异常）

**A**：核心 250 行实现 (`lib/agent.ts`)：

```
for (step = 0; step < MAX_STEPS; step++):
    stream = chatCompletionStream(messages, tools)
    
    contentBuffer = ''
    reasoningBuffer = ''  // ← V4 thinking mode 必须 echo
    toolCallAccs = Map { index → { id, name, args } }
    
    for await chunk of stream:
        if delta.content: contentBuffer += delta.content; emit answer_delta
        if delta.reasoning_content: reasoningBuffer += ...
        if delta.tool_calls: 按 index 累积 args 字符串
    
    push assistant message (含 reasoning_content) 到 messages
    
    if no tool_calls:
        emit done (含 messages slice)
        return
    
    for each tool_call:
        emit tool_start
        result = executeTool(...)
        emit tool_done
        push tool message 到 messages
```

**R**：
- 250 行实现完整 Agent，无第三方 agent 框架
- 支持 thinking mode 协议 echo（DeepSeek V4 独有，没回 echo 会 400）
- 错误转事件，SSE 连接永不挂

**面试白板必背**：tool_calls 按 index 累积的原因——模型一次响应可能调多个工具，每个 chunk 给一个 index 的一小段 arguments JSON 字符串。

**追问可能**：
- Q: 为什么不用 LangChain？  
  A: 黑盒，调试难。250 行自己写完全可控，且能直接对话 OpenAI 协议。
- Q: MAX_STEPS = 10 怎么定的？  
  A: 经验值。一般问题 2-4 步搞定，10 步留余量防死循环。生产可以加监控看分布。
- Q: 怎么处理 LLM 返回非法 tool_call？  
  A: try/catch 整个循环，错误转 emit event，连接不挂。具体见 agent.ts 错误处理那段。

### 故事 4：从硬编码模板到 LLM 生成提示（产品迭代）

**S**：EmptyState 显示的"示例问题"原本硬编码 `EXAMPLE_QUESTIONS`，每个 dataset 都显示"哪个区域销售额最高？"——切到员工数据完全不适用。

**T**：先做了模板版本——根据 columns 类型套：
```
string × number → "哪个 {string} 的 {number} 最高？"
date × number → "按 {date} 看 {number} 趋势"
```

用户反馈"哪个 region 的 units 最高 这个太生硬了"——**中英混搭让句子割裂**。

**A**：升级为 LLM 生成：
1. 新建 `lib/suggestions.ts` 调用二级 LLM，system prompt **显式给反例**：
   ```
   反例（不要这样）："哪个 region 的 units 最高"
   正例：'哪个区域的销量最高？'
   ```
2. 新增 `GET /api/datasets/[id]/suggestions` 端点，lazy 调用
3. 前端 ChatPanel：useEffect 加载 + useRef Map 会话内缓存
4. **fallback 链**：LLM 失败 → 模板 → 用户体验不挂

**R**：
- LLM 生成的句子自然得多："华东和华南哪个区域的销售额更高？"
- 渐进增强：模板立即显示，LLM 1 秒后替换
- 单 dataset 只调一次 LLM（缓存）+ 失败 fallback 模板
- 成本 ¥0.001 / dataset 一次性

**面试讲点**：
- **给 LLM 反例比给正例约束力强**——这是 prompt engineering 的小技巧
- **缓存层次设计**：模板（即时）→ LLM（异步）→ 会话内 Map 缓存。多层防御
- **接到用户反馈快速迭代**：从模板版到 LLM 版只花了 1 小时

### 故事 5：Sticky-to-bottom 流式滚动细节

**S**：流式聊天 app 的滚动看起来简单但坑很多——用户在底部时跟随、向上翻看时不打扰、发新消息时自然滑入。

**T**：需要区分三种场景，且让 scrollHeight 频繁变化不打扰用户。

**A**：核心设计——**sticky 状态由用户主动滚动维护，不被程序滚动污染**。

```ts
const stickyRef = useRef(true)

// onScroll 维护 sticky（只有用户滚动会触发）
el.addEventListener('scroll', () => {
  const distance = scrollHeight - scrollTop - clientHeight
  stickyRef.current = distance < 60
})

useLayoutEffect(() => {
  // 切换 dataset 加载完 → 瞬时定位到底（不闪顶部那一帧）
  if (justFinishedLoading) {
    el.scrollTop = el.scrollHeight
    return
  }
  // 新消息 → smooth scroll（视觉自然）
  if (isNewMessage) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    return
  }
  // 流式更新（同条 message 内容在变）→ sticky 时瞬时跟
  if (stickyRef.current) el.scrollTop = el.scrollHeight
}, [messages, isLoadingHistory])
```

**R**：
- 三种场景区分清晰
- `useLayoutEffect` 让切换 dataset 时浏览器永远不 paint 顶部那一帧
- 用户向上翻看时不打扰

**面试讲点**：
- 体感问题往往是 **数据结构（sticky 状态）抽象错了**，不是阈值不对
- **scrollHeight 变化不触发 scroll 事件**——这让 sticky 状态可以纯由用户行为维护，不被程序污染
- **useLayoutEffect vs useEffect** 的应用场景：避免可见的中间帧

---

## 5. 必背：数据流图

面试官最爱问"画一下你的架构"。这个图必须徒手能画出来。

```
浏览器 (ChatPanel + useAgent)
   ↓ fetch POST /api/agent
Next.js API Route (SSE response)
   ↓ runAgent({ datasetId, message, onEvent })
runAgent 主循环 (lib/agent.ts)
   ↓ chatCompletionStream(messages, tools)
DeepSeek V4 API
   ↓ chunks (3 种 delta: content / reasoning_content / tool_calls)
runAgent 累积 chunks
   ↓ 有 tool_calls?
        ├─ 是 → executeTool() → emit tool_start/done → push tool result → 继续循环
        └─ 否 → emit done → return
   ↓
SSE events (data: <json>\n\n) 流回浏览器
   ↓ TextDecoder + 按 \n\n 切分
useAgent.handleEvent → setMessages 触发 React render
```

**关键数字**（被追问"具体多少"时直接答）：

| 参数 | 值 |
|---|---|
| MAX_STEPS | 10 |
| tool result 数组截断阈值 | 30 项 |
| tool result 字符串截断阈值 | 6000 字符（~1500 token） |
| 滑动窗口（loadConversation 最近 N 条 messages） | 40 |
| 上传文件大小上限 | 20 MB |
| SSE 端点 maxDuration | 60 秒 |
| Vercel hobby function size 限制 | 50 MB |
| 当前项目核心代码 | ~3000 行 |
| commit 数 | 18+（conventional commits） |

---

## 6. 10 个高频问题精答

### Q1: 为什么不直接让用户用 ChatGPT 上传 CSV？

> 三个差异：① **过程可见**——我们把每一步工具调用展示出来，非技术用户能验证 AI 真的看了数据；② **结构化输出**——图表是 Recharts SVG 可交互，报告是 HTML 可下载可打印；③ **数据私有**——企业内网部署后数据不出公司，prompt 里也只发 sample 不发全量。
> 如果是 B 端销售场景，第三点最关键——很多客户因合规不能用 ChatGPT。

### Q2: DeepSeek 跟 OpenAI 怎么比？

> ① **价格**：DeepSeek V4-flash 大约 GPT-4o 的 1/10，中文场景特别划算。② **能力**：V4 在数学/代码接近 Claude Sonnet。Tool calling 偶尔过度自我纠正——已在 prompt 里约束。③ **稳定性**：高峰期延迟比 OpenAI 大。生产应有 fallback provider——这就是我做 provider 抽象层的原因，30 秒切换不改业务代码。

### Q3: SSE vs WebSocket 为什么选 SSE？

> SSE 适合**单向流**（服务端推客户端），HTTP 同源、HTTP 标准（代理友好）、`EventSource` 浏览器自带断线重连。WebSocket 是双向通信，本场景过度设计。**坑**：POST + 流式响应不能用 EventSource（只支持 GET），所以前端用 fetch + ReadableStream 手动消费。

### Q4: 长对话怎么管 token？

> 当前是 stateless 协议，每轮带全量历史，token linear 增长。我做了两层管理——
> ① **tool result 截断**：数组超 30 项切前 30 + `_truncated` 元信息提示 LLM
> ② **滑动窗口**：loadConversation 只取最近 40 条 messages（约 20 轮）
> 长对话累积 token 增长降约 70%。
> 真要做 50+ 轮的，会上摘要压缩；100+ 轮才考虑 RAG。本场景的数据分析对话一般 < 20 轮。

### Q5: vm 真的安全吗？现在的 SQLite 沙箱怎么样？

> **vm 不是真沙箱**——历史有上下文逃逸 CVE，globals 白名单也只是缓解。所以**第一版用了 vm + 5s timeout + globals 白名单做缓解，但同时在 LEARNING.md 标注了 L2 局限**。
>
> 现在换了 better-sqlite3——三层防御：(1) 必须 SELECT/WITH 开头；(2) 正则拒绝 DDL/DML 关键字；(3) `:memory:` per-query，无状态泄漏。SQLite 是世界上最被审计过的 DB 之一，比 vm 安全得多。
>
> 真要更严格隔离，下一步会接 E2B 沙箱（远程 Docker 容器），但需要付费 API key 才能测试，所以暂搁。

### Q6: 数据集很大（10 万行）怎么办？

> 现状：
> - 解析：papaparse 流式 OK
> - 存储：10 万行 JSON 几十 MB，Supabase JSONB 字段够（单字段上限 1GB）
> - 分析：better-sqlite3 :memory: 创建临时表 + 批量 INSERT（事务包裹快 10x+）+ 跑 SQL，10w 行毫秒级
> - 真正瓶颈是发给 LLM 的 sample——inspect_data 只发 3 行，所以 LLM 上下文窗口不爆
>
> 行数 >100w 时考虑 DuckDB native binding（但 Vercel Pro plan 才放得下）。

### Q7: 数据集很大时上传慢怎么办？

> 当前同步解析 + 写入 Supabase，10MB CSV 大约 2-5 秒。这在 Vercel hobby 10s timeout 内 OK，pro 60s 完全没问题。
> 优化方向：① 流式上传（multipart chunked），但 Vercel body 上限 4.5MB 即使 chunked 也限制；② 直接前端 → Supabase Storage 上传，绕过 Vercel function——这是 Phase 4 才做的。

### Q8: 状态管理为什么不用 Zustand / Redux？

> 评估过，当前规模不需要。状态要么完全局部（input / showJson），要么被 hook 封装得很干净（useAgent 暴露 `{messages, send, error, ...}`）。没有 prop drilling 痛点，也没有跨组件树共享。
>
> 引入 Zustand 的信号——cross-tree 共享 + 组件外访问 + middleware 需求——当前都没出现。加用户认证或者设置面板时会触发，那时再上。**提前引入是 over-engineering**。

### Q9: 部署上线遇到过什么问题？

> 三个有意思的：
> ① **环境变量 typeof string 但 falsy** —— LLM_API_KEY 字段在 Supabase 表里有但是空字符串。诊断方法：临时加 `console.error` 输出 `typeof process.env.LLM_API_KEY` 和 `Object.keys(env).filter(k => k.startsWith('LLM_'))`，看到 typeof string 但仍 falsy → 值是空串。
>
> ② **Vercel Serverless 跨函数内存隔离** —— 详见故事 1。
>
> ③ **better-sqlite3 native binding** —— Next.js bundle 时 inline 打包会导致 `.node` 文件加载失败。在 next.config.ts 加 `serverExternalPackages: ['better-sqlite3']` 解决。

### Q10: 你这个项目还能怎么演进？

> 短期（1-2 周）：
> - E2B 沙箱替代 SQLite（跑真 Python，能用 pandas 之类）
> - DuckDB-WASM（如果升 Vercel Pro）
> - Vision 多模态（架构已 ready，只需切到 vision-capable LLM 比如 gpt-4o）
>
> 中期（1 月）：
> - 用户认证 + RLS 真正多租户
> - Realtime 协作（多人同时分析同份数据）
> - DuckDB-WASM 上来后支持百万行级别
>
> 长期：
> - 接入企业数据源（PostgreSQL / 阿里云 MaxCompute 等）
> - 自动报表订阅（每周生成报告）

---

## 7. 5 个可以主动抛的加分点

面试结尾如果氛围好，主动抛 1-2 个："如果你有时间，我还想讲一个有意思的设计——"

### 加分 1: prompt engineering 反例的妙用

> "做动态 LLM suggestions 时，给 prompt 加正例 LLM 还是偶尔生硬。后来加了反例——'反例（不要这样）：哪个 region 的 units 最高'——LLM 立刻就不那么硬拼了。**给 LLM 反例比给正例约束力强**，因为反例少且 contrastive，模型更容易学。"

### 加分 2: 多层缓存设计

> "LLM suggestions 的缓存设计有点意思。fetch 时间约 1 秒，用户不喜欢等。所以：(1) 模板 suggestions 立即显示（即时 fallback），(2) 后台 fetch LLM 异步替换（渐进增强），(3) useRef Map 会话内缓存（切回同一 dataset 不重复调）。三层让用户感觉永远是即时响应。"

### 加分 3: SSE 错误是事件不是异常

> "Agent 主循环里所有错误都被 try/catch 兜住转成 SSE error 事件，不 throw。这样 SSE 连接永不挂，用户看到的是错误信息而不是空白。这个 invariant 让上层 API Route 几乎不用错误处理。"

### 加分 4: useLayoutEffect 避免可见中间帧

> "切换 dataset 时如果用 useEffect，浏览器会先 paint 一帧'内容在顶部'，下一帧才滚到底——肉眼可见的闪烁。改用 useLayoutEffect 同步执行 scrollTop = scrollHeight，浏览器 paint 时已经在底部。这种'肉眼可见 vs 不可见'的差别是 60fps 应用的关键。"

### 加分 5: 演进意识——vm → SQLite 的故事

> "第一版用了 node:vm 跑 LLM 生成的 JS。后来评估发现 vm 不是真沙箱，加 native binding 又怕 Vercel function size 爆。试了 DuckDB（115MB 爆）、sql.js（wasm 路径配置麻烦）、最后 better-sqlite3。**这种'试错 + 演进'的过程比一上来就声称用了最好方案更可信**。"

---

## 8. 避坑：哪些不要主动深讲

| 不深讲 | 原因 |
|---|---|
| **Tailwind v4 的 `@theme inline` 黑魔法** | 太前沿，被深问可能讲不清；用 token 系统说明即可 |
| **Recharts 内部实现** | 三方库，深挖暴露不熟 |
| **DeepSeek V4 vs V3 区别** | 模型选择层面的事，重点讲我用了什么 + 为什么；不要假装懂 V4 训练细节 |
| **better-sqlite3 内部 C 实现** | native binding 深度细节，知道是 SQLite 即可 |
| **Vercel 实际计费机制** | 商业层面，重点讲技术决策；说"Hobby plan 50MB function 限制"够了 |

被问到时坦诚说"这块我没深入研究，知道 X 大致原理，需要可以查"。**承认边界比硬撑专业**。

---

## 9. 反问招聘官（结尾必备）

面试官常问"你有什么问题问我？"——准备 3-5 个有水平的，体现你认真思考过这个岗位。

### 必问

1. "团队当前最大的技术挑战是什么？最近 3 个月做的最有意思的事？"
2. "AI/LLM 在团队的应用现状是？有没有专门的 AI 团队，还是各业务线自己探索？"
3. "如果我加入，前 90 天最希望我交付什么？"

### 加分

4. "团队怎么平衡技术债 vs 新功能？" （展示 senior 思维）
5. "代码 review 流程是怎样？" （看团队工程文化）
6. "团队最近上的一个生产事故 / 修复经历，方便分享一下吗？" （看是否敢承认问题）

### 千万别问

- "上下班几点？加班多吗？" ❌
- "升职路径如何？" （首次见面不合适）

---

## 10. 面试前 24 小时 checklist

- [ ] 通读 INTERVIEW.md 一遍
- [ ] §3 电梯演讲 30s + 1min 各默背 1 次
- [ ] §4 5 个故事每个能讲 2 分钟（不看稿）
- [ ] §5 数据流图徒手画一次
- [ ] §6 高频问题答案至少看一遍
- [ ] §9 反问选 3 个准备好
- [ ] 打开 live demo 实际操作一遍（防演示翻车）
- [ ] Git 仓库主页打开，README 截图能秒看到关键信息
- [ ] 准备问题清单：印一份纸质版 / 手机记事本

---

## 11. 项目相关数字速查

> 被问"具体多少"时直接答，不带磕巴。

| 项 | 数值 |
|---|---|
| 项目总代码 | ~3000 LOC |
| Agent 主循环 | 250 行 |
| 文档总长 | LEARNING.md 1400+ / PROGRESS.md 250+ / INTERVIEW.md 700+ |
| commit 数 | 18+ |
| 工具数 | 4（inspect / analysis / chart / report） |
| 主要 deps | Next 16 / React 19 / DeepSeek V4 / Supabase / Recharts / better-sqlite3 / exceljs / marked |
| Vercel function 数 | 8（含 dynamic routes） |
| Supabase 表 | 2（datasets / messages） |
| 单 tool result 截断 | 30 项 / 6000 字符 |
| 滑动窗口 | 最近 40 条 messages |
| MAX_STEPS | 10 |
| SSE timeout | 60 秒 |

---

## 12. 配套文档

| 文档 | 用途 |
|---|---|
| [README.md](./README.md) | 招聘官第一印象 |
| **INTERVIEW.md**（本文档） | 演讲稿 + 速查 |
| [LEARNING.md](./LEARNING.md) | 详细学习材料（25+ 道面试题 + 完整数据流追踪） |
| [PROGRESS.md](./PROGRESS.md) | 项目蓝图 + 局限登记册 |
| [CLAUDE.md](./CLAUDE.md) | 开发规范（不用对面试官展示） |

---

祝好运 ☕

记住：**真诚 > 完美**。承认局限和试错过程，比假装一切都"一上来就完美"更让面试官信服。
