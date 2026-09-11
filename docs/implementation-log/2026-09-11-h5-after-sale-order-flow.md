# H5 售后、订单详情、物流与评价闭环检查

## 范围及原始问题

- 按主任务分工仅修改 `apps/shop/src/pages/after-sale/index.vue`、`apps/shop/src/pages/order-detail/index.vue` 与独立 SFC 行为测试。已读 AGENTS、handoff、前轮恢复日志并检查 Git 状态；在主任务已 fetch 的共享工作区继续，保留所有其他改动与 ERP 文件，不提交、不部署、不运行根构建/文档生成。
- 真实 API 核对：详情返回 `afterSaleEligibleItems` 的 quantityRemaining/cashRemainingCents/pointRemainingCents，`allowedActions` 决定业务入口；after-sales/preview 返回 orderVersion 与逐行分摊；POST after-sales 支持本轮主任务补充的可选 idempotencyKey；寄回物流要求 WAITING_RETURN、RETURN_REFUND/EXCHANGE、新系统所有权和 version。物流真实存储字段为 traceJson，原页面只读 traces，漏显示实际轨迹。
- 原售后只在 onLoad 获取一次、失败无重试，剩余可退数量不会随返回刷新；提交重报价期间类型可改变，导致请求与报价不一致。原订单详情无页面级加载序号/会话及隐藏清理，旧响应可覆盖新状态；评价缺重复提交 guard，已评价状态无对应显示；售后只有申请金额汇总，缺商品数量和渠道退款状态。

## 修改与边界

- 售后返回/重试读取服务端最新可退数量、现金和积分抵扣额度；空值显示未获取，不补零。没有 APPLY_AFTER_SALE 或只读订单不能根据商品购买数量自行生成可退数量。
- 选择变化的旧报价被忽略；重报价与提交期间锁定类型、数量、原因等字段。服务端订单版本、金额或分摊变化后必须再次确认，不静默采用新状态。
- 每次新申请冻结完整 payload 和 `h5-after-sale-*` 幂等标识，以 realm 隔离的 after-sale-drafts 保存 owner + orderId。网络不确定时原样重试，跨刷新/返回仍恢复，不重新报价或新建 key；异账号草稿不读取。报价等待期间另一标签出现冻结请求时优先复用。成功只删除对应幂等 key 的订单草稿；明确业务拒绝后要求核对售后记录并刷新额度。
- 幂等服务端实现和登出/换账号清理 after-sale-drafts 由主任务负责，本子任务不改 API 或全局配置。
- 订单详情读 traceJson 数组与已有 `{data: [...]}` 格式，保留包裹商品数量和未获取提示；日期无效不显示 Invalid Date。展示每张售后单的商品/数量、申请金额及真实 refunds.status/amountCents，不把申请视为已退款；首次部分退款后剩余商品继续遵循 allowedActions 申请。
- 已评价使用服务端 items[].review 和实际提交响应显示；重复点击、非本订单商品和只读状态不发评价请求。寄回物流按真实 type/owner/version 提交，填写单号不自动标记退货已收或退款完成。
- 两页增加会话/页面生命周期保护；订单重复 load 最新响应优先，隐藏/离开清除会员私有表单，旧请求不能回填/导航/提示成功。收货确认弹窗返回后复核账号与权限。支付实现未替换，只给已有回调结果及轮询增加同样的页面回填保护。
- 两页局部按钮触达区域至少 44px，长物流文本可换行。

## 验证命令与结果

- `node --test tests/order-after-sale-flow.test.mjs tests/product-navigation.test.mjs`（目录 apps/shop）：30/30 通过；其中新售后/订单 SFC 行为 17 条，前轮导航/支付 CTA/地址回归 13 条。
- 新测试执行真实 Vue SFC script 和模板：额度/空值显示、加载重试、只读门禁、报价乱序、类型/数量冻结、网络后跨刷新同 payload/key 恢复、其他账号拒绝、隐藏旧请求、409 明确重查、订单版本变化二次确认、跨标签冻结请求接续、多包裹 traceJson、退款状态、详情乱序/错误重试、收货 modal 期间切账号、评价重复点击及旧会话回填、已评价返回、寄回物流 version/type/owner。
- `pnpm.cmd exec vue-tsc --noEmit`（目录 apps/shop）：通过。
- `git diff --check -- apps/shop/src/pages/after-sale/index.vue apps/shop/src/pages/order-detail/index.vue apps/shop/tests/order-after-sale-flow.test.mjs docs/implementation-log/2026-09-11-h5-after-sale-order-flow.md`：通过。
- 无源码/测试失败遗留。一次尝试修改压缩 CSS 的补丁因上下文拼写不匹配被拒绝，未改变文件；随后追加准确、局部的样式规则完成。

## 未替代的验收

- 以上为真实页面代码的模拟契约/竞态测试，不等同真实微信支付、物流商轨迹、资金退款或生产联调。API 幂等真实数据库、完整购物链路、根级回归由主任务统一执行。
- 售后图片附件上传仍未新增；页面仍按已有契约提交空 evidenceImages。需要上传功能时须与真实受权上传接口一起交付，不能凭图片地址输入视为上传完成。
