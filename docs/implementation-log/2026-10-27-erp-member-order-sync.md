# 总后台与会员订单ERP履约同步

用户在礼品提示修复发布期间补充：总后台订单显示ERP已取消而商城待发货，要求商城状态、快递单号和物流记录同步，会员中心前端订单同样处理。起始main/origin/main为`25ba7bddb4277ba5522badb5fb35df1b470d503f`，干净工作区经Start-Change检查后建立`codex/erp-member-order-sync-20261027`。前置发布CI40517472032验证已通过、部署尚在执行；本分支独立开发，前置发布验收后再更新main。

已定位：Worker的订单详情同步保存所有erpStatus，但只把有实际运单的Sent更新为商城SHIPPED，缺少Cancelled等映射。会员订单列表/详情只读商城缓存，没有ERP刷新链路；后台包裹只显示元数据，会员轨迹只识别少数JSON字段。现有订单查询会核对ERP订单ID、商城单号、店铺ID，必须保留该校验及并发更新保护。

实施范围：复用已有支付、履约及售后状态；同步已核实ERP取消/发货并保持资金、库存与礼品核销独立，售后/退款终态不被覆盖；增加会员归属限制的ERP快照/刷新，订单列表和详情统一显示履约状态、运单及实际返回的轨迹。补充自动有界刷新、后台物流时间线、并发与越权回归。没有供应商轨迹时明确未返回，不把打印面单或ERP操作日志当作快递运输轨迹。

生产操作限于读取现有ERP数据及同步本系统快照；不自动退款、不恢复礼品卡、不重复扣款/扣库存、不更改ERP店铺设置或供应商密钥。验证和发布回执将保存在ignored artifacts/erp-member-order-sync-20261027。


实现：共享履约显示与保守状态转换；订单详情同时核验ERP内部ID、商城单号和店铺，兼容聚水潭官方发货接口orders列表、分页及多包裹，运单按唯一键更新，轨迹只保留实际描述和时间。原fulfillment任务复用严格查询链。会员新增GET/POST processing接口、列表最多二十单过期刷新、详情有界轮询及刷新/复制单号/发货进度。离开页面、换账号和较旧结果均受代次和会话保护；会员DTO移除原ERP内部日志，只提供事件名称和时间。总后台和伙伴显示复用共享状态；后台详情增加实际轨迹。共享包使用独立commerce-erp子入口，避免商城引入完整接口目录影响首屏。

串行验证：pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check（478条）、pnpm tools:test、runtime artifact、deploy/us节点测试、capacity、bootstrap、image layers以及git diff --check均通过。API1366项通过、60项可选实库用例默认跳过；商城202项、Worker152项通过。新增回归覆盖取消映射、财务/终态保护、严格订单标识、多包裹分页、原轨迹保留、跨会员访问、限量排队和前端轮询代次。

实际loopback PostgreSQL及真实HTTP验收通过：ERP取消持久化并保留礼品引用和金额、重复同步不重复包裹、并发退款赢得比较更新、运单写入失败回滚状态和日志；root/global会员接口返回本人取消状态/运单/轨迹，其他会员404、匿名401，待发货筛选移除已取消和已发货订单，已付ERP取消保留人工售后能力，内部备注/操作人不泄漏，SKU库存与支付记录不变。仅新建和清理本次随机合成测试ID，未清理已有数据；ERP返回为合成，未调用真实短信/ERP。

验证修正：先补上新接口人工说明及字段契约后生成目录；新增轮询需在已有VM测试夹具提供计时器；工具检查首次shell未包含pwsh目录，补正PATH后重跑通过。实库HTTP辅助脚本支付计数误用orderId，改为现有businessId后完整通过，无业务源码因此更改。

Browser SDK仍返回Codex app tool request failed，未把VNode/HTTP验收表述为实际浏览器点击或微信真机结果。本地原5197预览保留；前置25ba7bdd部署仍在受限receiver拉取镜像，未完成前不改变main以免旧发布被新版本拒绝。后续Git对象发布逐blob及完整tree校验，expected_sha非强制更新main；发布与线上ERP核对回执写入ignored artifacts/erp-member-order-sync-20261027，未改变美国站、业务开关、数据库结构或ERP外部配置。
