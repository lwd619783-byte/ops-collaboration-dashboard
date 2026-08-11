# 任务数据模型与创建编辑 V1

Task 3.1 在统一 `app_users.id`、工作空间权限、项目成员和有序项目模块之上建立只属于项目的共享任务基础。它提供受控创建、详情 deep link 和核心元数据编辑；Task 3.2 通过独立安全 summary 投影增加只读任务列表 / 看板；Task 3.3 增加受控状态流转、当前 blocker 与结构化历史；Task 3.4 增加追加式每日进展、原子 progress 写入与时间线；已封板的 Task 3.5 增加提交验收、通过、退回和数据库权威完成信息。详见 [任务看板和列表 V1](task-board-and-list.md)、[任务状态流转与阻塞 V1](task-status-transitions.md)、[每日任务进展与进度同步 V1](task-daily-progress.md) 和 [任务提交验收、通过与退回 V1](task-review-closure.md)。私人任务、个人待办和笔记需要未来独立模型，绝不通过 `tasks` 的模糊模式混入项目任务。

## 数据模型

正式 migration 为 `supabase/migrations/20260809120000_task_model_create_edit_v1.sql`：

- `tasks` 保存项目、有效模块、标题、说明、验收标准、主要负责人、验收人、优先级、日期、预计工时、工作量、可见性、基础状态 / 进度及审计字段；
- `task_collaborators` 保存零到多个协作人，复合主键 `(task_id, user_id)` 去重；
- `task_visibility_users` 保存 restricted 任务的额外显式可见人员，同样由复合主键去重；
- 所有人员外键只引用内部 `app_users.id`，并使用 `ON DELETE RESTRICT`；
- `tasks.module_id` 非空，`(module_id, project_id)` 复合外键引用同一项目的 `project_modules`，同时使用 `ON DELETE RESTRICT`；
- 标题非空且最长 200，说明和验收标准各最长 10000，日期满足 `start_date <= due_date`，预计工时为 `0..10000` 且最多两位小数，进度约束为 `0..100`；
- 创建审计、更新审计、任务身份和幂等键不能由普通编辑改变；任务行不支持物理删除。
- Task 3.3 migration `20260809220000_task_status_transitions_v1.sql` 增加 `blocker_reason / blocked_at / blocked_by`，并以 check constraint 强制它们只在 blocked 状态完整存在。
- Task 3.4 migration `20260810120000_task_daily_progress_v1.sql` 增加 `last_progress_at / last_progress_by` 和 append-only `task_updates`，并只允许进展 RPC 同步 progress/latest metadata。
- Task 3.5 migrations `20260810180000_task_review_status_actions_v1.sql` 与 `20260810180100_task_review_closure_v1.sql` 增加共享验收状态动作、`completed_at / completed_by` 和 append-only `task_reviews`，并让验收记录唯一关联精确的共享状态历史。

`task_status` 包含 `todo / in_progress / blocked / pending_review / completed / cancelled`。Task 3.1 只允许数据库创建 `todo / 0%`；Task 3.3 只通过 `start_task / block_task / resume_task / cancel_task` 开放执行期转换；Task 3.4 只允许 `create_task_update()` 在追加 ledger 的同一事务中修改 progress；Task 3.5 只通过 `submit_task_for_review / approve_task_review / return_task_review` 开放验收转换。不存在通用 status setter，`update_task()` 也不接受 status、progress 或 completion metadata。

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

`task_snapshot(task_id)` 保持 Task 3.1 核心投影；Task 3.3 的内部 `task_status_snapshot(task_id)` 增加 current blocker；Task 3.4 的内部 `task_progress_snapshot(task_id)` 增加 latest progress；Task 3.5 的内部 `task_review_task_snapshot(task_id)` 和公开 `get_task(task_id)` 再增加 completion metadata 与安全显示名。投影仍不返回任何创建/状态/进展/验收幂等键或内部上下文。前端对数组、枚举、数值、日期、时间戳、nullable blocker/latest progress/completion 不变量和作用域进行运行时校验，malformed success 会 fail closed，数据库原始错误不会直接显示。

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

`scripts/verify-task-concurrency.mjs` 使用真实独立 PostgreSQL connection、observer 的 `pg_blocking_pids()`、`lock_timeout` 和 `statement_timeout` 验证 Task 3.1–3.4 的撤权、任务、状态和进展竞态，并为 Task 3.5 增加同/不同 key submit/approve、submit 与 cancel/progress/edit/archive/负责人或人员生命周期变化、approve 与 return/archive/验收人生命周期变化、return/cancel。当前共 127 项检查，只使用随机虚构本地夹具，不输出连接串、JWT 或密钥，并已纳入 `db:verify`。

## 前端边界

`src/features/tasks` 提供类型、运行时 service、错误映射、表单、Provider 和带 request epoch / scope key 的编辑资源加载。路由包括：

- `/projects/:projectId/tasks/new`；
- `/projects/:projectId/tasks/:taskId`；
- `/projects/:projectId/tasks/:taskId/edit`。

Task 3.2 已让项目详情对所有项目读者提供 `/projects/:projectId/tasks` 入口，管理者仍可进入创建页。Task 3.1 创建使用浏览器生成的重试 key；表单改动会生成新的业务意图 key。创建 / 编辑 mutation 捕获 workspace、project、task 与单调 action epoch，scope 变化或组件卸载会让迟到 success / error 失效，不能导航或污染新页面。窄屏回落为单列，fieldset / label / alert / loading 状态保持键盘和辅助技术可用。

## Task 3.3 状态边界

状态历史 `task_status_history` 是 append-only transition ledger，按 task 锁内生成 `transition_seq`，同时以 `(actor_id, idempotency_key)` 承载状态意图幂等。相同意图重试返回已有 transition；不同 task/action/reason 复用 key 会冲突。历史读取继续要求 `can_read_task`，但读取关系不会授予 mutation 权限。

`cancelled` 与 `completed` 按 terminal 处理；人员 lifecycle guard 只让 non-terminal task 职责阻止成员移除/降级/停用。历史 actor 不属于当前职责。模块删除不因 task terminal 而放宽，任何任务引用仍阻止模块删除。

## 当前未实现

当前明确不包含：拖拽状态修改、已完成重开、通知、Stage 4 工作台、飞书、微信小程序、CloudBase、附件、私人任务、个人空间、周期任务、甘特图、完整操作日志和任务回收站。Task 3.4 的进展与 Task 3.5 的验收记录均为 append-only，不提供编辑或删除。

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
