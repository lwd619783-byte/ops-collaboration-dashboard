# 运维协同看板开发约定

- 目标：维护可部署的运维协同看板前端；业务能力必须通过独立任务逐步引入。
- 技术栈固定为 React、TypeScript 严格模式、Vite、Tailwind CSS、React Router、Vitest 与 npm。
- 代码按功能组织：应用级内容放在 `src/app`，页面放在 `src/pages`，可复用组件放在 `src/components`，业务代码放在 `src/features`。
- 不得关闭 TypeScript 严格检查、引入无理由的 `any` 或使用 `@ts-ignore`。
- 每次修改后运行 `npm run check`；仅修改范围需要时可先运行对应单项命令。
- 不做无关重构，不提交真实密钥、令牌、账号或本地绝对路径。
- 未经明确任务，不得提前开发 Supabase、登录、项目、任务、提醒或其他业务功能。
