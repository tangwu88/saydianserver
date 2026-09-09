# 第三方配置接收与就绪情况

更新：2026-09-08。用户提供的本地配置文件含敏感信息，本文只记录字段是否提供和源码要求，不保存任何配置值、密钥片段或 Token。原文件已加入本机 `.git/info/exclude`，仍是本地明文文件，不等于已加密或已写入集成中心。

## 本次资料与当前代码的对应关系

| 集成 | 已收到的字段 | 接入前仍须核实 |
| --- | --- | --- |
| 企业微信 | 企业 ID、AgentId、应用 Secret | 当前商城入口、OAuth 重定向域名、应用可见范围与实际身份交换；应用凭据存在不代表员工同步/提现收款身份权限可用 |
| 微信支付 | 商户号、未注明版本的 32 位密钥 | 当前服务使用 API v3，不能把未注明版本的密钥直接当成 APIv3Key；还需商户私钥/证书序列号、平台验签公钥及对应序列号、支付渠道对应 AppID、支付及退款回调入口和绑定关系 |
| 聚水潭 | 授权公司 ID、APP Key、APP Secret、Access token、Refresh token | Token 是否有效、到期时间、真实查询/写入权限、店铺 ID；OAuth 回调 URL 在资料中为空。公司 ID 不是当前代码使用的 shopId；当前 Worker 使用 accessToken，但未实现 OAuth 自动刷新流程，不能声称已接入 refreshToken |
| 微信公众号 | 公众号标识、AppID、原始 ID；另有一段未标注用途的 32 位值 | 未标注值是否为 AppSecret 需确认。公众号、企业微信、移动应用微信登录的身份不可混用；当前没有完整公众号菜单/消息/OAuth 模块，提供凭据不会自动恢复这些业务 |

## 已完成与未执行

- 已在当前仓库确认原配置文件未被 Git 跟踪，并加入本地忽略规则；未移动、删除或修改原文件。
- 已只读对照企业微信登录、微信支付 v3、ERP Worker、移动应用微信登录及集成密钥存储实现。
- 未导入运行环境或数据库，未修改集成状态，未验证任何供应商凭据，也未启动同步、退款、付款或生产部署。
- 后续配置应通过加密的集成密钥存储或受控环境注入；后台保存成功/CONFIGURED/PENDING 不等于 VERIFIED。
- 本资料不包含两套旧库的连接或快照，仍不能据此完成账号、历史订单和资金迁移。

## 源码定位

- `apps/api/src/commerce/employee-promotion.service.ts`：企业微信配置、重定向校验及员工身份交换。
- `apps/api/src/billing/payment-provider.service.ts`：微信支付 v3 密钥、商户签名、平台验签、支付/退款回调。
- `apps/worker/src/commerce-job-worker.ts`：聚水潭 accessToken、店铺参数、任务重试/死信。
- `apps/api/src/auth/wechat-app-auth.service.ts`：移动应用微信登录，不是公众号应用。
- `apps/api/src/common/integration-secrets.service.ts`：集成密钥加密存储；需要受控主密钥。

边界：本文是配置盘点，不是供应商联通、权限或生产切换验收报告。不要在公开仓库、工单或聊天中粘贴真实密钥/Token。
