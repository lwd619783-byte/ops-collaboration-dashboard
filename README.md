# 运维协同看板

一个面向互联网部署的小型团队协同工作台，以项目、模块和任务为执行骨架，通过进展、阻塞和验收形成可审计的协作闭环。

## 当前基线

- Web milestone：`Operations Web MVP 1.0 — SEALED`
- Stage 4 functional baseline：`47785559d36f1aab1e1ebc4d5f87ecedfafb8877`
- Trial Admission：`ADMITTED`
- Primary Trial Web：CloudBase
- Secondary / fallback / comparison Trial Web：Vercel
- Authoritative backend：Supabase Trial
- CloudBase security headers：`0/6`，状态仍为 `DEFERRED HARDENING — REQUIRED BEFORE PRODUCTION ADMISSION`
- Production：`NOT CONFIGURED`
- 当前工作模式：`REAL-USAGE FEEDBACK MODE`
- 下一正式阶段：Stage 5 微信小程序 MVP；Task 5.1「微信身份桥接技术验证与威胁模型」尚未开始

这里的 `SEALED` 只表示当前 Web MVP 功能基线已经封板并进入真实使用反馈阶段，不代表 Production 已上线或通过 Production Admission。完整状态与历史边界见 [Operations Web MVP 1.0 封板记录](docs/operations-web-mvp-1.0-closeout.md)。

## 已有 Web 能力

当前 Web 基线已覆盖：

- 统一内部用户、邮箱登录、密码恢复、邀请激活与工作空间权限；
- 项目 CRUD、项目成员 / 牵头人、有序模块；
- 共享任务创建 / 编辑、看板与列表、受控状态机、阻塞恢复；
- 追加式每日进展、提交验收、通过 / 退回与完成态冻结；
- 首页个人工作台、`/tasks` 跨项目个人任务中心；
- Management Workbench V1 与 Team Load Overview V1。

当前仍未把通知 / 提醒、已完成重开、微信小程序、CloudBase 业务桥接、归档恢复 / 物理删除、生产 SMTP、Production Supabase / Web hosting 等能力纳入已完成基线。新能力只在明确授权的后续任务中增加。

## 文档导航

- Agent 项目级边界与上下文路由：[`AGENTS.md`](AGENTS.md)
- 当前 Web MVP 封板状态：[`docs/operations-web-mvp-1.0-closeout.md`](docs/operations-web-mvp-1.0-closeout.md)
- V1.3 历史产品总纲与双端路线图：[`docs/project-construction-plan-v1.3.md`](docs/project-construction-plan-v1.3.md)
- 公开仓库开发与 Git 审计流程：[`docs/public-development-workflow.md`](docs/public-development-workflow.md)
- Supabase / migration / RLS / RPC 本地开发：[`docs/supabase-development.md`](docs/supabase-development.md)
- Trial / Recovery / deployment runbook：[`docs/trial-deployment.md`](docs/trial-deployment.md)
- 统一身份：[`docs/identity-model.md`](docs/identity-model.md)
- 工作空间权限：[`docs/workspace-permissions.md`](docs/workspace-permissions.md)
- UI 设计系统：[`docs/design-system.md`](docs/design-system.md)
- 项目、成员、模块和任务领域文档：按当前任务读取 `docs/project-*` 与 `docs/task-*`

`project-construction-plan-v1.3.md` 和 `trial-deployment.md` 都包含重要历史基线与阶段证据；不要把历史 Task / Stage 步骤自动解释为当前任务指令。

## 技术栈

- React 19 + TypeScript strict
- Vite 8 + Tailwind CSS 4
- React Router 8
- Vitest + React Testing Library
- Supabase PostgreSQL / Auth / Edge Functions
- npm

环境要求以 `package.json` 的 `engines` 为准；数据库开发还需要 Docker Desktop 或兼容 Docker API 的容器运行时。Supabase CLI 使用仓库锁定版本，不依赖全局安装。

## 本地运行

```bash
npm ci
npm run dev
```

生产预览：

```bash
npm run build
npm run preview
```

需要本地数据库时：

```bash
npm run db:start
npm run db:verify
```

数据库完整说明见 [`docs/supabase-development.md`](docs/supabase-development.md)。

## 验证入口

验证强度按改动风险选择；完整项目级映射见 [`docs/public-development-workflow.md`](docs/public-development-workflow.md)。常用入口：

```bash
npm run check
npm run security:audit
npm run db:verify
npm run test:edge
npm run trial:baseline:check
npm run operator:db-credentials:verify
```

`npm run check` 覆盖格式、Lint、类型、单元测试、Trial baseline 静态门禁、前端凭据构建门禁和生产构建。依赖、数据库、Edge Function、Trial / Recovery 或 operator tooling 改动还需要对应专项验证，不应把所有专项命令无差别用于每个任务。

## 环境与安全

本仓库是公开仓库，不接受真实人员、单位、项目、内部工作记录、内部文件、IP / 内部域名 / 网络拓扑、日志、Cookie、Token、密码、私钥、API Key、数据库连接串、Supabase / Vercel / CloudBase / GitHub 凭据或本机绝对路径。

所有 `.env` 和 `.env.[mode]` 文件默认忽略；`.env.example` 是唯一允许提交的环境示例。浏览器构建只允许使用经过共享验证器检查的：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

secret key、service-role JWT、高权限数据库变量和连接串不得进入 `VITE_*`、浏览器包或仓库。

Supabase PostgreSQL 是业务数据权威来源。未来 `public` schema RPC 默认不向客户端角色开放执行权限；确需公开的 RPC 必须通过独立、可审阅的 migration 显式授权。Auth Admin 调用只存在于服务端边界。

## Trial Web

CloudBase 与 Vercel 共享同一个权威 Supabase Trial 后端；CloudBase 只是 primary Web origin，不代表 CloudBase 业务桥接已经实现。当前 CloudBase 仍存在已知 security-header gap，因此 Trial 可继续受控使用，但该问题必须在 Production Admission 前完成 hardening 与独立验证。

任何 Trial / Recovery / Hosted mutation、credential 操作或 Production 配置都应按对应 runbook 与当前任务授权执行，不能从“功能已实现”或“CI 已通过”推导出部署授权。
