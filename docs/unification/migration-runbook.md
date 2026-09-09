# 统一后台迁移与一次性接管操作手册

本手册配套当前源码中的迁移器、会话桥、回调 Inbox 和出站门禁。旧登录态尽量延续；新旧商品来源并存；旧订单、售后、退款、提现以一次性所有权切换方式接管。本轮没有迁移生产数据、验证真实供应商回执或切换域名。

## 1. 先明确完成标准

- `LegacyIdMap` 按来源系统、实体类型、原 ID 定位。旧 App 使用 `legacy_app`，独立商城使用 `legacy_mall`，不能用同一个旧数字跨来源猜测用户或订单。
- App 通用迁移支持已复核字段的会员和标准健康记录；源状态必填，未知密码算法、健康多样本/ECG 等无法映射内容进入冲突。源更新使用完整扫描与行摘要比较同步，不是 CDC。
- 通用迁移每行的实体、映射和断点在同一目标事务中；仅针对同一个不可变 `sourceSnapshotId` 允许断点续跑。来源发生更新必须创建新迁移轮次，从头扫描。
- 商城迁移按业务表事务更新，保存表级进度、来源行摘要，失败表回滚；重跑重新扫描来源快照。当前仍有整表读取和 120 秒单表事务上限，大表必须先演练、测量或再改为分块，不能直接许诺 30 分钟内完成首次全量。
- 核验冲突不计为成功；映射遗漏、删除/未见记录、来源更新、金额不一致阻断通过。发现源删除时进入人工复核，当前不自动物理删除目标健康/资金记录。
- 原提现 `withdrawalNo`、`providerBillId`、收款身份快照和供应商原回执保留；在途/成功提现缺原转账号或身份将阻断导入。不从原 `authorizedAt` 推断第三方已经重新核验。提现开关、最小/每日额度按源值导入，未知额度仍为 null；原计划另存档，当前强制人工审核，不自动付款。
- 原员工发券/赠券等仅存档、尚未完整操作迁移的非空来源表会出现在 `unverifiedDomains`，迁移状态不会误标完成。附件盘点、对象复制和反向回放仍需真实演练材料，程序不会生成虚假通过报告。

## 2. 环境、备份与只读盘点

在隔离预发布库先执行新 migrations，禁止在首次生产演练前直接改生产 schema。使用专用旧 MySQL/PostgreSQL 最小权限只读账号；源连接还会启动 REPEATABLE READ 只读事务。不要使用历史 root 凭据，也不要在命令行、日志或 Git 中写入数据库 URL、Token、密钥或真实健康内容。

由受控环境注入 `DATABASE_URL`（目标）、`LEGACY_DATABASE_URL`（旧 App）、`MALL_DATABASE_URL`（原商城）。先现场核对目标主机、库名和来源，不把示例配置当成已核验真实映射。为每个命令设置不同的 `MIGRATION_REPORT_PATH`，报告使用排他创建，不会覆盖旧报告。

```powershell
pnpm --filter @saydian/app-api exec prisma migrate status
pnpm --filter @saydian/app-migrator exec tsx src/main.ts inspect
pnpm --filter @saydian/app-migrator exec tsx src/main.ts mall-inspect
```

先用已配置的 PostgreSQL service 文件建立加密保存的自定义格式备份，再在另一隔离数据库完整恢复；备份能生成不等于恢复成功。命令中的 service 名和路径须替换为已复核目标：

```powershell
pg_dump --dbname=service=saydian_target --format=custom --no-owner --no-privileges --file=approved-backup.dump
pg_restore --list approved-backup.dump
pg_restore --dbname=service=saydian_restore_drill --no-owner --no-privileges approved-backup.dump
```

恢复演练库必须是明确命名的新空库，不能指向运行库；同时记录对象文件清单、字节数与 SHA-256。数据库、附件、回调原始回执、任务队列和当前镜像/配置都要有可找回的证据。

开发环境另有 `tools/test-local-backup-restore.mjs`：显式设置 `RUN_LOCAL_RESTORE_TEST=1`、可信 `PG_BIN_DIR`，运行 `pnpm test:restore:local <备份绝对路径>`。工具只允许回环地址，创建随机临时库、执行恢复并检查表/约束后删除该临时库，不修改运行库或原备份。它不能用于生产，也不代替真实业务数据、附件和逆向回放的核验。

## 3. 全量、更新扫描与旧会话

将 `apps/migrator/migration-map.example.json` 复制到受控路径，按真实结构替换所有示例值后设置 `MIGRATION_MAP_PATH`。`member.status` 和 `activeStatusValue` 必须明确，不知道状态含义时不能把会员激活。积分面值只有在确认真实来源字段与单位后才设置 `pointBalance` 和 `pointBalanceUnit=cents|yuan`；未知余额不创建可消费账户。

目标业务写入、Worker 出站已经暂停并核实后，才在迁移进程设 `MIGRATION_TARGET_WRITES_FROZEN=true`。商城还要求 `MIGRATION_SOURCE_SNAPSHOT_ID`，该值指已归档数据快照，不是本仓库 Git SHA。所有来源变更都要在冻结目标上重扫；已接管 NEW_SYSTEM 订单、支付、退款、售后或提现后商城迁移会拒绝覆盖。

```powershell
pnpm --filter @saydian/app-migrator exec tsx src/main.ts migrate
pnpm --filter @saydian/app-migrator exec tsx src/main.ts verify <本轮runId>
pnpm --filter @saydian/app-migrator exec tsx src/main.ts migrate <同一不可变快照的失败runId>
pnpm --filter @saydian/app-migrator exec tsx src/main.ts mall-migrate
pnpm --filter @saydian/app-migrator exec tsx src/main.ts mall-verify <商城runId>
```

会员支持完整 bcrypt 2a/2b/2y（cost 4–16），其他摘要不会猜算法。旧会话需要单独复核其真实权威表、注销/过期语义；可在映射中增加 `sessions`：`table/id/memberId/token/expiresAt/expiryFormat(iso|unix_seconds)/revokedAt?/verificationEvidence`。复核完成才设置 `MIGRATION_ALLOW_VERIFIED_SESSION_IMPORT=true` 和主机密钥 `LEGACY_SESSION_HASH_KEY`（至少 32 字符）。导入只保存 HMAC 摘要；旧会话被删除、替换或吊销后再次完整导入会吊销对应桥接凭据。

运行 API 会话桥默认关闭。启用必须同时设置 `LEGACY_SESSION_BRIDGE_ENABLED=true`、`LEGACY_SESSION_BRIDGE_DEADLINE`（明确 ISO 到期时间）和同一摘要密钥。只有已验证导入、未过期/吊销、用户仍有效的旧会话才能进入 V1；不接受未知 JWT 算法、无证据 Token 或 V2 上的旧 Token。桥接会话沿用原到期时间与截止时间中的较早值，退出后不会复活。验收要包含切换前已登录 App、刷新/退出/封禁、关爱旧 ID、文章和订单缓存 ID。

## 4. 回调入口与 30 分钟切换窗口

| 控制项 | 行为 |
| --- | --- |
| `MAINTENANCE_READ_ONLY=true` 或 `BUSINESS_WRITES_PAUSED=true` | 暂停用户业务写入及 Worker；兼容 GET 已读副作用也被限制 |
| `MAINTENANCE_ALLOW_MEMBER_AUTH=true` | 仅额外放行列明的会员登录/刷新/退出，用于只读验收；不开放注册或业务写入 |
| `CALLBACK_PROCESSING_PAUSED=true` | 已验签回调可靠入库后延后业务处理 |
| `WORKER_OUTBOUND_PAUSED=true` | 暂停 Worker 队列领取/对外动作，保留任务 |

环境变更必须应用到真实运行 API/Worker，并观察已领取任务排空；仅在迁移终端设置变量不等于运行服务已冻结。当前 Worker 在任务边界检查暂停，不能中途撤销已经发给供应商的请求。

旧支付/退款/提现回调 URL、域名、签名头和原始 Body 要逐项盘点。网关在切换时把旧入口转发到经过真实验签的对应新入口，保留原商户/App 配置和原渠道单号；不能把旧交易补成新商户交易。当前内置维护豁免仅包括新 billing 下微信支付/退款、支付宝通知和 Apple 通知四个验签处理器。尚无对应验签器的旧回调不能自行泛放行，必须先实现并取得回放证据。

迁入交易保持 `executionOwner=LEGACY_SYSTEM`，这表示未接管锁，不意味着继续通过旧引擎处理。准备一次性切换时，旧应用、旧 Worker、旧定时任务和旧回调业务处理都必须先停止，确保只有一个业务写入方。

- T+0：开始明确 30 分钟窗口，记录 `windowStartedAt`；旧写入方排空停写，新方业务和出站保持冻结，回调进入可靠 Inbox。
- T+0–10：只做已演练过的最终更新扫描与核验，不在窗口内首次迁移大表。检查删除/冲突、用户和健康分布、订单/支付/退款/提现/钱包及文件哈希。
- T+10–20：核对待处理回调、旧订单和售后状态、商户身份、已发 ERP 请求和在途转账。各证据必须指向相同快照。
- T+20–25：运行接管检查、锁定目标状态摘要，原子切换交易所有权；先用受控账号验证，再处理已验签 Inbox 和明确允许提交的任务。
- T+25–30：通过预定验收后单独开放业务写入。未达到门槛则结束窗口，保持冻结并按下节选择恢复路径。CLI 超过 30 分钟会拒绝激活，不能通过改时间掩盖超时。

## 5. 接管 CLI、证据与回滚边界

复制 `apps/migrator/takeover-manifest.example.json` 并设置 `MIGRATION_TAKEOVER_MANIFEST_PATH`。九项证据为客户端契约、旧端停写、回调路由、附件、身份、财务、库存、反向回放和待办队列。每项 JSON 文件须有 `status: "PASS"`、同一 `sourceSnapshotId` 和真实 `reviewedBy`；在 manifest 记录该文件 SHA-256。工具检查证据完整性和快照一致性，不代替审核员核对供应商或真实设备回执。不得为通过门禁人工填造 PASS。

```powershell
pnpm --filter @saydian/app-migrator takeover:check
```

检查同时核对 COMPLETED 迁移、零未解决冲突、所有交易锁定、订单项金额、原商户/App/支付号、在途退款号和提现身份。首次检查得到 `stateDigest` 后写入 manifest 的 `expectedStateDigest`；摘要涵盖交易、订单项/物流/售后项、钱包/佣金账本/计提、收款身份和提现规则，审阅后变化会使激活失败。`enqueueErpOrderIds` 只能列已证实从未提交且待履约的订单，默认空；已有 ERP 单号的订单会被拒绝入列。

只有审批已记录、实际服务仍冻结且窗口未超时，才在迁移进程设置 `MIGRATION_OWNERSHIP_TRANSFER_APPROVED=true`：

```powershell
pnpm --filter @saydian/app-migrator takeover:activate
```

激活在 Serializable 事务中同时转移订单、支付、退款、售后和提现所有权，并记录证据摘要；不会调用支付/提现供应商，不会打开业务开关。交易提交前再次检查 30 分钟门槛，超时整笔回滚。真实身份审核通过后，未吊销的原 AUTHORIZED/ACTIVE 收款授权转为 canonical ACTIVE 并记录证据，原始状态仍在存档。明确批准的 ERP 待办按统一幂等键入队。旧写入方不能在此之后重新运行。

回滚必须区分阶段：

- 新方尚未发生任何业务写入或对外副作用：可按已审阅旧端恢复步骤回切，先确认 Inbox 中没有漏掉的已验签事件和旧端已发未收请求。
- 新方已有写入：优先恢复兼容的上一应用镜像并继续使用新数据库。不得直接恢复切换前数据库、删除新订单或仅改 DNS 回旧库。
- 必须回旧数据库时：先冻结新方，保存切换后所有业务变更、原回调、支付/退款/转账回执与对象新增清单，经已演练的反向转换程序回放，再做金额/状态/关系对账。反向回放只恢复业务状态，不重发扣款、退款、打款、库存扣减或 ERP 下单。

当前仓库提供接管门禁，不提供未知旧库的通用反向写入引擎。没有真实反向回放演练，`reverse_replay` 证据必须保持未通过，接管不能激活。保留期按订单售后/退款/提现与客户端版本实际生命周期确定，不能把固定 14 天当作自动删除依据。
