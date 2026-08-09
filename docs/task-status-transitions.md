# 任务状态流转与阻塞 V1

Task 3.3 在 Task 3.1 的项目任务和 Task 3.2 的只读任务中心之上增加数据库权威的状态机、当前阻塞信息、结构化状态历史、幂等和并发保护。状态写入口只存在于任务详情；任务中心继续只读，不提供拖拽、卡片内状态修改或批量操作。

## 范围与状态机

本轮公开动作固定为：

| 动作     | 合法转换                                   | 原因 |
| -------- | ------------------------------------------ | ---- |
| `start`  | `todo → in_progress`                       | 无   |
| `block`  | `in_progress → blocked`                    | 必填 |
| `resume` | `blocked → in_progress`                    | 无   |
| `cancel` | `todo / in_progress / blocked → cancelled` | 无   |

数据库不提供可传入目标状态的通用 setter。`pending_review` 和 `completed` 仍只是 schema 预留词汇；Task 3.3 没有进入、离开或修改它们的 RPC/UI。`progress` 继续只读且不会随状态流转改变，Task 3.4 才负责进展比例。

## 数据模型与 blocker 不变量

Migration `supabase/migrations/20260809220000_task_status_transitions_v1.sql` 为 `tasks` 增加：

- `blocker_reason`：trim 后非空、最长 2000 字符；
- `blocked_at`：数据库生成的阻塞时间；
- `blocked_by`：数据库解析出的内部 `app_users.id`。

数据库 check constraint 强制：状态为 `blocked` 当且仅当三个 current blocker 字段全部非空；所有非 blocked 状态三个字段必须全部为空。`resume` 和从 blocked 执行 `cancel` 会清空当前 blocker，但历史表中的原因保持不变。`get_task()` 的完整详情投影增加 blocker、阻塞人显示名和阻塞时间；`list_project_tasks()` 的 Task 3.2 summary 不增加阻塞原因或人员信息。

## 结构化、追加式状态历史

`task_status_history` 保存 transition ID、task、from/to 状态、语义动作、block 原因、actor、幂等键、task 内序号和时间。数据库在持有 task 写锁后计算 `transition_seq`，并以 `UNIQUE(task_id, transition_seq)` 保证同一任务的顺序唯一；读取 RPC 固定按 sequence 排序，不把 transaction timestamp 当作唯一顺序。

历史 guard 拒绝 UPDATE/DELETE，也拒绝不带内部 transition 上下文的 INSERT。`PUBLIC`、`anon`、`authenticated` 和 `service_role` 均无历史表 DML；浏览器只通过 `list_task_status_history(task_id)` 读取安全投影，且必须继续满足 `can_read_task(task_id)`。投影不返回幂等键或内部上下文。

## 权限

- `start / block / resume`：当前 assignee 或 `can_manage_project_tasks(project_id)`；
- `cancel`：仅 `can_manage_project_tasks(project_id)`；
- 当前管理模型继续是项目 owner/lead 与工作空间 owner/admin；
- collaborator、reviewer、creator、显式可见用户、普通 member/viewer 不能仅凭该关系改变状态；
- 已归档项目仍可按既有读取边界查看详情和历史，但所有状态 mutation 都拒绝。

浏览器不提交 actor、角色或目标状态。所有公开 RPC 为 `SECURITY DEFINER`、固定空 `search_path`、owner 为 `postgres`，先撤销默认执行权后只向 `authenticated` 显式授权。内部通用执行 helper 与两个 guard helper 对所有 API 角色（含 `service_role`）撤销执行权。

## 幂等

四个 mutation RPC 都接收客户端为一次明确意图生成的 UUID。历史表以 `(actor_id, idempotency_key)` 唯一：

- 相同 actor/key/task/action/规范化 payload 重试返回已有 transition，并标记 `was_existing = true`，不重复写 history；
- key 被同 actor 用于不同 task、action 或 block reason 时稳定返回 `task_transition_idempotency_conflict`；
- 幂等重读前仍校验当前身份、任务读取边界和项目未归档，旧记录不能绕过撤权或泄漏任务。

前端对网络失败保留同一 intent key；scope 变化、成功或非重试型错误会清除 intent。按钮 in-flight 时禁用只用于减少误操作，数据库唯一约束才是最终防线。

## 锁顺序与原子性

状态 mutation 复用 Task 3.1 的顺序：

1. 非锁定读取不可变 `task.project_id`；
2. `projects`；
3. actor 与当前任务参与方的 `app_users`（稳定排序）；
4. 对应 `workspace_members`（稳定排序）；
5. `project_members`（稳定排序）；
6. 当前 `project_modules`；
7. `tasks`；
8. history append。

完整锁取得后重新校验当前身份、读取/动作权限、归档状态、模块、task 和当前 status。状态、current blocker、`updated_by`、`updated_at`、history、sequence 与幂等记录在一个数据库事务中提交；任一步失败整体回滚。状态 transition 更新 optimistic `updated_at`，因此更早加载的 metadata edit 会以 `task_concurrent_update` 拒绝。

## Terminal lifecycle

`cancelled` 和未来的 `completed` 是 terminal；`todo / in_progress / blocked / pending_review` 是 non-terminal。项目成员移除/降级、工作空间成员停用和 app user 停用 guard 只把 non-terminal task 的 assignee/collaborator/reviewer/显式可见关系解释为当前职责。cancelled 历史任务和 `task_status_history.actor_id` 不会永久阻止人员生命周期操作。模块删除规则不变：任何状态的任务仍保留原模块引用，因此被任务引用的模块继续不可删除。

## 前端

任务详情同时加载项目、完整任务与状态历史，并使用 request/action epoch、scope key 和 mounted ref 丢弃跨 task/project/workspace 的迟到响应。详情页按权限和状态展示：

- todo：开始；管理者另有取消；
- in_progress：标记阻塞；管理者另有取消；
- blocked：当前 blocker 卡片、恢复；管理者另有取消；
- pending_review/completed/cancelled：无 Task 3.3 动作。

阻塞使用带 label、字符计数、trim 校验和 loading 的 textarea Dialog；取消使用明确确认 Dialog。mutation 错误留在当前活动 Dialog 的 `role="alert"` 内，Dialog 不关闭且按钮恢复。成功后只有在新的 history 也安全读取完成时才同步 task 和历史 UI。

## 并发验证

`scripts/verify-task-concurrency.mjs` 使用独立 PostgreSQL connections、`lock_timeout`、`statement_timeout` 和 observer 的 `pg_blocking_pids()`，现有与新增共 43 项检查，覆盖：

- 同 key 双击 start 与不同 key start；
- block vs cancel、resume vs cancel；
- metadata edit vs transition 两种顺序；
- archive vs transition 两种顺序；
- Task 3.1 的 actor/参与方撤权、模块删除、归档、乐观编辑和 complete-set replacement 回归。

每个竞争都先证明真实锁等待，再验证状态、history 链、current blocker、metadata 和无死锁结果。夹具全部随机且虚构，不输出连接串、JWT 或密钥。

## 非目标

本任务不实现 Task 3.4 `task_updates`、进展百分比写入、Task 3.5 验收/完成、pending_review/completed mutation、拖拽、board inline action、批量操作、通知、外部平台、私人任务、全局工作台或 bundle code splitting，也未增加第三方依赖。

## 本地验证

```bash
npm ci
npm run db:reset
npm run db:test
npm run db:membership:verify
npm run db:modules:verify
npm run db:tasks:verify
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
npm run security:audit
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:edge
npm run build
npm run check
git diff --check
```
