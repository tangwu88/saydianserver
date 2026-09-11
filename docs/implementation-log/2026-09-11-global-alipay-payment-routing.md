# 国际版 H5 支付宝支付与渠道分流实施记录

## 范围与目标

- 微信客户端仅允许 `WECHAT_JSAPI`；普通浏览器仅允许 `ALIPAY_WAP` 或 `ALIPAY_PAGE`。
- 支付宝回调以验签通知为主；会员刷新订单时补充签名校验后的查单，避免通知短暂延迟造成已付款订单长期停留在待付款。
- 密钥只应写入线上加密集成存储；本记录不包含任何 AppId、私钥、公钥或管理员凭据。

## 变更

- 从国际版支付白名单移除微信 H5 与扫码支付，公开能力不再将其提供给普通浏览器。
- 在创建付款关系前根据服务端收到的 User-Agent 执行渠道校验；前端隐藏不是唯一控制。
- 为支付宝增加 `alipay.trade.query` 的签名请求、响应验签、订单号/金额/渠道交易号绑定校验和成功状态回写。

## 命令与验证记录

| 检查 | 结果 |
| --- | --- |
| `git fetch origin --prune` 后从 `origin/codex/global-api-foundation` 创建隔离工作树 | 通过，基线 `ec97bc2` |
| `pnpm --filter @saydian/app-contracts build` | 通过 |
| `pnpm --filter @saydian/app-api prisma:generate` | 通过 |
| `pnpm --filter @saydian/commerce-domain build` | 通过 |
| 支付宝/支付状态/能力针对性 Vitest | 3 个文件、71 项通过 |
| `pnpm --filter @saydian/app-api typecheck` | 通过 |
| 线上公开 capabilities 初检 | 微信 JSAPI 已启用；支付宝尚未配置，未将未验证渠道标记为可用 |

## 上线前置与验收

1. 通过超级管理员的集成配置写入支付宝 AppId、应用私钥和支付宝公钥，状态设为 `CONFIGURED`；配置只保存 `https://app.saydian.cn/global/api/saydian-app/v2/billing/payments/alipay/notify` 与官方网关。
2. 部署本次代码后，公开 capabilities 必须只返回 `wechat_jsapi`、`alipay_wap`、`alipay_page`；微信 UA 中仅可使用前者，非微信 UA 中仅可使用后两者。
3. 以真实小额、可退款订单完成一次支付宝 WAP/网页支付；核验已签名通知或查单均能把订单和付款关系更新为成功。未取得真实渠道回执前不得标为已验证。
