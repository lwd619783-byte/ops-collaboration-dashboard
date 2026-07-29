# 运维协同看板开发约定

- 每个任务开始前阅读本文件和 [公开开发流程](docs/public-development-workflow.md)。本仓库为公开仓库，所有提交均按公开信息处理。
- 目标：维护可部署的运维协同看板前端；业务能力必须通过独立任务逐步引入。
- 技术栈固定为 React、TypeScript 严格模式、Vite、Tailwind CSS、React Router、Vitest 与 npm。
- 代码按功能组织：应用级内容放在 `src/app`，页面放在 `src/pages`，可复用组件放在 `src/components`，业务代码放在 `src/features`。
- 不得关闭 TypeScript 严格检查、引入无理由的 `any` 或使用 `@ts-ignore`；不得提交真实业务数据、人员/单位信息、密钥、令牌、账号或本机绝对路径。
- 每次修改后运行 `npm run check`；依赖变化后还必须运行 `npm run security:audit`。
- 功能分支推送后必须等待 CI；远端独立审计通过前不得进入下一任务。
- Codex 不得自行创建 PR、合并 main、强推或修改仓库可见性；不得做无关重构或提前开发 Supabase、登录、项目、任务、提醒等业务功能。
