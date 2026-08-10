# 运维协同看板

> Task 0.2 设计系统和响应式页面骨架已经封板。Task 1.1 建立可复现的本地 Supabase migration、类型生成、数据库测试与系统健康页。Task 1.2 落地统一系统用户与多身份解析边界。Task 1.3 落地网页登录、密码恢复、个人资料与受保护路由。Task 1.4 新增工作空间、成员角色和状态、默认工作空间受控初始化、服务端邀请、首次激活及成员管理页。Task 2.1 新增项目 CRUD、受控可见性和不可逆归档；Task 2.2 新增 owner/lead/member/viewer 强约束、可信成员 RPC、跨表 TOCTOU 锁边界、归档项目不阻塞人员停用的职责区分、当前/历史成员计数与真实并发验证；Task 2.3 新增有序项目模块、可选运维预设、受控改名 / 排序 / 删除、项目创建锁后重新鉴权及真实锁竞争验证。Task 3.1 新增项目任务数据模型、创建 / 详情 / 编辑 V1、任务可见性、幂等创建、乐观并发和真实任务锁竞争验证。Task 3.2 新增安全任务 summary 投影、项目级只读看板 / 表格、组合筛选、逾期提示和 URL 浏览状态。Task 3.3 新增受控 start/block/resume/cancel 状态机、当前 blocker、追加式状态历史、幂等与真实锁竞争验证。Task 3.4 新增追加式每日进展、原子 progress/最新进展同步、协助标志、时间线，以及复用 Task 3.3 的进展+阻塞联动。Task 3.5 功能分支新增提交验收、通过、退回、数据库权威完成信息、追加式验收记录与真实锁竞争验证。业务身份仍只通过 `current_app_user_id()` 解析，浏览器不持有高权限凭据。通知和提醒仍未实现。正式完成仍以独立远端审计、PR CI 和 Squash 合并为准。

一个面向互联网部署的轻量化运维协同看板前端工程。

## 当前状态

Task 0.1 至 Task 1.4 已建立前端、数据库、统一身份、网页登录与工作空间权限基线。Task 2.1 增加项目 CRUD、关系可见性、乐观并发和不可逆归档；Task 2.2 演进为唯一 owner、可选唯一 lead、普通 member/viewer、延迟一致性约束、默认拒绝 RLS 与锁内可信 RPC；Task 2.3 增加平级有序模块、原子预设初始化与移动端可访问管理界面；Task 3.1 增加只属于项目的共享任务、受控创建 / 编辑与安全 deep link；Task 3.2 增加项目级任务浏览中心；Task 3.3 增加任务详情状态操作、阻塞信息和状态历史；Task 3.4 增加负责人每日进展、progress 写入、最新进展元数据、协助标志、授权时间线和原子阻塞联动；Task 3.5 功能分支增加提交验收、通过、退回、完成信息和验收时间线。详见 [工作空间与成员权限](docs/workspace-permissions.md)、[项目 CRUD、可见性与归档 V1](docs/project-crud-and-visibility.md)、[项目成员与牵头人 V1](docs/project-membership-and-lead.md)、[项目工作模块 V1](docs/project-modules.md)、[任务数据模型与创建编辑 V1](docs/task-data-model-and-editing.md)、[任务看板与列表 V1](docs/task-board-and-list.md)、[任务状态流转与阻塞 V1](docs/task-status-transitions.md)、[每日任务进展与进度同步 V1](docs/task-daily-progress.md) 和 [任务提交验收、通过与退回 V1](docs/task-review-closure.md)。正式完成仍以远端独立审计和 PR 合并为准。

## 第一阶段边界

当前数据库包含健康检查、统一身份、工作空间权限以及项目、成员、有序模块、项目任务、受控任务状态机、状态历史、追加式每日进展和验收记录。前端已提供邮箱密码登录、密码恢复、个人资料、工作空间门禁、成员目录、邀请激活，项目列表 / 创建 / 详情 / 编辑 / 归档 / 成员管理 / 工作模块闭环，以及任务创建 / 详情 / 核心元数据编辑、项目级只读任务看板 / 列表、任务详情 start / block / resume / cancel、每日进展、提交验收、通过、退回和授权时间线。当前仍不含通知 / 提醒、已完成重开、Stage 4 工作台、微信小程序、CloudBase 业务桥接、归档恢复或物理删除，也不扩大工作空间所有权、邀请、账号绑定、外部平台、生产 SMTP 或远端部署边界。

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
```

`npm run check` 按格式、Lint、类型、测试、生产构建的顺序执行。`npm run security:audit` 单独阻断高危和严重依赖漏洞，CI 会在项目检查前运行该命令。Edge Function 另有明确的两个测试文件（`npm run test:edge` 运行 `handler.test.ts` 与 `entry.test.ts`）与真实入口类型检查（`deno check supabase/functions/invite-workspace-member/index.ts`，CI 使用固定版本 Deno 2.2.12）。真实本地 Auth 重发集成验证由 `npm run db:reissue:verify` 执行；真实项目成员、项目模块和项目任务并发验证分别由 `npm run db:membership:verify`、`npm run db:modules:verify` 和 `npm run db:tasks:verify` 执行。三类项目并发脚本都已纳入 `db:verify`，且只使用本地 Supabase 与随机虚构夹具。

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

本仓库已实现身份、认证、工作空间成员权限 V1、项目 CRUD / 可见性 / 归档 V1、项目成员 / 牵头人 V1、项目工作模块 V1、项目任务数据模型和创建 / 详情 / 编辑 V1、项目级只读任务列表 / 看板、Task 3.3 状态机 / 阻塞 / 取消 / 状态历史、Task 3.4 每日进展 / progress / 时间线 / 阻塞联动，以及 Task 3.5 功能分支中的提交验收 / 通过 / 退回 / 完成信息 / 验收时间线；但**尚未实现**公开注册、项目邀请 / 审批、拖拽状态修改、已完成重开、通知 / 提醒、Stage 4 workspace / 全局“我的任务”工作台、私人任务 / 个人空间、归档恢复或物理删除、工作空间所有权转移 / 删除、成员永久删除、批量项目成员操作、完整邀请撤销 / 重发界面、确认 Auth 用户跨工作空间自动加入、微信小程序、CloudBase 业务桥接、飞书、通用审计日志、生产 SMTP、Vercel 生产配置或远端 Supabase 部署。这些能力只能在新的、明确授权的任务中增加。
