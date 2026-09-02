# App—旧接口—V2—数据来源覆盖表

判定顺序：当前 Flutter App 合约第一，原小程序/旧接口第二，V2 为新能力入口。`已实现`表示本地代码和静态测试可验证；外部供应商或真实数据仍按配置状态单独验收。

| App/业务能力 | V1 兼容路由 | V2 路由 | 新模块/数据表 | 状态 |
|---|---|---|---|---|
| 登录/注册 | `/api/v1/site/login|register` | `/auth/login|register` | `auth`, `User`, `UserSession` | 已实现 |
| 短信/重置密码 | `/api/v1/site/sms-code|up-pwd` | `/auth/sms-code|reset-password` | `SmsCode`, 短信适配器 | 已实现；供应商未配置 |
| Token 刷新/退出 | `/api/v1/site/refresh|logout` | `/auth/refresh|logout` | 原子刷新轮换、会话 JTI 校验 | 已实现 |
| 注销 | `/api/v1/member/account/delete` | `/auth/delete-account` | `AccountDeletionRequest`, Worker | 已实现 |
| 资料/头像 | `/api/v1/member/member/*`, `/api/v1/file/images` | `/members/me`, `/files` | `User`, 私有对象存储 | 已实现 |
| 目标 | `/api/v1/member/member-mubiao*` | `/members/me/goals` | `ActivityGoal` | 已实现 |
| 健康批量同步 | `/api/v1/member/health-records/batch` 及旧日表路由 | `/health/records/batch` | `HealthRecord`, `IdempotencyRecord` | 已实现，最多 200 条/部分成功 |
| 健康历史 | 旧各指标 `preview` | `/health/records` | `HealthRecord` | 已实现 |
| ECG 大文件 | 旧 `/e-c-g` 自动压缩 | `/files/ecg` + 批量索引 | `FileObject`, `EcgArtifact` | 已实现 |
| 健康阈值/预警 | 旧健康记录兼容 | `/health/warning-rules`, `/health/warnings` | `HealthWarningRule/Event`, Outbox | 已实现，不作诊断 |
| 设备 | 无可靠旧服务路由 | `/devices` | `DeviceBinding` | 已实现服务端快照；BLE 留在手机 |
| 远程关爱 | `/api/v1/member/care*`, `care-setting*` | `/care/*` | `CareRelationship/Permission/Audit` | 已实现 |
| 消息/未读/已读 | `/api/v1/member/notify*` | `/notifications*` | `Notification` | 已实现 |
| 推送安装实例 | `/api/v1/member/push-devices*` | `/notifications/push-installations` | `PushInstallation`, Outbox Worker | 已实现；生产 Push 未配置 |
| 百科/协议 | `/api/rf-article/*` | `/content/*` | `ArticleCategory`, `Article`, `LegalDocument` | 已实现 |
| AI 会话 | `/api/rf-article/chat/*` | `/ai/messages` | `AiConversation/Message` | 已实现；AI 未配置不伪答 |
| 反馈/客服/更新 | 无或旧占位 | `/support/feedback|config|app-update` | `Feedback`, `AppSetting` | 已实现 |
| 商城首页/商品 | `/api/v1/pages`, `/api/inv-shop/v1/product/*` | `/commerce/home|products` | 现有商城公开接口 + 数字 ID 兼容表 | 已实现 |
| 购物车 | 旧 App 本地购物车 | `/commerce/cart*` | 现有商城 | 服务端已实现；当前 App 保持本地兼容 |
| 地址 | `/api/v1/member/address*` | `/commerce/addresses*` | 现有商城 `Address` | 已实现，保留行政区代码 |
| 下单/订单 | `/api/inv-shop/v1/order/*` | `/commerce/orders*` | 现有商城 + `LegacyOrderProjection` | 已实现；旧订单只读 |
| 支付 | `/api/v1/pay` | `/commerce/payments` | 现有商城支付 | APP 参数适配已实现；商户配置未验证 |
| 物流/售后 | 旧订单物流/退款路由 | `/commerce/orders/:id/logistics|after-sales` | 现有商城 | 已实现；ERP 写权限需单独验收 |
| 管理后台 | 不适用 | `/api/saydian-app/admin/v1` | `AdminUser/Session/AuditLog` | 已实现 |

## 旧字段边界

- `heartReat`、`pulseReat`、`hourse` 等历史拼写只在 `legacy-health-mapper.ts` 出现。
- 商城 CUID 只在 V2 和内部服务间传递；V1 通过 `CompatibilityId` 返回稳定整数。
- V1 仍以 HTTP 200 包装旧业务码；V2 使用真实 400/401/403/404/409/422/429/500。
- 生产 Swagger 默认关闭；开启时不得放入 Token、手机号、IP、健康值或内部字段示例。
