# 2026-09-05 主系统、商城、支付与付费健康报告整合

## 本轮目标与边界

- 将原商城成熟业务迁入 `saydianapp-server`，让会员、商城、支付、通知、健康和接口说明由一个 API 与一个总后台管理。
- 建立详细健康报告的证据、权益、支付、生成、退款撤权和按需导出闭环，但不把健康异常提醒放入付费墙。
- 兼容 Flutter V1/V2、原 H5/小程序 `/api/saidian-mall/v1/*`，禁止双写订单、库存、支付和会员。
- 不搬移真实生产数据、不关闭维护只读、不切换 `app.saidian.cc`、不填写或伪造任何第三方凭据。
- 本轮数据库结构变化属于人工发布门槛；源码自动 CI 不代表允许自动迁移生产库。

## 修改前安全更新

| 仓库 | 分支与状态 | 修改前 HEAD / origin/main | 结论 |
|---|---|---|---|
| `saydianapp-server` | `main`，干净 | `a484adf6a63b9ba6fbc775f1de172823a5c9bdb9` | `tools/Start-Change.ps1` 安全检查通过 |
| 原商城 `赛电商城` | `main`，仅既有未跟踪 `artifacts/` | `09963c49f255c146ffab2bfd17b8d0961c655ebd` | 只读作为迁入基线；`artifacts/` 未读取、未修改、未提交 |
| Flutter App | `main`，干净 | `b671e7f170d2f1aa97642342db3f3b7eaf6224b2` | 本轮未改 App；报告/权益/StoreKit 页面列为后续明确缺口 |

执行过的更新检查：`git status --short --branch`、`git fetch origin --prune`、`git rev-list --left-right --count HEAD...origin/main`、`git rev-parse HEAD origin/main`、`pwsh -NoProfile -File tools/Start-Change.ps1`。未使用 reset、force push、`git add .` 或覆盖本地文件。

## 已实施修改

### 1. 主库商城与兼容前端

- 在 Prisma 中加入分类、商品、SKU、购物车、地址、订单/明细、物流、售后、退款、评价、收藏、优惠券、员工、奖金、轮播、业务配置和 ERP 作业模型。
- `CommerceStoreService` 直接读写主库；创建订单重新核算可售状态、价格、优惠、运费和库存，使用幂等键阻止网络重试产生双订单。
- 后台只允许修改展示资料、上下架和营销字段；ERP 商品编号、内部名、SKU、库存不可人工覆盖。评价只允许发布/隐藏，不能改写真实评分和内容。
- 从原商城提交 `09963c4` 迁入 H5/小程序同源前端至 `apps/shop`，保留 `/api/saidian-mall/v1/*` 合约；Admin 镜像同时发布 `/admin/` 和 `/saidian-mall/`。
- 新增原商城库 `inspect/migrate/verify` 入口和永久 ID 映射；没有真实只读账号时不运行导入、不生成虚假迁移数字。

### 2. 企业微信员工推广与赠券

- 新增允许回调域名校验、企业微信 OAuth、独立员工 JWT、本人业绩/推广素材/优惠券接口。
- 历史充值、积分、等级、渠道报单和提现只读展示，不恢复提现交易。
- 员工赠券使用高熵一次性令牌，数据库仅保存 SHA-256；原始链接只在创建时返回一次，并用事务保证并发领取最多成功一次。

### 3. 统一支付与退款

- 新增 `PaymentIntent`、`PaymentRefund`、`ProviderEvent`，统一承载商城订单、单次健康报告和健康会员。
- 服务端决定金额、币种、商品和权益；微信、支付宝和 StoreKit 仅在配置完整时生成真实调用参数。
- 微信/支付宝回调验签、金额核对、事件去重、退款状态和售后联动集中处理。
- 微信回调校验 5 分钟时间窗、平台证书序列号、签名和 APIv3 密文，降低过期通知重放及证书轮换误配风险。
- 使用 Apple 官方 App Store Server Library 校验根证书链、环境、Bundle ID、商品、价格、币种、数量和 `appAccountToken`；该 token 固定使用服务端 PaymentIntent UUID。
- StoreKit 通知按 notification UUID 去重；撤销/退款会撤销对应报告或会员剩余权益，重复通知不重复发放或扣减。

### 4. 健康档案与付费详细报告

- 新增健康档案、AI 单独同意、报告方案、报告、30 天会员、次数账本和证据摘要模型。
- 默认分析最近 30 天，至少需要 3 个不同自然日的有效数据；未知、`INVALID`、零占位和无来源异常值不进入证据。数据不足不创建支付单。
- 先由确定性规则生成指标趋势、异常和 record ID 证据，再把去标识化汇总交给 AI；不发送姓名、手机号、设备地址、record ID 或原始 ECG。AI 每条趋势必须返回已有 `metric`，服务端校验后附上该指标真实 `evidenceRecordIds`，引用不存在的指标会拒绝整份结果。
- 单次购买 1 份；健康会员规则由版本化方案配置，默认可配置为 30 天 4 份，不自动续费、不结转。生成失败返还次数，已生成报告可重复查看。
- 报告 Worker 串行处理并保存模板/模型/输入摘要；PDF 使用中文字体在内存按需生成、直接下载，不长期重复保存。
- 报告明确标识“AI 生成的健康管理参考”，不能输出诊断、处方或治疗建议；异常预警继续免费。

### 5. 通知、ERP 与 Worker

- 新增通知活动、目标人群、计划时间、投递明细、失败重试和 Outbox 分发。
- 推送载荷只包含事件 ID、类型和跳转，不包含手机号、Token 或健康值。
- Worker 可独立处理健康报告、通知活动、JPush 和聚水潭任务；供应商未配置时不会阻止其他 Worker 启动，也不会伪报外部投递成功。
- 聚水潭继续作为 SKU、库存和履约权威来源；真实订单/退款/售后写权限尚未用供应商回执验证。

### 6. 总后台、接口中心与密钥

- 总后台增加商城概览、商品、分类/轮播/配置、订单、物流、售后、评价、优惠券、推广/奖金、ERP 任务、支付、健康报告、价格方案、通知活动、接口中心和集成中心。
- 后台角色扩展为超级管理员、App 运营、商城运营、财务、内容编辑、客服、健康审计、集成管理员、接口文档编辑和只读人员；高风险接口由服务端守卫限制。
- 接口中心从代码生成方法、路径、鉴权、参数和签名；业务说明支持草稿、审核、发布、回滚、过期检测及脱敏 Markdown/OpenAPI 导出。
- 新增 `IntegrationSecret`：后台只能写入/清除并查看 `hasSecret`；使用主机外置 `INTEGRATION_MASTER_KEY` 的 AES-256-GCM 加密，AAD 绑定集成 key，任何读取接口不回显明文。
- API 与 Worker 的文件、短信、AI、微信/支付宝、StoreKit、企业微信、JPush 和聚水潭适配统一读取加密配置；环境变量仅保留兼容回退。
- 保存/修改配置会清空旧检测时间；选择启用后仍显示“尚未通过真实调用”，只有供应商或对象存储成功响应才标记已验证。seed 只初始化缺失项，不再在每次容器重启时覆盖后台保存的状态和公开配置。

### 7. 部署与文档

- Docker Admin 镜像同时构建总后台与商城 H5；Nginx/Caddy 增加 `/saidian-mall/` 路由。
- 生产示例环境加入健康报告销售开关、Apple 根证书/Bundle ID、企业微信、聚水潭、推送、AI、中文 PDF 字体和集成主密钥配置，但没有填写真实值。
- 生产预检查强制要求独立员工 Token 密钥和 32 字节集成主密钥；本地 Worker 也接收同一集成主密钥以解密后台配置。
- CI 增加生产 Compose 配置验证并继续执行 Prisma、类型、测试、构建、迁移、脱敏种子、HTTP 和三镜像检查。
- 路由目录由 156 条扩展为 269 条，全部有业务说明；README、架构、调用指南、缺陷清单、测试矩阵、部署和交接文档同步更新。

## 命令、测试和结果

| 命令 | 结果 | 证明范围 |
|---|---|---|
| `pnpm.cmd install` / 锁文件更新 | 通过 | 安装 Apple 官方库、PDFKit、二维码及商城工作区依赖 |
| `pnpm.cmd db:generate` | 通过 | Prisma Client 与新 schema 一致 |
| `pnpm --filter @saydian/app-api exec prisma format` | 通过 | Prisma schema 格式一致 |
| 设置仅用于解析的本地 `DATABASE_URL` 后执行 `prisma validate` | 通过 | Prisma 数据模型关系、类型和 provider 配置有效；未连接数据库 |
| `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` 与已提交迁移做内存对象名对照 | 76/76 表、30/30 枚举、153/153 索引、82/82 外键约束一致 | 检查手写增量迁移没有漏掉当前 schema 对象；不证明 SQL 已在 PostgreSQL 执行 |
| `pnpm.cmd api:docs` | 通过，生成 269 条且说明齐全 | 控制器路由目录 |
| `pnpm.cmd test` | 最新全仓复跑通过，77 项 | API 62、Worker 9、Contracts 4、Migrator 1、Admin 1 |
| `pnpm.cmd --filter @saydian/app-worker test` | 通过，9 项 | 新增伪造报告指标拒绝测试 |
| `pnpm.cmd --filter @saydian/app-api test` | 通过，62 项 | 新增微信回调时间窗/证书序列号测试 |
| `pnpm.cmd typecheck` | 通过 | API、Worker、Migrator、Contracts、Admin、Shop |
| `pnpm.cmd build` | 通过 | API/Worker/迁移器编译，总后台 Vite 和商城 H5 构建 |
| `pnpm.cmd --filter @saydian/app-shop build:mp-weixin` | 通过 | 微信小程序目标可生成；尚未填生产 AppID 或在开发者工具/真机验收 |
| `curl.exe https://app.saydian.cn/health/live` | 返回当前线上 `status=ok` | 仅证明上一版生产进程存活 |
| `curl.exe https://app.saydian.cn/health/ready` | 返回当前线上 `database=ok` | 仅证明上一版数据库就绪；响应仍无 revision |
| `gh variable list` / `gh secret list` | 当前均无条目 | 自动部署仍未接通 |
| `docker version` | 命令不存在 | 本机不能执行容器/本地 PostgreSQL 验收 |

构建警告：uni-app 使用的 Sass legacy JS API 将来会弃用；总后台主 JS 约 1.1MB，Vite 建议进一步按路由拆包。两者均未导致本轮构建失败，作为后续性能维护项保留。

## 失败、原因和修复

1. 首次 Prisma migration diff 使用了当前版本不接受的旧 `--to-schema` 参数，命令在生成 SQL 前退出；改为当前 CLI 支持的 datamodel 参数。
2. 从 migrations 目录生成 diff 时发现仓库缺少 `migration_lock.toml`，命令停止且未改数据库；补入 PostgreSQL provider lock 文件。
3. 再次自动 diff 要求可用的 shadow database，本机没有 Docker/PostgreSQL，命令停止且未产生数据库写入。改为根据已格式化 schema 编写两份只新增表/列/索引/外键的 SQL，人工检查无 `DROP`、`TRUNCATE` 或数据删除；最终由 CI PostgreSQL 16 空库执行验证。
4. 严格 TypeScript 检查发现商城 `api.ts` 的条件字段和售后页 picker 值类型过宽；收窄可选字段与安全转换后，商城 typecheck/H5 build 通过。
5. StoreKit 初版将用户 UUID 作为 `appAccountToken`，无法把交易唯一绑定到支付单；改为 PaymentIntent UUID，并增加交易商品/金额/币种/数量/账号校验测试。
6. Push 未配置时原设计会阻止整个 Worker 启动；改为 Disabled provider，让报告、注销和 ERP 等非推送任务继续运行，真实有安装实例的投递仍明确失败并重试。
7. 直接执行 `prisma validate` 因当前终端未设置 `DATABASE_URL` 返回 P1012；设置只用于 schema 解析的本地占位连接串后重跑通过，命令不会连接或修改数据库。
8. 首次内存迁移对象对照从 `apps/api` 工作目录仍使用仓库根相对路径，读取不到 migrations，得到无效的 `ACTUAL_TABLES=0`；修正为 `prisma/migrations` 后重跑，表、枚举、索引和外键名称全部对齐。
9. 提交前敏感配置扫描首次把同时包含单引号、双引号和量词逗号的正则直接放入 PowerShell 命令，触发解析错误，扫描没有执行且没有改文件；改为分段检索配置变量和值，再核对 `.env.example`、生产示例和本轮最大文件，未发现真实凭据或构建产物。

## 数据库迁移复核

- `20260905150000_integrated_commerce_health_billing`：新增商城、支付、健康报告、通知活动、接口文档和角色相关结构。
- `20260905170000_employee_promotion_coupons`：新增员工赠券和加密集成密钥；`sourceGiftId` 在前一份尚未上线的同轮迁移中创建，随后收紧为 UUID。
- 静态检索没有 `DROP`、`TRUNCATE`、`DELETE FROM` 或 `ALTER TABLE ... DROP`。
- 这只证明 SQL 设计为增量，不证明生产大表锁、执行时长、磁盘峰值或可回滚性；必须先在生产备份副本演练并人工批准。

## 明确未完成 / 未验收

- 本轮尚未提交时，CI PostgreSQL 迁移/种子、HTTP 合约和镜像构建没有本轮 run 证据；提交后必须记录 run URL 与提交 SHA。
- 旧 App/商城真实会员、商品、SKU、订单、支付、退款、附件、奖金和健康数据尚未迁移或逐表对账。
- 微信、支付宝、StoreKit、企业微信、聚水潭、AI、极光/APNs、短信和异地备份没有本轮真实凭据或供应商回执，保持“未配置/未验收”。
- Flutter 尚未接入健康档案、报告预览、付费解锁、会员权益、购买恢复和报告历史，也未做 Android/iOS 真实购买测试。
- 生产 `app.saydian.cn` 仍运行上一版且保持维护只读；`app.saidian.cc` 未切换，原商城未转只读归档。
- 本机无 Docker，未执行本地 PostgreSQL、容器、4GB 压力、备份恢复或旧库迁移演练。

## 下一步顺序

1. 显式提交本轮源码并等待 CI 的 PostgreSQL、HTTP 和镜像结果；CI 失败先修复，不绕开检查。
2. 在生产备份副本执行两项 migration，记录时长、锁、磁盘、内存和恢复点；审批后再发布当前 SHA，保持维护只读。
3. 获取最小权限旧库账号，按 dry-run → 冲突复核 → 全量 → 维护窗口增量 → 数量/金额/SHA 校验迁移。
4. 逐项配置第三方并用沙箱/真实回执验收；未通过项继续显示未配置。
5. 在 Flutter 仓库修改前重新安全更新，接入报告/权益/StoreKit 页面，完成 Android/iOS 真机与退款/恢复测试。
6. 全链路完成后再单独审批关闭维护只读、切换 `app.saidian.cc` 和将原商城转为 14 天只读回滚源。

- 2026-09-05T08:35:22.4045402Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-05T08:35:32.7740907Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-05T08:35:46.0556503Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-05T08:35:55.2860995Z：pnpm.cmd test，退出码 0。

- 2026-09-05T08:36:16.1849138Z：pnpm.cmd build，退出码 0。
