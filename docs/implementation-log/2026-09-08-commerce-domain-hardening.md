# 商城领域、后台动作与角色权限加固

## 范围与修改前状态

- 承接总后台整合实施：本地/ERP 双来源商品、服务端订单查询、购物车累加、商品项售后、订单/售后并发控制、积分消费及返还、佣金共享领域与到期结算、角色与后台操作权限。
- 主代理已执行 `Start-Change.ps1 -Resume` 并确认本地与 origin/main 为 `c5218875b614d9278b6849c52fbae3f24aad38d5`。保留原有未提交修改；本子任务未 fetch/commit/deploy、未读取生产秘密、未操作旧后台数据。
- 已读取根 AGENTS、handoff 与既有商城后台实施记录。schema/migrations/生成由迁移代理及主代理独占；billing、legacy、路由及提现工作分别由相关代理接线。

## 实现

1. `commerce-policy.ts` 集中金额、版本、接管 owner 和售后状态校验；金额分配使用整数及 BigInt，避免乘积浮点误差。
2. `commerce-store.service.ts` 支持购物车原子 increment/set；GET 购物车不再 upsert。订单积分按分原子扣账，并记录唯一 ledger；取消订单行锁与版本校验，存在未确认支付意图时拒绝释放库存，取消成功仅返一次积分。收货调用共享佣金领域。
3. 商品级售后保存 `CommerceAfterSaleItem` 的商品项、数量和申请金额；验证归属、历史已申请数量、折扣后金额、运输费范围，事务中更新订单版本。申请阶段不自动向 ERP 发送未经审核的售后。
4. `commerce.service.ts` 优先解析已迁移 canonical 订单及 LegacyIdMap 别名；未通过 owner 接管检查的历史业务不能执行写动作。旧客户端 point 元面值精确转分。
5. `AdminService` 提供本地商品及 SKU 新建/编辑、批量上架/下架/归档；ERP 来源 SKU/价格/库存不能从本地商品编辑入口覆盖。订单搜索和状态统计在服务端执行。订单备注/售后审核携带版本，拒绝过期表单与非法状态跳转。
6. `packages/commerce-domain` 提取 API/Worker 共享佣金计算、冻结、收货期限、退款冲回、到期结算函数；API 旧路径保留 re-export。累计退款冲回使用累计金额计算避免亚分舍入漏扣，物流费不计佣，未知期限快照不自动结算，冻结余额不足时拒绝记账。现金累计全退后，已有积分账户仅返原积分一次。
7. Worker 到期佣金使用任务队列、唯一 key 和游标分批；供应商临时错误重新排队，永久错误进入 DEAD_LETTER。ERP 售后只发送审核通过的选定商品项；物流更新保留 AFTER_SALE，不回退订单业务状态；ERP 商品同步不得覆盖 LOCAL 来源。
8. 共享 `adminResourcePermissions` 配置最小 resource read/write/refund 权限；AdminAuthGuard 同时执行多角色并集与更窄的路由角色校验。login/auth-me/AdminUser CRUD 返回并消费 roles，兼容旧单 role。后台菜单、商城写入/退款按钮、原始健康查看及其他操作按钮按权限显示，账号表单支持多角色。
9. 正式 `legacy_app_update` 设置接入旧 App 更新校验器，不把内部测试下载配置作为正式升级源。奖金页新增奖金/提现规则表单，财务专属 `PATCH commerce-commissions/plan` 校验最低额、每日限额及强制人工审核。
10. API/Worker package 与 Docker 构建/运行包含新的共享 commerce-domain 包；主代理统一安装与更新 lockfile。

## 验证与修复记录

- `pnpm --filter @saydian/commerce-domain build`：通过。
- `pnpm --filter @saydian/commerce-domain test`：6/6。首次退款零冲回测试观察到 JavaScript `-0`，改为标准 `0` 后重跑通过。
- `pnpm --filter @saydian/app-api exec vitest run src/commerce/commerce-policy.test.ts src/commerce/commerce-store.test.ts src/admin/commerce-admin.test.ts src/admin/admin-auth.test.ts`：最终四套 16/16。
- `pnpm --filter @saydian/app-contracts build`：通过；权限 registry focused test 2/2。
- `pnpm --filter @saydian/app-api exec vitest run src/admin/admin-auth.test.ts src/admin/commerce-admin.test.ts`：7/7，覆盖多角色财务授权、单 role 兼容、敏感 GET 拒绝、原始健康窄权限、ERP SKU 保护、版本冲突、非法售后重开与提现规则。
- `pnpm --filter @saydian/app-worker typecheck`：通过；新增游标首次触发 exactOptionalPropertyTypes，改显式 `string | undefined` 后通过。
- `pnpm --filter @saydian/app-worker test`：14/14，含物流不回退售后、选定退货行、临时失败重排、佣金跨页扫描及维护停写。
- `pnpm --filter @saydian/app-admin-web typecheck`：通过；曾误写 `@saydian/app-admin` filter，命令未匹配项目，后用正确包名重跑。
- `pnpm --filter @saydian/app-admin-web test`：6/6。
- `pnpm --filter @saydian/app-admin-web build`：最终通过，Vite 有单 bundle 超过 500 kB 的提示。
- `pnpm --filter @saydian/app-api typecheck`：最终通过；新增字段后一次检查因旧 Prisma 生成物导致提现 service 字段缺失，主代理统一 generate 后于 10:17 重跑通过。未擅自并发执行 Prisma 生成。
- `git diff --check`：通过。根级串行 typecheck/test/build、接口生成、数据库验收与浏览器验收交主代理统一执行。

## 明确边界与未验收

- 没有执行真实支付、退款、ERP 发货/退货、提现转账或生产迁移；代码/单测结果不等于供应商真实联调成功。
- 当前 Flutter 在支付页拒绝金额 <= 0。服务端在扣账前拒绝全额积分结算，提示保留至少 0.01 元现金；开启零现金支付必须升级客户端并单独验收。
- 不把未知旧 money1 余额或规则补零。积分来源核验和初始余额迁移由迁移验收门禁负责。部分现金退款暂不自动返部分积分；累计现金全额退款才返还整笔原积分，后续需要确认部分退款的积分分配业务规则。
- ERP 库存同步仍使用供应商快照覆盖 ERP SKU.stock，尚无“ERP 快照扣除本地未同步预留”的完整库存模型；供应商库存口径与预留生命周期仍需完成后才能认定真实并发库存联调通过。
- 本地商品采用归档/停用而非不可恢复删除；ERP 本地展示覆盖与 ERP 商品原始数据权限分离。后台订单备注未联动供应商备注修改。
- 角色是最小资源级授权及既有健康数据窄权限，不是细粒度租户/行级权限引擎；已授权账号的前端角色缓存变更需要重新加载/登录，服务端每次请求仍读取最新角色。
- 本记录不宣称全部原商城功能已完成。复杂运费/发票开具、复杂促销及其他未纳入上述动作的功能应对照总覆盖矩阵继续验收。

## 收尾追加：原始响应文档与员工提现入口

- 按主代理有界追加任务，仅修改 `api-docs/openapi.ts`、对应测试、`api-documentation.service.ts` 以及 Shop 员工页；未修改 generator/registry/ApiDocsView。
- 根据实际 controller 的 `@Res` / `RawResponse`：PDF 导出使用 `application/pdf` + binary string，头像文件使用实际允许的 image MIME + binary string，两个支付宝回调使用 `text/plain` + `success` 字符串。成功体不再伪标 JSON；接口异常仍保留 JSON 错误响应。
- 文档示例脱敏识别 Schema 节点，保留 password 字段 schema 的 type/format/required 等结构与 `<TEST_PASSWORD>`/`<ACCESS_TOKEN>` 等合成占位符，同时继续掩码真实密码、令牌、手机号与敏感 schema 默认值。
- 实际检查发现 `EmployeeWithdrawalPanel` 已存在但员工页没有引用。已接入 `pages/employee/index.vue` 登录后的员工信息区域，并替换“不提供新提现交易”的陈旧说明；组件继续使用真实员工提现 API 和 employee-token，不伪造授权或余额。
- `pnpm --filter @saydian/app-api exec vitest run src/api-docs/openapi.test.ts`：7/7，包括 PDF/文件 MIME、两个支付宝回调、示例保存脱敏 round-trip。
- API 与 Shop `typecheck`、`git diff --check`：通过。`pnpm --filter @saydian/app-shop build:h5`：通过，仅有现有 Sass legacy-js-api 弃用提示；真实员工身份登录与实际提现交易未执行。
