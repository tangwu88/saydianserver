# 2026-10-01 Say Ring 密码登录移植到生产主线候选

## 原因与范围

- 原密码登录候选 `98446a0` 基于旧 `codex/global-api-foundation`；生产主线 `7cdf04b` 已另行包含 Say Ring 基础协议与迁移，不能直接合并旧 PR。
- 从当前 `origin/main=7cdf04b` 新建独立工作区，只移植密码登录与专属同意增量。冲突仅在 `global-auth.test.ts` 的相邻用例；保留主线“未验证既有账号可登录”行为，并保留新 Say Ring 用例。
- 修正文档中已过时的“未验证开关限制”描述；不改默认 `saydian-global` 或国内密码登录，也不创建用户。

## 验证

- `pnpm install --frozen-lockfile`、`pnpm db:generate`：通过。
- `pnpm api:docs:check`：363 条路由通过；`pnpm contracts:client:check`：76 个消费者路径检查通过。
- `pnpm --filter @saydian/app-api exec vitest run src/auth/global-auth.test.ts --maxWorkers=1 --testTimeout=20000`：34/34 通过。首次定向测试因新工作区尚未构建 `@saydian/app-contracts` 而无法加载；构建 contracts 后通过。
- `pnpm tools:test`、`pnpm typecheck`、`pnpm build`、`node deploy/global/check.mjs`、`git diff --check`：通过；部署结构检查 187 项，未执行运行时操作。
- `pnpm test` 并行运行时，一项既有微信绑定密码猜测用例超过默认 5 秒。单独运行 `pnpm --filter @saydian/app-api exec vitest run --maxWorkers=1 --testTimeout=20000`：840 项通过、4 项按原配置跳过；根命令本次未通过，不把单独重跑写成根命令通过。

## 发布门禁

- 检查时主线 `7cdf04b` 的 CI 验证与镜像已通过，但 `auto-deploy / deploy` 尚在运行；外网 `/global/health/ready` 仍报告旧版本 `6ea9dd9`。不得重叠触发生产发布。
- 主线已有 `20261001190000_say_ring_legal_product` 两列默认值迁移。自动发布不会代执行待处理 schema；迁移须有生产备份、恢复演练与独立状态核验。
- 两份 Say Ring 法律文本仍需事实核对、法务审核与显式发布。没有已审专属协议时新密码入口返回 `legal_unavailable`，不得以通用协议代替。
