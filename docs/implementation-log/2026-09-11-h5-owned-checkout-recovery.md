# H5 原账号未确认订单恢复入口

## 范围与原因

- 按主任务最终复核，仅修复两个恢复缺口：商品缺货后“立即购买”禁用，导致已有未确认请求无入口；市场关闭后结算按钮一并禁用，导致不能以原幂等请求查回已创建订单。
- 本轮保留共享工作区所有既有改动和 ERP 文件；不重复 fetch、不提交、不部署、不运行根构建或文档生成。真实支付、市场开关与身份验证边界均不在本次修改范围。

## 修改

- `apps/shop/src/pages/product/index.vue` 增加独立“恢复上次下单”按钮，放在商品详情加载条件之外。只有已登录会员、checkout owner 和冻结草稿 userId 一致、存在原 key/payload 且 uncertain=true 时显示。点击再次核验当前账号、会话和草稿 key；缺货或详情读取失败不阻挡恢复。不会清空、替换购物数据或生成新 key。
- `apps/shop/src/pages/checkout/index.vue` 将市场关闭限制用于新下单，不拦截原 uncertain 请求恢复；获取结算锁后再次核验拥有者、原 key/payload 及 uncertain，防止等待期间草稿移除后误入新下单。仍提交原 payload/key，由服务端优先查回已提交订单；未创建订单仍受服务端市场校验，不绕过门禁。maintenance.readOnly 继续阻挡全部提交。
- 不改商品库存校验、原支付方式选择、临时身份交易限制、账号隔离、报价指纹、重复请求恢复或服务端代码。

## 验证

- `node --test tests/product-navigation.test.mjs`（目录 `apps/shop`）：13/13 通过。真实 Vue SFC 编译、模板渲染与事件调用验证缺货/详情错误仍可恢复，错误拥有者不显示，换账号/会话/草稿后不导航；原 payload/key 和存储不被改写。也覆盖关闭市场恢复 CTA、maintenance 禁用、既有商品/订单导航、支付 CTA 和地址场景。
- 首次新增 CTA 断言失败（undefined 与 false 严格比较）：没有 maintenance 配置时 Vue 的 disabled 属性为 undefined，实际按钮仍启用。将测试改为校验 Boolean(disabled)，未修改业务条件，重跑 13/13 通过。
- `node --test tools/h5-checkout-recovery.test.mjs`：19/19 通过。真实结算脚本验证关闭市场下精确复用原请求且不取新报价；缺草稿、非法原 key/payload、错误所属、锁等待时草稿移除均无出站；maintenance 阻止原请求恢复，市场关闭阻止新建。已有报价变化确认、503 保留原请求、跨标签/账号切换恢复用例继续通过。
- `git diff --check -- apps/shop/src/pages/product/index.vue apps/shop/src/pages/checkout/index.vue apps/shop/tests/product-navigation.test.mjs tools/h5-checkout-recovery.test.mjs docs/implementation-log/2026-09-11-h5-owned-checkout-recovery.md`：通过。
- 根级类型、全量测试、构建与生产验证由主任务串行执行；本记录不代替真机微信、真实支付或线上结果。
