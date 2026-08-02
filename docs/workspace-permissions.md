# 工作空间与成员权限 V1

## 目标与身份边界

Task 1.4 为系统增加最上层组织边界。所有业务外键继续引用内部 `app_users.id`；Supabase Auth UUID、JWT `sub`、邮箱和客户端提交的用户 ID 都不是业务主键。浏览器身份只能通过 `current_app_user_id()` 解析为活动内部用户。

## 数据模型

- `workspaces`：工作空间名称、当前 owner、创建者、受控 bootstrap 幂等键和时间戳。owner / 创建者均为 `app_users.id`，删除策略为 `RESTRICT`。
- `workspace_members`：工作空间与内部用户的唯一成员关系，保存角色、成员状态、邀请人、加入 / 停用时间。关键键、创建时间和邀请人不可修改，成员关系不可物理删除。
- `workspace_invitations`：邀请状态、目标角色、邮箱 SHA-256 摘要、遮罩提示、显示名称、邀请人、受邀内部用户、幂等键、过期时间和安全失败分类。普通客户端无原始表权限，邀请历史不可物理删除。

工作空间创建必须在同一事务内建立 `role='owner'`、`status='active'` 的 owner 成员行；延迟约束 trigger 在事务结束前检查该不变量。owner 成员始终 active，普通成员停用只改变 `workspace_members.status`，不会把全局 `app_users.status` 改为 suspended。

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

所有边界函数均为 `SECURITY DEFINER`、封闭 `search_path`、显式 schema 限定、静态错误文本和最小 EXECUTE 授权。成员目录仅返回显示名称、单位 / 职位、头像、角色、状态及成员时间，不返回邮箱、`contact_info`、身份 subject、JWT 或 Auth 管理数据。

## 默认工作空间初始化

默认工作空间只能由受信任服务以稳定幂等键调用 `bootstrap_default_workspace` 创建。目标 owner 必须是有效内部用户；函数原子创建工作空间及 owner membership。相同目标重试返回已有 ID，冲突目标拒绝。`anon`、`authenticated` 和浏览器均无执行权，前端无 active workspace 时只显示安全空状态。

## 邀请与首次激活数据流

1. owner/admin 在成员页提交工作空间、邮箱、显示名称、允许角色和浏览器生成的 UUID 幂等键。
2. Edge Function 校验 Origin、方法、Bearer 会话和字段；邮箱先规范化，再计算 SHA-256 和遮罩提示。
3. 携带调用者 Authorization 的低权限客户端调用 `prepare_workspace_invitation`；数据库通过 `current_app_user_id()` 校验角色、冲突和幂等性。
4. 仅在数据库返回 `should_send=true` 时，服务端管理客户端调用 Auth Admin `inviteUserByEmail`。请求 metadata 只包含邀请 ID 和服务端确定的 tenant，不携带角色、工作空间或显示名称等业务事实。托管环境从可信 Supabase URL 推导 tenant；本地容器地址不等于 JWT issuer 时，只能在官方 `auth.getUser` 已验证 token、issuer `sub` 与用户一致且 issuer 为 loopback `/auth/v1` 后采用该 issuer。
5. `auth.users` AFTER INSERT trigger 锁定 prepared 邀请，对 Auth 邮箱做相同规范化和 SHA-256 比对，并从邀请行读取业务值；随后原子创建 `app_users`、`profiles`、已验证 `user_identities` 和 invited membership，把邀请标为 sent。任一步失败会回滚 Auth 用户插入。
6. 受邀者通过受控 `/activate-account` 路由建立 Supabase 会话。页面显示工作空间、角色和到期时间的安全摘要。
7. 页面先设置首个密码，再调用 `accept_workspace_invitation`。数据库校验邀请属于当前内部用户、已发送且有效，原子激活 membership 并接受邀请；重复接受返回稳定成功结果。
8. 两步都成功后页面执行 local scope 退出并回到登录页。若密码成功但接受失败，页面保留会话并只重试接受步骤，不重复设置密码。
9. Auth Admin 调用失败时，Edge Function 通过服务端专用函数将邀请标为 failed，只保存允许列表分类，不保存原始错误。

## 幂等与邮箱最小化

邀请请求必须携带 UUID 幂等键。相同调用者、工作空间、邮箱摘要、显示名称和角色重试返回已有邀请；同一键携带不同目标会拒绝。同一工作空间与邮箱摘要只允许一条 open（prepared / sent）邀请，因此网络重试不会重复发信或创建成员。

业务数据库不保存明文邮箱、邀请链接、OTP、token 或密码。`email_hash` 是 64 位小写十六进制 SHA-256，`email_hint` 只用于安全识别。明文邮箱只在单次 Edge Function 请求内用于 Auth Admin 调用，不写日志或响应。

## 已知限制与后续边界

- 当前 Supabase `inviteUserByEmail` 不支持 PKCE；邀请邮件不能宣称为 PKCE 流程。密码恢复仍使用 PKCE。本地真实邮件验证确认邀请使用隐式 session fragment 进入 `/activate-account`，再由页面执行密码设置和业务邀请接受；远端邮件模板、允许重定向域名和实际邮件客户端必须在部署任务中重新验证。
- V1 不处理已有确认 Auth 用户按邮箱跨工作空间自动加入；若 Auth Admin 报冲突，返回安全邀请冲突 / 临时失败，不在浏览器查询 Auth 用户。
- 邀请发送采用 at-most-once 幂等边界：只有首次创建 prepared 记录的请求获得发送权，并发 / 同键重试不会二次发信。若进程在 prepared 提交后、Auth Admin 调用前终止，记录可能保持 prepared；V1 不含运营恢复、撤销或重发界面，需要后续受控运维流程处理。
- 不实现项目 / 项目角色 / 模块、任务 / 进展 / 验收 / 提醒、所有权转移、工作空间删除、成员永久删除、批量邀请、完整撤销 / 重发 UI、公开注册、第三方登录、通用审计日志、生产 SMTP 或远端部署。

## 本地验证

```bash
npm ci
npm run security:audit
npm run check
npm run db:start
npm run db:verify
npm run test:edge
git diff --check
```

`db:verify` 从空库重建 migration，执行 pgTAP、数据库 lint 和生成类型漂移检查。`test:edge` 执行真实 Request / Response 处理器测试，覆盖认证依赖、数据库准备、Auth Admin 调用、幂等短路和失败补偿。纯测试夹具使用 `.invalid`；本地 Auth 会拒绝该保留域，因此 Inbucket 真实邮件闭环使用明显虚构的 `example.com` 地址，且不得复制邮件中的链接或 token。
