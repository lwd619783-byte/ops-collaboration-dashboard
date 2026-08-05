# 公开开发流程

## 公开代码与私有数据边界

允许提交通用前后端代码、数据库结构和迁移、虚构测试数据、不含密钥的配置示例与通用开发文档。

禁止提交真实人员、单位、专家或成员信息，真实项目和内部工作记录，内部文件和会议材料，真实 IP、内部域名与网络拓扑，以及日志、Cookie、Token、密码、私钥、API Key、Supabase/Vercel/飞书/GitHub 凭据和本机绝对路径。

## 固定开发流程

`main` 最新基线 → 独立功能分支 → 本地检查 → 普通推送 → 功能分支 CI → 远端独立代码审计 → 修复并复审 → 审计通过后创建 PR → PR CI → Squash 合并 → 合并后核验 → 删除远端功能分支。

## Git 红线

- 不直接向 `main` 提交功能，不在独立审计前创建 PR，也不在审计通过前合并。
- 不 force push、不重写已推送历史、不删除或覆盖用户既有修改。
- 不绕过失败 CI，不以 Codex 自述报告替代远端代码审计。

## 代码与测试红线

- 保持 TypeScript strict；不使用无理由的 `any` 或 `@ts-ignore`。
- 不编写只有 `toBeTruthy` 等弱断言的测试，不为通过检查关闭规则，不做任务范围外重构。
- 依赖变化后必须运行 `npm run security:audit`。
- 仓库文本文件通过 `.gitattributes` 统一使用 LF；不得提交纯换行变更，也不得依赖个人全局 `core.autocrlf` 设置维持检查结果。

## 每次交付检查

```bash
npm ci
npm run security:audit
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
git diff --check
```

涉及数据库和 Task 2.2 项目成员边界时，还必须使用本地 Supabase 执行：

```bash
npm run db:reset
npm run db:test
npm run db:membership:verify
npm run db:lint
npm run db:types
npm run db:types:check
npm run db:verify
```

成员并发脚本只允许随机虚构夹具和本地连接，不得输出本地数据库连接串、publishable/secret key 或 JWT。功能分支普通推送后，必须等待与最终 commit SHA 精确匹配的 Project Checks、Database Checks、Edge Function Checks；CI 通过只代表实现与远端流程完成，不能替代后续独立代码审计。本任务不创建 PR，审计结论保持待处理。
