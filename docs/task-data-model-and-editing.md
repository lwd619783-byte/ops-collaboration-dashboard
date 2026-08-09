# 任务数据模型与创建编辑 V1

Task 3.1 在统一 `app_users.id`、工作空间权限、项目成员和有序项目模块之上建立只属于项目的共享任务基础。它提供受控创建、详情 deep link 和核心元数据编辑；后续 Task 3.2 已通过独立安全 summary 投影增加只读任务列表 / 看板，详见 [任务看板和列表 V1](task-board-and-list.md)。正式状态流转、每日进展或验收闭环仍未实现。私人任务、个人待办和笔记需要未来独立模型，绝不通过 `tasks` 的模糊模式混入项目任务。

## 数据模型

正式 migration 为 `supabase/migrations/20260809120000_task_model_create_edit_v1.sql`：

- `tasks` 保存项目、有效模块、标题、说明、验收标准、主要负责人、验收人、优先级、日期、预计工时、工作量、可见性、基础状态 / 进度及审计字段；
- `task_collaborators` 保存零到多个协作人，复合主键 `(task_id, user_id)` 去重；
- `task_visibility_users` 保存 restricted 任务的额外显式可见人员，同样由复合主键去重；
- 所有人员外键只引用内部 `app_users.id`，并使用 `ON DELETE RESTRICT`；
- `tasks.module_id` 非空，`(module_id, project_id)` 复合外键引用同一项目的 `project_modules`，同时使用 `ON DELETE RESTRICT`；
- 标题非空且最长 200，说明和验收标准各最长 10000，日期满足 `start_date <= due_date`，预计工时为 `0..10000` 且最多两位小数，进度约束为 `0..100`；
- 创建审计、更新审计、任务身份和幂等键不能由普通编辑改变；任务行不支持物理删除。

`task_status` 为后续 Task 3.3～3.5 预留 `todo / in_progress / blocked / pending_review / completed / cancelled` 词汇，但 Task 3.1 只允许数据库创建 `todo / 0%`。`update_task()` 不接受 status 或 progress 参数，guard trigger 也拒绝绕过接口改写执行状态。

## 人员资格

主要负责人、协作人和验收人必须同时满足：active `app_user`、目标工作空间 active membership、目标项目当前 membership，且项目角色不能是只读 `viewer`。显式可见人员满足相同 active / 项目范围要求，但可以是 viewer；viewer 只能读取已被明确授权的 restricted 任务，不能承担执行、协作或验收职责。

数据库拒绝不存在、停用、已移出项目、跨工作空间、跨项目或重复的人员 ID。主要负责人不能同时出现在协作人集合。前端候选下拉来自 `list_task_assignment_candidates(project_id)` 的安全投影，RPC 写入时仍在持锁状态重新校验，前端筛选不是权限边界。

## 权限矩阵

| 操作者                                       | 读取 project 可见任务 | 读取 restricted 任务                 | 创建 / 编辑核心元数据 |
| -------------------------------------------- | --------------------- | ------------------------------------ | --------------------- |
| 项目 owner / lead                            | 允许                  | 允许                                 | 允许                  |
| 工作空间 owner / admin（按现有项目管理规则） | 允许                  | 允许                                 | 允许                  |
| 当前项目 member                              | 允许                  | 仅任务参与者、创建者或显式授权时允许 | 拒绝                  |
| 当前项目 viewer                              | 允许                  | 仅显式授权等明确条件满足时允许       | 拒绝                  |
| 已移出项目、工作空间成员失效、app user 停用  | 拒绝                  | 拒绝                                 | 拒绝                  |
| anon / 非项目访问者                          | 拒绝                  | 拒绝                                 | 拒绝                  |

`can_manage_project_tasks(project_id)` 是任务管理能力的单一策略接缝，当前复用已审阅的项目 owner / lead 与工作空间 owner / admin 语义。浏览器不能提交 actor ID；所有写入口只通过 `current_app_user_id()` 解析当前内部用户。

## 可见性与 RLS

`can_read_task(task_id)` 是三个任务表共享的唯一读取边界，并且总是先要求 `can_read_project(project_id)`：

- `project`：当前仍有项目读取权限的成员可读；
- `restricted`：项目管理者、主要负责人、协作人、验收人、创建者和 `task_visibility_users` 显式授权人员可读。

显式授权不能跨越项目边界。无权限的 `get_task()` 返回空投影，前端统一显示“不存在或无权访问”，不会泄露标题、人员、验收标准、可见名单或任务是否存在。

`tasks`、`task_collaborators` 和 `task_visibility_users` 全部启用 RLS。`authenticated` 只有审阅后的列级 `SELECT` 和公开 RPC `EXECUTE`，没有直接 `INSERT / UPDATE / DELETE`；`service_role` 也未获得表级 `ALL`。内部 helper 均撤销 `PUBLIC / anon / authenticated / service_role` 执行权。所有 `SECURITY DEFINER` 使用空 `search_path` 并显式限定对象。

## 创建、编辑和安全投影

`create_task()` 在单一事务中完成任务行、全部协作人及 restricted 显式可见人员，并以 `(project_id, created_by, idempotency_key)` 防止重试 / 双击产生第二条任务。同一 key 与完全相同 payload 返回原任务；任一核心字段或关系集合不一致则稳定拒绝。幂等键不出现在浏览器读取投影中。

`update_task()` 使用 `expected_updated_at` 做乐观并发；版本不一致返回 `task_concurrent_update`，禁止 stale edit 覆盖新版本。协作人与显式可见人员采用 complete-set replacement，但删除旧集合、写入新集合和主任务更新处于同一事务，任一步失败都会整体回滚。

`task_snapshot(task_id)` / `get_task(task_id)` 返回前端需要的稳定投影：任务基础信息、模块名、主要负责人、协作人、验收人、可见性、显式可见人员、状态 / 进度和 optimistic concurrency 时间戳；不返回幂等键或内部删除信息。前端对数组、枚举、数值、日期、时间戳、nullable 字段和作用域进行运行时校验，malformed success 会 fail closed，数据库原始错误不会直接显示。

## 锁顺序与并发边界

任务写入保持以下顺序：

1. 目标 `projects` 行；
2. actor 与全部当前 / 新任务参与方的 `app_users` 行（按 id）；
3. 同一批人在目标工作空间的 `workspace_members` 行（按 user_id）；
4. 同一批人的 `project_members` 行（按 user_id）；
5. 目标 `project_modules` 行；
6. 编辑时的目标 `tasks` 行。

取得锁后，RPC 重新校验 actor 权限、项目未归档、模块仍有效且属于同一项目、所有人员资格及 expected timestamp。项目成员移除 / 降级、workspace / app user 停用和模块删除 guard 也会拒绝留下活动任务的非法职责，从而让撤权与任务写入在同一锁边界上线性化。

模块删除 RPC 在项目锁内检查任务引用：未被任务引用的模块仍可按 Task 2.3 规则软删除；已被任何任务引用的模块返回 `project_module_not_empty`，不 cascade、不移动任务、不置空模块，也不写删除标记。`project_modules_guard()` 同时执行相同的不变量检查，特权 SQL 也不能绕过 RPC 直接留下“已删除模块 + 活动任务”的关系。

`scripts/verify-task-concurrency.mjs` 使用真实独立 PostgreSQL connection、observer 的 `pg_blocking_pids()`、`lock_timeout` 和 `statement_timeout` 验证 actor 权限撤销、负责人移出项目、负责人停用、模块删除、项目归档、并发任务编辑与协作人集合替换。脚本只使用随机虚构本地夹具，不输出连接串、JWT 或密钥，并已纳入 `db:verify`。

## 前端边界

`src/features/tasks` 提供类型、运行时 service、错误映射、表单、Provider 和带 request epoch / scope key 的编辑资源加载。路由包括：

- `/projects/:projectId/tasks/new`；
- `/projects/:projectId/tasks/:taskId`；
- `/projects/:projectId/tasks/:taskId/edit`。

Task 3.2 已让项目详情对所有项目读者提供 `/projects/:projectId/tasks` 入口，管理者仍可进入创建页。Task 3.1 创建使用浏览器生成的重试 key；表单改动会生成新的业务意图 key。创建 / 编辑 mutation 捕获 workspace、project、task 与单调 action epoch，scope 变化或组件卸载会让迟到 success / error 失效，不能导航或污染新页面。窄屏回落为单列，fieldset / label / alert / loading 状态保持键盘和辅助技术可用。

## 当前未实现

当前明确不包含：Task 3.3 start / block / cancel / 状态历史，Task 3.4 `task_updates` / 每日进展，Task 3.5 `task_reviews` / 提交验收 / 通过 / 驳回，以及拖拽状态修改、通知、飞书、微信小程序、CloudBase、附件、私人任务、个人空间、周期任务、甘特图、完整操作日志和任务回收站。

## 本地验证

```bash
npm run db:reset
npm run db:test
npm run db:membership:verify
npm run db:modules:verify
npm run db:tasks:verify
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
npm run check
npm run test:edge
git diff --check
```
