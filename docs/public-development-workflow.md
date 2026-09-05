# 公开开发流程

本文件只定义本公开仓库特有的**公开 / 私有边界、Git 审计流程和验证路由**。通用 Codex 沟通、自主推进、提问和报告偏好不在这里重复。

## 1. 公开代码与私有数据边界

允许提交：

- 通用前后端代码、数据库结构与 migration；
- 虚构测试数据；
- 不含密钥的配置示例；
- 可公开的通用开发文档。

禁止提交真实人员、单位、项目、内部工作记录、内部文件和会议材料，真实 IP、内部域名与网络拓扑，以及日志、Cookie、Token、密码、私钥、API Key、数据库连接串、Supabase / Vercel / CloudBase / GitHub 凭据和本机绝对路径。

## 2. Git 与独立审计流程

默认流程：

`最新 main → 独立功能分支 → 实现与必要验证 → 普通 push → exact-head CI → 远端 main...branch 独立审计 → 修复并复审 → 审计通过后 PR → PR CI → Squash Merge → post-merge 核验`

项目红线：

- 不直接向 `main` 提交普通功能改动；
- 不在远端独立审计通过前创建 PR；
- 不在审计和 PR CI 通过前合并；
- 不 force push、不重写已推送历史、不删除或覆盖用户既有修改；
- 不绕过失败 CI，也不以 Codex 自述报告替代远端真实差异审计。

CI 必须对应最终推送的 exact head SHA。CI 通过证明自动门禁通过，不等于独立审计通过，也不等于 Trial / Production Admission。

## 3. 验证路由

验证与改动风险匹配；不要把所有专项命令机械应用到每个任务。

### 文档或纯导航改动

检查目标文档、链接 / 路径、实际 diff 与：

```bash
git diff --check
```

只有当文档改动会影响脚本、配置、部署门禁或机器读取行为时，才运行对应专项检查。

### 普通前端 / TypeScript 改动

优先运行：

```bash
npm run check
```

它已经覆盖格式、Lint、类型、单元测试、Trial baseline 静态门禁、前端凭据构建门禁和生产构建。若改动只触及很小范围，可先运行直接相关测试；在进入远端交付前按影响范围补齐必要门禁。

### 依赖或锁文件改动

运行：

```bash
npm ci
npm run security:audit
npm run check
```

不得为了通过 audit 随意忽略高危 / 严重问题或无关升级大量依赖。

### 数据库 / migration / RLS / RPC 改动

读取 `docs/supabase-development.md` 与目标领域文档，并运行目标 migration / pgTAP / concurrency 测试。涉及数据库结构、权限、生成类型或并发语义时，使用完整本地门禁：

```bash
npm run db:verify
```

如果同一任务还修改前端或共享 TypeScript，再运行 `npm run check`。数据库验证只使用 loopback 本地 Supabase 与虚构夹具；不得把 Trial / Production 当作普通测试环境。

### Edge Function 改动

至少运行目标 Edge Function 测试：

```bash
npm run test:edge
```

涉及真实入口或 Deno 类型边界时，再执行对应 `deno check`；如果同时修改共享前端 / TypeScript，再运行 `npm run check`。

### Trial / Recovery / operator tooling

先读取 `docs/trial-deployment.md` 的目标章节和相关 runbook，再运行该流程明确要求的 gate。Hosted mutation、真实邀请 / token 消费、credential bootstrap、Recovery APPLY、migration 部署或 Production 操作必须有当前任务的明确授权，不能因为本地验证通过而自动执行。

## 4. 代码、测试与文本红线

- 保持 TypeScript strict；不使用无理由的 `any` 或 `@ts-ignore`。
- 不用只有 `toBeTruthy` 等弱断言的测试替代真实行为验证。
- 不为通过检查关闭规则、放宽权限、安全校验或数据库约束。
- 不做任务范围外重构。
- 仓库文本由 `.gitattributes` 统一使用 LF；不提交纯换行变更，也不依赖个人全局 `core.autocrlf` 维持结果。
- 临时调试文件、构建产物、真实凭据或本机路径不得进入提交。

## 5. 交付证据

功能分支交付至少应能从远端验证：

- 最终 commit SHA 与分支状态；
- `main...branch` 的真实差异；
- 与风险匹配的测试 / gate 结果；
- exact-head CI 状态；
- 仍存在的真实风险或未完成项。

独立审计通过之后才进入 PR 阶段；PR 合并后再核验 `main` 的真实结果。
