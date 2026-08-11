# 试运行部署基线与环境门禁 V1

本文件是 Task 3.9.1 的部署 runbook。最高级路线与范围约束见
[《运维协同看板第一版建设方案 V1.3（受控试运行版）》](project-construction-plan-v1.3.md)。

本轮状态仅为 **Trial deployment baseline ready**。文档、脚本和本地验证不代表远端环境已经创建或部署：

> Remote Trial deployment has not been executed because credentials and an authorized environment are intentionally not available in Task 3.9.1.

Task 3.9.2-R1 是一次 deployment-discovered repository remediation：它只加固数据库部署路由的本地门禁与操作说明，不重新执行 Trial 远端部署，也不改变 Task 3.9.1 的历史结论。

## 1. Environment model

| 项目           | Local                           | Trial/Staging             | Production           |
| -------------- | ------------------------------- | ------------------------- | -------------------- |
| Frontend       | 本地 Vite                       | 独立 Vercel Trial 部署    | 独立正式 Vercel 部署 |
| Database       | 本地 Supabase                   | 独立 Supabase Trial 项目  | 独立 Production 项目 |
| Auth           | 本地 Auth 与邮件捕获            | Trial Auth 与受控测试账号 | Production Auth      |
| Edge Functions | 本地 Edge Runtime               | Trial Function            | Production Function  |
| Business data  | 明显虚构夹具                    | 1–2 个低风险试运行项目    | 经正式准入的数据     |
| Secrets        | 未跟踪的本地环境或 CLI 本地状态 | 平台 Secret 管理          | 独立平台 Secret 管理 |
| Verification   | pgTAP、集成、并发与完整重建     | 非破坏性 Smoke/E2E        | 独立生产准入         |

三类环境不得共用数据库、Auth 用户、Edge Function Secret 或 Vercel 环境变量。`supabase/config.toml` 只描述本地开发配置，不是远端 Trial 或 Production 配置的权威副本。

## 2. Preconditions

开始任何远端动作前，操作者必须逐项确认：

1. 使用已经审计并封板的准确 `main` 提交；记录完整 Git SHA。
2. 当前工作树干净，未跟踪文件中没有待提交的真实环境配置。
3. `npm ci`、`npm run security:audit`、`npm run check`、`npm run db:verify`、Edge Function 测试与类型检查均在准确 SHA 上通过。
4. Supabase CLI 使用仓库锁定版本；Task 3.9.1 核对版本为 `2.110.0`，实际执行时再次运行 `npx supabase --version`。
5. Trial Supabase 和 Trial Vercel 均已由有权限的操作者创建，且明确不是 Production。
6. 操作者拥有本次 Trial 动作的明确授权；没有授权或凭据时停止，不把缺少凭据视为失败。
7. 不在公开 Actions、Issue、PR、聊天、截图或文档中记录项目 ref、真实 URL、key、数据库连接串、用户邮箱或邀请链接。
8. 迁移前核对 Trial 当前备份能力、迁移历史、当前用户规模和回滚责任人。

Task 3.9.1 不创建远端项目、不登录外部控制台、不设置 Secret、不发送真实邀请，也不运行任何远端 mutation。

## 3. Secret boundaries

### Browser-safe

浏览器构建只允许：

| 变量                            | 用途                         | 配置位置              |
| ------------------------------- | ---------------------------- | --------------------- |
| `VITE_SUPABASE_URL`             | Trial Data API/Auth 公共入口 | Vercel Trial 环境变量 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 低权限 publishable key       | Vercel Trial 环境变量 |

两项必须同时配置。托管 URL 必须为 HTTPS；partial configuration、非法 URL、secret key、旧式 `service_role` JWT 或受禁高权限变量都会由现有构建门禁脱敏拒绝。真实值不进入 `.env.example` 或仓库。

### Server-only

以下内容只能存在于 Supabase、Vercel 或其他受控服务端 Secret 系统：

- Supabase secret/service-role key；
- 数据库密码和连接串；
- JWT signing secret；
- Vercel、GitHub 或第三方平台 token；
- SMTP credential；
- Edge Function privileged secret；
- Session、Cookie、access token、refresh token 和 Authorization header。

`invite-workspace-member` 继续由 Supabase 托管环境提供服务器变量。`SUPABASE_SECRET_KEY` 或兼容旧变量只供服务端管理客户端使用，绝不能改成 `VITE_*`。错误、响应和公开日志不得回显环境值、邮箱、邀请链接、Auth 原始响应或内部连接信息。

真实 `.env`、`.env.local`、`.env.staging`、`supabase/.temp/`、`.supabase/` 和 `.vercel/` 均保持 Git 忽略。`.env.example` 只保留明显占位符。`.supabase/` 是 Supabase next/alpha shell 的 checkout-local 状态目录；即使当前 stable shell 不使用，也不得提交。

数据库部署使用的 `SUPABASE_TRIAL_DB_URL` 与 `PGPASSWORD` 是受控操作员会话变量，不是应用配置。前者必须是 passwordless 连接 URL，后者是唯一允许的数据库密码来源；两者均不得写入仓库、`.env*`、脚本、Markdown、shell history、日志、报告、聊天或截图。会话结束后必须清除。

这一边界不禁止或删除全部项目 `.env*` 文件；unrelated `VITE_*`、`UNRELATED` 等非数据库应用配置可以保留。禁止的是下文 8 个 CLI 候选文件中出现任何数据库路由或 credential 专用变量赋值，即使赋值为空也不允许。

## 4. Trial target gate

`scripts/trial-deployment-gate.mjs` 是非网络、非 mutation 的防误操作前置检查。它：

- 只接受目标 `trial`；
- 要求独立、大小写敏感的 `TRIAL` 确认；
- 要求显式提供符合 stable CLI 规则的 20 位小写字母 Supabase project ref；
- link 后必须让 `supabase/.temp/project-ref` 与显式 ref 完全一致；
- 若会覆盖 linked-state 的 `SUPABASE_PROJECT_ID` 已设置，则它也必须格式合法且与显式 ref 完全一致；
- `SUPABASE_WORKDIR` 必须未设置或为空；任何非空值都会改变 CLI workdir/linked-state 来源，因此 fail closed；
- `SUPABASE_PROFILE` 必须精确等于 `supabase`；未设置、空值或 `staging`、`local`、`snap`、自定义路径等其他值全部 fail closed；
- 对 `production`、`staging`、`local`、缺项、未知参数、ref 不一致或 ambient selector 不干净全部 fail closed；
- 成功与失败输出都不打印 project ref、workdir 或 profile 值；
- 不运行 Supabase CLI，也不执行数据库、Function 或 Vercel mutation。

target gate 只证明 linked target identity，不证明后续数据库命令将使用哪一条 transport route。数据库命令还必须通过独立的 route gate；任一门禁通过都不能替代另一门禁。

### Session Pooler database route gate

`scripts/trial-database-route-gate.mjs` 是第二个非网络、非 mutation、fail-closed 的本地门禁。它复用上述 target gate，并额外要求：

- link 后的 `supabase/.temp/project-ref` 与显式 Trial ref 完全一致；不接受 `--allow-unlinked`；
- 从当前 checkout 的 `supabase/.temp/pooler-url` 读取 linked CLI 产生的数据库路由锚点；文件缺失、不可读或格式异常时立即停止；
- `SUPABASE_TRIAL_DB_URL` 必须是与 linked 路由逐字段一致的 passwordless PostgreSQL URL；协议只允许 `postgres`/`postgresql`，用户名必须是 `postgres.<linked-project-ref>`，database 必须是 `postgres`；
- hostname 必须属于 linked metadata 提供的 shared pooler 域，端口必须是 `5432`，且操作员 URL 只能带唯一的 `sslmode=require` 查询参数；不得带 fragment、额外 query、嵌入密码或硬编码 region/hostname；
- `PGPASSWORD` 必须非空，且是唯一允许的数据库 credential source；`SUPABASE_DB_PASSWORD` 必须未设置或为空；
- Supabase CLI 2.110.0 实际读取的其他连接选择器必须全部未设置或为空：`PGAPPNAME`、`PGCONNECT_TIMEOUT`、`PGDATABASE`、`PGHOST`、`PGPASSFILE`、`PGPORT`、`PGSERVICE`、`PGSERVICEFILE`、`PGSSLCERT`、`PGSSLKEY`、`PGSSLMODE`、`PGSSLPASSWORD`、`PGSSLROOTCERT`、`PGUSER`；
- 同时检查 CLI 会从当前 checkout 加载的 8 个项目环境文件，顺序固定为 `supabase/.env.development.local`、`supabase/.env.local`、`supabase/.env.development`、`supabase/.env`、`.env.development.local`、`.env.local`、`.env.development`、`.env`；缺失文件忽略，存在但不可读则 fail closed；
- 上述文件中不得赋值 `SUPABASE_TRIAL_DB_URL`、`SUPABASE_DB_PASSWORD`、`PGPASSWORD` 或任一 PG selector；识别标准 `KEY=value`、带空格、`export KEY=value` 与 `KEY: value` 形式，空赋值也拒绝；只返回通过/拒绝，不输出变量名、路径或值；
- migration 会话的 `SUPABASE_ENV` 必须未设置、为空或精确等于 `development`；`test`、`staging`、`production`、custom 或其他值全部拒绝且不回显。它只选择 CLI 加载哪组项目 `.env*`，不是 Supabase 项目 target；
- 成功与失败输出只给出脱敏状态，不输出 project ref、hostname、username、URL、password 或任何环境变量值。

route gate 只读取 checkout-local linked metadata、当前进程环境与上述 8 个 checkout-local 项目环境候选文件，不发起 DNS、TCP、Management API 或数据库连接，不执行 Supabase CLI，也不封装后续命令。

### Supabase CLI 2.110.0 linked-state contract

本仓库的 `package.json` 与 lockfile 锁定 **Supabase CLI 2.110.0 stable channel**。实际安装二进制的 `supabase --help` 标识 stable channel，`link --help` 包含 stable/legacy shell 的 `--password` 与 `--skip-pooler`。官方 v2.110.0 tag 同时包含两套 shell，但其 stable 发布配置选择 `shell=legacy`：

- stable/legacy `supabase link` 把当前 checkout 的 authoritative ref 写入 `supabase/.temp/project-ref`；
- stable/legacy `supabase unlink` 读取该 ref，并移除 checkout 的 `supabase/.temp/`；
- stable/legacy linked commands 按 `SUPABASE_PROJECT_ID`、再按 `supabase/.temp/project-ref` 解析目标，所以 gate 同时核对环境覆盖值；
- stable/legacy workdir 按 `--workdir`、`SUPABASE_WORKDIR`、从 cwd 向上发现 `supabase/config.toml`、fallback cwd 的顺序解析；linked-state 随该 workdir 变化；
- stable/legacy profile 按非默认 `--profile`、非空 `SUPABASE_PROFILE`、用户级持久化 `~/.supabase/profile`、内建 `supabase` 的顺序解析；Trial 通过精确设置 `SUPABASE_PROFILE=supabase` 在环境层终止解析，阻断用户级持久化 fallback；
- `.supabase/project.json` 属于同版本源码中的 next/alpha shell，其 ref 位于嵌套的 `project.ref`，不是本仓库锁定 stable 二进制的 linked-state，也不能作为 fallback 或覆盖 stable state；
- 如果以后升级 CLI 版本或切换发布 channel，必须重新审计实际安装二进制与官方对应源码，并先更新 gate 和本 runbook，不能沿用任一旧路径假设。

版本对应的官方证据见 [stable 发布 shell 选择](https://github.com/supabase/cli/blob/v2.110.0/.github/workflows/release.yml)、[stable/legacy link side effects](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/commands/link/SIDE_EFFECTS.md)、[stable ref resolver](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/config/legacy-project-ref.layer.ts)、[legacy workdir/profile resolver](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/config/legacy-cli-config.layer.ts) 与 [next/alpha project state schema](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/next/config/project-link-state.service.ts)。

Supabase CLI 2.110.0 stable/legacy 的数据库配置解析还会读取上述 PG 环境变量，并按 `supabase/` 优先于仓库根目录的顺序加载项目 `.env*`；route gate 的拒绝集合与 8 个固定路径以该锁定版本的 [database config parser](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-db-config.parse.ts)、[project dotenv loader](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-db-config.toml-read.ts) 和 [dotenv parser](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-dotenv.ts) 为依据。升级 CLI 或改变 channel 时，必须重新审计实际解析集合、文件集合与顺序，并同步更新 gate、测试和本 runbook。

`supabase link` 成功只确认 control-plane 身份和 linked metadata，不等于当前操作员网络可用默认 Direct TCP 数据库路径。Direct endpoint TCP reachability does not guarantee a usable PostgreSQL session. CLI 2.110.0 在路径可达时仍可能选择 direct connection；Task 3.9.2 当前批准的 migration transport 必须来自 Trial Dashboard / linked pooler metadata，并以 checkout-local metadata 精确给出的 **Shared Supavisor Session Pooler / 5432** 为准。这是 deployment-discovered compatibility boundary，不是对 Supabase 缺陷的判断。**Transaction Pooler / 6543** 不得用于 schema migration，因为 migration 需要完整 PostgreSQL session/transaction 语义。

All Trial commands must run from the current repository checkout; an ambient workdir redirect is forbidden. A non-default Supabase profile is forbidden. Gate 与其后的 CLI command 必须在同一 PowerShell 会话、同一 checkout 依次执行，期间不得设置 `--workdir` 或更改下列环境边界。不得向 Trial 命令增加 `--profile`：

- `SUPABASE_PROJECT_ID`：若存在，必须格式合法并与显式 Trial ref 一致；
- `SUPABASE_WORKDIR`：必须未设置或为空，任何非空值都拒绝；
- `SUPABASE_PROFILE`：必须精确等于 `supabase`；未设置、空值或任何其他值都拒绝。
- `SUPABASE_ENV`：数据库 migration 会话必须未设置、为空或精确等于 `development`；它选择项目 dotenv 文件集合，不选择 Trial/Production target。

`SUPABASE_PROFILE=supabase` 只固定 Supabase CLI 内建的 API/control-plane profile；这里的 `supabase` 不是项目环境名，不代表 Production 项目，也不改变显式 Trial project ref。项目脚本不读取、不删除或修改用户级 `~/.supabase/profile`，而是以会话环境固定值阻断 fallback。

PowerShell 会话中先清理 project ID/workdir 两项 ambient selector，并固定 stable control-plane profile；project ref 只保存在未提交的操作员会话变量中：

```powershell
Remove-Item Env:SUPABASE_PROJECT_ID -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_WORKDIR -ErrorAction SilentlyContinue

$env:SUPABASE_PROFILE = 'supabase'
$env:SUPABASE_TRIAL_PROJECT_REF = '<trial-project-ref>'
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF --allow-unlinked
```

`SUPABASE_TRIAL_PROJECT_REF` 是本项目 runbook 的操作员会话变量，不是 Supabase CLI 自带 target override，也不得把真实值提交仓库。

`--allow-unlinked` 只允许在第一次 `supabase link` 前使用。link 后以及每一条远端命令前都必须去掉该参数：

```powershell
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
```

link 后，在同一 PowerShell 会话中由受控交互设置 passwordless route 与数据库密码，清除所有会改变 CLI 2.110.0 连接选择的 ambient variable，再运行 route gate。下面的 `Read-Host` 输入不会把值写进命令历史；不得把真实值改写成命令字面量：

```powershell
$env:SUPABASE_TRIAL_DB_URL = Read-Host 'Passwordless Trial Session Pooler URL' -MaskInput
$env:PGPASSWORD = Read-Host 'Trial database password' -MaskInput

Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_ENV -ErrorAction SilentlyContinue
@(
  'PGAPPNAME', 'PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST',
  'PGPASSFILE', 'PGPORT', 'PGSERVICE', 'PGSERVICEFILE',
  'PGSSLCERT', 'PGSSLKEY', 'PGSSLMODE', 'PGSSLPASSWORD',
  'PGSSLROOTCERT', 'PGUSER'
) | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }

npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
```

正式 route gate 会在读取 linked metadata 之前后保持同一 fail-closed 边界，并检查 shell selector 与 8 个项目环境候选文件；操作者不需要把文件内容或匹配项复制到终端、日志或报告。若被阻断，只在本机受控编辑器中复核并移除数据库专用 assignment；不得输出值，也不得为通过门禁而删除 unrelated `VITE_*` 等普通应用配置。

route gate 通过后，目标门禁、路由门禁与对应数据库命令必须紧邻、在同一 checkout 和同一会话中执行；期间不得更改相关环境变量或项目 `.env*`。操作结束后清除 `SUPABASE_TRIAL_DB_URL` 与 `PGPASSWORD`。

CI 和公开日志只运行 `npm run trial:baseline:check`，不获得远端凭据，也不执行部署。真实远端部署保持受控、显式、人工发起。

## 5. Supabase Trial setup

本节只在 Task 3.9.2、且操作者已经获得 Trial 授权后执行。

1. 在 Supabase 平台创建独立 Trial 项目；不得复用未来 Production 数据库。
2. 核对 PostgreSQL major version 与 `supabase/config.toml` 的仓库要求兼容。
3. 核对 Auth 公网 URL、受控 Trial 回调地址、公开注册关闭、匿名登录关闭和 Email OTP 到期时间。
4. Email OTP 到期时间必须与数据库 `workspace_invitation_ttl_seconds()` 和 Edge `APP_INVITE_TTL_SECONDS` 的 3600 秒保持一致。
5. 按目标项目当前实际可用的官方备份能力启用并核对备份；不对未验证套餐能力作假设。
6. 在受控终端保持 project ID/workdir 与 profile 三项环境边界满足门禁，紧邻 `link` 前运行 pre-link gate，再由操作者核对结果并显式执行：

```powershell
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF --allow-unlinked
npx supabase link --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
```

7. 立即运行 link 后 target gate。若不匹配，停止并解除错误 link；不得继续 migration 或 Function 部署。
8. link 后确认 `.supabase/project.json` 没有被误当成 stable linked-state；该 next/alpha 文件即使存在也必须保持 Git 忽略，且不能让缺失或不匹配的 `supabase/.temp/project-ref` 通过 gate。
9. 确认 `supabase/.temp/pooler-url` 存在并由当前 stable linked state 产生；不得从旧 checkout、聊天、截图或手工硬编码 region/hostname 构造替代值。缺失或不可读时停止，不猜测路由。
10. 数据库命令前按第 4 节在受控会话设置 passwordless `SUPABASE_TRIAL_DB_URL` 与唯一密码来源 `PGPASSWORD`，清理 shell ambient PG selectors，确认 8 个项目环境候选文件中不存在数据库专用 assignment，并通过统一 route gate；不得把数据库 URL 或密码写入脚本或持久化文件。

## 6. Migration deployment

历史 migration 是唯一 schema 来源。不得修改、squash 或 rewrite 已发布 migration，不得使用 database dump 初始化 Trial，也不得把控制台手工粘贴 SQL 当作唯一部署方法。

每一条数据库命令前依次运行 link 后 target gate 与 route gate：前者确认 Trial identity，后者确认 `--db-url` 精确对应 linked Session Pooler metadata，并统一确认 shell credential/selector、项目 `.env*` 持久化 assignment 与 `SUPABASE_ENV` 边界。操作者核对两个 gate 的脱敏输出后，再单独执行对应 CLI 命令。两个 gate 都不封装或自动触发 remote mutation：

```powershell
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npx supabase migration list --db-url $env:SUPABASE_TRIAL_DB_URL

npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npx supabase db push --dry-run --db-url $env:SUPABASE_TRIAL_DB_URL
```

人工核对 dry-run：

- 目标仍为独立 Trial；
- 只包含仓库中尚未应用的版本化 migration；
- 不包含 seed、角色导入、reset、drop、restore 或其他破坏性动作；
- migration 顺序与 `supabase/migrations/` 一致；
- 没有修改历史 migration 的迹象。

只有 dry-run 通过、备份边界确认、操作者再次授权后，Task 3.9.2 才可逐条显式执行：

```powershell
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npx supabase db push --db-url $env:SUPABASE_TRIAL_DB_URL

npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF

npx supabase migration list --db-url $env:SUPABASE_TRIAL_DB_URL
```

route gate PASS 绝不等于 DB push 已获授权；migration list、dry-run、migration set、unexpected operation 与 backup boundary 均经人工复核并获得明确 Human Migration Approval 后，才允许执行真正 push。

本 runbook 不提供 `--include-seed`、`--include-all`、`--yes`、远端 `db reset`、远端 dump restore 或其他自动确认参数。失败后先保存脱敏错误分类和迁移状态，再判断可安全重试、forward fix 或人工恢复；禁止猜测成功。

## 7. Database post-deploy verification

远端 migration 的 CLI exit code 不是唯一成功依据。部署后至少核对：

1. `supabase migration list --db-url $env:SUPABASE_TRIAL_DB_URL` 与仓库 migration 历史一致；
2. 本地从空库生成的 `src/types/database.generated.ts` 无 drift；
3. `health_check` 通过低权限 Trial 客户端返回安全 `ok`；
4. `current_app_user_id()`、工作空间/项目/任务核心安全投影和语义化 RPC 存在；
5. 核心表 RLS 仍启用，浏览器角色没有意外获得直接高权限 DML；
6. `invite-workspace-member` 所需对象和确认 RPC 存在；
7. 未授权读取在 Task 3.9.3 的真实账号验证中被拒绝。

本地验证继续运行完整重建、pgTAP、lint、类型漂移、真实 Auth 集成和锁竞争测试。Trial 只运行明确标为远端安全、非破坏性的检查；不得对远端执行 `db:reset`、本地 seed、批量虚构夹具、pgTAP 清理脚本或并发破坏性测试。

若远端对象或 migration 状态不一致，停止前端准入和真实数据导入；不要用控制台临时改 schema 掩盖漂移。

## 8. Edge Function deployment

当前 Trial 需要部署的函数只有：

```text
invite-workspace-member
```

部署前确认：

- `verify_jwt = true` 保持启用，绝不使用 `--no-verify-jwt`；
- `APP_ALLOWED_ORIGINS` 只含准确 Trial HTTPS origin；
- `APP_INVITE_TTL_SECONDS` 为 3600，并与 Auth OTP 和数据库 TTL 一致；
- Supabase 平台托管的 URL、publishable key 和 server secret 可供函数读取；
- Secret 不进入 Vite、命令参数、公开日志或仓库；
- `npm run test:edge` 与真实 `index.ts` 的 Deno typecheck 已通过。

保持 project ID/workdir 与 profile 三项环境边界满足门禁，并在部署前紧邻运行 link 后 target gate；操作者核对结果后，Task 3.9.2 才可显式执行：

```powershell
npm run trial:target:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
npx supabase functions deploy invite-workspace-member --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
```

不要使用 `--prune`。记录部署时间、源 commit 和平台部署版本；不记录 project ref 或 Secret。最小 Smoke 在 Task 3.9.3 使用受控账号执行，禁止打印邀请链接、邮箱、token 或 Auth Admin 原始响应。

失败时先确认目标、配置和版本；允许在原因明确后重新部署同一准确 commit。需要回退时按第 12 节部署上一已验证的函数源码，并先确认其与当前 schema 兼容。

## 9. Vercel Trial deployment

Trial Vercel 必须是与 Production 分离的项目或受控环境。当前工程要求：

| 项目        | 值                                           |
| ----------- | -------------------------------------------- |
| Node.js     | 满足 `package.json`，当前为 22.22.0 或更高   |
| Install     | `npm ci`                                     |
| Build       | `npm run build`                              |
| Output      | `dist`                                       |
| SPA routing | `vercel.json` 将直接访问回退到 `/index.html` |
| Browser env | 仅两个 Supabase browser-safe 变量            |

Vercel Trial 环境变量只通过平台配置，不提交 `.vercel/`、真实 URL、key、项目 ID、组织 ID或 token。构建失败时使用脱敏日志定位，不输出完整环境。

Task 3.9.2 由已授权人员在 Vercel 发起 Trial 部署。Task 3.9.1 不登录 Vercel、不创建项目、不修改域名，也不建立 `push main -> production` 自动部署。

## 10. Deployment version traceability

每次 Trial 部署使用以下最小记录，保存于受控 runbook/变更记录中，不提交真实账号或内部地址：

| 字段                     | 记录                                  |
| ------------------------ | ------------------------------------- |
| Git commit SHA           | 完整 40 位 SHA                        |
| Deployment time          | 带时区时间                            |
| Frontend deployment      | Vercel Trial deployment ID 或受控链接 |
| Database migration state | 已应用 migration 末项与核对结果       |
| Edge Function            | 函数名、平台版本和源 commit           |
| Operator/approver        | 受控系统内记录，不进入公开仓库        |
| Verification             | 自动化、本地、远端人工结果分别记录    |

前端若未来展示版本，只允许公开 Git SHA 等非敏感元数据；不得展示内部 URL、数据库 host、project ref、构建机路径或 Secret。

## 11. Smoke checklist

Task 3.9.3 必须在真实 Trial 和真实浏览器中完成，并明确区分人工与自动化证据：

- owner/admin 登录、会话恢复和重新登录；
- 邀请/激活受控测试成员；
- 创建项目、成员、模块和任务；
- `todo -> in_progress`；
- 新增进展并更新 progress；
- `in_progress -> blocked -> in_progress`；
- 100% 后提交验收、退回、修改、再次提交、通过为 completed；
- 未授权用户读取项目/任务被拒绝；
- completed 冻结语义正确；
- 刷新、深链接、桌面和至少一个手机浏览器状态一致；
- migration、Function 和 Vercel 版本可追溯；
- Blocker 为 0，Major 原则上关闭。

Task 3.9.1 不声称完成上述远端 Smoke/E2E。

## 12. Rollback

### Frontend rollback

在 Vercel 选择上一已验证 Trial deployment，或从上一稳定 `main` commit 重新构建并部署。回退后重新核对 SHA、环境变量、SPA 路由和核心只读页面。

### Edge Function rollback

从上一已验证 commit 重新部署 `invite-workspace-member`。部署前确认旧函数与当前数据库 schema、RPC 签名和 Auth 配置兼容；部署后执行最小安全 Smoke。

### Database rollback

数据库以 forward-only migration 为主。默认回滚不是自动 down migration：

1. 优先新增经过审阅的 forward fix；
2. 重大事故时评估平台当前可用、已验证的备份恢复；
3. destructive restore 必须暂停服务、确认目标、评估数据丢失窗口并获得人工授权；
4. Trial 演练不能替代 Production 恢复演练；
5. 禁止一键 drop、远端 reset 或自动 restore 工具。

前端或 Function 回退不能假设数据库已经同步回退。任何组合都先做兼容性判断。

## 13. Backup and recovery boundary

进入 Trial 前：

- 按目标 Supabase 项目当前实际可用的官方备份能力执行；
- 在 migration 前核对最近备份状态、保留范围和责任人；
- 记录恢复入口和授权链，不在公开文档记录内部账号；
- 数据恢复一律视为高风险人工动作；
- 恢复演练使用独立 Trial/演练环境，不覆盖 Production；
- Stage 6 前必须完成正式 Production backup/restore 演练。

如果当前计划不支持某项托管备份能力，应如实记录限制并决定是否阻断试运行，不得编造能力。

## 14. Incident handling

发现以下任一情况立即停止部署或试运行：

- 目标无法确认或疑似指向 Production；
- Secret、真实账号、项目资料或内部地址进入公开日志；
- migration 状态不一致、执行结果不确定或出现部分失败；
- RLS、身份解析、权限拒绝或完成冻结失效；
- 数据丢失、污染、重复写入或无法回滚；
- Frontend、Function 与 schema 版本无法追溯。

处置顺序：

1. 停止新的写入和部署，不执行猜测性修复；
2. 保存不含敏感值的时间、SHA、部署版本、错误分类和影响范围；
3. 若凭据可能泄露，立即按平台流程撤销/轮换并评估公开传播；
4. 由授权人员选择 forward fix、前端/函数回退或人工恢复；
5. 完成验证和复盘后才恢复试运行。

## 15. Trial issue classification

| 分类            | 定义                                                                               | 准入处理                                 |
| --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Blocker         | 核心闭环不可完成；身份/权限失效；数据泄露、丢失或污染；migration、部署或回滚不可控 | 数量必须为 0，否则禁止试运行             |
| Major           | 主要流程严重受影响；权限、状态或一致性有明显风险；多用户真实使用非常困难           | 原则上试运行前关闭                       |
| Minor           | 不阻断核心工作的体验问题                                                           | 进入问题池，可不阻断                     |
| Feature Request | 新功能建议                                                                         | 不自动开发，重新进入路线图和独立任务评估 |

试运行反馈不能绕过 V1.3 路线或扩大当前任务。

## 16. Explicitly deferred actions

Task 3.9.1 明确延期到后续授权任务：

- Task 3.9.2：创建独立 Supabase/Vercel Trial，设置平台配置，执行 migration、Function 和前端真实部署；
- Task 3.9.3：真实账号、桌面/手机浏览器 Smoke/E2E 与准入结论；
- Production Supabase/Vercel 创建、配置、迁移、域名和正式数据；
- Stage 4 工作台、通知、提醒、通用日志、回收站；
- 微信小程序、CloudBase、微信身份桥接、订阅消息和飞书；
- 生产 SMTP、附件、评论、Realtime、已完成重开和归档恢复。

没有 Trial 凭据或环境是本任务的预期边界，不是失败。正确交付状态是：

```text
Task 3.9.1
Trial Deployment Baseline
FINAL AUDIT FIX PUSHED
READY FOR FINAL PASS REVIEW
```

而不是 `Production deployed` 或 `Trial deployed`。
