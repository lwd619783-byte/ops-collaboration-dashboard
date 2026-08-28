# 运维协同看板

> Task 0.1–3.5 已完成远端独立审计、PR CI 和 Squash 合并，Stage 3 Web Core MVP 已封板。Stage 4.1 已完成首页工作台 V1、跨项目“我的任务”V1 与数据库权威的 `list_my_tasks(p_workspace_id)` 只读 RPC 代码实现；Stage 4.1 migration 已部署到 Trial，`public.list_my_tasks(uuid)` 远端验证与 Hosted Trial 真实浏览器验证均为 PASS。Task 3.9.3-R7 的历史结论仍为 Trial Admission NOT ADMITTED。后续 R7-D1 架构感知只读复核确认 Hosted Auth Site URL 是授权 `CLOUDBASE_TRIAL_ORIGIN`；R7-B001 已重分类为 validation-model false positive。D3 将 CloudBase 定为 primary Trial Web、Vercel 定为 secondary / fallback，并把仍为 0/6 的 R7-B002 重分类为 `DEFERRED HARDENING — REQUIRED BEFORE PRODUCTION ADMISSION`；这是风险排期，不是技术修复或风险豁免。上一轮 Final R7 在核心写入闭环前 fail closed，fresh full Trial Smoke/E2E 尚未执行，因此 Trial 仍为 `NOT ADMITTED`。Recovery Drill 已完成，Production 尚未配置。业务身份仍只通过 `current_app_user_id()` 解析，浏览器不持有高权限凭据。

一个面向互联网部署的轻量化运维协同看板前端工程。

项目最高级路线与范围约束见 [《运维协同看板第一版建设方案 V1.3（受控试运行版）》](docs/project-construction-plan-v1.3.md)。试运行环境模型、目标门禁、迁移、Edge Function、Vercel / CloudBase Web、回滚和准入边界见 [试运行部署基线与环境门禁 V1](docs/trial-deployment.md)。

## 当前状态

Task 0.1 至 Task 1.4 已建立前端、数据库、统一身份、网页登录与工作空间权限基线。Task 2.1–2.3 已完成项目 CRUD、项目成员/牵头人和有序模块；Task 3.1–3.5 已完成共享任务、只读浏览、受控状态机、每日进展和提交/退回/通过验收闭环。详见 [工作空间与成员权限](docs/workspace-permissions.md)、[项目 CRUD、可见性与归档 V1](docs/project-crud-and-visibility.md)、[项目成员与牵头人 V1](docs/project-membership-and-lead.md)、[项目工作模块 V1](docs/project-modules.md)、[任务数据模型与创建编辑 V1](docs/task-data-model-and-editing.md)、[任务看板与列表 V1](docs/task-board-and-list.md)、[任务状态流转与阻塞 V1](docs/task-status-transitions.md)、[每日任务进展与进度同步 V1](docs/task-daily-progress.md) 和 [任务提交验收、通过与退回 V1](docs/task-review-closure.md)。

Stage 4.1 已实现首页个人工作台与 `/tasks` 跨项目任务中心，复用同一个 `list_my_tasks(p_workspace_id)` 只读 RPC，并以现有项目/任务权限函数限制责任任务范围。对应 migration 已部署到 Trial，`public.list_my_tasks(uuid)` 远端验证与 Hosted Trial 真实浏览器验证均为 PASS。Task 3.9.3-R7 已完成准确 main、CI、local gates、Trial target、migration、Edge Function、授权 Vercel deployment 与 Hosted Auth URL 的只读追溯，并因当时两个前置 Blocker 停止全部写入型 mandatory E2E。R7-D1 随后确认当前架构是同一 Supabase Trial 后端服务两个授权 Web origin；Hosted TokenHash 模板及 redirect allowlist 与代码契约兼容，R7-B001 因 Vercel-only 假设而成为 false positive。当前治理优先级为 CloudBase primary、Vercel secondary / fallback / comparison。CloudBase 的 6 项安全响应头仍为 0/6，功能路由与 Vercel 已验证一致但安全头态势并不等价；R7-B002 已延期为 Production Admission 前必须处理的 hardening gate，不再单独阻断 fresh Trial E2E。R7 历史结果没有改写，fresh full E2E 尚未执行，Trial Admission 继续为 `NOT ADMITTED — FRESH FULL TRIAL SMOKE/E2E REQUIRED`。Recovery Drill 已完成；Local Database Credential Bootstrap V1 仅是 Windows 本机 operator tooling，不授予 write、migration、PLAN 或 APPLY 权限。Production Supabase 与 Production Web hosting 仍未创建或配置。

## 第一阶段边界

当前数据库包含健康检查、统一身份、工作空间权限以及项目、成员、有序模块、项目任务、受控任务状态机、状态历史、追加式每日进展、验收记录和跨项目个人责任任务只读 RPC。前端已提供邮箱密码登录、密码恢复、个人资料、工作空间门禁、成员目录、邀请激活，项目闭环、任务核心闭环、首页个人工作台和 `/tasks` 个人任务中心。当前仍不含通知 / 提醒、已完成重开、管理者综合工作台、团队负荷、微信小程序、CloudBase 业务桥接、归档恢复或物理删除，也不扩大工作空间所有权、邀请、账号绑定、外部平台、生产 SMTP 或远端部署边界。

## 技术栈

- React + TypeScript（严格模式）
- Vite + Tailwind CSS 4（官方 Vite 插件）
- React Router 8
- ESLint + Prettier
- Vitest + React Testing Library + jest-dom

## 环境要求

- Node.js 22.22.0 或更高版本
- npm 10 或更高版本
- Docker Desktop 或兼容 Docker API 的容器运行时（数据库开发需要）

## 本地运行

```bash
npm ci
npm run dev
```

浏览器访问命令输出的本地地址。生产预览可依次运行：

```bash
npm run build
npm run preview
```

需要验证数据库或系统健康页时，先启动本地 Supabase：

```bash
npm run db:start
npm run db:verify
npm run db:membership:verify
npm run db:modules:verify
npm run db:tasks:verify
```

完整流程、环境变量边界与 migration 规范见 [Supabase 本地开发](docs/supabase-development.md)。

## 质量检查

以下命令均已作为项目脚本提供：

```bash
npm run format:check
npm run security:audit
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
npm run trial:baseline:check
npm run operator:db-credentials:verify
```

`npm run check` 按格式、Lint、类型、测试、Trial 部署基线静态门禁、前端凭据构建门禁和生产构建的顺序执行。`npm run operator:db-credentials:verify` 在 Windows 上同时使用 Windows PowerShell 5.1 与已安装 PowerShell 7 执行 synthetic DPAPI、target、redaction、CA 与 cleanup 回归；不读取或写入真实 Trial/Recovery 凭据。`npm run security:audit` 单独阻断高危和严重依赖漏洞，CI 会在项目检查前运行该命令。Edge Function 另有明确的两个测试文件（`npm run test:edge` 运行 `handler.test.ts` 与 `entry.test.ts`）与真实入口类型检查（`deno check supabase/functions/invite-workspace-member/index.ts`，CI 使用固定版本 Deno 2.2.12）。真实本地 Auth 重发集成验证由 `npm run db:reissue:verify` 执行；Recovery Auth tenant rebind 的离线 PLAN/APPLY 回归由 `npm run db:recovery-rebind:verify` 执行；真实项目成员、项目模块和项目任务并发验证分别由 `npm run db:membership:verify`、`npm run db:modules:verify` 和 `npm run db:tasks:verify` 执行。Recovery 与三类项目并发脚本都已纳入 `db:verify`，且只使用 loopback 本地 Supabase 与随机虚构夹具。

## 环境变量

将 `.env.example` 复制为本地 `.env.local` 后按需调整。所有 `.env` 和 `.env.[mode]` 文件均默认忽略，`.env.example` 是唯一允许提交的环境示例。应用不依赖 Supabase 配置也可启动；未配置时系统健康页会显示安全的未配置状态。

Vite 会在构建阶段把使用到的 `VITE_*` 值写入客户端包，因此生产环境只能配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。部分配置、无效 URL、secret key、service-role JWT 或高权限数据库变量会让 Vite 在启动或构建前直接失败，错误不会输出变量值。客户端工厂不接受调用方传入的 URL 或 key，只能读取并使用通过共享验证器的环境配置。

数据库 migration 已撤销未来 `public` schema 函数的默认执行权限；每个需要公开的 RPC 都必须在创建后显式、审阅并授予目标角色。工作空间邀请的 Auth Admin 调用只存在于 Edge Function，读取 Supabase 托管的服务端环境变量；secret key、service-role key、数据库连接串均不进入 `VITE_*`、浏览器包或仓库。Trial Supabase 以及授权 Vercel / CloudBase Web origin 已建立；Production Supabase 与 Production Web hosting 尚未配置。

## 目录结构

```text
src/
  app/          # 应用组合、布局、路由与 Provider
  components/   # 可复用的反馈、表单和 UI 组件
  features/     # 按业务功能组织的代码（含 auth 认证特性）
  lib/          # 通用工具
  pages/        # 路由页面（含 auth 认证页面）
  tests/        # 测试初始化与应用测试
  types/        # 共享类型
```

按实际任务创建文件；不为维持空目录而提交占位文件。

## 公开仓库安全

本仓库不接受真实业务数据、人员或单位信息、内部材料、IP/内部域名、日志、Cookie、Token、密码、私钥、API Key 或本机绝对路径。提交前遵循 [公开开发流程](docs/public-development-workflow.md)。

## Trial Web 前端部署

当前 Trial Web 前端以 CloudBase 为 primary origin，以 Vercel 为 secondary / fallback / comparison origin；两者共用同一个权威 Supabase Trial 后端。CloudBase 在这里仅承担静态 Web hosting，不代表 CloudBase 业务桥接已经实现。构建命令为 `npm run build`，输出目录为 `dist`；`vercel.json` 为 Vercel 的 React Router 直接访问提供 SPA 回退。平台只允许配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY` 两项 browser-safe 变量。只读核验确认两端 7/7 SPA browser routes 可用；CloudBase 当前 6 项安全响应头为 0/6，Vercel 为 6/6，因此只有功能路由 parity，没有 security-header parity。该已知风险允许在受控 Trial 中延期，但在 Production Admission 前必须完成 hardening 与独立验证；fresh full Trial Smoke/E2E 仍须单独执行并通过。本仓库本轮不执行 Vercel / CloudBase 部署，也不配置 Production。

## 当前未实现功能

本仓库已实现身份、认证、工作空间成员权限 V1、项目 CRUD / 可见性 / 归档 V1、项目成员 / 牵头人 V1、项目工作模块 V1、Task 3.1–3.5 任务核心闭环，以及 Stage 4.1 首页个人工作台和跨项目“我的任务”V1；但**尚未实现或执行**公开注册、项目邀请 / 审批、拖拽状态修改、已完成重开、通知 / 提醒、管理者综合工作台、团队负荷、私人任务 / 个人空间、归档恢复或物理删除、工作空间所有权转移 / 删除、成员永久删除、批量项目成员操作、完整邀请撤销 / 重发界面、确认 Auth 用户跨工作空间自动加入、微信小程序、CloudBase 业务桥接、飞书、通用审计日志、生产 SMTP、Vercel Production 配置或 Production Supabase 部署。这些能力只能在新的、明确授权的任务中增加。
