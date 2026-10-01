# 2026-10-01 已审迁移手工发布的 CI 门禁修正

## 原因与范围

- 待执行 migration 会使普通 main 自动发布在数据库状态检查处停止；原手工发布又要求整条 CI run 的结论为 `success`，因此即使 `verify` 已通过，也可能无法进入受控迁移流程。
- 仅修正 `Deploy production` 手工派发的来源校验：目标仍必须是当前完整 main SHA，且该 SHA 的 main push `CI` 必须存在成功的 `verify` 作业。没有对应 run、作业失败或 GitHub 查询失败时拒绝；不改变自动部署、迁移开关、备份、回滚或维护状态。
- `tools/tooling.test.mjs` 增加工作流静态约束；部署手册明确区别 CI 验证和自动发布结果。

## 验证与状态

- `node --test tools/tooling.test.mjs`：19/19 通过；`pnpm exec prettier .github/workflows/deploy-production.yml --check`：通过。
- `pnpm api:docs:check`：363 条路由通过；`pnpm tools:test`、`pnpm typecheck`、`pnpm build`、`node deploy/global/check.mjs`（187 项结构检查）及 `git diff --check`：通过。
- `pnpm test` 因并行负载出现 3 项既有 5 秒超时，退出码 1；单独执行 `pnpm --filter @saydian/app-api exec vitest run --maxWorkers=1 --testTimeout=20000` 为 840 项通过、4 项按原配置跳过。不将单独重跑冒充根命令通过。
- 目标 migration `20261001190000_say_ring_legal_product` 已确认只在两张 OAuth/微信绑定票据表增加 `TEXT NOT NULL DEFAULT 'saydian-global'` 字段，无删除或旧值改写；生产备份、恢复演练及实际执行仍是独立门禁。
- 修改前线上国内 `/health/ready` 为 `97eed39`、国际 `/global/health/ready` 为 `6ea9dd9`；旧 main 发布作业仍在运行。本轮仅修正工作流源码，不宣称迁移或上线完成。
