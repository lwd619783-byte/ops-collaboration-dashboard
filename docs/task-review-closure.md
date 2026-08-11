# 任务提交验收、通过与退回 V1

Task 3.5 在 Task 3.1–3.4 的项目任务、只读任务中心、受控状态机和追加式每日进展之上，增加提交验收、通过验收和退回修改闭环。写入口仍只位于任务详情；任务中心继续只读。该任务已完成远端独立审计、PR CI 和 Squash 合并并正式封板。

## 数据模型与权威字段

Migration `20260810180000_task_review_status_actions_v1.sql` 先为共享 `task_status_action` 增加 `submit_review / approve_review / return_review`。枚举变更单独提交迁移，避免 PostgreSQL 在同一事务内立即使用新枚举值的限制。

Migration `20260810180100_task_review_closure_v1.sql` 增加：

- append-only `task_reviews`，包含任务内稳定递增的 `review_seq`、`submit / approve / return` 动作、actor、from/to 状态、退回原因、数据库时间和内部幂等键；
- `status_transition_id` 唯一关联同一任务、同一 actor、同一动作、同一状态和同一时间的 `task_status_history` 记录；
- `tasks.completed_at / completed_by`，只由通过验收在数据库事务中生成；非 completed 状态必须同时为空；
- `task_review_task_snapshot()`、`task_review_snapshot()`、`list_task_reviews()` 和扩展后的安全 `get_task()` 投影。

验收记录禁止 update/delete。authenticated、service role 和普通 SQL 均没有直接写权限；插入 guard 只接受内部受控上下文，并再次验证共享状态历史的一对一链接和完成元数据。

## 语义化 RPC 与权限

公开写入口只有：

- `submit_task_for_review(task_id, idempotency_key)`：当前主要负责人或项目管理者可在 `in_progress` 且 progress 恰为 100 时提交，进入 `pending_review`；
- `approve_task_review(task_id, idempotency_key)`：当前验收人或项目管理者可通过待验收任务，进入 `completed`，同时写入数据库时间和审批人；
- `return_task_review(task_id, return_reason, idempotency_key)`：当前验收人或项目管理者可退回，进入 `in_progress` 并保留 progress。原因 trim 后必填，最长 2000 字符。

不存在可传目标状态、actor 或完成时间的通用 setter。Task 3.3 的 start/block/resume/cancel 和 Task 3.4 的进展 RPC 都拒绝 `pending_review / completed`；V1 不提供 completed 重新打开入口。

## 冻结、幂等与原子性

任务进入 `pending_review` 或 `completed` 后，核心任务字段、协作人和显式可见人集合被冻结。直接访问编辑 deep link 会显示只读冻结说明。只有合法 return 会让任务回到 `in_progress`，随后才能继续编辑或追加进展。

幂等键按 actor 隔离。同一 actor、同一 key、同一 task/action/规范化原因返回原验收记录；同 key 改变 task、动作或原因会稳定冲突。每个成功动作在一个事务中同时完成：

1. 更新任务状态和必要的 completion metadata；
2. 追加连续的共享状态历史；
3. 追加连续的验收记录并写入精确 transition 外键。

任一步失败都会整体回滚，不会留下只有 task、history 或 review 一侧成功的半状态。

## 锁顺序与撤权重检

验收 mutation 沿用既有 project-first 协议：project → 当前 actor 与任务参与者的 app user / workspace membership / project membership（UUID 稳定顺序）→ module → task → history/review append。取得锁后重新解析 `current_app_user_id()`，并重新检查项目可读性、项目归档状态、当前负责人/验收人和项目管理权限。

`scripts/verify-task-concurrency.mjs` 使用两条业务连接和 observer 的 `pg_blocking_pids()` 实测锁等待，覆盖同/不同 key submit 和 approve、submit 与 cancel/progress/edit/archive/负责人替换/成员移除/workspace 或 account suspension、approve 与 return/archive/验收人移除或停用、return 与 cancel。每个场景检查最终 task、progress、blocker、completion metadata、review sequence、共享 history、唯一链接、失败回滚和无死锁。当前脚本总计 127 项检查。

## 前端闭环

任务详情按服务端权限和当前快照显示：

- `in_progress` 小于 100% 时提示先完成进展；达到 100% 后负责人或管理者可确认提交；
- `pending_review` 对验收人或管理者显示“通过验收 / 退回修改”，其他授权读者只看到“等待验收”；
- 退回 Dialog 提供必填原因、2000 字符计数、loading 和安全错误，失败时保留输入与 Dialog；
- `completed` 显示数据库完成时间和审批人，不显示编辑、进展或状态写入口；
- 所有授权读者可查看追加式验收时间线。

mutation 使用浏览器生成的 intent 幂等键，并与既有 action mutex、scope key、action epoch 和 mounted guard 共用迟到响应保护。成功后必须同时读到精确 review、共享 transition、task、progress 和完整 ledger 才提交 UI；跨任务或卸载后的迟到响应会被丢弃。

## 当前不包含

Task 3.5 不增加通知/提醒、附件、评论、mention、看板 inline mutation、拖拽、批量验收、已完成重开、Stage 4 工作台、全局“我的任务”、私人任务、飞书、微信小程序、CloudBase、远端部署或第三方依赖。
