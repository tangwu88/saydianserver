# AI 问答与健康报告模型配置恢复

## 目标与边界

- 修复总后台健康报告长期停留在“AI 分析中”的问题，确认 AI 问答与健康报告共同读取“第三方服务 > AI 问答与报告”的配置。
- 修改前使用独立干净克隆 `F:\xcodeplace\国内电商\saydianserver-ai-report-fix-20260912`；`main` 与 `origin/main` 均为 `23b6c9fbafb88f76337014d64c1633813aafcac7`。
- 原工作区已有其他同事未提交修改且落后远端，本轮未合并、覆盖或暂存该工作区内容。
- 不记录或提交访问密钥、会员身份、报告编号、健康原始数据及完整报告正文；不重复创建报告，不直接修改报告或队列数据库记录。

## 排查与修复

- 生产 API、Worker、PostgreSQL 和 Redis 均处于健康运行状态；待处理报告已重试 4 次，服务商统一返回 HTTP 400，前一条历史任务也因相同原因达到死信状态。
- 代码核对确认：AI 问答和健康报告都读取键为 `ai` 的 `IntegrationConfig` 与加密 `IntegrationSecret`，并调用配置地址下的 Chat Completions 接口；问题不在调用入口分叉。
- 后台公开配置将服务商品牌“智谱”误填在模型字段。使用现有加密凭据只读查询服务商模型列表成功，再用不含会员或健康数据的合成请求验证 `glm-5.3-flash` 与报告所需 JSON 响应格式，HTTP 状态为 200。
- 通过后台正常配置流程仅将模型改为已验证的 `glm-5.3-flash`，保留原服务地址、密钥和启用状态。原排队任务随后自动重试并变为 `READY`，队列事件变为 `DELIVERED`；会员页显示“最近报告 · 已生成”，配置中心显示“AI 问答与报告 · 已通过真实调用”。
- 管理端将字段和说明明确为“模型 ID”，增加仅允许常见模型 ID 字符的前置校验，避免再次把中文品牌名当作模型 ID 保存。

## 修改文件

- `apps/admin-web/src/integration-settings.ts`：澄清模型 ID 文案并增加格式校验。
- `apps/admin-web/src/integration-settings.test.ts`：覆盖品牌名被拒绝、真实模型 ID 可保存。
- `docs/implementation-log/2026-09-12-ai-health-report-model-recovery.md`：记录复现、修复、验证和交接边界。

## 命令与验证记录

- `tools\Start-Change.ps1` 首次以相对仓库上下文调用时因脚本根路径未正确解析而停止；改为显式传入 `-RepositoryPath` 后通过，未产生源码修改。
- 首次 PostgreSQL 查询因 PowerShell、Shell 与 SQL 多层引号冲突而报语法错误；改用 Shell 单引号和 PostgreSQL dollar-quote 后只读查询成功。
- `git diff --check`：通过。
- 首次 `pnpm.cmd --dir apps/admin-web test -- integration-settings.test.ts --reporter=dot` 未被 Vitest 识别为单文件过滤，并因干净克隆尚未构建 `@saydian/app-contracts` 导致 6 个测试文件加载失败；这是执行顺序问题，不是断言失败。
- 首次通过嵌套 `powershell -File` 调用 `Publish-Change.ps1` 时，字符串数组被外层命令拆成位置参数，脚本在执行任何检查、暂存或提交前停止；改为由当前 PowerShell 直接传入字符串数组。
- 首轮正式发布检查中，接口目录与工具/H5 测试通过；`typecheck` 在 `commerce-domain` 读取未生成的 Prisma 客户端时缺少 `Prisma`、`RefundStatus` 等导出并停止。脚本未暂存或提交；随后按当前 schema 运行 `pnpm.cmd db:generate` 后复验。
- 第二轮发布检查全部通过，但独立克隆尚无仓库级 Git 作者信息，提交步骤被 Git 拒绝；只沿用当前仓库最近提交的作者身份写入本克隆本地配置，再核对显式暂存文件后提交，不改全局 Git 配置。
- `pnpm.cmd --filter @saydian/app-contracts build`：通过。
- `pnpm.cmd --dir apps/admin-web exec vitest run src/integration-settings.test.ts --reporter=dot`：1 个测试文件、25 项测试全部通过。
- `pnpm.cmd db:generate`：按当前 schema 成功生成 Prisma Client；`pnpm.cmd typecheck` 随后全工作区通过。
- `pnpm.cmd contracts:client:check`：76 个客户端接口消费者均有对应路由，无缺失路径。
- `node deploy/global/check.mjs`：184 项国际版部署结构检查通过；本机无 Docker Compose，容器配置与 Nginx 运行态继续由线上部署验收覆盖。
- 生产只读队列回查：本次任务 `READY`，事件 `DELIVERED`，无最新错误；历史死信记录保持原状，未擅自重跑。
- 后台页面回查：报告已生成且可预览；AI 集成状态已由真实 Worker 调用自动标记为已验证。

## 发布后复核

- 发布完成后核对自动部署任务成功，并确认 `https://app.saydian.cn/global/health` 返回的 revision 与本次提交一致。
- 在生产配置页确认“模型 ID”新提示已上线；不更改当前已验证配置，不再次发送会员健康数据。

- 2026-09-12T14:35:32.5424854Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T14:36:29.8484272Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T14:36:35.8802845Z：pnpm.cmd typecheck，退出码 2。

- 2026-09-12T14:37:57.9179129Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T14:38:34.5634260Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T14:39:03.9601926Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-12T14:39:43.9288964Z：pnpm.cmd test，退出码 0。

- 2026-09-12T14:40:18.9217952Z：pnpm.cmd build，退出码 0。
