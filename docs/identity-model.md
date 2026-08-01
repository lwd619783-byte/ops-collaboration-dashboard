# 统一系统用户与多身份数据模型

> Task 1.2 交付内容（含远端审计加固）。本模型在登录页面、Web 登录或微信小程序登录之前建立，明确区分内部业务用户、Supabase Auth 用户、微信 OpenID / UnionID 等外部主体与一次性绑定挑战。它只定义数据模型、解析边界、RLS 与权限矩阵，**不包含任何登录页面、受保护路由或真实的绑定 / 认证 / 微信 / CloudBase 流程**。

## 目标

在引入任何认证 UI 之前，先把"谁是谁"这件事收敛到一个可信的边界：

- 业务表只允许引用 `app_users.id`（内部业务用户主键）；
- 绝不引用外部 ID（Supabase Auth UUID、微信 OpenID 等），也绝不接受客户端传入的 `user_id` 或 subject；
- 外部主体到内部用户的映射集中在唯一一处解析函数，便于审计与替换。

## 数据模型

四个表，全部位于 `public` schema，全部启用 RLS。

| 表                            | 角色             | 关键约束                                                                                                                                                                                                                    |
| ----------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_users`                   | 内部业务用户主体 | 受控状态枚举 `app_user_status`；`merged_into_user_id` 自引用 `RESTRICT`；状态与 `disabled_at` 一致性 CHECK；`status='merged'` 当且仅当 `merged_into_user_id` 非空                                                           |
| `profiles`                    | 公开档案，一对一 | `user_id` 为主键且引用 `app_users` `CASCADE`；`display_name` 非空且 ≤120；`contact_info` 必须为 JSON 对象                                                                                                                   |
| `user_identities`             | 外部身份绑定     | `(provider, provider_tenant, provider_subject)` **非部分**唯一约束；`user_id` 引用 `app_users` **`RESTRICT`**；`verified_at` / `revoked_at` / `last_used_at` 单向状态；绑定主体字段不可修改；行不可物理删除                 |
| `identity_binding_challenges` | 一次性绑定挑战   | 仅存 `challenge_hash`（**小写** SHA-256 hex，CHECK `^[0-9a-f]{64}$`），**不存原始 code / token / secret**；`created_by` 与 `target_user_id` 均引用 `app_users` **`RESTRICT`**（两个用户外键均不允许级联删除）；状态不可回退 |

受控枚举：

- `public.app_user_status`：`invited` | `active` | `suspended` | `merged`
- `public.identity_provider`：`supabase_auth` | `wechat_miniprogram` | `enterprise_wechat`

`user_identities` 是**只追加（append-only）**的：

- 唯一约束是**非部分（non-partial）**的：即使某行被撤销（`revoked_at` 非空），该行仍然占位，因此同一个 `(provider, tenant, subject)` 不能被另一个用户重新绑定——"撤销后不可冒用"由数据库层封死；
- `user_id` 外键为 `RESTRICT`：有身份历史的 `app_users` 不能被删除并级联清空身份；
- 绑定主体与归属字段（`id` / `user_id` / `provider` / `provider_tenant` / `provider_subject` / `created_at`）由触发器强制不可修改；
- 单向状态：`verified_at` 只能 `null → 时间`（设置一次）；`revoked_at` 只能 `null → 时间`（不可清空 / 改写）；`last_used_at` 不得倒退；`updated_at` 由 `set_updated_at` 维护；
- 行不可物理删除（双层：`service_role` 无 `DELETE` 授权 + `BEFORE DELETE` 触发器拒绝）。

`identity_binding_challenges` 同样是**只追加**的：

- **两个用户外键（`target_user_id`、`created_by`）均为 `RESTRICT`**：删除目标用户或创建人时不会级联删除挑战行——挑战是高风险状态记录，只能通过独立、单独审计的 migration 或运维流程清理，普通业务 API 无法删除（`BEFORE DELETE` 触发器拒绝 + `service_role` 无 `DELETE` 授权，级联删除同样无法完成）；
- **主键 `id` 不可修改**：连同 `challenge_hash` / `target_user_id` / `provider` / `provider_tenant` / `created_by` / `created_at` 由触发器强制不可变（不可重新换键、换 hash、换目标、换创建人）；
- 状态不可回退：`attempt_count` 只增不减；`consumed_at` 只能 `null → 时间`（不可清空 / 改写）；`expires_at` 不得延长（过期挑战不可复活）；`max_attempts` 创建后不得增加；`updated_at` 由 `set_updated_at` 维护。

## 统一身份边界

解析集中在两个 `SECURITY DEFINER`、属主为 `postgres` 的函数，**绕过 `app_users` / `user_identities` 的 RLS**，从而避免策略自身调用边界函数导致的递归：

- `resolve_app_user_id(p_provider, p_tenant, p_subject) -> uuid | null`
  参数使用 `p_` 前缀，避免与 SQL 函数体内同名表列互相遮蔽（曾导致 `where i.provider = provider` 实际变成 `i.provider = i.provider`）。声明为 `stable`。仅由 `service_role` 执行。按 `(provider, tenant, subject)` 查找**已验证（`verified_at` 非空）**、未撤销且所属用户状态为 `active` 的内部用户 id，否则返回 null。非部分唯一约束保证最多一行，因此省略 `LIMIT`。**这是外部 subject 转换为业务 key 的唯一入口**；它永不接受客户端传入的 `app_user_id`，也从不按邮箱、用户名或 profile 解析。
- `current_app_user_id() -> uuid | null`
  由 `authenticated` 与 `service_role` 执行。读取已验证 JWT 的 `request.jwt.claims` GUC（`sub` 作为 subject，`iss` 作为 tenant），经 `resolve_app_user_id('supabase_auth', iss, sub)` 解析。以下情况一律返回 null：缺少 `sub` / `iss`、身份未绑定、**未验证**、已撤销、用户处于 `invited` / `suspended` / `merged`。它**永不接受客户端传入的 user id 或 subject**。

> **身份行存在 ≠ 身份已生效。** 只有 `verified_at` 非空、`revoked_at` 为空且所属用户 `active` 的身份才能解析到内部用户；未验证的绑定记录不参与任何解析。

两个函数均使用**封闭的 `search_path = ''`**：表全部以 `public.` 限定，内置函数以 `pg_catalog.` 限定（`NULLIF` / `COALESCE` 是 SQL 语法构造，不受 search_path 影响，保持裸调用），不依赖调用方的 search_path，不加入可被普通角色写入的 schema，不使用动态 SQL。

## 行级安全（RLS）

默认拒绝，按角色逐项开放：

- `app_users`：`authenticated` 仅能 `SELECT` `id = current_app_user_id()` 的自身记录。
- `profiles`：`authenticated` 仅能 `SELECT` / `UPDATE` 自身档案；`user_id` 列被排除在 `UPDATE` 授权之外，并由 `WITH CHECK` 二次校验，因此无法改成他人以冒用身份。
- `user_identities` 与 `identity_binding_challenges`：**不向 `anon` / `authenticated` 开放任何策略**，直接客户端访问同时被 RLS（无策略）和显式权限撤销拒绝，必须经由服务端逻辑（`service_role`）访问。

## 权限矩阵（显式、默认拒绝）

| 对象                                                                      | anon | authenticated          | service_role                                                                                          |
| ------------------------------------------------------------------------- | ---- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `app_users`                                                               | 无   | SELECT                 | ALL                                                                                                   |
| `profiles`                                                                | 无   | SELECT + 受限列 UPDATE | ALL                                                                                                   |
| `user_identities`                                                         | 无   | 无                     | SELECT / INSERT / `UPDATE(verified_at, last_used_at, revoked_at)`（无 DELETE、无 ALL、无绑定主体列）  |
| `identity_binding_challenges`                                             | 无   | 无                     | SELECT / INSERT / `UPDATE(attempt_count, consumed_at, expires_at, max_attempts)`（无 DELETE、无 ALL） |
| `resolve_app_user_id(...)`                                                | 无   | 无                     | EXECUTE                                                                                               |
| `current_app_user_id()`                                                   | 无   | EXECUTE                | EXECUTE                                                                                               |
| `user_identities_immutable()` / `identity_binding_challenges_immutable()` | 无   | 无                     | 无（仅由触发器内部调用）                                                                              |

要点：

- **`service_role` 拥有最小权限**：身份表不再授予 `ALL`，也没有 `DELETE`；绑定主体与归属字段不可通过授权修改。即使 `service_role` 是本地超户（可绕过授权），不可变 / 不可删 / 状态单向仍由触发器对所有角色强制执行——触发器是最终兜底，列级授权是第二道防线。
- 先对 `PUBLIC`、`anon`、`authenticated`、`service_role` 显式 `REVOKE` 旧权限，再按矩阵重新 `GRANT`，避免继承旧授权。
- **`PUBLIC` 指 PostgreSQL 的全部角色，不等于 Supabase 未认证用户**；Supabase 未认证请求的角色是 `anon`。两者在本模型中均对身份业务数据零权限。

## 测试

- `supabase/tests/database/identity_schema_constraints.test.sql`（`plan(77)`）：表 / 枚举存在性、主键、外键删除策略（含 `user_identities.user_id` 与 challenge **两个用户外键均为 `RESTRICT`**）、`set_updated_at` 触发器、唯一约束、空白 tenant / subject、`app_users` 状态组合（self-merge 使用全新 UUID 的 UPDATE 以命中 `no-self-merge` CHECK）、`identity_binding_challenges` 无原始 secret 列、**小写 SHA-256 hex 格式**（拒绝短值 / 非 hex / 大写）、两张身份表的**不可变 / 单向状态 / 禁删触发器**（SQLSTATE `27000`，含 **challenge 主键 `id` 不可变**）、删除有身份历史的 `app_user` 被 `RESTRICT` 拒绝（`23503`）、**真实父记录删除行为**（目标用户 T 与创建人 C 不同，删除 T 返回 `23503` 且挑战行与创建人 C 均保留，证明失败来自 target FK 而非 created_by FK）、允许操作通过 `pg_temp.rows_affected` 证明命中恰一行并由属主复核值变化、触发器函数不向任何客户端角色开放执行。
- `supabase/tests/database/identity_resolution_rls.test.sql`（`plan(74)`）：**provider 隔离回归**（同一 `(tenant, subject)` 在 `supabase_auth` 与 `wechat_miniprogram` 下分别解析到不同用户；该测试在旧的 `i.provider = provider` 遮蔽实现下必失败）、**verified_at 生效规则**（未验证 → null，验证后 → 用户，撤销后 → null）、身份唯一性（含已撤销行仍占位）、JWT 解析矩阵、RLS 真实拒绝与**属主复核**（A 改自己后以数据库所有者确认已生效；A 改 B 后以属主确认 B 未变）、函数元数据（`stable`、`SECURITY DEFINER`、**`proconfig = {search_path=""}` 封闭断言**）、函数/表权限矩阵（`PUBLIC` / `anon` / `authenticated` / `service_role`，授权断言走 `information_schema` 以避免超户干扰）、**service_role 真实行正向测试**（显式固定 id 的身份与挑战，初始 `verified_at` 为 null；service_role 更新后由属主确认底层值真实变化，杜绝零行 UPDATE 假阳性；service_role 对真实身份行 `DELETE` 被权限拒绝 `42501`，属主 `DELETE` 被触发器拒绝 `27000`）。
- 测试使用会话级辅助函数 `pg_temp.sqlstate_of(sql)`（精确断言 SQLSTATE）与 `pg_temp.rows_affected(sql)`（返回受影响行数，-1 表示抛错，证明语句真实命中目标行）；辅助函数仅存在于测试事务的 `pg_temp`，不进入生产 migration。
- 前端夹具 `src/features/identity/fixtures.ts` 与 `src/tests/identity-fixtures.test.ts`（21 项）：使用生成的 **`Tables` / `TablesInsert`** 类型，校验枚举、**所有 UUID 字段为合法小写十六进制格式（无 `/i` 掩盖，app_users.id / merged_into_user_id / profiles.user_id / user_identities.id / user_identities.user_id / challenge.target_user_id / challenge.created_by）**、状态 / `disabled_at` 一致性、**全部身份（含已撤销）唯一性**、跨 provider 同 `(tenant, subject)` 隔离夹具、64 位小写 hex `challenge_hash`（正则与数据库 CHECK 一致）、引用完整性、`revoked_at` 时间一致，并断言所有 `provider_tenant` 均为已知虚构值、不含邮箱 / 手机号形态。

所有夹具均为虚构数据：无真实 AppID、OpenID、手机号、JWT、绑定码或密钥；UUID 为确定性、合法、全局唯一的测试值（不内嵌 `fictional` 文本标记），issuer / tenant / subject 使用明显虚构标识。

## 明确未实现

本任务只落地数据模型与安全边界。以下能力**不在**本任务范围，只能在未来明确授权的任务中引入：

- 登录页面、受保护路由、会话持久化；
- 真实的绑定 / 认证 / 微信小程序 / CloudBase 流程（含真实绑定 RPC、发送绑定码）；
- 工作空间、项目、任务、提醒等业务表；
- 远端 Supabase 推送、生产 Vercel 配置、PR 创建或 main 合并（由远端独立审计与授权人员执行）。
