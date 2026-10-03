# Say Ring AI 睡眠报告

## 基线与范围

- 从 fetch 后的 `origin/main` `969a264639345e03ef3678d868c75cea289983bf` 创建独立工作区，原服务端工作区及其他分支不修改。
- 现场国内/global readiness 均为 `e9670670f752485ee187dd6da0946e948cb5f92c`；当前远端 main 不等于已部署版本。
- 新增睡眠报告类型，复用 HealthReport JSON、既有第三方 AI 配置与异步任务；无需数据库 schema 迁移，不改变普通健康报告权益。
- 仅处理已登录账号主动上传并授权的睡眠汇总和会话起止；第三方 AI 输入排除账号、联系方式、设备地址和原始分段。无有效睡眠/未配置/未授权时明确拒绝，不伪造评分。
- 后台健康报告提供睡眠类型筛选和报告阅读，仍受既有健康角色、敏感读取审计约束。

## 验证记录

- 实施、接口目录、类型、全量测试、构建、部署和真实 AI 验收分别记录；未执行的不标记通过。

## 实施结果

- 增加 aggregate-only 严格契约、3 个带账号鉴权的睡眠接口。复用报告 JSON 和 Outbox，内容哈希相同的快照复用报告，更新后生成独立报告；不收取健康报告额度。AI 输入仅包含秒单位汇总、时区和会话起止，排除硬件标识与原始分段。
- Worker 在传输前和提交结果前复核当前账号状态、已发布健康 AI 授权和睡眠独立开关。AI 必须返回有依据的独立参考分或 null；错误、非法分数和伪造指标拒绝发布。
- 后台健康报告增加全部/健康/睡眠类型筛选、评分及详细报告阅读；人工编辑保留 AI 原始评分，不允许编辑变成伪造评分。独立 sleepAiEnabled 默认关闭，不改变其他 AI 隐藏状态。

## 逐次检查与失败保留

- 新工作区 `pnpm install --frozen-lockfile --network-concurrency=4`、`pnpm db:generate` 成功，锁文件和 schema 无变化。
- 定向验证：contracts 29、API 67、Worker 39 项通过，均为合成输入与供应商 mock，不代表真实第三方调用。
- 首轮全量类型检查通过；首轮全量单测因后台保存契约新增 sleepAiEnabled=false 与旧断言不符失败 2 项。更新断言并新增独立开关保存/类型验证；失败记录保留。
- 第二轮 `pnpm test` 通过：contracts 29、commerce 28、migrator 9、download 11、Worker 65、admin 166、API 896（4 个 PostgreSQL 真实事务测试未在本机执行）。`pnpm build` 成功；后台 bundle 大小警告保留，未把此警告当业务失败。
- `pnpm api:docs` 新目录 372 路由；增加已复核字段契约和合成示例。`pnpm api:docs:check` 通过。
- `pnpm tools:test` 通过：部署与工具测试、H5 流程 61、H5 契约 38；`actionlint -shellcheck=` 和 `git diff --check` 通过。
- 补充双方一致的 SHA-256 golden、Worker 传输内容及关闭/撤回授权竞态验证后，正在重跑最终类型/全量单测/构建。
- 生产后台目前显示登录页，当前没有已认证后台会话；不猜密码，不绕过鉴权，不伪报开启开关。默认关闭；真实 AI 生成、后台报告查看及实际生产版本在部署后另记。
- 最终串行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check` 均退出码 0：contracts 30、commerce 28、migrator 9、download 11、Worker 65、admin 167、API 896 通过（4 个本机 PostgreSQL 用例跳过）；shop 的 Node 全量用例也通过。部署/工具 36、H5 流程 61、契约 38 通过；Actions 语法检查与 diff 检查通过。
- 提交前 fetch 成功，origin/main 仍为基线 969a264，无覆盖其他分支。候选代码准备推送并交由现有 CI 校验；推送不等于上线，默认开关不会在代码部署中擅自启用。
