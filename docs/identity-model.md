# 统一系统用户与多身份数据模型

> Task 1.2 交付内容。本模型在登录页面、Web 登录或微信小程序登录之前建立，明确区分内部业务用户、Supabase Auth 用户、微信 OpenID / UnionID 等外部主体与一次性绑定挑战。它只定义数据模型、解析边界、RLS 与权限矩阵，**不包含任何登录页面、受保护路由或真实的绑定 / 认证 / 微信 / CloudBase 流程**。

## 目标

在引入任何认证 UI 之前，先把"谁是谁"这件事收敛到一个可信的边界：

- 业务表只允许引用 `app_users.id`（内部业务用户主键）；
- 绝不引用外部 ID（Supabase Auth UUID、微信 OpenID 等），也绝不接受客户端传入的 `user_id` 或 subject；
- 外部主体到内部用户的映射集中在唯一一处解析函数，便于审计与替换。

## 数据模型

四个表，全部位于 `public` schema，全部启用 RLS。

| 表                            | 角色             | 关键约束                                                                                                                                                                |
| ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_users`                   | 内部业务用户主体 | 受控状态枚举 `app_user_status`；`merged_into_user_id` 自引用 `RESTRICT`；状态与 `disabled_at` 一致性 CHECK；`status='merged'` 当且仅当 `merged_into_user_id` 非空       |
| `profiles`                    | 公开档案，一对一 | `user_id` 为主键且引用 `app_users` `CASCADE`；`display_name` 非空且 ≤120；`contact_info` 必须为 JSON 对象                                                               |
| `user_identities`             | 外部身份绑定     | `(provider, provider_tenant, provider_subject)` 非部分唯一约束（撤销后仍占位，防止被重新绑定）；`revoked_at` 撤销时间；引用 `app_users` `CASCADE`                       |
| `identity_binding_challenges` | 一次性绑定挑战   | 仅存 `challenge_hash`（服务端 SHA-256 摘要），**不存原始 code / token / secret**；`created_by` 引用 `app_users` `RESTRICT`；`target_user_id` 引用 `app_users` `CASCADE` |

受控枚举：

- `public.app_user_status`：`invited` | `active` | `suspended` | `merged`
- `public.identity_provider`：`supabase_auth` | `wechat_miniprogram` | `enterprise_wechat`

`user_identities` 的唯一约束是**非部分（non-partial）**的：即使某行被撤销（`revoked_at` 非空），该行仍然占位，因此同一个 `(provider, tenant, subject)` 不能被另一个用户重新绑定——这正是"撤销后不可冒用"的硬性保证。

## 统一身份边界

解析集中在两个 `SECURITY DEFINER`、属主为 `postgres` 的函数，**绕过 `app_users` / `user_identities` 的 RLS**，从而避免策略自身调用边界函数导致的递归：

- `resolve_app_user_id(provider, tenant, subject) -> uuid | null`
  仅由 `service_role` 执行。按 `(provider, tenant, subject)` 查找未撤销且所属用户状态为 `active` 的内部用户 id，否则返回 null。**这是外部 subject 转换为业务 key 的唯一入口。**
- `current_app_user_id() -> uuid | null`
  由 `authenticated` 与 `service_role` 执行。读取已验证 JWT 的 `request.jwt.claims` GUC（`sub` 作为 subject，`iss` 作为 tenant），经 `resolve_app_user_id('supabase_auth', iss, sub)` 解析。以下情况一律返回 null：缺少 `sub` / `iss`、身份未绑定、已撤销、用户处于 `invited` / `suspended` / `merged`。它**永不接受客户端传入的 user id 或 subject**。

> 实现直接读取 `request.jwt.claims` GUC（与 `auth.uid()` / `auth.jwt()` 内部行为一致，且 PostgREST 会在每个请求上设置该 GUC），因此边界不依赖 `auth` schema 的具体辅助函数。

## 行级安全（RLS）

默认拒绝，按角色逐项开放：

- `app_users`：`authenticated` 仅能 `SELECT` `id = current_app_user_id()` 的自身记录。
- `profiles`：`authenticated` 仅能 `SELECT` / `UPDATE` 自身档案；`user_id` 列被排除在 `UPDATE` 授权之外，并由 `WITH CHECK` 二次校验，因此无法改成他人以冒用身份。
- `user_identities` 与 `identity_binding_challenges`：**不向 `anon` / `authenticated` 开放任何策略**，直接客户端访问同时被 RLS（无策略）和显式权限撤销拒绝，必须经由服务端逻辑（`service_role`）访问。

## 权限矩阵（显式、默认拒绝）

| 对象                          | anon | authenticated          | service_role |
| ----------------------------- | ---- | ---------------------- | ------------ |
| `app_users`                   | 无   | SELECT                 | ALL          |
| `profiles`                    | 无   | SELECT + 受限列 UPDATE | ALL          |
| `user_identities`             | 无   | 无                     | ALL          |
| `identity_binding_challenges` | 无   | 无                     | ALL          |
| `resolve_app_user_id()`       | 无   | 无                     | EXECUTE      |
| `current_app_user_id()`       | 无   | EXECUTE                | EXECUTE      |

`service_role` 绕过 RLS，保留对管理 / 测试路径的完整控制。`public`（即未认证调用方）对上述函数均无执行权限。

## 测试

- `supabase/tests/database/identity_schema_constraints.test.sql`（`plan(33)`）：表 / 枚举存在性、主键、外键删除策略（`RESTRICT` vs `CASCADE`）、`set_updated_at` 触发器生效、唯一约束、`user_identities` 非空校验、状态组合一致性、`identity_binding_challenges` 不含原始 secret 列及各项约束。
- `supabase/tests/database/identity_resolution_rls.test.sql`（`plan(32)`）：身份唯一性、JWT 解析（含未绑定 / 撤销 / invited / suspended / merged / 缺 issuer / 缺 subject / 不串用户）、RLS 真实拒绝（A 读自己不读 B、不能改 B 档案、不能改自身 `user_id`、anon / authenticated 无权访问身份表、suspended / revoked 无访问）、函数权限矩阵（真实角色切换 + `has_function_privilege`）。
- 前端夹具 `src/features/identity/fixtures.ts` 与 `src/tests/identity-fixtures.test.ts`：使用生成的 `TablesInsert` / `TablesRow` 类型，校验夹具符合枚举、UUID、状态 / `disabled_at` 一致性、唯一性、64 位 `challenge_hash`、引用完整性，并断言不含真实数据（微信 AppID 使用 `wx_fictional` 前缀、不含邮箱 / 手机号形态）。

所有夹具均为虚构数据：无真实 AppID、OpenID、手机号、JWT、绑定码或密钥；UUID 与 issuer / appid 均带 `fictional` 标记。

## 明确未实现

本任务只落地数据模型与安全边界。以下能力**不在**本任务范围，只能在未来明确授权的任务中引入：

- 登录页面、受保护路由、会话持久化；
- 真实的绑定 / 认证 / 微信小程序 / CloudBase 流程；
- 工作空间、项目、任务、提醒等业务表；
- 远端 Supabase 推送、生产 Vercel 配置、PR 创建或 main 合并（由远端独立审计与授权人员执行）。
