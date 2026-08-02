# Supabase 本地开发

## 开发原则

本项目采用 local-first migration：数据库结构先以版本化 SQL migration 在本地从空库重建、测试和生成类型，再进入远端审计与后续部署流程。这样可以让结构变更可复现、可审阅，并让前端使用与 migration 同源的 TypeScript 类型。

Task 1.1 建立基础设施与健康检查，Task 1.2 建立统一内部身份，Task 1.3 启用本地 Auth 与网页登录，Task 1.4 增加工作空间成员权限和邀请激活闭环。本地配置启用数据库、Data API、Auth、Edge Runtime 与 Inbucket 邮件捕获；Studio、Realtime、Storage 和 Analytics 仍保持关闭。所有工作空间授权仍以 `current_app_user_id()` 解析出的 `app_users.id` 为边界。

## 环境要求

- 满足 `package.json` engines 的 Node.js 和 npm；
- Docker Desktop，或兼容 Docker API 的容器运行时；
- 使用仓库锁定的 Supabase CLI，不依赖全局安装。

安装依赖：

```bash
npm ci
```

## 常用命令

```bash
npm run db:start
npm run db:stop
npm run db:reset
npm run db:test
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
```

`db:verify` 会依次重建本地数据库、执行 pgTAP、以 warning 为失败门槛运行数据库 lint，并检查已提交类型是否与本地 migration 漂移。

## 创建和验证 migration

从干净功能分支创建 migration：

```bash
npx supabase migration new descriptive_name
```

编辑生成的 SQL 后，启动本地服务并从空库验证：

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

每个数据库行为都应加入 `supabase/tests/database/` 下的 pgTAP 测试。测试必须放在 `begin` / `rollback` 边界内，并覆盖权限与实际返回值，不能只断言对象名称。

`public` schema 中未来创建的函数默认不向 `PUBLIC`、`anon`、`authenticated` 或 `service_role` 开放执行权限。每个确需公开的 RPC 必须在函数创建后通过独立、可审阅的 migration 显式 `grant execute`；不能依赖 PostgreSQL 的函数默认权限。

## 统一身份模型

数据模型、解析边界、RLS 与权限矩阵的完整说明见 [统一身份模型](docs/identity-model.md)。相关产物：

- Migration：`supabase/migrations/20260801120000_unified_user_identity_schema.sql`（表、枚举、约束、只追加/单向状态触发器）、`20260801120100_unified_user_identity_security.sql`（解析函数、RLS、最小权限授权）；
- pgTAP：`supabase/tests/database/identity_schema_constraints.test.sql`（`plan(77)`）、`supabase/tests/database/identity_resolution_rls.test.sql`（`plan(74)`）；
- 前端夹具：`src/features/identity/fixtures.ts`、`src/tests/identity-fixtures.test.ts`。

业务表只允许引用 `app_users.id`，绝不引用外部 ID，也绝不接受客户端传入的 `user_id` 或 subject；外部主体到内部用户的映射集中在 `resolve_app_user_id()`（参数 `p_provider` / `p_tenant` / `p_subject`，避免同名遮蔽），调用方边界为 `current_app_user_id()`。解析要求身份已 `verified_at`、未撤销且用户 `active`。所有 `SECURITY DEFINER` 与触发器函数使用封闭的 `set search_path = ''`，并全部以 `public.` / `pg_catalog.` 限定；`user_identities` 绑定主体不可修改、撤销不可逆、行不可物理删除（`service_role` 无 `DELETE`/`ALL`，仅保留 SELECT / INSERT / 受限状态列 UPDATE）；`identity_binding_challenges` 的两个用户外键（`target_user_id`、`created_by`）均为 `RESTRICT`，主键 `id` 与其余身份字段不可修改，行不可物理删除。

## 数据库类型

数据库成功重建后，由本地 CLI 生成类型：

```bash
npm run db:types
```

生成文件为 `src/types/database.generated.ts`，不得手工编写或修改。提交前运行：

```bash
npm run db:types:check
```

漂移检查会在内存中重新生成并规范化行尾，与已提交文件比较；不一致时以非零状态退出。

## 本地前端配置

只在未跟踪的 `.env.local` 中填写本地低权限配置：

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable or anon key>
```

根目录和 `supabase/` 目录中的 `.env`、`.env.local`、`.env.production`、`.env.development`、`.env.staging` 及其他 `.env.[mode]` 文件都会被默认忽略；`.env.example` 是唯一允许提交的环境示例。

不要把本地状态命令的完整输出复制到文档、聊天或日志。浏览器只允许读取以下两个公开变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Vercel 将来同样只需要配置这两个公开变量。Vite 会在开发或生产构建阶段把使用到的 `VITE_*` 值写入客户端包，因此配置验证在 Vite 启动和构建前执行。URL 与 publishable key 只配置一项、URL 无效、secret key、旧式 service-role JWT 或任何受禁高权限变量非空时，命令会以脱敏错误直接失败，不会等到浏览器运行后才拒绝。

publishable key 面向低权限客户端；secret key、旧式 service role key、数据库密码和连接串都属于高权限凭据，绝不能使用 `VITE_` 前缀、进入浏览器代码或提交到仓库。失败门禁不会记录 URL、key 或完整环境对象，并会阻止失败产物留在 `dist`。

本地开发可接受 `localhost` 或 `127.0.0.1` 的 HTTP URL；托管地址必须使用 HTTPS。客户端工厂只有无参数生产接口，不能接收调用方传入的 URL、key 或配置结果；只有共享验证器返回安全配置后才会创建受控单例。Task 1.3 起客户端启用正式网页登录所需的会话能力：`persistSession: true`、`autoRefreshToken: true`、`detectSessionInUrl: true` 与 PKCE 流程；浏览器始终只持有低权限 publishable 凭据与会话，绝不持有 `service_role` 或任何高权限配置。

## 本地 Auth

`supabase/config.toml` 已启用本地 Auth（`[auth] enabled = true`），并保持安全边界：

- 禁止匿名登录、禁止公开注册（`enable_signup = false`）；
- `site_url` 与 `additional_redirect_urls` 只允许 loopback 受控地址；密码恢复流程重定向到应用受控的 `/reset-password`；
- 本地邮件捕获（`[local_smtp] enabled = true`，Inbucket）用于验证找回 / 重置流程，不配置真实 SMTP、不提交邮件账号或密钥；
- 不登录、不链接远端 Supabase，不执行远端 `db push`。

浏览器通过 `current_app_user_id()`（读取已验证 JWT 的 `request.jwt.claims`）解析内部 `app_users.id`，随后按 RLS 读取 / 更新自己的 `app_users` / `profiles`；Auth UUID 只存在于 `user_identities.provider_subject`，不作为业务键。网页登录、找回、重置与个人资料的实现见 `src/features/auth/` 与 `src/pages/auth/`，错误统一经 `src/features/auth/errors.ts` 脱敏映射，界面不显示原始 Supabase 错误、token、表名或内部信息。

## 本地 Edge Function 与邀请邮件

`supabase/config.toml` 启用本地 Edge Runtime，并将 `invite-workspace-member` 配置为 JWT 必须验证。启动本地栈后，可在另一个终端运行专项测试：

```bash
npm run db:start
npm run test:edge
```

函数入口只接受受控来源的 `POST`，使用调用者 Bearer token 调用 `auth.getUser(token)`，再把同一 Authorization 交给低权限客户端执行 `prepare_workspace_invitation`。数据库完成最终角色授权与幂等准备后，服务端管理客户端才调用 Auth Admin 邀请接口。Auth Admin 失败时只通过服务端专用 RPC 写入允许列表中的失败分类；函数响应与日志不包含邮箱全文、JWT、邀请链接、Auth 原始错误或密钥。

托管 Edge Runtime 的 provider tenant 从可信 `SUPABASE_URL` 推导。本地 Edge Runtime 会把该变量设为容器内部 Kong 地址，而本地 JWT issuer 是外部 loopback Auth URL；实现先通过官方 `auth.getUser(token)` 验证 token 和用户，再从同一已验证 JWT 读取 issuer，并只对内部 Runtime 接受严格的 loopback `/auth/v1` 例外。issuer 的 `sub` 还必须与官方验证返回的 Auth 用户一致。浏览器不能提交或覆盖 provider tenant。

本地邀请邮件进入 Inbucket / Mailpit。开发人员可在 Supabase 启动命令显示的 Web UI 中查看明显虚构的保留域名测试邮箱，点击后只应重定向到受控 loopback `/activate-account`。pgTAP 和纯处理器测试使用 `.invalid`；当前本地 Auth 的 email provider 会拒绝 `.invalid` 登录，因此真实邮件闭环使用 RFC 保留的 `example.com`。不要复制邮件中的邀请链接、token 或本地密钥到仓库、工单、截图或日志。

本地 Edge Runtime 由 CLI 注入项目 URL 以及 publishable / secret 变量；实现同时兼容 CLI 的本地旧变量名。不要创建自定义明文 secret 文件，也不要把任何服务端变量改成 `VITE_*`。托管环境应使用 Supabase 当前的 `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` 约定，浏览器仍只有 publishable key。

当前安装的 Supabase SDK 明确说明 `inviteUserByEmail` 不支持 PKCE，因此邀请邮件不应被描述为 PKCE 邀请。现有密码恢复继续使用 PKCE；本地真实邮件验证确认邀请链接以隐式 session fragment 重定向到 `/activate-account`，页面再接受业务邀请。邮件模板、允许重定向地址和托管域名在任何远端部署前都必须重新做端到端验证。

`[auth].enable_signup = false` 是公开注册的最终硬闸；`[auth.email].enable_signup = true` 只保持 email provider 可供既有账户登录、密码恢复和 Auth Admin 邀请。改动该组合时必须同时实测：既有受控账户登录成功、`/signup` 仍被拒绝。

## 默认工作空间 bootstrap

默认工作空间不会由浏览器自动创建，也没有“第一个用户抢占租户”的逻辑。仅受信任的 `service_role` 可调用：

```sql
select public.bootstrap_default_workspace(
  '<existing-app-user-id>'::uuid,
  'Fictional Default Workspace',
  '<stable-idempotency-key>'::uuid
);
```

调用前 owner 必须已是有效的内部 `app_users` 用户。相同 owner、名称和幂等键重复调用返回已有工作空间；同一幂等键携带冲突目标会拒绝。示例 UUID 需由本地测试夹具替换，绝不能用于远端项目。完整模型和权限矩阵见 [工作空间与成员权限](workspace-permissions.md)。

## 将来的远端连接

后续独立任务在完成安全审计后，可以由获授权人员执行 `supabase login` 与 `supabase link`，再按受控流程应用 migration。本任务不登录、不链接任何远端项目，不配置生产 Vercel 环境变量，也不部署 Edge Function 或远端 Auth 配置。

不得对生产数据库运行 `db reset` 或其他破坏性重建命令。远端 migration、Auth 邮件模板、SMTP、RLS 和 Edge Function 部署都需要在后续任务重新进行权限与数据边界审计。
