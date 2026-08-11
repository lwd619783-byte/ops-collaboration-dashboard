# 项目工作模块 V1

Task 2.3 在现有项目 CRUD、项目成员和统一 `app_user_id` 权限边界上增加平级、有序的工作模块。实现仍是 local-first migration；已封板的 Task 3.1 按本文件原有外键契约接入项目任务，但仍不引入拖拽、子模块或模板管理后台。

## 数据模型

正式 migration 为 `supabase/migrations/20260806140000_project_modules_v1.sql`。`public.project_modules` 包含：

- 稳定 `id`；
- `project_id`，以 `ON DELETE RESTRICT` 归属唯一项目；
- 规范化 `name`，最长 120 个字符；
- 零起点 `sort_position`；
- `created_by`、`updated_by`、`deleted_by`，全部引用 `app_users.id`；
- `created_at`、`updated_at`、`deleted_at`。

模块名由数据库内部 `normalize_project_module_name(text)` 去除首尾空白，并把连续空白折叠为一个普通空格。空名称、仅空白名称、未规范化名称和超过 120 个字符的名称均由数据库约束拒绝；前端使用同一长度限制并在提交前规范化。一个项目内的有效模块采用规范化后不区分大小写的唯一名称，不允许依赖大小写或空白差异制造表面重复。不同项目可以使用同名模块。

有效模块的 `(project_id, sort_position)` 唯一，位置不得为负数。所有业务写 RPC 都把有效序列规范化为 `0..n-1`；查询再以 `sort_position, id` 形成稳定顺序。已删除行不参与有效名称、位置、读取或排序。

## 权限矩阵

| 操作者                                                | 读取有效模块 | 新增 / 改名 / 排序 / 删除 |
| ----------------------------------------------------- | ------------ | ------------------------- |
| 项目 owner                                            | 允许         | 允许                      |
| 项目 lead                                             | 允许         | 允许                      |
| 项目 member / viewer                                  | 允许         | 拒绝                      |
| 现有项目规则授权的工作空间 owner / admin              | 允许         | 允许                      |
| 非项目成员且不具备上述管理能力                        | 拒绝         | 拒绝                      |
| 已移出项目、工作空间成员失效、app user 停用或身份撤销 | 立即拒绝     | 立即拒绝                  |
| 归档项目的仍有效读者                                  | 允许只读     | 拒绝                      |

模块权限直接复用 `can_read_project()`、`can_manage_project_members()`、`project_role_for_current_user()` 和 `lock_membership_participants()`，不维护第二套角色解释。浏览器对 `project_modules` 只有经过列审阅的 RLS 读取能力，没有直接 `INSERT`、`UPDATE` 或 `DELETE`；写按钮只是体验层，数据库 RPC 才是最终权限边界。

所有浏览器 RPC 均为 `SECURITY DEFINER`、固定空 `search_path`、所有者 `postgres`，创建后先撤销 `PUBLIC`、`anon`、`authenticated`、`service_role` 默认执行权，再只向 `authenticated` 授予所需入口。RPC 不接受操作者 ID，统一通过 `current_app_user_id()` 解析。

## 运维预设

创建项目表单提供“同时创建运维预设模块”复选项，默认不勾选。唯一可执行权威定义是数据库内部 `operations_project_module_presets()`：

1. 准备与计划
2. 实施与变更
3. 验证与观察
4. 收尾与复盘

前端只提交 `p_initialize_modules` 布尔值，不复制预设名称。测试通过查询权威函数核对创建结果，也不维护第二份名称数组。

`create_project` 保留原八参数签名作为“默认不创建预设”的兼容包装器，并新增无默认参数的九参数重载，避免签名歧义。`projects.module_preset_initialized` 是不可变的内部幂等输入：同一幂等键用不同预设选择重试会稳定冲突。项目、owner 关系和全部预设模块在同一数据库事务中插入；任一模块失败会回滚项目和全部模块。

九参数入口在读取幂等项目或写入任何业务行之前调用内部 `lock_workspace_project_creator(workspace_id)`。该函数只从 `current_app_user_id()` 解析操作者，依次锁定目标 `workspaces` 行、actor 的 `app_users` 行、目标工作空间中的 actor `workspace_members` 行，然后重新调用唯一权威规则 `can_manage_workspace_projects()`。锁后只有 active app user、active workspace membership 且角色仍为 owner / admin 的操作者可以继续；member、external collaborator、suspended membership、inactive app user、撤销身份、未知工作空间和无权限工作空间统一得到 `42501 project_permission_denied`。八参数包装器委托九参数入口，因此使用相同边界。

锁顺序与撤权操作不存在反向等待：workspace role/status RPC 锁目标成员行后不再请求 workspace 或 app-user 行；app-user 状态写锁 app-user 行后不再请求 workspace 行。若 owner 已锁住 admin 的成员行准备降权，项目创建会在第三步真实等待；降权提交后，创建请求在锁内重新鉴权并失败，不会查询幂等项目，也不会留下 project、project owner relation 或预设模块。反过来，创建先取得三类锁时，后续撤权会等到原子创建事务完成。

## 写入、排序和锁

模块新增、改名、完整排序与删除依次使用：

- `add_project_module(project_id, name)`；
- `rename_project_module(project_id, module_id, name)`；
- `reorder_project_modules(project_id, module_ids[])`；
- `delete_project_module(project_id, module_id)`。

每次写入都保持相同锁顺序：

1. `projects` 目标行；
2. actor 的 `app_users` 行；
3. actor 在目标工作空间的 `workspace_members` 行；
4. 需要时按模块 `id` 稳定锁定有效模块行。

锁建立后重新校验操作者仍有效、仍有管理能力且项目未归档。新增位置完全由数据库在项目锁内计算，不信任客户端位置。改名锁内复核模块仍有效且属于目标项目。

排序必须提交当前全部有效模块 ID。数据库拒绝 NULL、重复、缺失、多余、已删除和跨项目 ID；验证通过后先把全部位置移到不冲突区间，再在同一事务中写入完整零起点序列，因此任意交换都不会触发中间唯一冲突或留下部分顺序。项目行锁使同一项目的新增、排序和删除线性化；不同项目保持隔离。

`scripts/verify-project-module-concurrency.mjs` 使用独立随机夹具、多个真实 PostgreSQL 连接、`lock_timeout`、`statement_timeout` 和 observer 连接。observer 通过 `pg_blocking_pids()` 证明发生实际锁等待后才释放首事务，共执行 28 项检查，覆盖：workspace admin 在项目创建等待期间被 owner 降为 member（创建以 `42501` 失败且 project / project_members / project_modules 均为 0）、并发新增、并发完整重排、删除与排序、等待期间 lead 被降级、等待期间项目归档、跨项目模块混入。脚本在 `finally` 中只清理本轮随机工作空间夹具，不输出连接串、JWT 或密钥。

## 删除策略与 Task 3.1 落地

V1 采用受控软删除：浏览器不能直接 `DELETE`，只能调用 `delete_project_module()`；RPC 写入 `deleted_at` / `deleted_by`，随后在同一事务中压紧剩余有效位置。已删除模块不可恢复、不可更新、不可读取、不可排序，也不会长期占用有效名称或位置。Task 3.1 起，已被任一任务引用的有效模块会稳定返回 `project_module_not_empty`，不会写入删除标记或移动任务。

Task 3.1 已实现以下契约：

1. `tasks.module_id` 必须是非空、引用 `project_modules.id` 的 `ON DELETE RESTRICT` 外键；
2. 任务创建只能选择同项目且 `deleted_at IS NULL` 的模块，并在并发边界内重新验证；
3. `delete_project_module()` 必须在相同项目锁事务中检查是否存在任务；存在任务时返回稳定 `project_module_not_empty`，不得写入 `deleted_at`，不得依赖原始外键错误作为用户提示；
4. 任务写入与模块删除必须采用兼容锁顺序，避免“检查为空后又插入任务”的竞态；
5. 物理清理即使未来引入，也必须继续受 `ON DELETE RESTRICT` 保护。

`tasks` 通过 `(module_id, project_id)` 复合外键证明模块与项目一致；任务创建 / 编辑和模块删除都先锁项目，再按兼容顺序锁定参与方与模块，因此并发 create task / delete module 不能产生指向软删除模块的任务。完整实现见 [任务数据模型与创建编辑 V1](task-data-model-and-editing.md)。

## 前端与服务边界

`src/features/projects` 提供严格 `ProjectModule` 模型、RPC 参数映射、运行时形状校验、项目作用域校验、连续位置与唯一 ID 校验，以及稳定错误到安全中文提示的映射。畸形、跨项目、顺序缺口或重复 ID 的响应统一安全失败，组件不直接消费未验证数据库载荷。

项目详情的“工作模块”区域独立显示加载、错误重试、无权限、空状态、数量、只读原因和管理操作。owner / lead 及现有规则授权的工作空间管理员可新增、改名、上移、下移和确认删除；member / viewer 与归档项目只读。首项不能上移、末项不能下移，所有提交期间禁用重复操作。新增、改名和删除失败使用 `role="alert"` 且只在当前活动模态对话框内部显示，避免 inert 页面背景中的错误不可见或被重复播报；对话框保持打开、确认按钮恢复可用，修改输入或关闭对话框会清除旧错误。没有对话框的排序失败仍在模块区域显示页面级 alert。组件以项目作用域 key、请求 epoch、动作 epoch 和卸载失效共同阻止快速点击、乱序响应、工作空间切换、项目切换及 A→B→A 返回时的旧响应覆盖。

## 本轮不包含

Task 3.1 已提供任务数据模型和创建 / 编辑，Task 3.2 已提供项目级只读任务列表 / 看板；正式状态机、每日进展、阻塞流程、验收闭环、通知、完整操作日志、任务回收站、拖拽状态修改、嵌套或子模块、自定义模板库、模板版本、模块复制、批量导入和批量编辑仍不在当前范围。

## 本地验证

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:modules:verify
npm run db:membership:verify
npm run db:tasks:verify
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
npm run check
npm run security:audit
git diff --check
```
