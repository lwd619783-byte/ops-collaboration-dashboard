# Supabase 本地开发

## 开发原则

本项目采用 local-first migration：数据库结构先以版本化 SQL migration 在本地从空库重建、测试和生成类型，再进入远端审计与后续部署流程。这样可以让结构变更可复现、可审阅，并让前端使用与 migration 同源的 TypeScript 类型。

Task 2.1 在既有统一身份与工作空间权限边界上增加项目 CRUD、关系可见性、乐观并发与不可逆归档。Task 2.2 增加项目 owner/lead 一致性、成员可信 RPC、完整权限矩阵和真实多连接并发验证。数据模型、最小授权和页面边界见 [项目 CRUD、可见性与归档 V1](project-crud-and-visibility.md) 与 [项目成员与牵头人 V1](project-membership-and-lead.md)。

Task 1.1 建立基础设施与健康检查，Task 1.2 建立统一内部身份，Task 1.3 启用本地 Auth 与网页登录，Task 1.4 增加工作空间成员权限和邀请激活闭环。本地配置启用数据库、Data API、Auth、Edge Runtime 与 Inbucket 邮件捕获；Studio、Realtime、Storage 和 Analytics 仍保持关闭。所有工作空间授权仍以 `current_app_user_id()` 解析出的 `app_users.id` 为边界。Task 1.4 审计修复新增 `20260802110000_workspace_audit_hardening.sql`：数据库强制唯一 owner（部分唯一索引 + 语句级约束触发器）、服务端邀请 TTL（`workspace_invitation_ttl_seconds()`，与 Auth OTP 对齐）、`prepare_workspace_invitation()` 移除浏览器可传入的过期参数并原子关闭过期开放邀请，以及成员目录对缺失 profile 的安全 LEFT JOIN 回退。第二轮修复新增 `20260803120000_workspace_invitation_reissue_status.sql` 与 `20260803120100_workspace_invitation_reissue.sql`：`reissue_prepared` 邀请状态与 `reissue_of_invitation_id` 关联、`prepare_workspace_invitation()` 返回 `operation_kind`（`new_auth_user_invite` / `existing_invitee_reissue`）、服务专用 `finalize_workspace_invitation_reissue()`（已在第四轮移除）、锁后 `clock_timestamp()` 时间语义，以及成员目录 `pending_invitation` 标记。第三轮修复新增 `20260803130000_workspace_invitation_reissue_lineage.sql`：failed reissue 的 lineage 保持（`existing_invitee_reissue` 永不退回普通 `prepared`，`temporary_failure` / `auth_invite_failed` 可恢复，`auth_user_conflict` 稳定冲突）。第四轮修复新增 `20260803140000_workspace_auth_invitation_confirmation.sql`：移除旧 `finalize_workspace_invitation_reissue()`，统一由 `confirm_workspace_auth_invitation_result(invitation_id, operation_kind, provider_tenant, provider_subject)` 作为 **Auth Admin 成功后的唯一数据库确认边界**——所有 operation kind 都必须经它确认后才算业务成功。第五轮修复新增 `20260803150000_stable_invitation_conflict_confirmation.sql`：`auth_user_conflict` 对同一幂等键与全新幂等键都是持久稳定冲突（空 invitee 的行同样被守卫，绝不重新创建邀请、不调用 Auth Admin、不发信），且 confirmation 的 operation kind 与持久化行结构严格绑定（NULL / 空白 / 未知 kind → `22023`，new-auth 行必须 `reissue_of_invitation_id IS NULL`，reissue 行必须带 `reissue_of_invitation_id` 与 `invitee_user_id`）。

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
npm run db:membership:verify
npm run db:verify
```

`db:verify` 会依次重建本地数据库、执行 pgTAP、运行 Task 2.2 多连接 PostgreSQL 并发验证、以 warning 为失败门槛运行数据库 lint，并检查已提交类型是否与本地 migration 漂移。并发脚本只创建随机虚构本地夹具，不连接远端。

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
deno check supabase/functions/invite-workspace-member/index.ts
```

`test:edge` 明确运行两个文件：`handler.test.ts`（处理器行为）与 `entry.test.ts`（真实入口接线，使用假客户端：caller client 只用 publishable key 和调用者 Authorization，admin client 只持有服务端 secret，provider tenant 不可由浏览器伪造，失败补偿与统一确认走 admin client，环境值不进入日志或响应）。CI 的 Edge Function workflow 安装固定版本 Deno（`denoland/setup-deno@v2`，`deno-version: 2.2.12`，与 Supabase Edge Runtime 的 Deno 2 约束兼容）并对真实 `index.ts` 执行 `deno check`，覆盖 npm: Supabase SDK 导入、环境变量读取、handler 接线与 Deno 类型；workflow 权限保持 `contents: read`。

函数入口只接受受控来源的 `POST`，使用调用者 Bearer token 调用 `auth.getUser(token)`，再把同一 Authorization 交给低权限客户端执行 `prepare_workspace_invitation`。数据库完成最终角色授权与幂等准备后返回 `operation_kind`：`new_auth_user_invite` 走 `auth.users` AFTER INSERT trigger 预配置（trigger 完成后邀请进入 `sent` 且带 invitee）；`existing_invitee_reissue` 由服务端管理客户端调用 Auth Admin `inviteUserByEmail` 对同一未确认用户重发（不产生第二个 Auth 用户，也不触发 trigger）。**Auth Admin 成功不等于业务邀请成功**：无论哪种 operation kind，Edge Function 在 Auth Admin 返回成功后都必须调用服务专用 `confirm_workspace_auth_invitation_result`，由数据库确认邀请已进入与其 kind 相符的合法状态（trigger 预配置完成 / reissue 身份与 source 校验通过），确认返回 `sent` 才对外报告 `invitation_sent`；确认返回 `failed` 时映射稳定 409，数据库临时故障映射 503。Auth Admin 失败或确认失败时只通过服务端专用 RPC 写入允许列表中的失败分类；函数响应与日志不包含邮箱全文、JWT、邀请链接、Auth 原始错误或密钥。

邀请有效期完全由数据库服务端计算（`workspace_invitation_ttl_seconds()`，当前 3600 秒，与 `[auth] otp_expiry = 3600` 对齐）；RPC 不接受浏览器传入的过期时间。Edge Function 通过 `APP_INVITE_TTL_SECONDS` 做部署期校验：默认 3600，设置为安全上下限（300–86400 秒）之外、非整数或与 3600 不一致的值时拒绝启动。**托管 Supabase 的 Email OTP Expiration 必须与业务邀请 TTL 同步配置**，任何调整必须同时修改 Auth `otp_expiry`、数据库函数与 Edge 默认值并重新验证。

同一工作空间的邀请准备（过期恢复 / 重发判定、幂等重读、新邀请创建）在同一事务与工作空间行锁边界内完成，且 `clock_timestamp()` 只在**获得行锁之后**读取——过期判断、`revoked_at` 与新邀请 `expires_at` 使用同一锁后时间点，并发请求在锁等待跨越过期点后仍能正确关闭旧邀请并让新邀请获得完整 TTL；唯一冲突后会重读幂等键并返回既有邀请（payload 一致）或明确冲突。过期 `prepared` 邀请在下一次同摘要准备请求中关闭为 `revoked` 并走普通新用户邀请；过期 `sent`（或 `reissue_prepared`）邀请且 invitee 仍然有效时走**重发路径**（关闭旧邀请为 `revoked`，创建保留原 `invitee_user_id` 并关联 `reissue_of_invitation_id` 的 `reissue_prepared` 邀请，由 Edge Function 重发邮件后经统一 `confirm_workspace_auth_invitation_result` 确认并推进为 `sent`）；invitee 已停用 / 合并 / 身份撤销时拒绝（`workspace_invitation_invitee_invalid`）；`accepted` / `failed` / `revoked` 与未过期邀请不会被修改。**`auth_user_conflict` 是持久稳定冲突**：同一工作空间与邮箱摘要下存在 `failed`/`auth_user_conflict` 行（无论是否带内部 invitee）时，同一幂等键与全新幂等键都返回固定 `workspace_invitation_auth_user_conflict`，不创建新邀请、不调用 Auth Admin、不发信、不改历史；只有受控账号绑定或运维处理才能解除（本任务不实现）。`temporary_failure` / `auth_invite_failed` 等可恢复失败仍允许新键恢复。

真实本地 Auth 集成验证可重复执行（`npm run db:reissue:verify`，已加入 Database CI，前置见 `scripts/verify-invitation-reissue.mjs` 头部注释）：首次邀请产生一个 Auth 用户与一套业务身份；过期后重发复用同一 Auth 用户、同一 `app_user` / `user_identities` / `workspace_members`，发送第二封邮件，统一确认后新邀请出现在 pending 列表并可接受激活原 membership，旧邀请不能接受；**跨工作空间场景**验证同一未确认邮箱在另一工作空间首次邀请时 Auth 复用既有用户、确认 RPC 把新邀请安全补偿为 `failed`/`auth_user_conflict`，随后同一幂等键与全新幂等键的重试都稳定冲突且**不再发送邮件、不创建新邀请行**；**recoverable failed 完整真实重发**打开 recovery 邮件链接建立真实 Supabase session、断言 session user ID 等于原 Auth 用户，并用该 session 接受 recovery 邀请激活原 membership。输出不含链接、token、邮箱或密钥。

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
