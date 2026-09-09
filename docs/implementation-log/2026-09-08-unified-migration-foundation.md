# 2026-09-08 统一后台迁移与接管基础实施记录

## 范围与成功标准

承接用户确认的旧登录态尽量无感、商城和 App 来源并存、旧交易一次性接管方案。本轮实现可运行的迁移/冻结/所有权门禁和测试；不将源码或合成测试等同于真实旧源、供应商和正式切换验收。主任务已通过 `tools/Start-Change.ps1 -Resume` 核对 main/origin 为 `c5218875b614d9278b6849c52fbae3f24aad38d5`，保留原有 dirty 修改。本子任务单一负责 schema/migrations，未提交或操作生产。

## 已实施

- Prisma：按 sourceSystem/entityType/legacyId 隔离来源；来源行摘要、断点；只存 HMAC 的可撤销旧会话凭据；交易来源/所有权及版本；订单积分面值快照和账本；明细售后关系；提现/收款身份及钱包账本关联；原商户/App 标识；佣金结算规则快照；多角色数组和提现规则。已应用的 foundation 不再改 checksum，后续增量为独立 migrations。
- 旧 App 迁移：显式状态/积分单位；仅完整受支持 bcrypt 可沿用；用户或健康实体、映射和断点同事务。冻结目标上全扫描同步更新，源删除/冲突阻断验收；仅同一不可变快照可断点续跑。
- 旧登录态桥：默认关闭、独立过渡期限、已复核来源表、HMAC 摘要、真实过期/吊销/用户状态检查。凭据重验并加锁后才绑定会话；已注销或并发吊销不可复活。来源会话删除/换 Token 经完整重导入使旧凭据吊销。不接受未知旧 JWT 签名或客户端自报身份。
- 原商城迁移：只读可重复读快照；按表目标事务、原实体更新同步和来源逐行摘要核验；原整数分金额/日期/状态严格校验。订单、支付、退款、售后、提现导入后归 `LEGACY_SYSTEM` 锁定，新 Worker 不得触发。任意五类交易已接管后禁止重迁覆盖。保留原转账号、提现编号、收款快照、钱包/佣金状态及原财务存档；未知金额不能当零。源最小/每日提现限额可空保留，当前强制人工审核。
- 维护分类：一般业务写入暂停；明确的已验签回调入口仍可接收，根任务 Billing 存入 Inbox 后按冻结标记延后处理。Worker 在 claim/recovery 前及事件边界检查冻结。旧 GET 标记通知已读属于写操作，冻结时被阻止。实际在途请求排空仍需部署侧证明。
- 接管 CLI：九项同一快照的真实审核证据文件及 SHA-256、COMPLETED/零冲突、完整订单项金额、原支付商户/App/流水/退款/提现证据、唯一旧所有权；目标状态摘要覆盖交易、明细/物流、钱包/佣金和收款身份。Serializable 事务原子转移五类交易所有权；显式允许的未提交 ERP 单才按统一幂等键入队。30 分钟窗口开始及事务提交前均检查，超时回滚；不打开业务开关、不调用支付/打款接口。
- `docs/unification/migration-runbook.md`：真实 CLI 参数、冻结配置、备份与恢复演练要求、旧会话映射、回调原入口和商户所有权、30 分钟时间表、接管与新写后回滚边界。

## 命令与验证记录

| 命令/检查 | 结果与修正 |
| --- | --- |
| 只读检查原商城 `apps/api/prisma/schema.prisma`、佣金/提现来源字段 | 核实原 providerBillId、withdrawalNo、authorization 字段及 signed ledger 规则；未访问生产数据库或读取密钥 |
| `pnpm --filter @saydian/app-api exec prisma validate` | 每次 schema 批次通过，最后提现规则批次通过 |
| 协调 `prisma generate` | 首次本地 API 占用 query engine DLL 导致 EPERM；主任务核对 8080 进程并暂停后成功；最后批次由主任务统一停服/生成/部署，本子任务未抢占生成 |
| foundation 本地 deploy | 主任务先核对回环 PostgreSQL、制作备份，再应用；本子任务未自行 deploy。后续 admin_multiple_roles/withdrawal_policy_snapshot 均独立 migration，应用结果见根实施日志 |
| `pnpm --filter @saydian/app-migrator typecheck` | 最终通过 |
| `pnpm --filter @saydian/app-migrator test` | 最终 9 例通过：配置、密码边界、显式积分单位、严格原商城整数分、行摘要、冲突不计成功、支付原商户门禁、30 分钟门禁 |
| API `vitest run src/common/legacy-session-bridge.test.ts src/common/maintenance.middleware.test.ts` | 18 例通过：9 例会话桥（含并发吊销）、9 例维护分类 |
| Worker `vitest run src/cutover-pause.test.ts` / worker typecheck | 1 例冻结前不 claim 通过，类型检查通过 |
| contracts `vitest run src/cutover.test.ts` | 2 例冻结共享规则通过 |
| API 早期 typecheck | 初始相关代码通过；并行后出现根数据库测试 userId 类型及多角色共享导出尚未 build，已分别通知 owner；未擅改对方代码。最终全套结果由根任务统一复核 |
| `git diff --check` | 最终代码批次通过；未清理其他任务文件 |

## 真实未验收与门禁

- 尚未取得旧 App 生产表结构、权威会话/注销规则、密码算法、真实附件清单；未运行生产全量、增量、删除恢复或真实身份合并。仅改域名是否足够需客户端真机完整流程证明。
- 商城仍按整表读取/120 秒目标事务，不是 CDC 或无限规模分块导入；正式全量应提前演练。原员工发券/赠券等尚为存档，非空表阻断完成；其他旧 App 复杂健康/协议/媒体等仍需真实源专用适配。
- 来源行摘要与映射计数不是完整目标语义验收；财务余额、跨表关系、库存、历史媒体、所有旧任务/回调的独立对账证明仍必需。证据文件完整性检查不能替代人工/供应商验证，禁止伪造 PASS。
- 当前真实商户和 App 所有权、旧回调 URL 转发/验签保真、未完成 ERP/退款/转账出站状态未核验；缺原商户或流水门禁拒绝接管。没有重复启动旧引擎补尾的替代路径。
- 不含未知旧库通用反向写入引擎。新写后直接恢复旧库或只切 DNS 会丢新状态，必须有逐业务反向转换/去重演练并禁止重复财务副作用；缺真实 reverse_replay 证据阻断激活。本轮未实施生产接管、真打款、DNS 变更或真实 30 分钟演练。
