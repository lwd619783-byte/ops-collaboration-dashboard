# 运维协同看板

> Task 0.2 设计系统和响应式页面骨架已经封板。Task 1.1 当前提供可复现的本地 Supabase migration、类型生成、数据库测试与系统健康页；尚未接入登录、业务表或真实业务数据。正式上线仍以独立远端审计、PR CI 和 Squash 合并为准。

一个面向互联网部署的轻量化运维协同看板前端工程。

## 当前状态

Task 0.1 工程基线和 Task 0.2 设计系统已建立。Task 1.1 增加 Supabase JavaScript 客户端、本地 CLI 项目、基础 migration、pgTAP、生成数据库类型、类型漂移门禁、独立数据库 CI，以及 `/system-health` 健康页。正式完成以远端独立审计和 PR 合并为准。

## 第一阶段边界

当前数据库只包含通用 `updated_at` trigger function 与不读取业务数据的健康检查 RPC，不包含登录、profiles、工作空间、项目/成员/模块/任务管理、提醒、个人待办、业务审计日志或真实业务数据。

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

将 `.env.example` 复制为本地 `.env.local` 后按需调整。应用不依赖 Supabase 配置也可启动；未配置时系统健康页会显示安全的未配置状态。浏览器端只允许使用 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`，不得放入 secret key、service role key、数据库密码或连接串。不要提交真实密钥、令牌、账号或绝对路径；`.env`、`.env.local` 与 `.env.*.local` 已被忽略。

## 目录结构

```text
src/
  app/          # 应用组合、布局、路由与后续 Provider
  components/   # 可复用的反馈、表单和 UI 组件
  features/     # 按业务功能组织的代码
  lib/          # 通用工具
  pages/        # 路由页面
  tests/        # 测试初始化与应用测试
  types/        # 共享类型
```

按实际任务创建文件；不为维持空目录而提交占位文件。

## 公开仓库安全

本仓库不接受真实业务数据、人员或单位信息、内部材料、IP/内部域名、日志、Cookie、Token、密码、私钥、API Key 或本机绝对路径。提交前遵循 [公开开发流程](docs/public-development-workflow.md)。

## Vercel 部署

在 Vercel 中导入仓库后，使用默认的 Vite 构建识别即可：构建命令为 `npm run build`，输出目录为 `dist`。`vercel.json` 为 React Router 的直接访问提供 SPA 回退，不包含令牌或临时预览地址。部署需由已获授权的人员在 Vercel 中发起。

## 当前未实现功能

本仓库尚未实现登录、RLS 业务表、项目协同、任务管理、提醒或远端 Supabase 部署；这些能力只能在新的、明确授权的任务中增加。
