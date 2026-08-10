# 每日任务进展与进度同步 V1

Task 3.4 在 Task 3.1 的项目任务、Task 3.2 的只读浏览中心和 Task 3.3 的受控状态机之上，增加 Web 与未来客户端共用的每日进展数据层。写入口只位于任务详情；任务看板和列表仍然只读。

## 数据模型与追加式语义

Migration `20260810120000_task_daily_progress_v1.sql` 新增 `task_updates`。每条记录包含任务内稳定递增的 `update_seq`、业务 `record_date`、完成内容、当前完成比例、问题、下一步、协助标志、阻塞快照、可选的 Task 3.3 block transition 关联、作者、数据库时间和内部幂等键。

- `(task_id, update_seq)` 唯一；序号在持有 task 写锁后分配，不以时间戳作为并发排序依据。
- `(created_by, idempotency_key)` 唯一，提供数据库级重试去重。
- `completed_content` trim 后必填且最多 10000 字符；`issues`、`next_steps` 为空时存 `NULL`，非空时同样 trim 且最多 10000 字符。
- `progress` 是 0–100 的整数。100% 仍保持 `in_progress`，不会自动进入验收或完成状态；Task 3.5 要求负责人或项目管理者另行确认提交验收。
- `block_transition_id` 只能关联同一任务、同一 actor 的合法 Task 3.3 `block` 历史，且一个 block transition 最多被一条进展关联。
- trigger 拒绝 `UPDATE` 和 `DELETE`，也拒绝不具备受控事务上下文的 `INSERT`。V1 不提供编辑、删除或通用 correction RPC。

## 当前进度与最新进展

`tasks.progress` 继续是任务当前完成比例。Task 3.4 在 `tasks` 上新增 `last_progress_at` 和 `last_progress_by`；二者必须同时为空或同时存在，只能由受控进展 RPC 修改。

`last_progress_at` 与最新 ledger 行的数据库权威 `created_at` 相同，`last_progress_by` 与该行作者相同。它们不使用含有元数据编辑和状态变化噪声的 `tasks.updated_at`，可直接支持后续“多久未更新”等安全查询。`get_task()` 只在 `can_read_task()` 允许时返回这些字段和作者安全显示名。

## 日期与时间

- `created_at` 由数据库 `clock_timestamp()` 生成，是绝对时间。
- `record_date` 是用户确认的本地日历业务日期，前端使用本地 `getFullYear/getMonth/getDate` 生成默认值，并严格校验 `YYYY-MM-DD`。
- 不把 UTC timestamp 截断为业务日期；浏览器、数据库或 CI 所在时区不会改变已经提交的 `record_date`。

## 读取与写入权限

| 能力       | 允许                                                                                                       | 拒绝                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 读取       | 现有 `can_read_task(task_id)` 允许的 active 用户；restricted task 沿用原参与人边界                         | anon、被移除/停用或不再具备任务读取权的用户                                                                    |
| 新增进展   | active app user + active workspace/project membership + 当前 assignee + 未归档项目 + `in_progress/blocked` | 非 assignee 的 owner/lead/admin/creator/collaborator/reviewer/visibility user/viewer、无关成员、停用或移除用户 |
| 直接表写入 | 无浏览器角色                                                                                               | `PUBLIC`、`anon`、`authenticated` 和 `service_role` 均无直接 INSERT/UPDATE/DELETE grant                        |

浏览器不能传 actor、工作空间角色或项目角色。RPC 始终通过 `current_app_user_id()` 解析 actor，并在取得锁后重新检查身份、成员关系、负责人、项目归档、任务可读性与状态。

`list_task_updates(task_id)` 复用 `can_read_task()`，只返回安全投影，不返回幂等键、身份 provider、邮箱、auth subject 或内部上下文。表启用 RLS 且默认拒绝；公开 RPC 使用空 `search_path`、显式 owner、默认撤销 EXECUTE 后再只向 `authenticated` 最小授权。内部 snapshot、guard 和 helper 对 API roles 不开放直接执行。

## 原子写入与 Task 3.3 联动

`create_task_update(...)` 在一个数据库事务中完成：

1. 解析 actor，锁定 project；
2. 按稳定顺序锁定 task 当前参与人、module 和 task，并重新鉴权；
3. 校验和规范化 payload，处理 actor-scoped 幂等重读；
4. 可选调用现有 `execute_task_transition(..., block, ...)`，生成唯一的 Task 3.3 block history；
5. 分配 `update_seq`，更新 `tasks.progress/last_progress_*`，追加 `task_updates`；
6. 返回 task 与 update 的安全快照并一次 commit。

任何步骤失败都会回滚进展、progress、latest metadata、current blocker 和 status history。进展+阻塞使用本次 update 的独立内部 UUID 调用 Task 3.3 helper，避免与用户曾用于独立状态动作的客户端幂等键发生跨域碰撞。

状态行为如下：

- `todo`：拒绝；必须先使用 Task 3.3 start。
- `in_progress`：可普通新增；勾选“同时标记阻塞”时必须填写原因并确认，随后原子执行 `in_progress → blocked`。
- `blocked`：可继续新增；记录 `is_blocked=true`，但不创建 `blocked → blocked` 历史、不修改 current blocker，也不隐式 resume。
- `pending_review`、`completed`、`cancelled`：拒绝新增。Task 3.4 不增加这些状态的 mutation；`pending_review / completed` 只由 Task 3.5 语义化验收 RPC 处理。

## 幂等

一次明确提交意图使用一个 UUID。相同 actor、相同 key、相同规范化 task/payload 返回原记录，不增加 update/sequence，也不重复 block；相同 key 对应不同 task 或 payload 返回稳定冲突。幂等重读仍会重新检查当前 actor、任务读取权、assignee 和项目归档，旧记录不能绕过撤权或泄露 restricted task。

前端在网络错误或未知结果时保留同一 key；表单字段改变、明确的非重试错误或 scope 改变时生成新意图；成功并取得一致快照后清除。按钮禁用只改善交互，最终去重由数据库唯一约束保证。

## 锁顺序与并发

Task 3.4 沿用 Task 3.1/3.3 的顺序：project → task 相关 app users/workspace members/project members（UUID 稳定序）→ module → task → history/update append。没有第二套锁协议或通用 status setter。

`scripts/verify-task-concurrency.mjs` 以独立 PostgreSQL connections、`lock_timeout`、`statement_timeout` 和 observer 的 `pg_blocking_pids()` 验证：

- same-key update/update；
- different-key update/update；
- progress update 与 cancel；
- update-with-block 与 cancel；
- progress update 与 metadata edit；
- progress update 与 project archive；
- progress update 与 assignee 变化。

每个 race 都必须观察到真实锁等待，并检查最终 task、progress、唯一 update sequence、status history、current blocker、失败事务回滚和无死锁。

## 前端与一致性刷新

任务详情展示当前进度、最新进展时间/作者、负责人可见的表单和所有授权读者可见的稳定时间线。时间线显式按 `update_seq` 倒序渲染；空状态为“还没有进展记录”。blocked 表单明确提示恢复仍走 Task 3.3 resume。

所有 RPC success payload 都运行时校验 UUID、enum、整数范围、date、timestamp、nullable 字段、sequence、task scope 和 block linkage。malformed success fail closed，原始 PostgreSQL/Supabase 错误不会进入 UI。

初始加载和 mutation 后刷新同时读取 task、status history 和 progress updates，并有界重试，直到：

- status history 为空时 task 为 `todo`，否则 tail status 等于 task status；
- 最新 update 的 progress、时间和作者等于 task 的 latest progress snapshot；
- block-linked update 的 transition 确实存在；
- 本次 mutation 返回的 update ID（以及可选 block transition ID）已经可见。

若另一个合法进展先于刷新完成，可以展示更新的线性化结果；持续不一致则 fail closed。request/action epoch、scope key 和 mounted ref 阻止 workspace/project/task 切换、A→B→A、导航和卸载后的迟到 success/error 污染新页面。

## 非目标

Task 3.4 自身不实现验收；Task 3.5 的独立边界见 [任务提交验收、通过与退回 V1](task-review-closure.md)。当前仍不实现通知或协助派发、看板 inline mutation、拖拽、批量进展、编辑/删除历史、附件、评论、mention、Stage 4 工作台、微信小程序或 CloudBase 业务桥接，也不新增第三方依赖。
