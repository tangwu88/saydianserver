# H5 商城 App 对照与订单分组修复

## 范围与基线

- 主任务要求先只读对照国际 App 商城，再明确授权本子任务修复 H5 订单列表筛选。App `F:/xcodeplace/saydian-app-global` 只读，`main` / `1023ce4fb257fb087f0f18bcb3e06462410e6305`，未修改、测试、构建或联网操作该客户端。
- 阅读两个仓库 AGENTS、App 国际 handoff/变更记录和服务端本轮 H5 实施记录。服务端修改前执行 `git status --short --branch`、`git remote -v`、`git fetch origin --prune`、`git rev-parse HEAD origin/codex/global-api-foundation`；本地远端均为 `0f9c7e0457e9ab554d92b72a913cd706ec63e09f`。当前工作区有其他代理修改，全部保留，未快进、暂存、提交或部署。
- 本子任务仅改订单过滤 helper、Store/CommerceService 的订单列表区块、两个控制器的 orders 参数、H5 orders 页面、专用测试和本记录。不碰其他代理的优惠券、评价、售后或生产配置。

## App 对照结论（源码证据，不代表真机或生产验收）

| 业务 | 国际 App 当前实际实现 | H5 当前源码 |
| --- | --- | --- |
| 首页/分类/搜索/商品 | `lib/ui/global_shop_pages.dart` 使用 V2、字符串 ID；可浏览目录和详情 | 已接独立 global 目录，手机/桌面列表及 SKU |
| 购物车/结算/支付/地址 | 继承 `shop_pages.dart` 的整数 ID 旧界面；`global_api_client.dart` 的相应方法在请求前明确拒绝 | 已接 UUID、CN/CNY、服务端报价和真实能力门禁，不应照搬 App 旧 money1 或旧 V1 |
| 订单/售后/物流 | `pages.dart` 的 OrdersPage/AfterSalesPage 与 `shop_pages.dart` 的 ShopExpressPage 存在，但 global API 方法仍拒绝 | 已有真实订单、商品数量现金/积分售后、换货、多包裹、退货物流；主线程继续补轨迹归一、评价状态和售后恢复 |
| 优惠券/积分/评价 | 未找到可执行的领券/评价 API；积分仅继承结算 money1 输入，无独立账本 | H5 有已领券、pointCents 与分页流水、评价提交；领券入口/已评价状态由主线程处理 |

- 已报告主线程的其他缺陷：`CommerceShipment.traceJson` 与旧 H5 `ship.traces` 不匹配；已评价商品仍显示新增而服务端直接返回旧评价；售后成功响应丢失后重新报价重试可能申请第二份剩余数量。它们不由本子任务修改，不把报告发现写成已经修复。

## 订单过滤合同与实现

- 两个已有 GET 入口 `api/saydian-app/v2/commerce/orders`、`api/saidian-mall/v1/storefront/orders` 增加可选 `group=pending_shipment|after_sales`。无新路由；响应仍为原订单数组。
- `group` 与非空 `status` 互斥，冲突或未知分组返回 400。旧 `status` 仍是精确状态过滤，保留 trim/大写归一；未传时仍为全部。没有将原 status=AFTER_SALE 的 API 含义静默改为所有售后。
- `pending_shipment` 在数据库使用 `status IN (PAID, WAITING_FULFILLMENT)`；历史只读投影也使用相同状态条件。
- `after_sales` 在主订单数据库使用 `afterSales: { some: {} }` 并保留 `userId`，包含退款完成、拒绝、取消等真实历史售后关联，不依赖当前订单是否仍为 AFTER_SALE。旧投影只有状态、没有真实售后关联，不能凭状态冒充该分组证据，故不列入此新分组。旧精确状态查询仍保留投影。
- H5 “待发货/售后” tab 和原个人中心 status 快捷链接转换为服务端 group 查询，不在前端过滤已经加载的结果；直接 group 链接也能选中对应 tab。补齐 `COMPLETED` 的“已完成”显示。保留原页面请求序号、隐藏/卸载失效和错误重试。
- 新增 `commerce-order-filter.ts` 统一过滤，避免两个控制器、普通 service 入口与旧投影条件漂移。主任务统一维护接口说明并生成文档，本子任务不并发生成共享 contracts。

## 验证

- `pnpm --filter @saydian/app-api exec vitest run src/commerce/commerce-order-filter.test.ts`：11/11 通过，包含旧精确状态、大小写兼容、两组真实数据库谓词、会员隔离、非法/互斥参数、旧投影边界、两个控制器和内部 GET 参数转发。
- `node --test tests/order-filter.test.mjs`（apps/shop）：3/3 通过，执行真实页面脚本，验证服务端分组请求、旧快捷入口/新链接、COMPLETED 中文与未知状态保留。
- `node --test tools/h5-frontend.test.mjs`：18/18 通过，保留购物车、账号隔离和订单乱序/隐藏/重试回归。
- `pnpm --filter @saydian/app-api exec tsc --noEmit` 与 `pnpm --filter @saydian/app-shop exec vue-tsc --noEmit` 通过；`git diff --check` 通过。没有执行根级生成、构建、数据库写入、真实微信/支付或生产请求。
- 本次测试无失败。只读源码定位中个别无匹配 rg 返回 1，以及旧路径查找错误已通过实际文件路径重查，不涉及源码修复。

## 仍待主任务验证

- 新分组的真实数据库/浏览器已付款、退款完成历史场景，以及主线程的券/评价/物流/售后端到端联调。
- 订单列表仍沿用已有数组合同，没有引入新分页或擅自截断数据。大规模历史订单分页可另立兼容合同，不应由前端只过滤当前页替代。
- 国际 App 交易界面仍未迁移，不修改 App 也不能声称 App 的购物链已经同步开通。真实供应商、库存、发货与支付回执继续独立验收。
