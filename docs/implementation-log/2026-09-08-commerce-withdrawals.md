# 2026-09-08 员工提现业务实现

## 授权与原始依据

- 续同轮统一后台实施；根任务已运行 Start-Change -Resume，保留既有工作区，不修改旧商城、Flutter、生产数据或任何付款账户。
- 原商城只读源码 `赛电商城/apps/api/prisma/schema.prisma:675` 为 Withdrawal，`:699` 为 EmployeePayoutIdentity；真实旧字段为 `providerBillId/openIdSnapshot/authorizationIdSnapshot`，不存在猜测的 merchantBatchNo/detailNo。新迁入字段由 schema 单一写者统一适配。
- 原 `commission.service.ts:319` 起承接 enabled、withdrawalEnabled、minimumWithdrawCents、dailyWithdrawLimitCents、每员工仅一笔在途规则；`:391/459/499` 记录冻结/退回/成功的钱包变化。本轮时间边界明确采用北京时间自然日。
- **未获真实打款授权，也未实现或调用任何第三方转账请求。** 本模块只能申请冻结、人工审核及登记外部真实终态凭证。

## 独立文件与接线

- `apps/api/src/commerce/commerce-withdrawal.service.ts`：事务和状态机；controller/module 同名前缀独立文件。根任务负责 AppModule 接线。
- `apps/admin-web/src/views/CommerceWithdrawalsView.vue`：财务/超级管理员分页、审核/拒绝、人工付款凭证登记、核验原在途付款终态；根任务负责路由和菜单。
- `apps/shop/src/components/EmployeeWithdrawalPanel.vue`：员工真实钱包/配置/身份状态、金额校验、申请和历史记录；由根任务挂载员工页。
- schema/migration 由迁移任务统一编辑：CommerceWithdrawal、CommerceEmployeePayoutIdentity、Ledger 提现变化字段和 CommissionPlan 提现规则。不得擅自应用生产 migration。

## 成功标准与安全设计

1. 员工身份取认证 guard，而非请求体；只允许已核验 ACTIVE、未撤销的原微信收款身份。完整 openId/authorizationId 不返回前端，只展示 hint。缺钱包、身份、最低金额或启用配置时明确不可申请。
2. 金额严格整数分，最低/每日额度和退款欠款均校验。只消费 available，不消费 frozen；同员工仅一笔在途，迁入锁定在途同样计入。FAILED 仍计当天申请额度，REJECTED/CANCELLED 不计，与原规则一致。
3. 钱包行 `FOR UPDATE` 锁与佣金领域共用，申请 available 减、withdrawing 增；拒绝释放冻结，若期间产生退款 debt，优先抵还 debt 再增加 available。成功 withdrawing 减、totalPaid 增；均写同事务 Ledger。
4. 审核不会付款；APPROVED 且 NEW_SYSTEM、未已有供应商单号才能登记人工成功回执。金额、原收款 openId、真实单号、凭证索引、核验依据、实际完成时间和明确人工确认必填；审计与账本一起提交。
5. 迁入 PROCESSING/WAIT_USER_CONFIRM 只可核验原 providerTransferId 的 SUCCEEDED/FAILED 终态；不允许换号/补发、未知或处理中状态不能当失败退钱。LEGACY_SYSTEM owner 不因查看/核验而自动变更。
6. 申请幂等键持久化请求摘要；审核及回执操作幂等键写 Ledger，包含 actor/action/version/参数哈希；同键异参拒绝。版本冲突拒绝，重复真实单号的数据库唯一冲突转 409 并事务回滚。回执登记不覆盖原审核人。
7. 维护开关在 HTTP 中间件和领域写入口双重阻断；GET 只读，不自动创建钱包/身份。财务角色与 SUPER_ADMIN 同时允许，其他角色无权。

## 验证命令与结果

- `pnpm --filter @saydian/app-api exec vitest run src/commerce/commerce-withdrawal.test.ts`：15/15 通过（2026-09-08 10:11）。覆盖同键重试、幂等异参、欠款/余额/身份/撤销、维护、审核无付款、收款金额/时间不符、拒绝抵债、版本/终态、在途原号核验、未知结果拒绝、乐观更新/审计失败回滚、迁入不足冻结、重复转账单号回滚、原最低/每日/在途规则及 guard。
- 测试用内存串行事务验证状态机与回滚分支；**不是 PostgreSQL 真并发锁验收**。上线前必须增加隔离数据库真实并发/事务/迁入余额对账验证。
- `pnpm --filter @saydian/app-admin-web typecheck`：通过。
- `pnpm --filter @saydian/app-shop typecheck`：通过。
- 初次 API typecheck 因并行 contracts 新导出 canAdminResource 未构建失败；后续该错误消失。规则扩展后的 API typecheck 等 schema 单一写者生成新增 plan 字段；测试 mock 缺入参类型的 TS 错误已修正，最终结果由本日志后续补记或根门禁记录。
- 曾使用错误 filter `@saydian/app-admin`，命令提示未匹配项目；随后改用正确 admin-web filter 成功，不把空检查算通过。
- `git diff --check --` 本轮独立 service/controller/module/test、两个 Vue 文件及 legacy 范围：通过。

## 未完成的外部验收

- 新微信收款身份授权/自动重新核验流程尚未接通；只有经迁移证据核验的身份可申请，未配置身份不伪造成功。没有供应商授权时不猜渠道、不保存任意自填 openId 作为已核验身份。
- 尚未执行真实打款、真实供应商回执查询、生产数据库迁移、原钱包/提现全量对账；凭证接口是财务人工核验登记，并非服务器主动查证供应商结果。
- Root 负责统一接线、生成接口文档、全仓串行门禁与本地页面验收。本轮没有提交或部署，不能表述生产提现已开放。
