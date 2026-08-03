# 工作空间与成员权限 V1

## 目标与身份边界

Task 1.4 为系统增加最上层组织边界。所有业务外键继续引用内部 `app_users.id`；Supabase Auth UUID、JWT `sub`、邮箱和客户端提交的用户 ID 都不是业务主键。浏览器身份只能通过 `current_app_user_id()` 解析为活动内部用户。

## 数据模型

- `workspaces`：工作空间名称、当前 owner、创建者、受控 bootstrap 幂等键和时间戳。owner / 创建者均为 `app_users.id`，删除策略为 `RESTRICT`。
- `workspace_members`：工作空间与内部用户的唯一成员关系，保存角色、成员状态、邀请人、加入 / 停用时间。关键键、创建时间和邀请人不可修改，成员关系不可物理删除。
- `workspace_invitations`：邀请状态、目标角色、邮箱 SHA-256 摘要、遮罩提示、显示名称、邀请人、受邀内部用户、幂等键、过期时间和安全失败分类。普通客户端无原始表权限，邀请历史不可物理删除。

工作空间创建必须在同一事务内建立 `role='owner'`、`status='active'` 的 owner 成员行；延迟约束 trigger 在事务结束前检查该不变量。owner 成员始终 active，普通成员停用只改变 `workspace_members.status`，不会把全局 `app_users.status` 改为 suspended。

### 唯一 owner 不变量（数据库强制）

每个工作空间在数据库层同时满足：

1. `workspace_members(workspace_id)` 上存在 `where role = 'owner'` 的部分唯一索引，任何写入路径（直接 SQL、`service_role`、未来 RPC 或 migration）都只能产生一条 owner 成员。
2. 约束触发器在语句级立即验证：任何 `role='owner'` 成员行的 `user_id` 必须等于对应 `workspaces.owner_id`，不一致即拒绝（`workspace_owner_membership_mismatch`）。
3. owner 状态必须始终为 active（表 CHECK `workspace_members_owner_active` 与不可变触发器共同保证）。
4. 普通成员无法通过角色变更升级为 owner；owner 行的角色与状态不可变（`workspace_owner_immutable`）。所有权转移不在 V1 范围，因此不存在合法的"新 owner 行"写入路径，伪造 owner 行无法提升任何权限辅助函数的结果。

## 角色权限矩阵

| 能力                                | owner                | admin | member | external collaborator |
| ----------------------------------- | -------------------- | ----- | ------ | --------------------- |
| 读取当前工作空间和安全成员目录      | 是                   | 是    | 是     | 是                    |
| 邀请 admin                          | 是                   | 否    | 否     | 否                    |
| 邀请 member / external collaborator | 是                   | 是    | 否     | 否                    |
| 调整 admin 角色或状态               | 是（不能触碰 owner） | 否    | 否     | 否                    |
| 调整 member / external collaborator | 是                   | 是    | 否     | 否                    |
| 提升为 owner / 转移所有权           | 否                   | 否    | 否     | 否                    |
| 读取其他工作空间                    | 否                   | 否    | 否     | 否                    |

前端只按角色隐藏不可用入口，数据库函数才是最终授权边界。owner 不能通过普通成员接口降级、停用或移除；admin 不能邀请或管理 admin，也不能把任何人提升为 owner/admin。

## 状态机

成员状态：

- `invited`：Auth 预配置完成但尚未接受，只能读取自己的有效邀请摘要；不得伪造 `joined_at`。
- `active`：可以按角色访问工作空间，必须有 `joined_at`。
- `suspended`：立即失去该工作空间访问权限，必须有 `disabled_at`；不影响其在其他工作空间的关系和全局账号。

邀请状态：

```text
prepared -> sent -> accepted
    |         |
    +-------> failed
    +-------> revoked
```

状态只能按 migration 中允许的方向前进，不能回退；过期由 `expires_at` 判定。V1 不提供撤销 / 重发产品界面，但数据模型保留对应终态。

### 过期邀请自动关闭与重新邀请

业务邀请有效期由受信任服务端配置决定（见下文 TTL），`expires_at` 只能由数据库计算，浏览器不能传入。当同一工作空间与邮箱摘要下存在**已过期**的 `prepared` 或 `sent` 邀请时，`prepare_workspace_invitation()` 会在同一事务与锁边界内把它们原子关闭为 `revoked`（写入 `revoked_at`），随后允许新的幂等键创建并发送新邀请。`accepted`、`failed`、`revoked` 以及尚未过期的邀请绝不会被该流程修改；尚未过期的开放邀请仍会阻止同摘要的新邀请（普通邀请冲突）。

### 过期邀请自动关闭与重新邀请

业务邀请有效期由受信任服务端配置决定（见下文 TTL），`expires_at` 只能由数据库计算，浏览器不能传入。当同一工作空间与邮箱摘要下存在**已过期**的 `prepared` 或 `sent` 邀请时，`prepare_workspace_invitation()` 会在同一事务与锁边界内把它们原子关闭为 `revoked`（写入 `revoked_at`），随后允许新的幂等键创建并发送新邀请。`accepted`、`failed`、`revoked` 以及尚未过期的邀请绝不会被该流程修改；尚未过期的开放邀请仍会阻止同摘要的新邀请（普通邀请冲突）。

## RLS、RPC 与最小授权

核心表全部启用 RLS并默认拒绝。活动成员只能通过工作空间 RLS 读取自己所属的 `workspaces`；成员和邀请原始表不向 `authenticated` / `service_role` 授予普通表访问。

浏览器可执行的安全 RPC：

- `list_my_workspaces()`
- `list_workspace_members(workspace_id)`
- `list_my_pending_workspace_invitations()`
- `set_workspace_member_role(...)`
- `set_workspace_member_status(...)`
- `prepare_workspace_invitation(...)`
- `accept_workspace_invitation(invitation_id)`

受信任服务专用 RPC：

- `bootstrap_default_workspace(...)`
- `mark_workspace_invitation_failed(...)`

所有边界函数均为 `SECURITY DEFINER`、封闭 `search_path`、显式 schema 限定、静态错误文本和最小 EXECUTE 授权。成员目录仅返回显示名称、单位 / 职位、头像、角色、状态及成员时间，不返回邮箱、`contact_info`、身份 subject、JWT 或 Auth 管理数据。目录使用安全 `LEFT JOIN`：`profiles` 行缺失的成员仍然出现，显示名称回退为固定文案"未设置显示名称"，`avatar_url` / `organization_name` / `title` 返回 null，排序保持不变；`profiles` 自身的 RLS 不做任何放宽。

## 默认工作空间初始化

默认工作空间只能由受信任服务以稳定幂等键调用 `bootstrap_default_workspace` 创建。目标 owner 必须是有效内部用户；函数原子创建工作空间及 owner membership。相同目标重试返回已有 ID，冲突目标拒绝。`anon`、`authenticated` 和浏览器均无执行权，前端无 active workspace 时只显示安全空状态。

## 邀请与首次激活数据流

1. owner/admin 在成员页提交工作空间、邮箱、显示名称、允许角色和浏览器生成的 UUID 幂等键。
2. Edge Function 校验 Origin、方法、Bearer 会话和字段；邮箱先规范化，再计算 SHA-256 和遮罩提示。邀请有效期由数据库按服务端 TTL 计算，Edge Function 与浏览器都不参与。
3. 携带调用者 Authorization 的低权限客户端调用 `prepare_workspace_invitation`；数据库通过 `current_app_user_id()` 校验角色、冲突和幂等性，并在同一事务锁内先关闭同摘要的过期开放邀请。
4. 仅在数据库返回 `should_send=true` 时，服务端管理客户端调用 Auth Admin `inviteUserByEmail`。请求 metadata 只包含邀请 ID 和服务端确定的 tenant，不携带角色、工作空间或显示名称等业务事实。托管环境从可信 Supabase URL 推导 tenant；本地容器地址不等于 JWT issuer 时，只能在官方 `auth.getUser` 已验证 token、issuer `sub` 与用户一致且 issuer 为 loopback `/auth/v1` 后采用该 issuer。
5. `auth.users` AFTER INSERT trigger 锁定 prepared 邀请，对 Auth 邮箱做相同规范化和 SHA-256 比对，并从邀请行读取业务值；随后原子创建 `app_users`、`profiles`、已验证 `user_identities` 和 invited membership，把邀请标为 sent。任一步失败会回滚 Auth 用户插入。
6. 受邀者通过受控 `/activate-account` 路由建立 Supabase 会话。页面显示工作空间、角色和到期时间的安全摘要。
7. 页面先设置首个密码，再调用 `accept_workspace_invitation`。数据库校验邀请属于当前内部用户、已发送且有效，原子激活 membership 并接受邀请；重复接受返回稳定成功结果。
8. 两步都成功后页面执行 local scope 退出并回到登录页。若密码成功但接受失败，页面保留会话并只重试接受步骤，不重复设置密码。
9. Auth Admin 调用失败时，Edge Function 通过服务端专用函数将邀请标为 failed，只保存允许列表分类，不保存原始错误。

### 首次激活的 USER_UPDATED 恢复语义

`setInitialPassword()` 成功后 Supabase 会产生 `USER_UPDATED` 事件，AuthProvider 会重新解析身份（期间受保护路由会短暂卸载激活页）。为避免"密码已设置"的本地状态丢失，AuthProvider 维护一个**激活专用阶段标记**：

- 标记只包含非敏感的布尔值，保存在受控 `sessionStorage`（`ops-auth-activation-password-set`），绝不保存密码、token 或邀请链接；它在 `USER_UPDATED` 重解析、React 重渲染、激活页卸载 / 重挂载和页面刷新后仍然有效。
- 只在密码更新**成功**后写入；失败不会误标记。
- 激活状态绑定当前认证会话：接受邀请成功并退出、显式退出、会话丢失、用户切换、新的普通登录（`SIGNED_IN`）、密码恢复会话（`PASSWORD_RECOVERY`）以及任何"会话已不存在"的原子清理都会清除它，因此不会跨用户残留。
- 阶段存在时激活页只允许重试 `accept_workspace_invitation()`，绝不再次要求或提交密码；接受成功后才执行 local scope 退出。该机制不关闭、也不弱化任何 `USER_UPDATED` 身份校验、auth epoch、登出、会话过期或停用账号保护。

## 幂等与邮箱最小化

邀请请求必须携带 UUID 幂等键。`prepare_workspace_invitation()` 在同一工作空间上建立显式事务锁，过期清理、幂等重读与新邀请创建共享同一锁边界，不存在并发窗口。相同调用者、工作空间、邮箱摘要、显示名称和角色重试返回已有邀请且 `should_send=false`；同一键携带不同目标返回 `workspace_invitation_idempotency_conflict`；唯一冲突后会重新读取 `(workspace_id, idempotency_key)` 再决定幂等成功或冲突。同一工作空间与邮箱摘要只允许一条 open（prepared / sent）邀请，因此网络重试不会重复发信或创建成员，也不会产生第二次 Auth Admin 调用。

业务数据库不保存明文邮箱、邀请链接、OTP、token 或密码。`email_hash` 是 64 位小写十六进制 SHA-256，`email_hint` 只用于安全识别。明文邮箱只在单次 Edge Function 请求内用于 Auth Admin 调用，不写日志或响应。

## 邀请有效期（TTL）配置

- 数据库配置函数 `workspace_invitation_ttl_seconds()` 是业务邀请有效期的唯一权威，当前固定为 **3600 秒**，与本地 Auth 的 Email OTP 到期时间（`supabase/config.toml` `[auth] otp_expiry = 3600`）严格对齐；`prepare_workspace_invitation()` 据此计算 `expires_at`，RPC 签名不含浏览器可传入的过期参数。
- Edge Function 通过 `APP_INVITE_TTL_SECONDS` 环境变量执行部署期一致性校验：未设置时默认 3600；设置为安全上下限（300–86400 秒）之外的数值、非整数或与 3600 不一致时**拒绝启动**，绝不静默使用超长值。
- **托管 Supabase 的 Email OTP Expiration 必须与业务邀请 TTL 同步配置**：任何一端调整 TTL 时，必须同时修改 Auth `otp_expiry`、数据库 `workspace_invitation_ttl_seconds()` 与 Edge Function 默认值并重新验证，否则邀请链接可能先于或晚于邮件令牌失效。

## 已知限制与后续边界

- 当前 Supabase `inviteUserByEmail` 不支持 PKCE；邀请邮件不能宣称为 PKCE 流程。密码恢复仍使用 PKCE。本地真实邮件验证确认邀请使用隐式 session fragment 进入 `/activate-account`，再由页面执行密码设置和业务邀请接受；远端邮件模板、允许重定向域名和实际邮件客户端必须在部署任务中重新验证。
- V1 不处理已有确认 Auth 用户按邮箱跨工作空间自动加入；若 Auth Admin 报冲突，返回安全邀请冲突 / 临时失败，不在浏览器查询 Auth 用户。
- 邀请发送采用 at-most-once 幂等边界：只有首次创建 prepared 记录的请求获得发送权，并发 / 同键重试不会二次发信。若进程在 prepared 提交后、Auth Admin 调用前终止，记录可能保持 prepared；V1 不含运营恢复、撤销或重发界面（过期邀请会在下一次同摘要准备请求中自动关闭为 revoked），需要后续受控运维流程处理。
- 本轮审计修复只恢复服务端能力：数据库唯一 owner 强制、TTL 配置与过期重邀、激活 `USER_UPDATED` 恢复、成员目录 profile 缺失回退、幂等并发加固与 Edge 真实入口 CI；仍然不包含完整撤销 / 重发产品界面、生产 SMTP 或任何远端部署。
- 不实现项目 / 项目角色 / 模块、任务 / 进展 / 验收 / 提醒、所有权转移、工作空间删除、成员永久删除、批量邀请、完整撤销 / 重发 UI、公开注册、第三方登录、通用审计日志、生产 SMTP 或远端部署。

## 本地验证

```bash
npm ci
npm run security:audit
npm run check
npm run db:start
npm run db:verify
npm run test:edge
deno check supabase/functions/invite-workspace-member/index.ts
git diff --check
```

`db:verify` 从空库重建 migration，执行 pgTAP、数据库 lint 和生成类型漂移检查。`test:edge` 执行真实 Request / Response 处理器测试，覆盖认证依赖、数据库准备、Auth Admin 调用、幂等短路和失败补偿；另有 `entry.test.ts` 用假客户端验证真实入口接线（publishable / secret 分离、调用者 Authorization 透传、provider tenant 不可伪造、补偿走 admin client、环境值不进日志），CI 同时用固定版本 Deno（2.2.12）对真实 `index.ts` 执行 `deno check`。纯测试夹具使用 `.invalid`；本地 Auth 会拒绝该保留域，因此 Inbucket 真实邮件闭环使用明显虚构的 `example.com` 地址，且不得复制邮件中的链接或 token。
