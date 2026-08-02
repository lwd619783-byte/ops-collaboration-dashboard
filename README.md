# 运维协同看板

> Task 0.2 设计系统和响应式页面骨架已经封板。Task 1.1 建立可复现的本地 Supabase migration、类型生成、数据库测试与系统健康页。Task 1.2 在登录之前落地统一系统用户与多身份数据模型（`app_users` / `profiles` / `user_identities` / `identity_binding_challenges` 及解析边界、RLS 与权限矩阵）。Task 1.3 落地网页登录（邮箱 + 密码）、密码找回 / 重置、个人资料编辑与受保护路由：业务页面只允许通过 `current_app_user_id()` 解析到有效内部身份的会话访问，登录 / 找回 / 重置使用独立认证布局，配置了本地 Auth（禁匿名、禁公开注册、仅 loopback 站点与回调地址、本地邮件捕获）。仍不含工作空间、项目 / 任务 / 提醒等业务数据。正式上线仍以独立远端审计、PR CI 和 Squash 合并为准。

一个面向互联网部署的轻量化运维协同看板前端工程。

## 当前状态

Task 0.1 工程基线和 Task 0.2 设计系统已建立。Task 1.1 增加 Supabase JavaScript 客户端、本地 CLI 项目、基础 migration、pgTAP、生成数据库类型、类型漂移门禁、独立数据库 CI，以及 `/system-health` 健康页。Task 1.2 增加统一身份数据模型、解析函数、RLS 与权限矩阵，以及对应的 pgTAP 与前端夹具测试（详见 [统一身份模型](docs/identity-model.md)）。Task 1.3 增加网页认证闭环：AuthProvider 状态机、安全错误映射、安全 returnTo、登录 / 忘记密码 / 重置密码页、受保护路由、个人资料编辑与退出登录；认证过程始终通过 `current_app_user_id()` 解析内部 `app_users.id`，Auth UUID 不作为业务键。正式完成以远端独立审计和 PR 合并为准。

## 第一阶段边界

当前数据库包含通用 `updated_at` trigger function、不读取业务数据的健康检查 RPC，以及 Task 1.2 的统一身份模型（`app_users`、`profiles`、`user_identities`、`identity_binding_challenges` 及相关解析函数与 RLS）。前端已提供邮箱密码登录、密码重置、个人资料编辑与受保护路由；但**不含**公开注册、管理员邀请、工作空间、项目 / 成员 / 模块 / 任务管理、提醒、微信登录 / 小程序 / CloudBase、账号绑定 / 合并流程或真实业务数据。数据库仍只以 `current_app_user_id()` 作为业务访问边界，未新增业务表或弱化 Task 1.2 的安全约束。

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

`npm run check` 按格式、Lint、类型、测试、生产构建的顺序执行。`npm run security:audit` 单独阻断高危和严重依赖漏洞，CI 会在项目检查前运行该命令。

## 环境变量

将 `.env.example` 复制为本地 `.env.local` 后按需调整。所有 `.env` 和 `.env.[mode]` 文件均默认忽略，`.env.example` 是唯一允许提交的环境示例。应用不依赖 Supabase 配置也可启动；未配置时系统健康页会显示安全的未配置状态。

Vite 会在构建阶段把使用到的 `VITE_*` 值写入客户端包，因此生产环境只能配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。部分配置、无效 URL、secret key、service-role JWT 或高权限数据库变量会让 Vite 在启动或构建前直接失败，错误不会输出变量值。客户端工厂不接受调用方传入的 URL 或 key，只能读取并使用通过共享验证器的环境配置。

数据库 migration 已撤销未来 `public` schema 函数的默认执行权限；每个需要公开的 RPC 都必须在创建后显式、审阅并授予目标角色。当前仍未连接远端 Supabase、未配置生产 Vercel，也未实现登录页面、受保护路由或真实的绑定 / 认证 / 微信 / CloudBase 流程。

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

本仓库已实现身份模型的数据结构、解析边界与 RLS，以及网页登录 / 密码重置 / 个人资料 / 受保护路由；但**尚未实现**公开注册、管理员邀请与成员管理、工作空间、项目协同、任务管理、提醒、微信登录 / 小程序 / CloudBase、账号绑定 / 合并流程或远端 Supabase 部署；这些能力只能在新的、明确授权的任务中增加。
