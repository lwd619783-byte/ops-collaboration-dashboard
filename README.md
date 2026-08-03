# 运维协同看板

> Task 0.2 设计系统和响应式页面骨架已经封板。Task 1.1 建立可复现的本地 Supabase migration、类型生成、数据库测试与系统健康页。Task 1.2 落地统一系统用户与多身份解析边界。Task 1.3 落地网页登录、密码恢复、个人资料与受保护路由。Task 1.4 新增工作空间、成员角色和状态、默认工作空间受控初始化、服务端邀请、首次激活及成员管理页；业务身份仍只通过 `current_app_user_id()` 解析，浏览器不持有高权限凭据。项目 / 任务 / 提醒等业务数据仍未实现。正式上线仍以独立远端审计、PR CI 和 Squash 合并为准。

一个面向互联网部署的轻量化运维协同看板前端工程。

## 当前状态

Task 0.1 至 Task 1.3 已建立前端、数据库、统一身份与网页登录基线。Task 1.4 增加 `workspaces`、`workspace_members`、`workspace_invitations`，四级角色与成员 / 邀请状态机，默认拒绝 RLS、最小 RPC、Auth 原子预配置 trigger，以及受信任 `invite-workspace-member` Edge Function。前端提供工作空间门禁、成员目录、owner/admin 管理入口和首次受邀激活页；邀请邮箱在业务数据库只保留 SHA-256 摘要和遮罩提示。独立审计修复已完成数据库唯一 owner 强制、邀请 TTL 与过期重邀、**已有受邀身份的重发闭环**（`operation_kind` 区分首次 / 重发、`reissue_prepared` 状态与 `reissue_of_invitation_id` 关联、服务专用 `finalize_workspace_invitation_reissue`、锁后 `clock_timestamp()` 时间语义、成员目录 `pending_invitation` 区分）、首次激活 `USER_UPDATED` 恢复、成员目录 profile 缺失回退、幂等并发加固与 Edge 真实入口 CI（`deno check`）。详见 [工作空间与成员权限](docs/workspace-permissions.md)。正式完成仍以远端独立审计和 PR 合并为准。

## 第一阶段边界

当前数据库包含健康检查、统一身份模型以及 Task 1.4 工作空间权限模型。前端已提供邮箱密码登录、密码恢复、个人资料、工作空间门禁、成员目录与邀请激活闭环。Task 1.4 只处理工作空间级别的成员关系，不含公开注册、项目 CRUD、项目角色 / 模块、任务 / 进展 / 验收 / 提醒、工作空间所有权转移 / 删除、成员永久删除、批量邀请、完整撤销 / 重发界面、确认 Auth 用户跨空间自动加入、账号绑定 / 合并、微信 / 小程序 / CloudBase、飞书、通用审计日志、生产 SMTP 或远端部署。

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
```

`npm run check` 按格式、Lint、类型、测试、生产构建的顺序执行。`npm run security:audit` 单独阻断高危和严重依赖漏洞，CI 会在项目检查前运行该命令。Edge Function 另有明确的两个测试文件（`npm run test:edge` 运行 `handler.test.ts` 与 `entry.test.ts`）与真实入口类型检查（`deno check supabase/functions/invite-workspace-member/index.ts`，CI 使用固定版本 Deno 2.2.12）。真实本地 Auth 重发集成验证由 `npm run db:reissue:verify` 执行（前置见脚本头部注释）。

## 环境变量

将 `.env.example` 复制为本地 `.env.local` 后按需调整。所有 `.env` 和 `.env.[mode]` 文件均默认忽略，`.env.example` 是唯一允许提交的环境示例。应用不依赖 Supabase 配置也可启动；未配置时系统健康页会显示安全的未配置状态。

Vite 会在构建阶段把使用到的 `VITE_*` 值写入客户端包，因此生产环境只能配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。部分配置、无效 URL、secret key、service-role JWT 或高权限数据库变量会让 Vite 在启动或构建前直接失败，错误不会输出变量值。客户端工厂不接受调用方传入的 URL 或 key，只能读取并使用通过共享验证器的环境配置。

数据库 migration 已撤销未来 `public` schema 函数的默认执行权限；每个需要公开的 RPC 都必须在创建后显式、审阅并授予目标角色。工作空间邀请的 Auth Admin 调用只存在于 Edge Function，读取 Supabase 托管的服务端环境变量；secret key、service-role key、数据库连接串均不进入 `VITE_*`、浏览器包或仓库。当前仍未连接或修改远端 Supabase，也未配置生产 Vercel。

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

## Vercel 部署

在 Vercel 中导入仓库后，使用默认的 Vite 构建识别即可：构建命令为 `npm run build`，输出目录为 `dist`。`vercel.json` 为 React Router 的直接访问提供 SPA 回退，不包含令牌或临时预览地址。部署需由已获授权的人员在 Vercel 中发起。生产环境只需配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。

## 当前未实现功能

本仓库已实现身份、认证和工作空间成员权限 V1；但**尚未实现**公开注册、项目协同、项目成员 / 角色、任务 / 进展 / 验收 / 提醒、工作空间所有权转移 / 删除、成员永久删除、批量邀请、完整邀请撤销 / 重发界面、确认 Auth 用户跨工作空间自动加入、微信 / 小程序 / CloudBase、飞书、通用审计日志、生产 SMTP、Vercel 生产配置或远端 Supabase 部署。这些能力只能在新的、明确授权的任务中增加。
