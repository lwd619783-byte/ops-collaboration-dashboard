# 项目 CRUD、可见性与归档 V1

Task 2.1 在既有统一身份与工作空间权限边界上增加最小项目模型、项目列表、详情、创建、编辑和归档。Task 2.2 在不改变核心 CRUD 状态机的前提下演进项目成员与 owner/lead 变更边界。实现继续采用 local-first migration；没有连接或修改远端 Supabase，也没有引入项目模块、任务、进展、验收或提醒。

## 数据模型

- `projects` 保存项目所属工作空间、名称、描述、类型、状态、负责人、牵头人、计划日期、归档时间和乐观并发时间戳。
- `project_members` 只保存项目与内部用户的最小关系以及 `owner`、`lead`、`member`、`viewer` 四级项目角色。它为普通工作空间成员的项目可见性提供稳定依据，不承担后续任务分工、邀请或审批能力。
- 项目用户字段只引用 `app_users.id`。调用方身份仍由 `current_app_user_id()` 从已验证且有效的外部身份解析，浏览器不能提交任意 actor 或 workspace 身份。
- 项目负责人关系在同一事务内写入，并由延迟约束触发器在事务提交时验证；创建失败时项目与关系一起回滚。

项目类型为 `operations`。状态机为 `planning -> active`、`active -> paused/completed`、`paused -> active`、`completed -> archived`；归档不可恢复，行不可物理删除。计划开始日期不能晚于计划结束日期。

## 权限与可见性

数据库采用默认拒绝和最小授权：

- 工作空间 `owner` / `admin` 可以查看本工作空间全部项目、创建项目、更新允许字段，并把已完成项目归档。
- 工作空间 `member` / `external` 只能查看自己在 `project_members` 中有关系的项目。
- 项目名称、描述、状态、日期与归档等 Task 2.1 核心写操作仍只开放给工作空间 `owner` / `admin`。
- Task 2.2 成员写操作采用独立矩阵：工作空间 owner/admin 和项目 owner 可执行专用 owner/lead 操作；项目 lead 只能管理普通 member/viewer。
- 已停用用户、已撤销 / 待激活成员、无有效身份、无工作空间绑定或跨工作空间访问都会被拒绝。
- 浏览器只获得 `projects` 的受控读取权和明确 RPC 的执行权；`project_members` 没有浏览器表级权限，内部辅助函数也不开放直接执行。

前端通过以下 RPC 访问安全投影，不直接拼装跨表授权查询：

- `list_projects`
- `get_project`
- `create_project`
- `update_project`
- `archive_project`
- `list_project_members`
- `list_project_member_candidates`
- `add_project_member` / `set_project_member_role` / `remove_project_member`
- `set_project_lead` / `clear_project_lead` / `transfer_project_owner`

列表和详情只返回页面需要的项目字段以及负责人 / 牵头人显示名，不暴露身份绑定、邀请或凭据数据。`list_project_members` 还返回 `active_member_count` 与 `inactive_historical_member_count` 两个计数，前端据此区分「当前在用」与「停用历史」成员（含归档项目）；负责人/牵头人停用 guard 仅作用于未归档项目，归档项目保留历史职责但不阻止人员停用。详见 [项目成员与牵头人 V1](project-membership-and-lead.md)。

## 幂等、并发与归档

创建请求必须携带客户端生成的幂等键。数据库把幂等范围限定为“工作空间 + 当前内部用户 + 幂等键”；同一 actor 的重试返回同一项目，不会重复创建项目关系，其他 actor 不能复用该结果。

更新必须提交当前 `updated_at`。若其他请求已先完成更新，RPC 返回稳定的并发冲突，页面重新读取数据后才能再次保存。普通更新允许修改的字段只有名称、描述、状态和计划日期；工作空间、创建人、项目 ID、幂等键和创建时间保持不可变。Task 2.2 只允许专用 RPC 在项目行锁、权限重检和延迟一致性约束内原子修改 `owner_id` / `lead_id` 与对应成员角色；owner/lead 操作同样要求精确 `updated_at`，普通更新 RPC 仍不能改写这些字段。

归档只允许从 `completed` 进入 `archived`，并在同一事务设置 `archived_at`。重复归档返回当前快照，不创建第二次状态变化；归档项目不允许恢复、更新或删除。

## 页面与路由

所有项目页面仍位于登录、有效身份和工作空间门禁之后，并复用当前工作空间上下文：

- `/projects`：项目列表、空状态、加载与失败状态；
- `/projects/new`：创建项目；
- `/projects/:projectId`：项目详情与允许操作；
- `/projects/:projectId/edit`：带乐观并发保护的编辑页。
- `/projects/:projectId/members`：安全成员投影、候选目录与受控成员管理。

桌面端列表以信息卡展示；窄屏下卡片、详情和表单切换为单列，主操作保持在正常文档流中，不依赖横向滚动。没有项目写权限的成员不会看到创建、编辑或归档入口。

## 本地验证

```bash
npm run db:start
npm run db:verify
npm run db:membership:verify
npm run db:reissue:verify
npm run test:edge
deno check supabase/functions/invite-workspace-member/index.ts
npm run security:audit
npm run check
```

`db:verify` 会从空库应用全部 migration、执行 pgTAP、运行真实多连接成员并发验证、运行数据库 lint，并核对生成类型。数据库测试覆盖结构约束、完整权限矩阵、RLS、RPC 幂等、归档与停用语义；前端测试覆盖 service 运行时校验、列表、创建、详情、编辑、归档、成员管理、路由保护、失败状态和跨作用域竞态。

## 明确未实现

Task 2.2 已实现项目成员与牵头人 V1；Task 2.3 未实现。本任务不包含项目邀请 / 审批、项目模块、任务 CRUD、进展、验收、提醒、评论、附件、审计日志、归档恢复、物理删除、批量成员操作、公开分享、生产环境变量、远端 migration 或生产部署。任何此类能力都需要后续独立任务与权限审计。成员模型细节见 [项目成员与牵头人 V1](project-membership-and-lead.md)。
