# 任务看板和列表 V1

Task 3.2 在 Task 3.1 的项目任务、`can_read_task()` 和安全详情 deep link 基线上增加项目级只读任务中心。路由为 `/projects/:projectId/tasks`，形成“项目详情 → 任务中心 → 看板 / 列表 → 筛选 → 任务详情”的网页浏览闭环。Task 3.3 功能分支把状态操作集中加入任务详情，但任务中心本身继续不提供任何状态或进度写入口。

## 安全列表投影

Migration `20260809180000_task_board_list_v1.sql` 新增 `list_project_tasks(project_id)`。RPC 为 `SECURITY DEFINER`、固定空 `search_path`、所有者 `postgres`，撤销 `PUBLIC`、`anon`、`authenticated` 和 `service_role` 的默认执行权后，仅向 `authenticated` 显式授予执行权限；不接受客户端 actor，身份继续由现有可信身份体系解析。

RPC 首先要求调用者满足 `can_read_project(project_id)`，项目不存在或无权读取时统一返回 `task_not_found_or_forbidden`。返回查询随后对每一行执行 `can_read_task(task_id)`：项目可见任务按项目读取规则返回；restricted 任务仅对项目管理者、任务负责人、协作人、验收人、创建者或显式授权人员返回。

列表投影只包含任务中心需要的 summary 字段：任务 / 项目 / 工作空间 / 模块 ID、模块名、标题、负责人、协作人摘要、优先级、日期、预计工时、工作量、可见性、状态、进度和更新时间。它不返回 description、acceptance criteria、idempotency key、显式可见人员名单、创建 / 删除内部元数据。完整内容继续由 `get_task(task_id)` 的详情投影提供。

所有总数、状态列数量、筛选选项和空状态都只从已经通过逐行授权的 summary 数组生成。数据库不会先统计未授权任务，UI 也不会显示“隐藏任务”或其他存在性提示，因此 ordinary member 无法从数量或筛选侧信道推断 unrelated restricted 任务。

## 前端运行时契约

`TaskSummary` 与完整 `Task` 为独立类型。`taskService.list({ projectId, workspaceId })` 只向 RPC 发送项目 ID，并在成功后逐项验证 UUID、project / workspace scope、标题、模块、负责人、协作人数组与重复 ID、封闭 enum、进度、date-only 日期、nullable 数值和 timestamp。重复任务 ID、畸形数组、错误日期 / 时间、跨 scope payload 或其他 malformed success 均 fail closed；返回对象通过白名单重建，不依赖完整任务私密字段。

任务中心同时加载当前项目、有效模块和已授权 summary。普通 member / viewer 不调用管理型 `list_task_assignment_candidates`；负责人和协作人筛选项只从当前已授权 summary 推导，模块项来自当前项目的安全模块投影。

## 看板、列表与筛选

看板固定使用 `todo / in_progress / blocked / pending_review / completed / cancelled` 六列，并只读展示标题、模块、负责人、优先级、截止日期、逾期文字、进度和可见性。任务卡使用真实 `<Link>` 打开 `/projects/:projectId/tasks/:taskId`；没有拖拽、列点击或状态 mutation。

桌面列表使用语义化表格，展示任务、模块、负责人、状态、优先级、截止日期、进度、逾期和更新时间。窄屏不压缩宽表，而是改用同一 summary 的任务卡。状态、可见性和逾期均有文字，不依赖颜色表达。

看板和列表共享模块、负责人、协作人、状态、优先级及“仅看已逾期”组合筛选。项目本身由路由 `:projectId` 固定，不提供跨项目聚合。无可见任务显示“当前暂无任务”；有任务但筛选结果为空显示“没有符合当前筛选条件的任务”并提供清空筛选。

## 逾期和排序

逾期纯函数使用 date-only 字符串语义：`due_date < today` 且状态不是 `completed` / `cancelled` 时为逾期。今天到期、未来到期、无截止日期、已完成和已取消任务均不逾期。比较不把 `due_date` 传给 `new Date()`，从而避免 UTC 时区跨日。

页面的 `today` 通过浏览器本地 `getFullYear()`、`getMonth()`、`getDate()` 生成 `YYYY-MM-DD`，不使用 `toISOString().slice(0, 10)`。测试显式传入 today，保证确定性。

看板和列表共用稳定排序：逾期优先；有截止日期的较早任务优先；无截止日期后置；再按紧急、高、中、低优先级、更新时间降序和 task ID 升序决胜。

## URL 浏览状态

`view`、`module`、`assignee`、`collaborator`、`status`、`priority` 和 `overdue` 保存在 query string，刷新、复制链接和浏览器前进 / 后退可重建状态。切换 board / list 保留筛选，清空筛选保留当前视图。

view、status 和 priority 只接受封闭词汇；模块、负责人和协作人 ID 还必须存在于当前可信 option 集合。非法 query 值会回落到安全默认值，不进入内部筛选状态，更不会作为权限依据。

## 响应式与异步安全

桌面看板允许状态列横向滚动，表格保留快速扫描宽度；手机看板改为纵向状态列，列表改为任务卡，筛选工具栏换行为单列，链接和按钮不依赖 hover。

页面 scope key 包含 app user、workspace、workspace role 和 project ID。每次加载使用单调 request epoch、当前 scope ref 和 mounted protection；workspace / project / route 发生 A→B→A 变化时，旧 project、modules 或 task list 响应不能覆盖新页面，也不能短暂显示旧 scope 的 restricted 数据或修改新页面的 loading / error 状态。URL 筛选只作用于当前已加载 scope，不写入服务端权限。

## 当前不包含

Task 3.3 不改变本页面的 summary 敏感字段或只读边界。数据库状态变化后，重新进入或刷新任务中心会通过原 `list_project_tasks()` 自然显示最新状态；blocker reason、阻塞人和状态历史只出现在授权的任务详情。任务中心仍不实现 progress mutation、拖拽、inline action、批量操作、通知、飞书、微信小程序、私人任务、甘特图、团队负荷、全局“我的任务”或阶段 4 管理者工作台。

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
