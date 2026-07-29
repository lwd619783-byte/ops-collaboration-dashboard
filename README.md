# 运维协同看板

一个面向互联网部署的轻量化运维协同看板前端工程。

## 当前状态

已完成 Task 0.1 工程基线：可运行的 React 单页应用、基础布局、首页与 404 页面、自动化检查、GitHub Actions 和 Vercel SPA 配置均已建立。

## 第一阶段边界

当前仅提供工程基线与静态占位页面，不包含登录、数据库、Supabase、项目/成员/模块/任务管理、提醒、个人待办、日志或模拟后端与业务数据。

## 技术栈

- React + TypeScript（严格模式）
- Vite + Tailwind CSS 4（官方 Vite 插件）
- React Router
- ESLint + Prettier
- Vitest + React Testing Library + jest-dom

## 环境要求

- Node.js 22 或更高版本
- npm 10 或更高版本

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

## 质量检查

以下命令均已作为项目脚本提供：

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
```

`npm run check` 按格式、Lint、类型、测试、生产构建的顺序执行，与 CI 使用同一标准。

## 环境变量

将 `.env.example` 复制为本地 `.env` 后按需调整。当前唯一示例变量是 `VITE_APP_NAME`，应用不依赖它即可启动。不要在仓库提交真实密钥、令牌、账号或绝对路径；`.env`、`.env.local` 与 `.env.*.local` 已被忽略。

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

## Vercel 部署

在 Vercel 中导入仓库后，使用默认的 Vite 构建识别即可：构建命令为 `npm run build`，输出目录为 `dist`。`vercel.json` 为 React Router 的直接访问提供 SPA 回退，不包含令牌或临时预览地址。部署需由已获授权的人员在 Vercel 中发起。

## 当前未实现功能

本仓库尚未实现任何业务能力；后续仅在新的、明确授权的任务中增加设计系统、项目协同、任务管理、提醒及相关能力。
