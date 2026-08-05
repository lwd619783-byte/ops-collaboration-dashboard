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

所有 RPC 固定空 `search_path`、锁定项目行、在锁内重新判断权限和状态，并返回带 `project_id` / `workspace_id` 的安全项目快照。owner/lead 变更还要求精确 `updated_at`；并发旧版本返回稳定冲突。PUBLIC、anon、service_role 和 authenticated 的默认函数权限先全部撤销，只向 authenticated 显式授予审阅后的浏览器 RPC；内部授权辅助函数不开放执行。

## 停用、移除与归档语义

- 项目 owner 未转让前、lead 未清除或更换前，工作空间成员停用和 app user 停用均被数据库拒绝。
- 普通 member/viewer 被工作空间停用后立即失去 `list_projects`、`get_project` 和成员投影读取权。
- 普通成员关系会保留为不可用的历史关系；若工作空间管理员以后明确重新启用该用户，原项目访问会随保留关系恢复。此选择是 V1 的显式语义，并由 pgTAP 覆盖，不是隐式副作用。
- 从项目移除会删除普通项目关系；重复移除安全返回未变更，且下一次三条真实读取路径均立即拒绝。
- 已归档项目仍可读取历史成员，但添加、角色修改、移除、lead 任命/清除和 owner 转让全部被数据库拒绝。

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

pgTAP 覆盖结构、授权矩阵、RLS、幂等、归档、停用与关系一致性。`db:membership:verify` 使用多个真实 PostgreSQL 连接验证 owner 转让竞争、lead 任命竞争和“移除 vs 角色修改”竞争；`db:verify` 已包含这项检查。

## 明确不包含

本任务不实现项目邀请/审批、项目模块、任务、进展、验收、提醒、评论、附件、审计日志、归档恢复、项目或用户物理删除、批量成员操作、公开分享、远端 Supabase migration 或生产部署。Task 2.3 及阶段 3 能力必须由后续独立任务授权。
