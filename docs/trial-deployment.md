# 试运行部署基线与环境门禁 V1

本文件是 Stage 3.9 网页受控试运行准备与部署的 runbook。最高级路线与范围约束见
[《运维协同看板第一版建设方案 V1.3（受控试运行版）》](project-construction-plan-v1.3.md)。

## 当前状态

```text
TRIAL DEPLOYMENT COMPLETE
RECOVERY DRILL COMPLETE
FINAL TRIAL SMOKE/E2E EXECUTED — FAIL
TRIAL ADMISSION NOT ADMITTED
PRODUCTION NOT CONFIGURED
```

- Trial deployment：已完成（独立 Supabase Trial 与 Vercel Trial 已建立并部署）；
- Recovery Drill：已完成（`TRIAL-RECOVERY-001` 关闭条件已建立，见第 13 节）；
- Final Task 3.9.3-R7 Trial Smoke/E2E：已执行；Hosted Trial 部署来源追溯与实际入口安全响应头存在 2 个 Blocker，写入型核心多用户闭环按 fail-closed 门禁未启动；
- Trial Admission：NOT ADMITTED；
- Production：NOT CONFIGURED。

> Task 3.9.1 historical baseline statement：Task 3.9.1 完成时仅建立
> local / trial / production 边界、部署门禁与 runbook，当时的交付状态为
> Trial deployment baseline ready，远端 Trial 尚未创建或部署。该陈述只描述
> Task 3.9.1 当时的状态，不是本 runbook 的当前状态；Trial 部署与 Recovery Drill
> 已由后续授权任务完成。

Task 3.9.2-R1 是一次 deployment-discovered repository remediation：它只加固数据库部署路由的本地门禁与操作说明，不重新执行 Trial 远端部署，也不改变历史结论。

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
4. Supabase CLI 使用仓库锁定版本；本 runbook 基线核对版本为 `2.110.0`，实际执行时再次运行 `npx supabase --version`。
5. Trial Supabase 和 Trial Vercel 均已由有权限的操作者创建，且明确不是 Production。
6. 操作者拥有本次 Trial 动作的明确授权；没有授权或凭据时停止，不把缺少凭据视为失败。
7. 不在公开 Actions、Issue、PR、聊天、截图或文档中记录项目 ref、真实 URL、key、数据库连接串、用户邮箱或邀请链接。
8. 迁移前核对 Trial 当前备份能力、迁移历史、当前用户规模和回滚责任人。

> Task 3.9.1 historical baseline statement：Task 3.9.1 不创建远端项目、不登录外部控制台、不设置 Secret、不发送真实邀请，也不运行任何远端 mutation。

## 3. Secret boundaries

### Browser-safe

浏览器构建只允许：

| 变量                            | 用途                         | 配置位置              |
| ------------------------------- | ---------------------------- | --------------------- |
| `VITE_SUPABASE_URL`             | Trial Data API/Auth 公共入口 | Vercel Trial 环境变量 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 低权限 publishable key       | Vercel Trial 环境变量 |

两项必须同时配置。托管 URL 必须为 HTTPS；partial configuration、非法 URL、secret key、旧式 `service_role` JWT 或受禁高权限变量都会由现有构建门禁脱敏拒绝。真实值不进入 `.env.example` 或仓库。

### Server-only

应用运行时 / browser / Edge / CI 使用的高权限 secret 只能存在于 Supabase、Vercel 或其他受控服务端 Secret 系统：

- Supabase secret/service-role key；
- 应用运行时 / browser / Edge / CI 使用的数据库密码和连接串；
- JWT signing secret；
- Vercel、GitHub 或第三方平台 token；
- SMTP credential；
- Edge Function privileged secret；
- Session、Cookie、access token、refresh token 和 Authorization header。

### Operator-only（仓库外本机保险库）

人工 operator 在 Trial / Recovery 操作中使用的 PostgreSQL 数据库密码，允许按下方
Local Database Credential Bootstrap V1 存放在仓库外 Windows 本机保险库
（CurrentUser + CurrentMachine DPAPI），不进入平台 Secret 系统。它是
operator-only 边界：不属于应用运行时 / browser / Edge / CI 配置，也不得进入
Git、聊天、日志、`.env*` 或浏览器。

两类 secret 的存放位置不同，但泄露边界相同：应用运行时高权限 secret 与人工
operator 的数据库密码均不得进入 Git、聊天、日志、`.env*` 或浏览器；
service_role / JWT secret 等边界不因本机保险库而放宽。

`invite-workspace-member` 继续由 Supabase 托管环境提供服务器变量。`SUPABASE_SECRET_KEY` 或兼容旧变量只供服务端管理客户端使用，绝不能改成 `VITE_*`。错误、响应和公开日志不得回显环境值、邮箱、邀请链接、Auth 原始响应或内部连接信息。

真实 `.env`、`.env.local`、`.env.staging`、`supabase/.temp/`、`.supabase/` 和 `.vercel/` 均保持 Git 忽略。`.env.example` 只保留明显占位符。`.supabase/` 是 Supabase next/alpha shell 的 checkout-local 状态目录；即使当前 stable shell 不使用，也不得提交。

数据库部署使用的 `SUPABASE_TRIAL_DB_URL` 与 `PGPASSWORD` 是受控操作员会话变量，不是应用配置。前者必须是 passwordless 连接 URL，后者是唯一允许的数据库密码来源；两者均不得写入仓库、`.env*`、脚本、Markdown、shell history、日志、报告、聊天或截图。会话结束后必须清除。

这一边界不禁止或删除全部项目 `.env*` 文件；unrelated `VITE_*`、`UNRELATED` 等非数据库应用配置可以保留。禁止的是下文 8 个 CLI 候选文件中出现任何数据库路由或 credential 专用变量赋值，即使赋值为空也不允许。

### Local Database Credential Bootstrap V1

Windows 本机操作者使用 `scripts/operator/` 下的通用 helper，避免每次把 Trial / Recovery 数据库密码传入聊天、剪贴板、命令字面量或项目 `.env*`。真实 operator state 只位于运行时由 `%LOCALAPPDATA%` 构造的仓库外目录；仓库、文档和测试只保存通用代码与 synthetic fixture。

一次性初始化在该实现完成远端独立审计、PR CI 与 Squash Merge 后，由操作者本人在受控 PowerShell 中执行。本轮开发与测试不得录入真实密码：

```powershell
.\scripts\operator\Initialize-OpsDbCredentialStore.ps1 -Target Both
```

也可用 `-Target Trial` 或 `-Target Recovery` 单独初始化/重新录入。密码只能通过 `Read-Host -AsSecureString` 读取；已有 target state 被覆盖前必须输入大小写敏感的 `OVERWRITE`。Windows PowerShell 使用 CurrentUser + CurrentMachine DPAPI 保护 CLIXML，换用户、换机器、缺失文件或解密失败均 fail closed，不存在明文、Base64、旁置 AES key 或非 Windows fallback。

本机 `config.json` 只保存 schema version、Trial / Recovery project ref、DPAPI secret 相对路径、Recovery CA 相对路径和 `productionConfigured=false`。它不保存密码、带密码 URL、token、key 或授权证据。Session Pooler URL 不成为本机 config 的长期副本；每次进入会话仍以当前 checkout 的 `supabase/.temp/project-ref` 与 `supabase/.temp/pooler-url` 为 linked-state 权威来源。

当前 checkout link 到对应项目后，可显式进入 Trial、Recovery，或让 `Auto`（默认）按本机 config 与 linked ref 精确匹配：

```powershell
.\scripts\operator\Enter-OpsDbSession.ps1 -Target Trial
.\scripts\operator\Enter-OpsDbSession.ps1 -Target Recovery
.\scripts\operator\Enter-OpsDbSession.ps1
```

helper 只在当前 PowerShell 进程注入受控 `PGPASSWORD`、passwordless Session Pooler URL、target marker 与必要的 profile/route context；Recovery 还要求仓库外的官方 Server root certificate 存在且格式安全，并设置受控 `NODE_EXTRA_CA_CERTS`。它不设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`、不使用 `rejectUnauthorized=false` 或 `sslmode=disable`，检测到 TLS verification 被关闭时拒绝进入。

Trial 与 Recovery 会话互斥。未知 linked target 使用 `OPS_DB_TARGET_UNKNOWN` 拒绝；显式 target 与 linked-state 不符使用 `OPS_DB_TARGET_MISMATCH` 拒绝；Production 配置或识别使用 `OPS_DB_PRODUCTION_AUTOLOAD_DENIED` 拒绝。缺少 config、secret 或 Recovery CA 时同样 fail closed。READY 输出只包含 target 分类与 PASS/LOADED/NOT GRANTED 状态，不输出 password、URL、hostname、username、project ref、CA path、系统标识或身份信息。

结束数据库操作后，在同一 PowerShell 进程执行：

```powershell
.\scripts\operator\Exit-OpsDbSession.ps1
```

Exit 只按 `OPS_DB_SESSION_MANAGED_KEYS` allowlist 清除本工具注入的 `PGPASSWORD`、Trial/Recovery route、Recovery CA 和 session marker，不粗暴删除无法证明由本工具创建的其他 `RECOVERY_*` 或用户环境。输出固定为 `OPS DATABASE SESSION CLEARED`。

`CREDENTIAL: LOADED`、target/route PASS 或 CA PASS 只表示连接上下文 ready。helper 不执行 `db push`、migration、reset、restore、Edge/Vercel deploy、Recovery PLAN/APPLY 或任何业务写入，也不创建这些动作的授权。reviewed PLAN digest、Recovery evidence、Human Migration Approval、CLI 二次确认与 Production authorization 继续保持独立人工门禁。

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

`scripts/trial-database-route-gate.mjs` 是第二个非网络、非 mutation、fail-closed 的 database route + migration behavior execution-context gate。它复用上述 target gate，并额外要求：

- link 后的 `supabase/.temp/project-ref` 与显式 Trial ref 完全一致；不接受 `--allow-unlinked`；
- 从当前 checkout 的 `supabase/.temp/pooler-url` 读取 linked CLI 产生的数据库路由锚点；文件缺失、不可读或格式异常时立即停止；
- `SUPABASE_TRIAL_DB_URL` 必须是与 linked 路由逐字段一致的 passwordless PostgreSQL URL；协议只允许 `postgres`/`postgresql`，用户名必须是 `postgres.<linked-project-ref>`，database 必须是 `postgres`；
- hostname 必须属于 linked metadata 提供的 shared pooler 域，端口必须是 `5432`，且操作员 URL 只能带唯一的 `sslmode=require` 查询参数；不得带 fragment、额外 query、嵌入密码或硬编码 region/hostname；
- `PGPASSWORD` 必须非空，且是唯一允许的数据库 credential source；`SUPABASE_DB_PASSWORD` 必须未设置或为空；
- Supabase CLI 2.110.0 实际读取的其他连接选择器必须全部未设置或为空：`PGAPPNAME`、`PGCONNECT_TIMEOUT`、`PGDATABASE`、`PGHOST`、`PGPASSFILE`、`PGPORT`、`PGSERVICE`、`PGSERVICEFILE`、`PGSSLCERT`、`PGSSLKEY`、`PGSSLMODE`、`PGSSLPASSWORD`、`PGSSLROOTCERT`、`PGUSER`；
- `SUPABASE_YES` 与 `SUPABASE_DB_MIGRATIONS_ENABLED` 必须未设置或为空；前者会自动回答 CLI confirmation prompt，后者会覆盖 `[db.migrations].enabled`。正式 migration session 禁止 shell 环境改变 Human Migration Approval 之后仍保留的 CLI 二次确认或 migration enablement；
- 同时检查 CLI 会从当前 checkout 加载的 8 个项目环境文件，顺序固定为 `supabase/.env.development.local`、`supabase/.env.local`、`supabase/.env.development`、`supabase/.env`、`.env.development.local`、`.env.local`、`.env.development`、`.env`；缺失文件忽略，存在但不可读则 fail closed；
- 上述文件中不得赋值 `SUPABASE_TRIAL_DB_URL`、`SUPABASE_DB_PASSWORD`、`PGPASSWORD`、`SUPABASE_YES`、`SUPABASE_DB_MIGRATIONS_ENABLED` 或任一 PG selector；识别标准 `KEY=value`、带空格、`export KEY=value` 与 `KEY: value` 形式，空赋值也拒绝；只返回通过/拒绝，不输出变量名、路径或值；
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

Supabase CLI 2.110.0 stable/legacy 的数据库配置解析还会读取上述 PG 环境变量、`SUPABASE_YES` 与 `SUPABASE_DB_MIGRATIONS_ENABLED`，并按 `supabase/` 优先于仓库根目录的顺序加载项目 `.env*`；route gate 的拒绝集合与 8 个固定路径以该锁定版本的 [database config parser](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-db-config.parse.ts)、[project dotenv/config loader](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-db-config.toml-read.ts) 和 [dotenv parser](https://github.com/supabase/cli/blob/v2.110.0/apps/cli/src/legacy/shared/legacy-dotenv.ts) 为依据。升级 CLI 或改变 channel 时，必须重新审计实际解析集合、文件集合与顺序，并同步更新 gate、测试和本 runbook。

`supabase link` 成功只确认 control-plane 身份和 linked metadata，不等于当前操作员网络可用默认 Direct TCP 数据库路径。Direct endpoint TCP reachability does not guarantee a usable PostgreSQL session. CLI 2.110.0 在路径可达时仍可能选择 direct connection；Task 3.9.2 当前批准的 migration transport 必须来自 Trial Dashboard / linked pooler metadata，并以 checkout-local metadata 精确给出的 **Shared Supavisor Session Pooler / 5432** 为准。这是 deployment-discovered compatibility boundary，不是对 Supabase 缺陷的判断。**Transaction Pooler / 6543** 不得用于 schema migration，因为 migration 需要完整 PostgreSQL session/transaction 语义。

All Trial commands must run from the current repository checkout; an ambient workdir redirect is forbidden. A non-default Supabase profile is forbidden. Gate 与其后的 CLI command 必须在同一 PowerShell 会话、同一 checkout 依次执行，期间不得设置 `--workdir` 或更改下列环境边界。不得向 Trial 命令增加 `--profile`：

- `SUPABASE_PROJECT_ID`：若存在，必须格式合法并与显式 Trial ref 一致；
- `SUPABASE_WORKDIR`：必须未设置或为空，任何非空值都拒绝；
- `SUPABASE_PROFILE`：必须精确等于 `supabase`；未设置、空值或任何其他值都拒绝。
- `SUPABASE_ENV`：数据库 migration 会话必须未设置、为空或精确等于 `development`；它选择项目 dotenv 文件集合，不选择 Trial/Production target。
- `SUPABASE_YES`：必须未设置或为空，不能让 CLI 自动确认数据库写入 prompt。
- `SUPABASE_DB_MIGRATIONS_ENABLED`：必须未设置或为空，不能通过环境覆盖 tracked `[db.migrations].enabled`。

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

link 后，在同一 PowerShell 会话中使用已审计的本机 credential bootstrap 加载 passwordless route 与数据库密码。helper 会核对 linked-state、清除所有会改变 CLI 2.110.0 连接选择的 ambient variable，并只在当前进程建立 Trial context；不得把真实值改写成命令字面量：

```powershell
.\scripts\operator\Enter-OpsDbSession.ps1 -Target Trial
npm run trial:db-route:check -- --target trial --confirm TRIAL --project-ref $env:SUPABASE_TRIAL_PROJECT_REF
```

正式 route gate 会在读取 linked metadata 之前后保持同一 fail-closed 边界，并检查 shell route/behavior selector 与 8 个项目环境候选文件；操作者不需要把文件内容或匹配项复制到终端、日志或报告。若被阻断，只在本机受控编辑器中复核并移除数据库路由、credential 或 migration behavior 专用 assignment；不得输出值，也不得为通过门禁而删除 unrelated `VITE_*` 等普通应用配置。

route gate 通过后，目标门禁、路由门禁与对应数据库命令必须紧邻、在同一 checkout 和同一会话中执行；期间不得更改相关环境变量或项目 `.env*`。操作结束后必须运行 `.\scripts\operator\Exit-OpsDbSession.ps1`，清除本工具管理的 `SUPABASE_TRIAL_DB_URL`、`PGPASSWORD` 与 session marker。

CI 和公开日志只运行 `npm run trial:baseline:check`，不获得远端凭据，也不执行部署。真实远端部署保持受控、显式、人工发起。

## 5. Supabase Trial setup

本节适用于建立或重建 Trial 项目的受控流程。现有 Trial 已由 Task 3.9.2 建立并部署；本节在重建、审计或后续同等授权场景中仍适用，并由已获得 Trial 授权且明确持有授权记录的操作者执行。

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

每一条数据库命令前依次运行 link 后 target gate 与 route gate：前者确认 Trial identity，后者确认 `--db-url` 精确对应 linked Session Pooler metadata，并统一确认 shell credential/route/behavior selector、项目 `.env*` 持久化 assignment 与 `SUPABASE_ENV` 边界。操作者核对两个 gate 的脱敏输出后，再单独执行对应 CLI 命令。`SUPABASE_YES` 被禁止，所以 CLI confirmation prompt 继续作为 explicit Human Migration Approval 之后的 secondary safety barrier；route gate PASS 仍绝不等于 db push 已授权。两个 gate 都不封装或自动触发 remote mutation：

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

只有 dry-run 通过、备份边界确认、操作者再次授权后，才可逐条显式执行：

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

保持 project ID/workdir 与 profile 三项环境边界满足门禁，并在部署前紧邻运行 link 后 target gate；操作者核对结果后，才可显式执行：

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

Trial Vercel 部署已由 Task 3.9.2 的已授权人员在 Vercel 完成。

> Task 3.9.1 historical baseline statement：Task 3.9.1 不登录 Vercel、不创建项目、不修改域名，也不建立 `push main -> production` 自动部署。

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
- 邀请调用必须验证一次真实浏览器预检：浏览器请求头至少包含 `authorization`、`apikey`、`content-type`、`x-client-info`，响应必须使用准确 allow-origin、只允许 `POST` / `OPTIONS`、显式允许上述四个头并保留正确的 `Vary` / cache 语义；不得使用通配符或反射任意请求头；
- 仅看到 `OPTIONS -> 204` 不代表 CORS 通过；还必须证明 SDK/header 契约兼容、预检不调用认证或业务处理，并且允许来源的预检之后确实发出正常 `POST`；
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

Task 3.9.1 historical baseline statement：Task 3.9.1 不声称完成上述远端 Smoke/E2E；Task 3.9.3-R6 已在后续独立授权中执行，并因 mandatory member activation blocker 判定 NOT ADMITTED。

### Task 3.9.3-R6 脱敏执行结果（2026-08-22）

R6 在公开 Git SHA `b38cf709e4109a81a5cff4a7187b5568518b208f` 对应的稳定 Trial 前端上执行。Smoke 数据均为明显虚构数据并使用 `R6-SMOKE-` 前缀；数据保留为 Trial 验证痕迹，未执行破坏性清理。

执行前安全与版本门禁均通过：workspace/main 基线准确且工作树干净；`security:audit`、`check`、`test:edge`、operator credential verifier 与 diff check 通过；Trial target、Session Pooler 5432、TLS、22 项 migration 与末项 `20260812124927` 一致；operator database credential 仅加载用于只读核对，WRITE/APPLY authorization 均未授予并已清除；Production 仍未配置；Recovery Drill 既有关闭条件未发生回归。前端可追溯到上述准确 Git SHA，`invite-workspace-member` 为 active version 2。

真实桌面浏览器证据证明：Owner 登录、刷新后的 session restore、fresh login、工作空间解析、synthetic project 创建均成功。稳定 Trial origin 的邀请预检为 `OPTIONS 204`，allow-origin 精确匹配且不是 `*`，methods 固定为 `POST, OPTIONS`，allowed headers 固定为 `authorization, apikey, content-type, x-client-info`，任意附加 header 未被反射，`Vary` 包含 `Origin`，cache 为 `no-store` 且 max-age 为 600；随后同一正常浏览器流程实际产生 `POST 200` 并返回邀请成功。不可变 preview origin 的预检被 `403` 拒绝，作为非 allowlist 来源的负向证据；OPTIONS 未触发邀请业务 mutation。

邀请激活未通过。默认托管邮件发送到第一个非团队受控 inbox 时，Auth/业务侧记录了发送但 inbox 未收到邮件；改用另一个已加入平台组织团队的受控 inbox 后邮件成功到达，但邮件中的激活入口解析到 local development origin，而不是稳定 Trial 的 `/activate-account`。仓库 Edge handler 已向 Auth Admin 传入基于准确请求 origin 的 Trial 激活地址，runbook 也要求托管 Auth 公网 Site URL 与受控 Trial redirect allowlist；当前 hosted Auth 结果与该门禁不一致。R6 未改写邀请链接、未修改 Auth 配置、未重发来掩盖问题，也未把手工绕过计为 PASS。

| Mandatory check                                         | R6 result    |
| ------------------------------------------------------- | ------------ |
| owner login / workspace identity                        | PASS         |
| session restore                                         | PASS         |
| logout + fresh login                                    | PASS         |
| invitation CORS preflight                               | PASS         |
| invitation actual POST                                  | PASS         |
| controlled member activation/login                      | FAIL         |
| synthetic project creation                              | PASS         |
| project membership                                      | NOT EXECUTED |
| module / task creation                                  | NOT EXECUTED |
| todo -> in_progress                                     | NOT EXECUTED |
| progress / blocked / resume / 100%                      | NOT EXECUTED |
| submit / return / edit / resubmit / approve / completed | NOT EXECUTED |
| completed freeze                                        | NOT EXECUTED |
| unauthorized read denial                                | NOT EXECUTED |
| task refresh / deep link consistency                    | NOT EXECUTED |
| actual mobile browser                                   | NOT EXECUTED |

Finding count：Blocker 1，Major 0，Minor 0，Feature Request 0。

- Blocker：`Trial Auth invitation activation redirects to a local origin`。复现：Owner 从稳定 Trial 正常邀请已加入平台组织团队的受控成员，邮件可到达，但激活入口指向 local development origin，成员无法按正常 Trial 产品路径进入 `/activate-account`。影响：member activation、project membership、完整任务/review closure、completed freeze、outsider RLS、关键状态 refresh/deep-link 与真实手机 mandatory gates 均无法继续。证据类型：真实浏览器、受控收件箱人工检查、脱敏 Edge/Auth logs、只读数据库状态与仓库封板代码。建议：由独立授权任务核对并修正 hosted Trial Auth Site URL、redirect allowlist 与 invite template/config，完成独立审计与受控部署后，从准确基线重新执行完整 R6；本任务不实施修复。

确定性结论：

```text
TRIAL ADMISSION: NOT ADMITTED
```

本轮未启动 Stage 4，未执行 Production/Recovery mutation、db push、migration apply/repair/up、reset、restore、直接 Trial PostgreSQL 写入、未经授权部署、PR、merge 或 force push；正常 UI invitation/project 写入仅限本任务授权的 synthetic smoke 数据。OPS database session 已清除。

### Task 3.9.3-R6-F1 Hosted Trial Auth activation redirect 脱敏结果（2026-08-22）

F1 从准确 `origin/main` 基线 `3a65cbb5f75deaf948d6d8d99dfcff01b2333f84` 开始，只处理 R6 已封板的 Hosted Trial invitation activation redirect blocker；本轮不是完整 R6 重跑，也不授权 Stage 4、Production、Recovery、数据库、Edge Function 或 Vercel deployment mutation。

修复前只读诊断建立了组合配置根因：Hosted Trial Site URL 仍分类为 local origin，精确的稳定 Trial `/activate-account` 未进入 Redirect URLs allowlist；deployed `invite-workspace-member` 仍为 active version 2、JWT verification enabled，且 deployed source 与 sealed main 的 stable-origin `/activate-account` redirect 逻辑一致；Invite template 使用标准 `ConfirmationURL`，当前 Free/default SMTP 项目不允许编辑该模板。Supabase 当前行为会在应用传入的 redirect 未被允许时忽略该值并回退到 Site URL，因此真实邮件在 R6 中生成了 local redirect。

| Hosted Auth signal                         | Before F1                        | After minimal configuration remediation |
| ------------------------------------------ | -------------------------------- | --------------------------------------- |
| `SITE_URL_CLASSIFICATION`                  | `LOCAL_ORIGIN`                   | `TRIAL_ORIGIN`                          |
| `STABLE_TRIAL_ACTIVATION_REDIRECT_ALLOWED` | `NO`                             | `YES`                                   |
| `LOCAL_REDIRECT_PRESENT`                   | `NO`                             | `NO`                                    |
| `PREVIEW_REDIRECT_PRESENT`                 | `NO`                             | `NO`                                    |
| `DEPLOYED_INVITE_REDIRECT_LOGIC`           | `STABLE_ORIGIN_ACTIVATE_ACCOUNT` | unchanged                               |
| `INVITE_TEMPLATE_MODE`                     | `CONFIRMATION_URL`               | unchanged                               |
| `INVITE_TEMPLATE_EDITABLE`                 | `NO`                             | unchanged                               |
| `INVITE_AUTH_LOG_REDIRECT_CONTEXT`         | `UNAVAILABLE`                    | `TRIAL_ORIGIN`                          |

`ROOT_CAUSE_CLASSIFICATION: D`：精确 activation redirect 缺失与 local Site URL 同时存在；template 和 deployed Edge source 不是该 local redirect 的根因。F1 仅把 Site URL 改为稳定 Trial origin，并添加精确的稳定 Trial `/activate-account` redirect；未删除 localhost 配置、未加入 wildcard/Preview/Production/Recovery，也未修改邮件模板。

修复后由 Owner 在稳定 Trial 发出一个新的 controlled invitation。脱敏 Edge/Auth evidence 显示 invitation `OPTIONS 204`、`POST 200`、Auth `/invite 200` 和 mail delivery 均成功；随后 Auth `/verify` 曾成功返回一次 redirect，之后对同一一次性链接的重复访问均为 invalid/expired。操作者未在首次点击前留下任务要求的 ConfirmationURL 脱敏检查记录，且真实浏览器最终落在登录页而不是 `/activate-account`，因此不能补写 `NEW_INVITATION_REDIRECT: STABLE_TRIAL_ACTIVATION_PATH`，也不能把 redirect context 或后续绕行替代 mandated final-landing evidence。

| Narrow F1 check                                   | Result                                           |
| ------------------------------------------------- | ------------------------------------------------ |
| new invitation CORS preflight                     | `PASS` (`OPTIONS 204`)                           |
| invitation actual POST                            | `PASS` (`POST 200`)                              |
| controlled inbox mail delivery                    | `PASS`                                           |
| pre-click ConfirmationURL redirect classification | `UNAVAILABLE`                                    |
| Auth invite token verification                    | `PASS ONCE`; later visits invalid/expired        |
| final landing = stable Trial `/activate-account`  | `FAIL`                                           |
| activation through the invitation session         | `FAIL`                                           |
| password-recovery workaround                      | `EXECUTED BY HUMAN — NOT F1 ACTIVATION EVIDENCE` |
| member normal login after the workaround          | `PASS`                                           |
| workspace membership                              | `PASS` (`member`, enabled)                       |
| refresh identity / membership consistency         | `PASS`                                           |

内置浏览器的只读核验显示该成员可恢复受保护工作台和成员目录，成员状态为 enabled，刷新后保持一致；该成员没有可见的邀请、角色调整或停用控制，浏览器控制台无 auth/network error。上述结果只证明 recovery 后的账号访问和 membership，不证明 invitation activation session 的正常落地。

本轮还确认一个独立的新 Finding：对已由早期邀请创建 Auth user 的邮箱调用 hosted `inviteUserByEmail` 会返回“already registered”，而 sealed 本地 reissue 验证假设该调用会复用同一未确认 Auth user 并重新发信。删除业务邀请行既不能释放 Auth email，也被 schema 明确禁止；F1 未执行任何账号/邀请清理。该 hosted reissue compatibility 与首次 verify 后 activation session/final landing 均需要独立任务判定，F1 不修改业务代码、不 redeploy Edge Function。

确定性结论：Hosted URL configuration 的最小修复已应用，但 F1 全部成功标准未满足，不得记录 blocker remediated：

```text
TRIAL AUTH ACTIVATION REDIRECT BLOCKER: NOT REMEDIATED
FULL R6 RERUN: PENDING
TRIAL ADMISSION: NOT ADMITTED
```

F1 未执行直接 Trial PostgreSQL 写入、db push、migration apply/repair/up、reset、restore、Recovery/Production mutation、SMTP 配置、Edge/Vercel redeploy、PR、merge 或 force push；未在文档中记录 project ref、Hosted URL、邮箱、token、OTP、用户 ID、IP、请求 ID、数据库 hostname、credential path 或 Auth raw log。

### Task 3.9.3-R7 最终 Trial Smoke/E2E Rerun 脱敏结果（2026-08-25）

R7 从准确 `origin/main` 基线 `9f14bda8cd77901984adbd0d7363535970a49344` 开始，在分支 `test/task-3.9.3-r7-final-trial-admission` 执行。执行前确认 live remote main、本地 main tracking ref、merge-base 与工作树一致，且 Frontend、Database、Edge Function 三组 push CI 均绑定该准确 SHA 并成功。Node.js `v22.23.2`、npm `10.9.8`、仓库锁定的 Supabase CLI `2.110.0` 参与验证。

本地与只读远端门禁通过：`npm ci`、`npm run security:audit`、`npm run check`、`npm run test:edge`、operator credential verifier、`npm run db:verify` 与 diff check 全部 PASS；Trial target、Session Pooler 5432、TLS 与 24 项 local/remote migration 完全一致，末项为 `20260824125359`；deployed `invite-workspace-member` 为 active version 4、JWT verification enabled，去除注释与格式差异后与当前 main 的可执行语义一致；Production 保持 `NOT CONFIGURED`，operator database session 已清除，WRITE/APPLY authorization 均未授予。

前置 Hosted gate 建立了确定性分叉：授权 Vercel Trial project 上存在 source branch `main`、准确 SHA `9f14bda8cd77901984adbd0d7363535970a49344` 且状态为 READY 的 deployment，授权稳定入口返回 200 并包含全部 6 项强制安全响应头；但 Hosted Auth 当前 Site URL 分类为 `NON_VERCEL_ORIGIN`，无法由 Vercel deployment trace 解析。该入口提供的前端 asset basename 与准确 main 构建一致，只能证明前端内容相似，不能证明授权部署来源、环境边界或 exact-SHA delivery。对 Hosted Auth 实际入口的只读响应头检查返回 200，但 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、`Strict-Transport-Security` 与 `X-Permitted-Cross-Domain-Policies` 全部缺失。

上述两项均属于 invitation、activation、recovery 及全部业务 E2E 之前的 mandatory Blocker。R7 因此没有发出 invitation、没有打开一次性 token、没有设置或修改密码、没有创建 `R7-SMOKE-*` 业务数据，也没有执行清理。既有 Owner session 的只读页面可达观察不能替代 fresh login/logout、角色闭环或移动端 mandatory evidence；未执行项均保持 `NOT EXECUTED`，不以静态代码、本地测试、历史 R6/F1/F2 证据或 asset 一致性补写 PASS。

| Mandatory check                                               | R7 result    |
| ------------------------------------------------------------- | ------------ |
| exact main / exact-SHA push CI                                | PASS         |
| local security / frontend / Edge / database gates             | PASS         |
| Trial target / database route / migration trace               | PASS         |
| deployed Edge Function executable-semantics trace             | PASS         |
| authorized Vercel exact-main deployment                       | PASS         |
| Hosted Auth actual origin -> authorized Vercel trace          | FAIL         |
| security headers on authorized Vercel stable origin           | PASS         |
| security headers on Hosted Auth actual origin                 | FAIL         |
| Hosted Invite / Recovery email template read-only inspection  | NOT EXECUTED |
| owner fresh login / logout / session / deep link              | NOT EXECUTED |
| fresh invitation / single-password activation / member login  | NOT EXECUTED |
| recovery and return-to negative paths                         | NOT EXECUTED |
| workspace role / invitation / membership                      | NOT EXECUTED |
| project / module / task / progress / blocker / review closure | NOT EXECUTED |
| completed freeze / outsider RLS denial                        | NOT EXECUTED |
| Stage 4.1 home / my tasks role consistency                    | NOT EXECUTED |
| actual mobile browser                                         | NOT EXECUTED |

Finding count：Blocker 2，Major 0，Minor 0，Feature Request 0。

- `R7-B001`（Blocker）— `Hosted Trial origin is not traceable to the authorized exact-main Vercel deployment`。复现：核对 Hosted Auth Site URL 分类并用 Vercel deployment trace 解析，同时对照授权 Vercel Trial project 上准确 main SHA 的 READY deployment。期望：Hosted Auth 稳定入口与授权 exact-main Vercel deployment 为同一 Trial origin。实际：Hosted Auth 使用 `NON_VERCEL_ORIGIN`；Vercel exact-main deployment 独立存在但不是 Auth 当前入口。影响：全部角色、邮件跳转与业务闭环的环境边界和部署追溯。可重复：是。建议：在独立授权任务中确定唯一 canonical Trial origin，重新建立 Vercel deployment、Hosted Auth URL/redirect/template 与 exact-SHA 追溯一致性并独立审计；R7 不实施配置修复。
- `R7-B002`（Blocker）— `Mandatory security headers are absent on the Hosted Auth actual origin`。复现：对 Hosted Auth 当前 Site URL 执行只读 HEAD 检查。期望：6 项 mandatory headers 全部存在。实际：入口为 200，但 6 项全部缺失；作为对照，授权 Vercel stable origin 的 6 项全部存在。影响：所有桌面/移动访问以及邀请、激活和恢复落地。可重复：是。建议：在 canonical Trial origin 对齐任务中恢复并验证完整 header contract；R7 不修改 hosting 或 header 配置。

确定性结论：

```text
TRIAL ADMISSION: NOT ADMITTED
```

R7 未执行 Trial/Production/Recovery mutation、Hosted Auth 配置修改、SMTP 配置、邀请或密码操作、业务写入、db push、migration apply/repair/up、reset、restore、Edge/Vercel/CloudBase 部署或 Finding 修复；没有创建 PR、合并 main 或 force push。所有 URL、project ref、邮箱、账号、token、OTP、用户/请求 ID、IP、数据库 hostname、credential path 与 raw Auth log 均未写入证据。

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

本节只定义下一次**单独授权**的恢复演练；本仓库分支不执行备份、restore、远端 reset 或数据库写入。依据 Supabase 当前官方的 [Database Backups](https://supabase.com/docs/guides/platform/backups)、[Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)、[CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[`db dump` reference](https://supabase.com/docs/reference/cli/v1/supabase-db) 与 [Auth users migration](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)，先按实际 Trial 套餐和项目状态选择下列路径；不得按套餐名称猜测能力。

### A. Managed backup available

1. 由授权操作者在受控平台核对可恢复备份的状态、带时区时间戳、最早/最晚恢复点、保留期和可能的数据丢失窗口（RPO），只在非公开记录中保存项目和操作者信息。
2. 记录平台提供的受控恢复入口。优先使用官方“restore to a new project”把物理备份复制到新项目；该能力要求付费计划和已启用的 physical backups，并且仍需人工重新配置 Edge Functions、Auth settings/API keys 等非数据库配置。
3. 恢复目标必须是另行授权的 disposable Trial/recovery 项目，不得是 active Trial，更不得是 Production。禁止为了证明恢复而 destructive-reset active Trial。
4. 平台物理恢复可包含数据库 schema/data、roles/permissions 和 `auth` identity data，但仍须以实际恢复结果逐项验证，不得把“平台显示可恢复”当成演练成功。

### B. Managed backup unavailable

1. 在任何高风险 Trial 写入、migration 或 E2E 前（适用时）由授权操作者使用仓库锁定的 Supabase CLI 和官方 CLI backup sequence 生成 manual logical backup。连接信息只存在于受控会话，不写入命令文件、artifact 名、文档、日志或 shell history。
2. 备份集至少分别覆盖 roles、application schema 和 application data；需要延续 CLI migration state 时，按官方流程单独保存 `supabase_migrations` schema/data。记录 CLI 版本、每个 artifact 的 UTC/带时区时间戳、明确包含/排除的 schema、文件大小和 SHA-256（例如在受控终端使用 `Get-FileHash -Algorithm SHA256`）。
3. artifact 与 manifest 必须保存于公开仓库之外的受控位置；绝不提交 Git，不使用含 credential、项目 ref、真实 URL、真实账号或业务数据的文件名，也不把内容复制进公开日志、报告或聊天。
4. standard `supabase db dump` 会排除 `auth`、`storage` 和 extension-owned 等 Supabase-managed schemas；普通 schema/data dump 不是完整应用恢复备份。migration history 也必须按官方流程显式处理。
5. 本应用的可恢复集合必须同时覆盖：application schema、application data、需要的 migration history、roles/privileges/ACL/RLS 语义，以及与 `app_users` / `user_identities` / memberships 引用一致的 Supabase Auth identity state，或一个已经验证为安全的重建流程。
6. 不得编造 Auth SQL，不得直接 INSERT/UPDATE `auth.users` 作为捷径。Supabase 官方说明 Auth 用户迁移可使用完整 Dashboard backup，或按其 general migration guide 执行经过验证的 SQL export/import；在目标计划、CLI 版本和隔离恢复项目上未证明安全步骤前，manual logical backup 只能视为部分保护，恢复准入继续阻断。

### Isolated restore drill and evidence

未来演练必须获得单独授权，并只在 disposable Trial/recovery 项目或等价隔离环境执行。恢复前再次确认目标既不是 active Trial 也不是 Production；不得使用远端 `db reset` 掩盖失败。至少保留以下脱敏证据：

- backup artifact 存在、可读，时间戳/hash 与 manifest 一致，并能证明来自预期 Trial；
- roles、application schema/data 和需要的 migration/version state 恢复成功；
- 核心 table privileges、column privileges、RLS/RPC、拒绝路径与白名单路径通过仓库验证；
- Auth identity 已通过官方支持路径恢复，或安全 reconstruction procedure 已被实际验证；新项目 key/签名边界变化时，受控用户能够按预期重新认证；
- 应用能读取恢复后的低风险 smoke state，且 active Trial / Production 未被改变；
- artifact、仓库、命令历史和公开日志中没有 Secret、连接信息、真实账号或业务数据；
- 记录恢复结果、RPO/保留限制、未恢复的平台配置、失败与后续责任人。

只有上述真实 restore drill 完成并经独立复核后，`TRIAL-RECOVERY-001` 才可考虑关闭。文档更新、backup artifact 单独存在或本地测试通过均不是恢复证据。Task 3.9.3 的真实 Recovery Drill 已完成 PLAN、APPLY、Recovery Auth 新登录、issuer identity 追加、`current_app_user_id()`、Owner/workspace 与 Trial/Production 未修改核验，已建立 blocker 关闭条件；这仍不等于最终 Trial Admission 已通过。当前状态为：

```text
RECOVERY DRILL COMPLETE
TRIAL-RECOVERY-001 CLOSURE CONDITIONS ESTABLISHED
FINAL TRIAL RERUN NOT YET EXECUTED
```

Stage 6 前仍必须完成独立的 Production backup/restore 演练；Trial 演练不能替代 Production 恢复证据。

### Recovery Identity Domain Rebind V1

Supabase Auth 用户随数据库恢复到另一个 Supabase 项目后，`auth.users.id`
和密码哈希可以保持不变，但新项目会签发新的会话。新会话 JWT 的 `sub`
仍是恢复后的 Auth UUID，`iss` 则是 Recovery 项目的 Auth issuer。应用的
`current_app_user_id()` 故意按精确的
`(provider='supabase_auth', provider_tenant=iss, provider_subject=sub)`
解析；因此只恢复 `auth.users` 不会让新的 Recovery issuer 自动继承旧 Trial
身份域的授权。

本仓库提供 `scripts/recovery/recovery-auth-tenant-rebind.mjs`，只用于经过验证的
Supabase 项目到项目灾难恢复。它是离线 operator procedure，不创建 migration、
数据库函数、public RPC、Edge Function、浏览器入口或日常 Trial 功能。V1 只支持：

- source 与 target 都是 canonical Supabase hosted Auth issuer；
- `provider = supabase_auth`；
- 恢复后的 `auth.users.id` 与 source `provider_subject` 完全相同；
- 把 target issuer + 同一 subject 追加到同一现有 `app_user`；
- 不做邮箱匹配、账号合并、跨 provider 绑定、微信迁移或任意 tenant federation。

旧身份行必须保留：它是历史外部身份事实，绑定字段由数据库触发器强制不可变。
Recovery 绑定使用 INSERT 追加；不得 UPDATE source `provider_tenant` /
`provider_subject` / `user_id`，不得 DELETE 或仅因发生恢复而 revoke source 行。

#### Execution authorization boundary

仓库实现、测试、功能分支 push、CI、独立审计、PR 和 merge 都不授权执行 APPLY。
只有上述代码交付完成后，在一个**新的、单独授权的 Recovery operation** 中，
操作者才可使用本节。当前 coding task 禁止对 active Trial、hosted Recovery 或
Production 运行 PLAN/APPLY；本节出现命令不表示它们已经执行。

在任何 Recovery 连接前，受控恢复记录必须已经证明：

1. target 是隔离 Recovery 项目，不是 active Trial 或 Production；
2. linked project ref 与 linked Session Pooler metadata 来自当前 Recovery checkout；
3. source issuer 来自 active Trial inventory，target issuer 来自实际 Recovery Auth；
4. source 和 target issuer 都是精确 canonical `https://<ref>.supabase.co/auth/v1`，且不相等；
5. Recovery database cluster system identifier 已在受控记录中建立，不能在执行时猜测；
6. migration count / latest version 与已审阅恢复结果一致；本次 R3 已知恢复前提是 22 项、latest `20260812124927`，执行时仍需重新核对实际值；
7. source identity 已验证且未撤销、内部用户 active；
8. Recovery `auth.users.id::text` 与 source subject UUID 完全相同；
9. 该恢复 subject 已在 Recovery Auth 成功完成一次新会话认证；
10. active Trial / Production inventory 已明确填写；若 Production 尚未配置，只能使用固定值 `NOT_CONFIGURED`，不能留空。

`verified_at` 的含义不在本任务中全局放宽。新 target identity 之所以可标记为已验证，
必须同时依赖上述四段证据：source identity 原本已验证且 live、subject UUID 在
Recovery `auth.users` 中精确恢复、该 subject 已由 Recovery Auth 成功认证、操作者
正处于显式授权的灾难恢复流程。程序能在数据库中复核前三项中的持久化部分；
“成功的新 Recovery Auth 会话”和“人工恢复授权”由受控恢复记录与固定确认值作为
执行前提。缺少任一项即停止，不得为了通过测试设置 `verified_at`。

#### Target and route evidence

该过程复用 stable CLI linked-state / Session Pooler route 约束，并增加 Recovery
专用证据。它不只依赖项目名称：linked ref、linked pooler route、canonical target
issuer、数据库 cluster system identifier、migration count/latest 必须同时一致。
端口只允许 Session Pooler `5432`，不允许 Transaction Pooler `6543`；URL 不得嵌入
密码，`PGPASSWORD` 是唯一密码来源。`SUPABASE_PROFILE` 必须精确为 `supabase`，
`SUPABASE_WORKDIR`、PG route selectors、migration behavior overrides，以及 active
Trial 的 route/project session variables 均必须为空。

所有值只放在当前受控 PowerShell 进程，不写 `.env*`、脚本、Markdown、命令字面量、
聊天、截图或 shell history。操作器会 fail closed 检查 CLI 会读取的 8 个项目
dotenv 候选文件；任何 `RECOVERY_*`、数据库 route/password 或 Supabase selector
持久化 assignment 都会拒绝。先由已审计的 credential bootstrap 加载 Recovery target、
passwordless Session Pooler route、DPAPI password 与官方 CA，再使用兼容 Windows PowerShell
5.1 的 hidden-input helper 建立仍需人工提供的 Recovery operation evidence：

```powershell
.\scripts\operator\Enter-OpsDbSession.ps1 -Target Recovery

function Read-RecoveryValue {
  param([Parameter(Mandatory = $true)][string]$Prompt)
  $secureValue = Read-Host $Prompt -AsSecureString
  try {
    return [System.Net.NetworkCredential]::new('', $secureValue).Password
  } finally {
    $secureValue.Dispose()
  }
}

$env:RECOVERY_TARGET_CLASSIFICATION = 'ISOLATED_RECOVERY_TARGET'
$env:RECOVERY_OPERATOR_AUTHORIZATION = 'AUTHORIZED_RECOVERY_REBIND_V1'
$env:RECOVERY_AUTHENTICATION_EVIDENCE = 'AUTHENTICATED_RECOVERY_SESSION_VERIFIED'
$env:RECOVERY_ACTIVE_TRIAL_PROJECT_REF = Read-RecoveryValue 'Active Trial project ref'
$env:RECOVERY_PRODUCTION_PROJECT_REF = Read-RecoveryValue 'Production project ref or NOT_CONFIGURED'
$env:RECOVERY_SOURCE_ISSUER = Read-RecoveryValue 'Exact source issuer'
$env:RECOVERY_TARGET_ISSUER = Read-RecoveryValue 'Exact Recovery issuer'
$env:RECOVERY_AUTH_SUBJECT = Read-RecoveryValue 'Restored Auth subject UUID'
$env:RECOVERY_EXPECTED_SYSTEM_IDENTIFIER = Read-RecoveryValue 'Recovery database system identifier'
$env:RECOVERY_EXPECTED_MIGRATION_COUNT = Read-RecoveryValue 'Expected migration count'
$env:RECOVERY_EXPECTED_LATEST_MIGRATION = Read-RecoveryValue 'Expected latest migration'
```

bootstrap 不设置 classification、operator authorization、authentication evidence、active Trial/Production inventory、issuer、subject、system identifier 或 migration evidence；这些值继续由独立 Recovery operation 人工建立。`NODE_EXTRA_CA_CERTS` 只指向本机受控的官方 Recovery CA，TLS verification 保持开启。

进入 Recovery credential session 前，bootstrap 会清除上一轮由本工具管理的 session
state，然后对当前进程环境中的所有非空 `RECOVERY_*` 变量做 fail-closed 检查：只要
仍存在任何非本工具管理的 `RECOVERY_*`（例如上一轮 Recovery operation 遗留的
operator authorization / authentication evidence / target classification / issuer /
subject / system identifier / migration evidence），立即以
`OPS_DB_AMBIENT_CONTEXT_CONFLICT` 拒绝进入，且不删除、不修改这些遗留值。因此每次
Recovery operation 必须从干净的人工授权上下文开始：先 Enter Recovery credential
session，再独立建立本次 operation evidence，再取得本次 PLAN/APPLY 人工授权，不能
复用上一轮环境中的授权。上一轮操作遗留的 `RECOVERY_*` 需要在进入前由操作者按
下方收尾流程显式清除。

在设置这些变量前，当前 checkout 必须已经由另一个明确授权步骤 link 到 Recovery；
`supabase/.temp/project-ref` 和 `supabase/.temp/pooler-url` 缺失或与输入不一致时，
PLAN 与 APPLY 都会拒绝。不得复制 active Trial checkout 的 linked metadata，也不得
为通过门禁手工编造 pooler hostname、system identifier 或 migration evidence。

#### Phase A — PLAN / DRY RUN

PLAN 是只读的 repeatable-read transaction。它验证 Recovery target、source identity、
active app user、恢复后的 Auth UUID、全 subject ownership、target conflict 及当前精确
解析结果。输出只有 counts、booleans 和 SHA-256 `plan_digest`；不输出 issuer、subject、
identity/app user ID、JWT、邮箱、URL、project ref、连接信息或凭据：

```powershell
node scripts/recovery/recovery-auth-tenant-rebind.mjs --mode plan --confirm RECOVERY
```

对于本次单 subject V1，首次安全计划必须明确满足：

- `status = PASS`；
- `safe_rebind_count = 1`；
- `idempotent_noop_count = 0`；
- source verified/live、app user active、Auth subject present、subject owner count = 1；
- target conflict count = 0、source/target distinct、Recovery target verified；
- `mutation_performed = false`。

如果 exact target identity 已存在、live 且指向同一 `app_user`，PLAN 应为
`safe_rebind_count = 0`、`idempotent_noop_count = 1`；这属于安全幂等状态。任何其他
count、失败码或不确定证据都必须停止。操作者将 `plan_digest` 记录在受控操作记录中，
完成人工复核；PLAN 绝不会自动继续 APPLY。

#### Phase B — APPLY

APPLY 必须是新的、单独命令，并同时携带已审阅 digest 与第二确认值。digest 是非秘密
审阅指纹，但仍只进入受控操作记录：

```powershell
$reviewedPlanDigest = Read-Host 'Reviewed PLAN digest'
node scripts/recovery/recovery-auth-tenant-rebind.mjs --mode apply --confirm RECOVERY --plan-digest $reviewedPlanDigest --confirm-apply APPLY_RECOVERY_IDENTITY_REBIND
```

APPLY 在一个 serializable transaction 内重新执行全部 target / route / identity guard，
锁定 `user_identities`、source `app_users` 与恢复后的 `auth.users`，并重新计算 digest。
digest 不一致或任一 guard 失败时事务 rollback，不产生部分绑定。成功路径只执行一条
`user_identities` INSERT：

- `provider = supabase_auth`；
- `provider_tenant =` exact Recovery issuer；
- `provider_subject =` restored Auth UUID；
- `user_id =` source identity 的同一内部用户；
- `verified_at =` 当前受控恢复验证时间；
- `last_used_at = null`，不伪造应用使用历史。

事务提交前再次证明 source 行完全未变，target 行 live，source 与 target 的 exact
issuer + subject 都经未修改的 `current_app_user_id()` 解析到同一 `app_user`。重复 APPLY
对同一 live mapping 返回 idempotent NO-OP，不创建 duplicate。

#### Post-apply verification and incident behavior

APPLY 的本地/终端 PASS 不是恢复闭环。提交后必须：

1. 运行 `.\scripts\operator\Exit-OpsDbSession.ps1` 清除 bootstrap 管理的 password、route 与 CA，再清除本次人工建立的其余 Recovery evidence；
2. 对 Recovery Auth 明确退出并重新登录，取得新的 Recovery session；不得复用 Trial token；
3. 通过正常应用/RLS 路径证明 `current_app_user_id()`、Owner workspace state 和低风险 smoke state 正常；
4. 验证 source 历史 identity 仍存在且未变、target identity 恰一条；
5. 证明 active Trial 与 Production 未发生 mutation；
6. 由独立复核者检查脱敏 PLAN/APPLY、版本链和真实浏览器证据。

完成或中止操作后，在同一进程清除操作上下文；不得把这些值导出到 profile 或
dotenv：

```powershell
.\scripts\operator\Exit-OpsDbSession.ps1
Get-ChildItem Env:RECOVERY_* | Remove-Item -ErrorAction SilentlyContinue
```

任一 guard 在 commit 前失败会自动 rollback。成功 commit 后没有自动 DELETE/UPDATE
“回滚”，因为身份历史是 append-only。若 mapping、target 或恢复证据出现任何疑问：

- 立即停止 Recovery 登录与业务写入；
- 不修改、删除或撤销 source identity，不自行 UPDATE/DELETE target identity；
- 保存不含 subject、issuer、账号或连接信息的失败分类和影响范围；
- 由授权人员选择恢复到 APPLY 前的隔离 Recovery 备份，或设计单独审阅的 forward remediation；
- 重新执行完整恢复验证与独立复核后才恢复使用。

本过程的 repository implementation、测试或一次 APPLY 都不能单独关闭
`TRIAL-RECOVERY-001`。只有真实 Recovery re-authentication、应用解析、权限/业务 smoke、
active Trial/Production 未修改和独立复核全部成立后，才可另行评估 blocker。

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

> Task 3.9.1 historical baseline statement：以下延期清单描述 Task 3.9.1 完成时的
> 范围边界。其中 Trial Supabase/Vercel 创建与部署已由 Task 3.9.2 完成，Recovery
> Drill 已由 Task 3.9.3 完成；R6 与 R7 均已执行并判定 NOT ADMITTED；其余项目仍未执行并继续延期到后续授权任务：

- Task 3.9.3 后续独立任务：确定唯一 canonical Trial origin，使授权 Vercel exact-main deployment、Hosted Auth URL/redirect/template 和 mandatory security headers 重新一致；完成独立审计后，再从准确基线重新执行全量 Trial Smoke/E2E 与准入；
- Production Supabase/Vercel 创建、配置、迁移、域名和正式数据；
- Stage 4 工作台、通知、提醒、通用日志、回收站；
- 微信小程序、CloudBase、微信身份桥接、订阅消息和飞书；
- 生产 SMTP、附件、评论、Realtime、已完成重开和归档恢复。

> Task 3.9.1 historical baseline statement：Task 3.9.1 当时的正确交付状态是
> Trial deployment baseline（如下），不是 `Production deployed` 或 `Trial deployed`；
> 该状态已由后续授权任务推进，不再是当前状态：

```text
Task 3.9.1
Trial Deployment Baseline
FINAL AUDIT FIX PUSHED
READY FOR FINAL PASS REVIEW
```
