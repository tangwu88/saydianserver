# 2026-09-09 全系统模拟场景与角色调试

## 目标与边界

按用户授权自行注册合成会员和测试角色，建立可重复模拟数据，实际执行顾客、员工、运营、客服、财务、健康审核、内容、集成和只读场景，修复发现的问题。只操作 saydian_h5_demo 与 8081/5174/5175；原 8080/5173、原库、真实短信/支付/ERP/提现、域名及部署不在本轮写入范围。已有工作区修改保留，不提交。

## 基线

- 已读 AGENTS.md、handoff 和上一轮 H5 实施记录。
- `pwsh -NoProfile -File tools/Start-Change.ps1 -Resume` fetch成功；HEAD与origin/main同为c5218875b614d9278b6849c52fbae3f24aad38d5，dirty保留，没有merge。
- 演示seed重复运行成功，私有员工会话刷新但未重复赠送积分；两前端及8081 ready均200。
- 原5173/8080 PID仍为34204/31104；演示5174/5175/8081 PID为31984/31920/38432。
- 分工：协作代理仅提交仓库外候选补丁/脚本；根审查应用，统一串行运行生成/类型/测试/构建，统一执行实际DB与浏览器操作。

## 本轮初始发现

- 跨标签会话同步与首次结算互斥尚未闭环。
- LOCAL商品缺少后台手工分包发货操作；仅显示包裹不能算履约可用。
- 最后一位超级管理员可被停用/降级。
- 健康同时间分页游标会丢记录，幂等键在写入后登记存在并发异参写入风险。
- 裸密码注册未验证手机号，商城密码登录也未校验验证状态，需要阻止未验证手机号取得购物身份。

## 修改范围与预期

- Auth/UserAuthGuard/旧会话桥：注册手机号证明与商城门禁；禁止短信、微信App/mini恢复DISABLED或DELETED账号。精确覆盖新商城、旧inv-shop、旧address与pay受保护路由；健康/profile保留原兼容。手机号存在不当作验证证明。
- Admin/commerce-domain/Billing：保护最后一位启用超级管理员，LOCAL逐商品分包与版本锁、售后后履约状态恢复；不对LOCAL售后发ERP任务。新增CommerceShipmentItem关系和正数量约束，预览含规格，后台与H5显示包裹数量。
- H5 api/App/checkout/login/profile：共享Web Locks、会话修订和迟到响应边界、账号跨标签变更清理，保持员工独立会话。不支持锁的旧H5浏览器明确阻止新登录/刷新/下单。
- Health/content/notifications/support：批次写入与幂等响应/Outbox原子事务，绑定前设备来源哈希，重复/异参冲突；时间+ID分页，预警全量校验+事务，合法分页限制，客服公开配置不加载private数据。
- 后台概览：中文字段、金额单位和口径注释；没有把支付当前状态汇总冒充退款后净销售额。
- 新增只操作演示库的保留场景脚本、真实HTTP角色/履约检查、健康综合回归、数据库专项包装器；文档/302条目录/脱敏发货字段契约同步。

## 命令执行与故障记录

以下从仓库根执行，profile参数均为仓库外私有文件 `F:/xcodeplace/saidianserver-local-runtime/h5-demo/.env.h5-demo`。配置值与密码不复制到本记录。每轮测试顶层串行，pnpm内部既有workspace并行保留。

1. `node tools/h5-demo-runtime.mjs seed <profile>`：重复seed成功，只补充演示数据与员工会话，不复制真实系统数据/密钥。
2. `pnpm db:generate`：第一次因演示进程占用Prisma引擎而EPERM。精确确认8081 PID38432及其query-engine子进程37448后仅停止这两个进程，原8080/5173不动；`$env:PRISMA_CLIENT_ENGINE_TYPE='binary'; pnpm db:generate`成功（Prisma6.19.3），未降级或修改正式数据库。
3. `node tools/h5-demo-runtime.mjs migrate <profile>`：两条新增migration `20260909060000_local_manual_shipments`、`20260909070000_health_source_device_key`只应用至saydian_h5_demo；累计11条迁移。
4. `node tools/h5-demo-runtime.mjs api <profile>`：重启演示API加载更新，先PID26348，最后确认为PID39848；两次均经监听端口、main.ts路径与网络门禁命令检查后只停止其自身与已确认子进程。独立API预加载loopback网络门禁，Worker出站/回调执行暂停。
5. `pnpm typecheck; pnpm test; pnpm build`：首次全库测试发现旧 `wechat-h5-auth.test.ts` 仍mock旧login而没有实际passwordUser数据库查询。将该测试改为真实bcrypt验证过的合成账号和issueSession spy，验证未弱化。后续最后完整运行全部通过：API326、domain28、contracts10、migrator9、worker14、admin6、download10，共403通过；4项opt-in数据库测试默认跳过。类型和全库构建成功。
6. `$env:RUN_SYSTEM_QA='1'; node tools/system-qa-db.mjs <profile>`：包装器校验演示profile、白名单环境、加载网络门禁，四项真实PostgreSQL并发/约束用例全部通过。只在独立测试进程打开必要处理开关，不启动Worker/API、不修改演示服务开关。
7. `node --test tools/h5-cross-tab.test.mjs tools/h5-frontend.test.mjs tools/h5-checkout-recovery.test.mjs tools/h5-demo-network-guard.test.cjs tools/h5-demo-profile.test.mjs tools/h5-field-contracts.test.mjs`：64通过（24+10+8+7+9+6）。
8. `pnpm tools:test`：7通过。`pnpm api:docs`生成302条路由；`pnpm api:docs:check`通过。`pnpm contracts:client:check`基线fa79aa3的76处调用缺失路径为零，只证明路径覆盖。`pnpm --filter @saydian/app-shop build:mp-weixin`成功，不代表微信真实授权或手机号绑定验收。
9. `node tools/system-qa-role-matrix.mjs <repo>`：87条受角色约束路由×十角色及额外边界，共879纯Guard断言通过；不把它当作真实HTTP。
10. `$env:RUN_SYSTEM_QA='1'; node tools/system-qa-scenarios.mjs <profile>`：实际注册三测试会员、创建十角色和多状态场景，初次63HTTP/40断言；补充健康/内容/关爱后重复43HTTP/40断言。保留标识数据，不回滚已推进状态、不重复赠积分。密码/ID仅保存私有system-qa-accounts.json。
11. `node tools/system-qa-http.mjs <profile>`：首次越权receipt断言错误预期404，实际既有API409统一拒绝“不存在/不可操作”，未泄漏订单内容；纠正契约期望而非放宽权限。快速复跑遇短信冷却400，脚本改为读取本测试会员最近验证码时间并等待60秒门槛，不绕过限流。早期完整393HTTP/815断言通过；增加同版本真实并发发货后最后完整390HTTP/808断言通过，初态分支因已推进数据而少执行，未把多轮数量相加冒充覆盖量。临时停用会员严格校验后恢复；管理员临时登录最终退出。
12. `$env:RUN_H5_APP_HEALTH_ACCEPTANCE='1'; node tools/h5-app-health-integration.mjs <repo> <profile>`：最终新版API115HTTP/543断言通过，随机marker `SYSTEM-QA-8e8a6e17-1e45-4782-95ee-0bf6f9acdb0d`，cleanupVerified=true。覆盖13指标、同时间页、异参/并发上报、旧格式、关爱接受/撤权/再邀请、健康审核原因与审计、内容角色/发布态、附件归属、反馈、未配置AI、站内通知和仅草稿群发；不上传真实文件或调用推送。
13. `$env:RUN_H5_ISOLATED_ACCEPTANCE='1'; node tools/h5-isolated-integration.mjs <repo> <profile>`：本轮245断言/63HTTP、cleanup=true；独立fake支付创建3次/退款5次，覆盖多次部分退款、积分尾差、纯积分商品、单独退运费、库存竞争、重复回调、退货物流及评价保护。
14. `$env:RUN_H5_ADMIN_EMPLOYEE_ACCEPTANCE='1'; node tools/h5-admin-employee-integration.mjs <repo> <profile>`：本轮211断言/37HTTP、cleanupErrors=[]；真实5174/5175代理、后台价格/库存/轮播/券临时修改与恢复，员工赠券/归因/业绩分页/二维码、会话隔离及未配置提现拒绝。私有journal `h5-admin-employee-3b4e54fa-0fc5-46dc-bb76-4e03731e3604.json`（以目录实际文件名为准），不含渠道回执。
15. `git status --short --branch; git diff --check`：保留已有dirty，无空白错误；未stage、commit或push。包构建有既有Sass旧API/大包警告，未为消警告扩大依赖升级。

## 内部浏览器真实操作

- 使用5174登录会员19900009101，列出本人六条标识订单。第二标签共享登录后退出并确认，第一标签自动清除旧订单并回到未登录个人页；第二标签登录19900009102，第一标签同步新身份，订单列表“当前没有订单”。不是写localStorage或直接注入登录态的结果。
- 5175以商城运营角色登录，仅显示该角色入口；打开订单 `SD20260908163604C86282E0` 的发货表单，正确区分测试规格1/2，第一规格发1件，承运和运单标识明确“模拟/未实际发货”。提交成功后列表为待发货、1个包裹；另一个并发分包测试订单有2个包裹。没有模拟真实物流轨迹或签收。
- 随后切换READ_ONLY角色，在同一订单列表只显示详情，不显示备注/发货；点击订单子菜单后商城主菜单保持展开。交付时后台标签保留只读账号，需使用文档中商城运营/其他合成角色登录才能继续对应业务操作；H5保留会员2登录。重复测试标签已关闭，原用户标签保留。
- 页面视口390/768/1280宽度实际DOM为双列、双列、桌面分类侧栏三列，document无横向溢出；IAB视口覆盖与截图存在缩放差异，未把缩略图当作真机视觉成功。恢复全部覆盖后桌面截图正常，商城console无error。

## 数据保留与交付边界

- 永久演示标识 `SYSTEM-QA-20260909`：三会员/十角色/本地员工，四SKU合成商品，六订单、地址/积分、十健康记录、一生效关爱、一反馈、测试文章/分类、一未排期通知草稿。原有昨日演示数据不清理。
- 随机专项脚本的临时用户、订单、售后、集成任务等由各脚本按精确marker清理且核验。仅临时夹具被移除，原数据/文件/账号未删除；可以重跑脚本重新生成夹具。保留的订单不会seed回到初态。
- 未配置真实短信、微信/企微、小程序绑定、支付/退款/提现、ERP、推送；没有真实资金、消息发送、文件出站、生产部署、历史迁移或切域名。
- 未完整闭环：换货退回后重新换出；历史包裹与已完成售后分配不明确需人工复核；READ_ONLY不等于全面字段脱敏；部分资源500条限制、大规模导出/统计、生产恢复演练和真机字段/浏览器兼容仍需专项验收。
- 总结与可重复操作方式见 [全系统模拟验收](../system-qa.md)。本地可运行的核心链路经过本轮验收，不声称全部业务已达到生产放量标准。
- 交付前复核：演示8081/原8080就绪、5174商城、5175后台均HTTP200；原8080 PID31104、5173 PID34204不变，演示8081 PID39848、5174 PID31984、5175 PID31920。HEAD/origin/main仍为c5218875b614d9278b6849c52fbae3f24aad38d5；`git diff --check`通过；apps/tools/docs未发现本轮私有测试密码明文。

- 2026-09-09T06:56:34.6810496Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-09T06:56:44.8953008Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-09T06:56:59.5651495Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-09T06:57:16.0211149Z：pnpm.cmd test，退出码 0。

- 2026-09-09T06:57:47.6697549Z：pnpm.cmd build，退出码 0。

- 2026-09-09T06:58:44.7646715Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-09T06:58:55.1116051Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-09T06:59:09.3856403Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-09T06:59:25.5340541Z：pnpm.cmd test，退出码 0。

- 2026-09-09T06:59:50.6131269Z：pnpm.cmd build，退出码 0。
