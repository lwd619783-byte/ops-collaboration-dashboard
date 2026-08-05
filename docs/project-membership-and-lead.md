# 项目成员与牵头人 V1

Task 2.2 在 Task 2.1 项目可见性基线上建立数据库强约束的成员管理闭环。浏览器仍不直接写 `projects` 或 `project_members`，actor 只由 `current_app_user_id()` 从有效身份解析。

## 角色与管理矩阵

- 每个项目必须且只能有一个 `owner`；`projects.owner_id` 与唯一 `project_members.role = 'owner'` 始终一致。
- 每个项目最多有一个 `lead`；`projects.lead_id` 为 null 时不存在 lead 关系，非 null 时与唯一 lead 关系一致。
- `member` 与 `viewer` 是普通角色，只能经普通成员 RPC 相互切换。
- 工作空间 owner/admin 可管理空间内所有项目的普通成员、牵头人和负责人。
- 项目 owner 可管理本项目的普通成员、牵头人和负责人。
- 项目 lead 只能添加、调整或移除普通 member/viewer，不能任命或清除 lead，也不能转让 owner。
- 项目 member/viewer、同空间未加入用户、跨空间用户、停用用户和 anon 均无成员写权限。

负责人转让是单事务操作：新负责人必须是当前空间 active 内部用户；尚未加入时原子加入；旧负责人固定降为 member。若新负责人原本是 lead，则 lead 同时清除；目标原本是 member/viewer 时直接提升。任命或更换 lead 同样原子完成，旧 lead 自动降为 member；清除 lead 也把原 lead 降为 member。

## 数据库边界

迁移 `20260805120000_project_membership_lead_v1.sql` 提供：

- owner/lead 部分唯一索引；
- 初始延迟的 constraint trigger，在事务提交边界检查字段和关系一致性；
- 项目与成员身份字段不可变 guard，以及归档项目全写拒绝；
- 工作空间成员和 app user 的负责人/牵头人停用 guard；
- 安全成员投影 `list_project_members` 和 active 候选投影 `list_project_member_candidates`；
- `add_project_member`、`set_project_member_role`、`remove_project_member`、`set_project_lead`、`clear_project_lead`、`transfer_project_owner` 六个可信写 RPC。

内部辅助 `public.lock_membership_participants(p_project_id, p_participant_ids)` 由上述六个写 RPC 在锁定项目行之后统一调用，用于消除「权限检查」与「业务写入」之间的跨表 TOCTOU：它在固定空 `search_path` 的 `SECURITY DEFINER` 边界内，把 actor（由 `current_app_user_id()` 解析）与所有参与方去重并按 id 排序后，按稳定顺序加锁 `app_users`（按 id）→ `workspace_members`（按 user_id，限定项目所在工作空间），随后在锁内重新校验 actor 仍为 active 工作空间成员与 active app user（否则抛 `project_member_actor_invalid`，`42501`）。持锁直到事务结束，并发的 actor 停用、角色降级或候选方状态变更都必须在锁释放后才能提交，因此权限重检结论在写入瞬间仍然成立。该函数不授予任何 API 角色执行权。

所有 RPC 固定空 `search_path`、锁定项目行、在锁内重新判断权限和状态，并返回带 `project_id` / `workspace_id` 的安全项目快照。owner/lead 变更还要求精确 `updated_at`；并发旧版本返回稳定冲突。PUBLIC、anon、service_role 和 authenticated 的默认函数权限先全部撤销，只向 authenticated 显式授予审阅后的浏览器 RPC；内部授权辅助函数不开放执行。

### 锁顺序

每个写 RPC 的加锁顺序固定为：

1. `public.projects` 项目行（由调用 RPC 先取 `for update`）；
2. `public.app_users` 参与方行（含 actor，去重后按 id 升序 `for update`）；
3. `public.workspace_members` 行（项目所在工作空间内，按 user_id 升序 `for update`）；
4. `public.project_members` 业务行（由调用 RPC 在锁后写入或更新）。

稳定顺序避免了参与者之间的死锁，并保证并发撤销 / 停用 / 转让在单一锁边界上线性化（见下方「并发撤销线性化」）。

## 停用、移除与归档语义

- 仅对**未归档**项目，项目 owner 未转让前、lead 未清除或更换前，工作空间成员停用和 app user 停用均被数据库拒绝（错误 `workspace_member_project_responsibility_conflict` / `app_user_project_responsibility_conflict`，`55000`）。两个 guard 的判定都显式排除 `status = 'archived'` 的归档项目。
- 普通 member/viewer 被工作空间停用后立即失去 `list_projects`、`get_project` 和成员投影读取权。
- 普通成员关系会保留为不可用的历史关系；若工作空间管理员以后明确重新启用该用户，原项目访问会随保留关系恢复。此选择是 V1 的显式语义，并由 pgTAP 覆盖，不是隐式副作用。
- 从项目移除会删除普通项目关系；重复移除安全返回未变更，且下一次三条真实读取路径均立即拒绝。
- 已归档项目仍可读取历史成员，但添加、角色修改、移除、lead 任命/清除和 owner 转让全部被数据库拒绝。

### 当前职责 vs 归档历史职责

「负责人 / 牵头人」在数据库中存在两类语义，必须区分：

- **当前职责**：项目 `status <> 'archived'` 时，`owner_id` / `lead_id` 指向的内部用户承担当前职责，其工作空间成员与 app user 停用受 guard 保护，不能被永久阻塞。
- **归档历史职责**：项目 `status = 'archived'` 后，原 owner / lead 的职责已成为历史记录，归档项目保留完整历史成员与负责人/牵头人关系供 owner/admin 读取，但六个写 RPC 全被拒绝，**且不再对原负责人/牵头人的工作空间停用或 app user 停用构成阻塞**——归档项目不能因历史职责而永久阻止用户停用。

pgTAP 覆盖：归档项目的 owner/lead 作为普通成员被工作空间停用成功、app user 停用成功、历史字段（含负责人/牵头人）保留可读、六个写 RPC 全部拒绝；以及非归档项目的 owner/lead 停用仍被拒绝。同一内部用户若在非归档项目中仍承担当前职责，则其停用仍被拒绝（不复用仅在归档历史中承担职责的用户）。

### 当前/历史成员计数

`list_project_members` 投影额外返回两个窗口计数（基于已过滤后的可见成员集合）：

- `active_member_count`：当前在用的成员数（`workspace_members.status = 'active'` 且 `app_users.status = 'active'`）。
- `inactive_historical_member_count`：停用历史成员数（其余，`workspace_members.status <> 'active'` 或 `app_users.status <> 'active'`，仅保留历史、不可恢复访问）。

前端据此在成员页显示「当前在用 X 人；停用历史 Y 人」，在详情页显示当前在用数量并可选地标注停用历史数量；归档项目同样按上述口径拆分。计数由数据库统一计算，前端不再二次统计角色，只做语义展示。

## 前端与状态安全

项目详情显示负责人、牵头人、成员数量及 `/projects/:projectId/members` 入口。成员页使用响应式成员卡片、语义化标签、可见焦点和明确确认对话框，覆盖添加、普通角色修改、移除、lead 任命/清除和 owner 转让。候选目录只包含 active 工作空间成员，并标注其现有项目角色。

service 层在任何数据进入 UI 前校验项目、工作空间、角色、布尔状态和 nullable 字段。页面以“工作空间 ID + 工作空间角色 + 项目 ID”作为请求作用域，并用独立单调 epoch 处理读取和写入；A→B→A、卸载、权限下降或实体作用域不匹配的旧响应都被丢弃。数据库仍是最终权限来源。

## 验证

```bash
npm run db:reset
npm run db:test
npm run db:membership:verify
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
npm run security:audit
npm run check
```

pgTAP 覆盖结构、授权矩阵、RLS、幂等、归档、停用与关系一致性，以及归档生命周期与 actor 撤销矩阵。

`db:membership:verify` 使用多个真实 PostgreSQL 连接验证并发线性化，**不依赖固定休眠**：先提交的一方释放行锁，后到达的一方在锁上真实阻塞，从而证明操作在单一锁边界上可串行化。共 23 项检查，分两组：

- 既有 9 项：stale 读后写竞争（owner 转让、lead 任命、移除 vs 角色修改，含 A→B→A 与作用域不匹配丢弃）。
- 新增 14 项真实锁竞争（7.1 / 7.2 / 7.3，均验证两种顺序）：
  - 7.1 lead 任命 vs 工作空间成员停用：任命先提交则后续停用被 `55000` 阻塞；停用先提交则任命被 `22023`（行锁冲突）拒绝。
  - 7.2 owner 转让 vs app user 停用：转让先提交则后续停用被 `55000` 阻塞；停用先提交则转让被 `22023` 拒绝。
  - 7.3 工作空间 admin 降级 vs 普通成员写：写先提交则降级照常生效（无冲突）；降级先提交则成员写被 `42501` 拒绝。
  - 末尾 `raceInvariants`：被竞争的每个项目仍恰好一个 owner、至多一个 lead。

所有并发检查只创建随机虚构本地夹具，输出不含 DB URL、JWT 或密钥；`db:verify` 已包含这项检查。

## 明确不包含

本任务不实现项目邀请/审批、项目模块、任务、进展、验收、提醒、评论、附件、审计日志、归档恢复、项目或用户物理删除、批量成员操作、公开分享、远端 Supabase migration 或生产部署。Task 2.3 及阶段 3 能力必须由后续独立任务授权。
