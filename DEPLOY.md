# DEPLOY.md — Vercel 生产部署指南

> Phase 4 改造后第一次完整重部署。涉及鉴权、Prisma 数据层、OAuth 三方。
> 完成时间预算：~30 分钟（不含 OAuth App 配置时间）。

---

## 0. 部署前检查

| 项 | 应该是什么状态 |
|---|---|
| 本地代码 | 在你的开发机上能 `npm run build` 通过 |
| 本地 e2e | Phase 4 验收清单全过（参考 PROGRESS.md §6.3） |
| Resend 账号 | 已注册 + 有 API key |
| Google OAuth App | 已创建，Authorized redirect URIs 含**两个**：本地 `localhost:3000` 和生产域名 |
| GitHub OAuth App | 单 App 只能配一个 callback —— 见 §3 |
| Supabase 项目 | 用同一个项目作为生产 DB（demo 项目常做法）。Connection pooling 端口 6543 必须启用 |

---

## 1. Vercel 环境变量清单

进入 **Vercel Dashboard → 项目 → Settings → Environment Variables**。

### 1.1 删除（Phase 3 老的）

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

### 1.2 必须配置（13 个）

| 变量 | 值 / 怎么拿 | Environment |
|---|---|---|
| `LLM_PROVIDER` | `deepseek` | All |
| `LLM_API_KEY` | DeepSeek 控制台 API key | Production + Preview |
| `LLM_MODEL` | `deepseek-v4-flash`（可选，默认就是这个） | All |
| `DATABASE_URL` | Supabase Connection pooling string（端口 **6543**），含 `?pgbouncer=true&connection_limit=1`，密码 URL 编码 | Production + Preview |
| `DIRECT_URL` | Supabase 直连 string（端口 **5432**） | Production + Preview |
| `AUTH_SECRET` | 用 `openssl rand -base64 32` 生成的 32 字节随机串 | Production + Preview |
| `AUTH_URL` | `https://data-analysis-agent-omega.vercel.app`（你的实际生产域名） | Production |
| `AUTH_TRUST_HOST` | `true` | Production + Preview |
| `GOOGLE_CLIENT_ID` | Google OAuth App 的 client_id | Production + Preview |
| `GOOGLE_CLIENT_SECRET` | Google OAuth App 的 client_secret | Production + Preview |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 client_id | Production + Preview |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 client_secret | Production + Preview |
| `RESEND_API_KEY` | Resend Dashboard 的 API key | Production + Preview |
| `RESEND_FROM_EMAIL` | `onboarding@resend.dev`（sandbox）或你 verify 过的自有域名地址 | Production + Preview |

### 1.3 不要加（本机专用）

```
HTTPS_PROXY    # 本机翻墙用，生产 Vercel 网络通畅不需要
HTTP_PROXY     # 同上
```

`instrumentation.ts` 检测不到这两个变量时会自动跳过 —— 零生产副作用。

---

## 2. Google OAuth App 生产 callback

Google 单个 OAuth App **支持多个 Authorized redirect URIs**：

1. https://console.cloud.google.com/ → 选你的项目
2. **APIs & Services → Credentials** → 点你的 OAuth 2.0 Client ID
3. **Authorized redirect URIs** 区域，应该已有两个：
   - `http://localhost:3000/api/auth/callback/google`（本地）
   - `https://<你的生产域名>/api/auth/callback/google`（生产）

如果生产那一行还没加，**现在加上 + Save**。

---

## 3. GitHub OAuth App 生产 callback

**GitHub 单 App 只能配一个 callback URL**。两种处理方式：

### 方案 A（推荐）：建第二个 OAuth App 专给生产

1. https://github.com/settings/developers → **New OAuth App**
2. Application name: `Data Analysis Agent (Production)`
3. Homepage URL: `https://<你的生产域名>`
4. Authorization callback URL: `https://<你的生产域名>/api/auth/callback/github`
5. 拿到这个**生产专用**的 client_id + secret，配进 Vercel env vars（不要覆盖本地 .env.local）

### 方案 B（简化）：用同一个 App，切换 callback URL

把现有 App 的 callback 改成生产域名。**本地开发就用不了 GitHub OAuth 了**（点了会跳生产域名）。

如果你不需要本地测试 GitHub，方案 B 省事。否则方案 A。

---

## 4. 数据库 schema 同步

> **重要变更（2026-06）**：migration **不再**在 Vercel build 里跑。
> 原 `build` 是 `prisma generate && prisma migrate deploy && next build`，
> 把每次部署绑死在「构建时数据库必须可达」上 —— Supabase 免费层闲置 7 天自动暂停后，
> 连纯前端改动都会构建失败（`tenant/user ... not found`）。已解耦。

`package.json` 的 `build` 现在是：
```json
"build": "prisma generate && next build"
```

`prisma generate` 只读 schema 文件生成 Client，**不连数据库** —— 构建从此与库状态无关。

### Migration 改为「部署前手动应用」

凡是 `prisma/migrations/` 里**新增了 migration**，部署前先对生产库跑一次：

```bash
npm run db:migrate:deploy   # = prisma migrate deploy，只应用未跑过的 migration
```

它走 `.env` 的 `DIRECT_URL`（5432 直连），生产安全（不像 `migrate dev` 会动 schema / 生成新文件）。
**没有新 migration 的部署（纯前端 / 逻辑改动）跳过这步即可。**

顺序铁律：**先 `db:migrate:deploy`（库先有新列），再 push 触发部署（新代码才用到新列）**。反过来会让线上代码查不存在的列。

### 当前 5 个 migration 都已应用到生产 DB（开发库即同一个 Supabase）

```
prisma/migrations/
├─ 20260519145908_init                       Dataset + Message
├─ 20260520013006_add_user_and_owner         User + Dataset.userId FK
├─ 20260520064951_add_login_attempts         LoginAttempt（rate limit）
├─ 20260520091850_add_email_verification     User.emailVerified + EmailVerificationToken
└─ 20260520110805_add_oauth_accounts         User.password 可空 + image + Account
```

随时 `npx prisma migrate status` 验证生产库是否最新。

---

## 5. 触发部署

两种方式：

### A. Git push 自动部署

```bash
git push origin main
```

Vercel 检测到 commit 自动开 build。

### B. Vercel Dashboard 手动 redeploy

如果代码没新 commit 但你想用新 env vars 重部署：
- Vercel Dashboard → Deployments → 最近一次 → 三点菜单 → **Redeploy**
- 改了 env vars 才需要取消 **"Use existing Build Cache"**；只换代码可保留缓存加速

---

## 6. 部署后 e2e 验证清单

打开 `https://<你的生产域名>`，按顺序跑一遍：

### 6.1 鉴权
- [ ] 未登录访问 / → 被重定向到 /login
- [ ] /login 页正常加载
- [ ] OAuth 按钮可见

### 6.2 Credentials 注册流程
- [ ] 注册新账号（用 Resend 注册时的邮箱才会收到真邮件）
- [ ] 邮箱收到验证邮件
- [ ] 点邮件链接 → /verify-email 显示"验证成功"
- [ ] 用注册邮箱+密码登录 → 进首页

### 6.3 OAuth
- [ ] 退出登录
- [ ] 点 Google → Google 授权 → 跳回首页（注意首次会 link 同邮箱 User）
- [ ] 退出再点 GitHub → 同上

### 6.4 业务功能
- [ ] 上传 sample.csv
- [ ] 提问 "哪个区域销售额最高" → 正常对话
- [ ] 切换主题（明/暗） → 颜色切换无 FOUC
- [ ] 退出登录

### 6.5 越权防护
- [ ] 登录用户 A，记下其 dataset ID
- [ ] 退出 + 登录用户 B
- [ ] 浏览器手动访问 `https://<域名>/api/datasets/<A 的 dataset id>` → 404 NOT_FOUND

---

## 7. 排错速查

| 症状 | 原因 | 修法 |
|---|---|---|
| Vercel Build 失败 `Environment variable not found: DATABASE_URL` | env 没配 | 在 Vercel Dashboard 补 |
| 部署后线上报「列不存在 / column does not exist」 | 加了新 migration 但忘了对生产库 `npm run db:migrate:deploy` | 先跑 `db:migrate:deploy` 再 redeploy（顺序：库先迁移，代码后上线） |
| `npm run db:migrate:deploy` 报 `tenant/user ... not found` | Supabase 免费层项目被暂停 | Dashboard → 项目 → Restore，等 1~3 分钟拉起后重试 |
| `db:migrate:deploy` 失败 `P3018: A migration failed` | 已有 schema 冲突（如手动改过 DB） | Supabase Dashboard 看 `_prisma_migrations` 表，删失败行后重跑 |
| 登录后 session.user.id 是 undefined | jwt/session callback 没运行 | 检查 `auth.config.ts` 有 `jwt` 和 `session` callback |
| OAuth 回调跳到 `error=Configuration` | client_id/secret 没配，或 callback URL 没对上 | 比对 Vercel env 和 OAuth App callback |
| 邮件发不出去 | RESEND_FROM_EMAIL 不是 verify 过的域名 | 用 `onboarding@resend.dev` 或在 Resend verify 自己 domain |
| Function timeout 60s | DeepSeek 慢 + 多轮 tool call | 升 Vercel Pro 改 maxDuration，或简化 prompt |
| Supabase 连接池打爆 | 没用 pooler（6543）或 connection_limit 没设 | 检查 DATABASE_URL 含 `?pgbouncer=true&connection_limit=1` |

---

## 8. 安全自检

部署后 5 分钟做：

1. **打开浏览器 DevTools → Network**，看任何接口返回 header 不含敏感数据
2. **打开浏览器 view-source**，搜索 `LLM_API_KEY` `AUTH_SECRET` `GOOGLE_CLIENT_SECRET` → **必须为空**（这些是 server-only env vars，不能进 client bundle）
3. **未登录直接 `curl https://<域名>/api/datasets`** → 应返回 401 JSON
4. **登录后退出再访问** → 应再次 401

任何一条不符合 → 立即下线 + 排查。
