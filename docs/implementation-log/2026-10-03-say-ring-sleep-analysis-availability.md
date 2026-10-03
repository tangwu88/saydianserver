# Say Ring 睡眠 AI 不可用修复

## 根因、范围与预期

- 用户的 1025 真机页面提示“睡眠 AI 分析服务或分析说明暂不可用”。生产睡眠入口已开启，既有 AI 集成有真实调用记录；后台没有发布分析说明，缺说明时生成接口按设计拒绝上传。
- 从已部署的 `origin/main` `50dd2abbbcad82323b7d6fef7310a4aa33a26713` 创建独立分支；原服务端脏工作区不修改。客户端保留 1025 提交及远端新增文档，不覆盖改动。
- 本轮只修复 Say Ring：新增专属睡眠分析说明类型与 ConsentRecord 授权，不修改 Health App 的健康分析说明或 HealthProfile 授权。未授权、版本变化、撤回或关闭开关均继续拒绝第三方传输。
- Availability 分别报告开关、供应商、Worker、已发布说明状态；不以固定评分或隐藏错误冒充生成成功。准备与实际配置相符的操作说明，用户仍须在 App 中自行确认每次上传。

## 验证记录

- 实施、定向与全量检查、构建、线上 revision、已发布说明回读和真实生成分开记录。没有真实报告回读前不宣布 AI 生成故障完全修复。

## 实施与逐次验证

- 新增 `say_ring_sleep_analysis` 专属类型、独立 ConsentRecord 授权接口与 Worker 三次复核；普通健康报告保持原授权逻辑。生成和撤回使用相同会员行锁；重复同意更新 acceptedAt，撤回后重新同意不能让旧任务发布。
- AI 只可发送到说明所列的智谱 BigModel HTTPS API，改变供应商会失败关闭，而不是在旧说明下向其他 AI 发送数据。当前主体名称及官方政策经 `https://docs.bigmodel.cn/cn/terms/privacy-policy` 核对；不推断零留存或不用于训练。
- 新增中英文操作说明，列明实际上传内容、可选性质、第三方、云端读取、风险、非诊疗用途、撤回/删除区别及已确认联系方式。只对新睡眠说明用“内容已核对”标记，不把内容核对冒称外部法律审查；已有用户协议/隐私政策的法律审核门禁保持不动。
- 首次 patch 由于重复文件操作及上下文不匹配未写入；改用明确完整上下文后成功。接口目录第一次生成因缺新方法说明失败，补上 notes 后 373 路由生成/检查通过。
- 定向 API 22、Worker 38、后台说明编辑器 6 项通过，合成输入且未真实调用供应商。首次 typecheck 通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check` 和 `pnpm tools:test` 串行完成，退出码均为 0。contracts 31、commerce 28、migrator 9、downloads 11、Worker 71、后台 168、API 909 项通过，4 个本机未配置 PostgreSQL 用例跳过；工具/H5 流程/H5 契约通过。
- 随后补充独立的本机数据库授权并发/隔离测试及 CI 执行入口，需重跑最终检查。本机未提供 loopback 数据库时不计实际事务通过，CI 真实数据库单列证据。
- 发布脚本仅允许主 checkout 的 main。为保留原脏主工作树，本轮用独立分支显式暂存与 PR 集成，同等执行所有串行检查，不覆盖主工作树或强推。
- 最终补充数据库测试后的 `pnpm typecheck`、`pnpm test`、`pnpm build`、373 路由文档检查、Actions 语法及 `git diff --check` 全部退出码 0；API 909 通过、7 个实际 PostgreSQL 用例在本机跳过。日志为 `/private/tmp/saydian-sleep-consent-*-final-v2.log`；后台既有大 bundle 警告保留。工具/H5 全量检查在本轮已完成，工具源码未改。
- 提交前再次 fetch；独立工作树 HEAD 与 origin/main 均为 `50dd2abbbcad82323b7d6fef7310a4aa33a26713`，未发生远端业务变化。说明文件只作为候选内容随源码保存，不由部署脚本自动激活，也不代替用户单独同意。
- 首轮 PR #17 的 `8fc5f41da7a5a9da38d8eb344735e9eb2f9a54a4` 在 Actions `37101815467` 完成全量 CI（7 分 35 秒）；真实 PostgreSQL 测试为睡眠授权 3 项加商城并发 4 项，7/7 通过。镜像、HTTP 授权、备份恢复及离线镜像传输演练通过；PR 不自动部署，没有把 PR CI 通过写成上线。
- 合入前再次 fetch 发现主线推进到 `c93eeb27a64f1f9c70ceba8aebcc1d564e2e43e5`（同事的国际公开页面 PR #16）。暂停合入，审阅 14 个差异文件，全部属于公开页面/网关及记录，与本轮睡眠源码无重叠。干净独立分支用普通 `git merge --no-edit origin/main` 安全合并，未冲突、未覆盖或强推；继续串行重跑合并后的工具、文档、静态、全量测试、构建及 Actions 检查，再推进发布。
- 合并基线 `1bd9ddf7b5bf4f0b62eef64d3a7dd515dcb18465` 的 `pnpm tools:test`、`pnpm api:docs:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`actionlint`、`git diff --check` 串行全部通过；API 909 通过、7 个数据库用例仍按本机环境跳过，其他套件计数不变。日志为 `/private/tmp/saydian-sleep-consent-integrated-*.log`；随后的真实数据库和镜像验收继续以更新后的 CI 结果为准。
- 额外 `node deploy/global/check.mjs` 12/12 通过，包含新公开页面国际限定路由与幂等网关契约。发布前再 fetch，主线仍为 `c93eeb27a64f1f9c70ceba8aebcc1d564e2e43e5`，其同事改动保留。
