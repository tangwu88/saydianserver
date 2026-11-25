# 礼品兑换按编号批量开启与换绑

## 原因与范围

后台原有批量操作依赖当前页勾选，增加输入多个管理编号的批量开启、批量换绑入口。管理编号是列表 serialNo / CommerceGiftCard.number，不是8位卡号或校验码。每次去重后最多100个编号，支持换行、中英文逗号、空格、分号和顿号。

## 基线与工作区

- 已阅读 AGENTS.md、docs/handoff.md 和最近礼品兑换实施记录。
- 原目录 E:/saydian h5 分支 codex/local-sync-20261117，本地 SHA 8e395c6c9e1e85c2d3319bd2845d3b6642d4432b；存在用户未提交文件，全部保留，未合并或覆盖。
- 已执行 git status、git remote -v、git fetch origin --prune。远端 main 为 dccccf3f38e853878120e6bff978b3fe9f1713ca。
- Start-Change 要求干净 main，原工作区不满足；从上述远端基线创建独立目录 E:/saydian-gift-bulk-20261123，分支 codex/gift-bulk-numbers-20261123。

## 实现

- contracts 增加共用编号解析，限制合法正整数和输入大小，去重，不支持隐式范围展开。
- API 复用原 actions 路由、总管理员权限、行锁、事务及逐卡审计；numbers 与 ids/batchId 不混用，仅支持 ACTIVATE/BIND。
- 按编号请求跨分页/批次精确查找；缺失或非 DRAFT 状态在写入前整批拒绝并列出编号，不跳过。保留原 ids/batchId 兼容行为。
- UI 新增两入口和对话框，显示去重数量、原因、开启文件确认；换绑统一配置商品/规格/有效期。保留卡号和校验码，失败保留输入，成功显示实际数量并刷新。
- 无数据库迁移，不改变兑换开放开关，不访问或操作真实生产礼品卡。

## 验证

- `pnpm install --offline --frozen-lockfile` 恢复依赖，`pnpm --filter @saydian/app-api prisma:generate` 生成本地客户端。设置 `PNPM_CONFIG_PM_ON_FAIL=ignore` 兼容本机已有 pnpm 版本，未修改锁文件。
- `pnpm typecheck`：通过。
- `pnpm test`：最终通过。API 1657、后台342、contracts110 等所有默认测试通过；106项数据库测试按仓库开关跳过，本机未配置隔离 PostgreSQL，不能视为真实数据库联调完成。
- 首轮新 API 用例的 queryRaw 模拟误把 tagged template 当作 Sql 对象，8项失败；修正测试将模板转成 Prisma.sql 后，定向20项及重跑全量测试均通过。未因此更改生产逻辑。
- `pnpm build`：所有工作区通过；保留已有 Vite 大包体积提示。设置 npm_config_workspace_concurrency=1 尝试降低本机检查负载。
- `pnpm api:docs`：生成603条路由的字段契约；`pnpm api:docs:check`：通过。
- `pnpm tools:test`：部署脚本/工具59项、H5流程62项、H5契约38项全部通过。使用本机已存在的 Git Bash 和 `E:/saydian h5/artifacts/toolchain/jq.exe`，无部署动作。
- Edge/Playwright 本地页面模拟：粘贴去重开启、统一商品换绑、整批拒绝后保留输入、运营角色无批量入口，四个场景通过，页面异常0。全部 API 使用合成数据拦截，无真实账号或生产写入。首轮脚本因 Element Plus 隐藏原生 checkbox 无法直接 check 超时，改用可见标签点击后通过。
- 本地模拟证据（忽略、不提交）：`artifacts/gift-bulk/browser-result.json`、`activate-desktop.png`、`bind-desktop.png`。
- `git diff --check`：通过；再次核对原 E:/saydian h5 的未提交文件列表未变化。

## 交付状态与未验收项

功能在独立工作区完成，尚未提交、推送或发布线上。没有数据库迁移；未使用真实礼品卡验收。真实 PostgreSQL 并发联调及上线后人工验收尚未进行。需要发布时应先重新 fetch/reconcile，再按仓库发布检查核对 CI 与线上版本。

## 变更文件

- `packages/contracts/src/gift-card-numbers.ts`、测试和 `index.ts` 导出。
- `apps/api/src/gifts/gift.service.ts`、`gift-bulk-actions.test.ts`。
- `apps/admin-web/src/components/GiftBulkActionsDialog.vue`、`src/gift-bulk-actions.test.ts`、`src/views/CommerceGiftsView.vue`。
- `tools/gift-field-contracts.mjs`、`tools/api-notes.mjs`、生成的 `docs/api-catalog.json`、`docs/api-reference.md`、`packages/contracts/src/api-catalog.generated.ts` 及本日志。
