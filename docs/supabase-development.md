# Supabase 本地开发

## 开发原则

本项目采用 local-first migration：数据库结构先以版本化 SQL migration 在本地从空库重建、测试和生成类型，再进入远端审计与后续部署流程。这样可以让结构变更可复现、可审阅，并让前端使用与 migration 同源的 TypeScript 类型。

Task 2.1 在既有统一身份与工作空间权限边界上增加项目 CRUD、关系可见性、乐观并发与不可逆归档。Task 2.2 增加项目 owner/lead 一致性、成员可信 RPC、完整权限矩阵和真实多连接并发验证。Task 2.3 增加平级有序模块、可选运维预设、受控软删除和模块锁竞争验证。Task 3.1–3.5 已完成项目任务主表、安全列表、受控状态机、每日进展和验收闭环并正式封板。数据模型、最小授权和页面边界见 [项目 CRUD、可见性与归档 V1](project-crud-and-visibility.md)、[项目成员与牵头人 V1](project-membership-and-lead.md)、[项目工作模块 V1](project-modules.md)、[任务数据模型与创建编辑 V1](task-data-model-and-editing.md)、[任务看板和列表 V1](task-board-and-list.md)、[任务状态流转与阻塞 V1](task-status-transitions.md)、[每日任务进展与进度同步 V1](task-daily-progress.md) 与 [任务提交验收、通过与退回 V1](task-review-closure.md)。

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
npm run db:modules:verify
npm run db:tasks:verify
npm run db:verify
```

`db:verify` 会依次重建本地数据库、执行 pgTAP、运行 Task 2.2 成员并发验证、Task 2.3 模块并发验证与 Task 3.1/3.3 任务并发验证、以 warning 为失败门槛运行数据库 lint，并检查已提交类型是否与本地 migration 漂移。并发脚本只创建随机虚构本地夹具，不连接远端，输出不含 DB URL、JWT 或密钥。

Task 2.2 的成员写 RPC 通过内部 `public.lock_membership_participants(p_project_id, p_participant_ids)`（`SECURITY DEFINER`、固定空 `search_path`、不授予 API 角色执行权）统一消除跨表 TOCTOU：每个 RPC 先锁定 `projects` 行，再按「`app_users` 按 id → `workspace_members` 按 user_id（项目所在工作空间）」的稳定顺序锁定 actor 与参与方，最后在锁内重新校验 actor 仍为 active 工作空间成员与 active app user（否则 `42501`）。持锁至事务结束，使并发撤销 / 停用 / 转让在单一锁边界上线性化。`list_project_members` 同时返回 `active_member_count` 与 `inactive_historical_member_count` 两个窗口计数，区分当前在用与停用历史成员。

具体 RPC 锁边界、锁顺序、当前 vs 归档历史职责、并发撤销线性化与计数语义见 [项目成员与牵头人 V1](project-membership-and-lead.md)。当前并发验证共 38 项：3 项 stale 读后写竞争（均显式校验第二事务被第一事务持有的项目行锁阻塞），以及 35 项真实行锁竞争（lead 任命 vs 工作空间停用、owner 转让 vs app user 停用、admin 降级 vs 普通成员写，均验证两种顺序，并用独立 observer 连接通过 `pg_blocking_pids()` 显式证明第二事务被第一事务锁阻塞，校验赛后每个项目仍恰好一个 owner、至多一个 lead）。

Task 2.3 的模块写 RPC 统一调用内部 `lock_project_for_module_write(project_id)`：先锁 `projects`，再复用 Task 2.2 的 actor 身份锁，最后按模块 id 锁行并在锁内重查权限与归档状态。项目创建另由内部 `lock_workspace_project_creator(workspace_id)` 按 `workspaces → actor app_users → actor workspace_members` 加锁，再复用 `can_manage_workspace_projects()` 重新鉴权；因此 admin 在等待期间被降为 member 后以 `42501` 失败，且不会留下任何项目、成员或预设模块。模块并发脚本共 28 项断言，覆盖该项目创建撤权竞态、并发新增、并发完整重排、删除 vs 排序、等待期间 lead 降级、等待期间项目归档及跨项目 ID 隔离；每个竞争都由 observer 通过 `pg_blocking_pids()` 证明真实阻塞。完整设计与 Task 3.1 外键契约见 [项目工作模块 V1](project-modules.md)。

Task 3.1 的创建 / 编辑 RPC 使用 `projects → app_users（按 id）→ workspace_members（按 user_id）→ project_members（按 user_id）→ project_modules → tasks` 的稳定锁顺序。锁建立后重新校验 actor、所有任务人员、模块、项目归档状态和任务版本；关系集合替换与主任务更新在同一事务中完成。`scripts/verify-task-concurrency.mjs` 用真实独立连接和 observer 验证 actor 撤权、负责人移出 / 停用、模块删除、项目归档、并发编辑及协作人完整集合替换。详细可见性、RLS、幂等与乐观并发契约见 [任务数据模型与创建编辑 V1](task-data-model-and-editing.md)。

Task 3.3 的状态 RPC 继续采用同一项目优先锁顺序，并在 task 写锁后追加 history。数据库自行决定 from/to 状态和每 task 单调 `transition_seq`；`(actor_id, idempotency_key)` 让相同意图安全 replay，让不同 task/action/block reason 的 key 复用稳定冲突。任务状态、current blocker、更新审计和 history 在一个事务中提交；归档项目 mutation 全部拒绝。任务并发脚本扩展到 43 项，新增同/不同 key start、block vs cancel、resume vs cancel、metadata vs transition 与 archive vs transition，所有竞争都由 observer 的 `pg_blocking_pids()` 证明真实等待。完整状态机、terminal lifecycle、RLS 和前端边界见 [任务状态流转与阻塞 V1](task-status-transitions.md)。

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

## Trial 远端连接与部署边界

Task 3.9.1 只建立可重复的部署基线，不登录、不链接或修改任何远端项目。完整环境模型、显式 Trial target gate、CLI 2.110.0 的 `link` / `migration list --linked` / `db push --dry-run --linked` 流程、Edge Function 部署、版本追溯、回滚与备份边界见 [试运行部署基线与环境门禁 V1](trial-deployment.md)。

本仓库实际锁定的是 Supabase CLI `2.110.0` stable channel。该稳定包使用 legacy shell：`supabase link` 的 checkout-local authoritative ref 是 `supabase/.temp/project-ref`，linked commands 还会优先读取 `SUPABASE_PROJECT_ID`，因此 post-link gate 同时要求 ref 文件、环境覆盖值（若存在）与显式 Trial ref 一致。`SUPABASE_WORKDIR` 会重定向 CLI 使用的 checkout 与 linked-state 来源，必须未设置或为空。stable/legacy profile 按非默认 `--profile`、非空 `SUPABASE_PROFILE`、用户级持久化 `~/.supabase/profile`、内建 `supabase` 的顺序解析；当前 Trial contract 要求显式设置 `SUPABASE_PROFILE=supabase`，以阻断持久化 profile fallback，未设置、空值或任何其他值均 fail closed。这里的 `supabase` 只指 CLI 内建 API/control-plane profile，不代表 Production 项目；项目脚本不读取、不删除或修改用户级 `~/.supabase/profile`。`.supabase/project.json` 是同版本 next/alpha shell 的不同状态模型，不作为 stable linked-state 或 fallback；目录仍由 `.gitignore` 忽略，防止本地工具状态进入仓库。CLI 版本或 channel 变化时必须重新审计，不能猜测或自动迁移状态路径。

真实 Trial 创建和部署属于 Task 3.9.2，必须由获授权人员在独立 Supabase/Vercel Trial 中执行；真实账号 Smoke/E2E 属于 Task 3.9.3。`db:reset`、pgTAP seed、真实并发夹具和 `db:verify` 只用于本地环境，绝不能指向 Trial 或 Production。任何远端 mutation 前必须重新核对 target gate、备份状态、dry-run 和准确 Git SHA。

Production 只在本轮定义边界，不创建、不链接、不部署。不得对任何远端数据库运行 `db reset`、drop、自动 restore 或其他破坏性重建命令。
