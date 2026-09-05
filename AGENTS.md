# 运维协同看板项目级 AGENTS.md

本文件只定义本仓库的**项目级事实源、永久边界、任务路由和 Git 审计边界**。通用沟通、自主推进、提问、Sub-Agent 和通用验证偏好由 Codex 全局个性化负责，不在这里重复。

只读取完成当前任务所需的最小上下文。不要因为某个历史总纲或 runbook 很重要，就在每次任务中完整载入它。

## 1. 事实源与历史边界

- `README.md` 与 `docs/operations-web-mvp-1.0-closeout.md` 用于当前 Web milestone、Trial / Production 状态和稳定导航；若后续存在明确 supersede 的新状态文档，以新文档声明的范围为准。
- `docs/project-construction-plan-v1.3.md` 是受保护的历史产品总纲、双端路线图和阶段基线。只在产品范围、新阶段或相关业务语义需要时读取对应章节；不要把已完成阶段的执行步骤当成当前任务指令，也不要为了同步现状回写历史基线。
- `docs/trial-deployment.md` 是受保护的 Trial / Recovery / deployment runbook 与证据基线。只有部署、恢复、环境门禁、Hosted Trial 或 Production Admission 任务才读取对应章节。
- 具体身份、权限、项目、模块、任务和验收语义以相关领域文档、数据库 migration、测试和当前代码共同判断；文档声明不能替代真实实现证据。
- 历史 SHA、Task / Stage 状态和旧审计结论只代表其记录时点，除非文档明确声明为当前有效基线。

## 2. 永久不变量

- 本仓库是公开仓库。不得提交真实人员、单位、项目、内部工作记录、内部文件、IP / 内部域名 / 网络拓扑、日志、Cookie、Token、密码、私钥、API Key、数据库连接串、Supabase / Vercel / CloudBase / GitHub 凭据或本机绝对路径。
- 保持 TypeScript strict；不得用无理由的 `any`、`@ts-ignore`、关闭检查规则或削弱测试 / 权限来让实现通过。
- Supabase PostgreSQL 是业务数据权威来源；不要为其他客户端或托管平台复制第二套项目 / 任务主数据。
- 内部业务用户与外部登录身份保持分离。业务表使用稳定的 `app_users.id`；外部 subject / OpenID / Auth UUID 不直接成为业务主键，也不接受客户端自行声明业务 user id。
- 后端 RLS、受控 RPC、数据库约束和服务端边界才是权限边界；前端隐藏按钮或路由不是安全控制。
- Trial、Recovery 与 Production 是不同环境和授权域。不得把 Trial 通过、功能实现或 CI 通过解释为 Production Admission。
- Hosted 数据写入、migration、恢复、credential bootstrap、身份 rebind、真实邀请 / token 消费、Production 配置或部署等高风险操作，只能在当前任务明确授权并满足对应 runbook / gate 时执行。
- 不为“保持一致”改写已经封板的历史基线、审计结论或证据文档；需要改变现行治理时新增或更新当前事实源。

## 3. 按任务读取上下文

- **普通 UI / 页面 / 交互：** 目标代码与测试；涉及视觉、响应式、日期或反馈状态时再读 `docs/design-system.md`。
- **身份 / 登录 / 邀请 / 账号绑定：** `docs/identity-model.md`、`docs/workspace-permissions.md`，再读目标代码、migration、Edge Function 和测试。
- **项目 / 成员 / 模块：** 分别读取 `docs/project-crud-and-visibility.md`、`docs/project-membership-and-lead.md`、`docs/project-modules.md` 中与任务直接相关的文档。
- **任务闭环：** 根据任务读取 `docs/task-data-model-and-editing.md`、`docs/task-board-and-list.md`、`docs/task-status-transitions.md`、`docs/task-daily-progress.md`、`docs/task-review-closure.md` 中必要部分。
- **数据库 / migration / RLS / RPC：** `docs/supabase-development.md` 加目标 migration、pgTAP / concurrency tests 和生成类型；不要为了普通前端任务载入全部数据库历史。
- **Trial / Recovery / Hosted deployment：** 读取 `docs/trial-deployment.md` 的目标章节；只有 TokenHash 恢复场景再读 `docs/trial-password-recovery-tokenhash-runbook.md`。
- **产品范围 / 新阶段 / 微信小程序：** 读取 `docs/project-construction-plan-v1.3.md` 的相关章节、当前 closeout / 状态文档和当前任务授权，不需要从头到尾加载 V1.3。

## 4. 公开开发与 Git 边界

详细流程见 `docs/public-development-workflow.md`。

默认项目流程保持：最新 `main` → 独立功能分支 → 与风险匹配的验证 → 普通 push → exact-head CI → 基于远端 `main...branch` 独立审计 → 修复 / 复审 → 审计通过后 PR → PR CI → Squash Merge → post-merge 核验。

除非当前任务明确授权，不直接修改或合并 `main`，不在独立审计前创建 PR，不 force push，不重写已推送历史，不删除或覆盖用户已有修改。
