# Supabase 本地开发

## 开发原则

本项目采用 local-first migration：数据库结构先以版本化 SQL migration 在本地从空库重建、测试和生成类型，再进入远端审计与后续部署流程。这样可以让结构变更可复现、可审阅，并让前端使用与 migration 同源的 TypeScript 类型。

Task 1.1 只建立基础设施、`set_updated_at()` 和匿名可调用的最小 `health_check()`。尚未实现登录、业务表、RLS 业务策略、Storage、Realtime、Edge Functions 或远端部署。

## 环境要求

- 满足 `package.json` engines 的 Node.js 和 npm；
- Docker Desktop，或兼容 Docker API 的容器运行时；
- 使用仓库锁定的 Supabase CLI，不依赖全局安装。

安装依赖：

```bash
npm ci
```

## 常用命令

```bash
npm run db:start
npm run db:stop
npm run db:reset
npm run db:test
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
```

`db:verify` 会依次重建本地数据库、执行 pgTAP、以 warning 为失败门槛运行数据库 lint，并检查已提交类型是否与本地 migration 漂移。

## 创建和验证 migration

从干净功能分支创建 migration：

```bash
npx supabase migration new descriptive_name
```

编辑生成的 SQL 后，启动本地服务并从空库验证：

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:lint
```

每个数据库行为都应加入 `supabase/tests/database/` 下的 pgTAP 测试。测试必须放在 `begin` / `rollback` 边界内，并覆盖权限与实际返回值，不能只断言对象名称。

## 数据库类型

数据库成功重建后，由本地 CLI 生成类型：

```bash
npm run db:types
```

生成文件为 `src/types/database.generated.ts`，不得手工编写或修改。提交前运行：

```bash
npm run db:types:check
```

漂移检查会在内存中重新生成并规范化行尾，与已提交文件比较；不一致时以非零状态退出。

## 本地前端配置

只在未跟踪的 `.env.local` 中填写本地低权限配置：

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable or anon key>
```

不要把本地状态命令的完整输出复制到文档、聊天或日志。浏览器只允许读取以下两个公开变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Vercel 将来同样只需要配置这两个公开变量。publishable key 面向低权限客户端；secret key、旧式 service role key、数据库密码和连接串都属于高权限凭据，绝不能使用 `VITE_` 前缀、进入浏览器代码或提交到仓库。

本地开发可接受 `localhost` 或 `127.0.0.1` 的 HTTP URL；托管地址必须使用 HTTPS。当前客户端关闭认证会话持久化，因为登录尚未实现。

## 将来的远端连接

后续独立任务在完成安全审计后，可以由获授权人员执行 `supabase login` 与 `supabase link`，再按受控流程应用 migration。本任务不登录、不链接任何远端项目，也不写入 Vercel 环境变量。

不得对生产数据库运行 `db reset` 或其他破坏性重建命令。登录、RLS 业务表和远端部署都需要在后续任务重新进行权限与数据边界审计。
