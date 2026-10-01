# Say Ring 法律协议客户端契约（1014）

状态：服务端候选实现，尚未部署；Say Ring 隐私政策仍是内部草稿。

## 产品选择

- Say Ring 固定产品值：`say-ring`。
- 国际主 App 省略产品，或显式传 `saydian-global`。
- 不使用自定义请求头；不要用包名、设备名、语言或域名推断产品。
- 未知产品返回 HTTP 400，`errorKey=invalid_product`。

## 能力与文档

请求：

`GET /global/api/saydian-app/v2/auth/capabilities?locale=en&product=say-ring`

响应中的 `data.product` 必须等于 `say-ring`。只有已审、已启用且已到发布时间，并且版本一致的 `say_ring_user_agreement` 与 `say_ring_privacy_policy` 同时存在时，才返回非空 `consentVersion` 和 `legal`。

客户端按 `legal.userAgreement.path`、`legal.privacyPolicy.path` 读取文档。路径已经包含文档类型、版本和语言；只在前面增加一次 `/global` 网关前缀。

## 同意请求

所有 Say Ring 法律或验证相关 JSON 请求都必须传：

```json
{
  "product": "say-ring",
  "locale": "en"
}
```

实际接受同意的注册、验证码登录、密码登录和 Android 微信登录/绑定请求，还必须传：

```json
{
  "consentVersion": "<capabilities 返回的当前版本>"
}
```

创建 Say Ring 新账号时还必须传：

```json
{ "ageConfirmed": true }
```

这只表示用户确认已满 14 周岁；客户端不得以出生日期、设备推断或其他年龄信息代替。服务端只记录最小年龄确认，不为该检查收集出生日期。缺少该字段返回 HTTP 400，`errorKey=minimum_age_confirmation_required`。13 岁支持在独立的可核验监护人同意流程完成前保持关闭。由于 App Store 的可选等级为 13+/16+/18+，上架前必须确认 App Store Connect 为 16+，不得用 13+ 上架本协议。

适用入口：

- `POST /auth/verification-code`（注册验证码申请；只传产品和语言，不提交同意版本）
- `POST /auth/register-with-code`
- `POST /auth/register`（仅临时免验证码开关开启时）
- `POST /auth/login`（既有账号的密码登录；必须额外传 `consentAccepted:true`）
- `POST /api/saidian-mall/v1/auth/code/request`（只传产品和语言，不提交同意版本）
- `POST /api/saidian-mall/v1/auth/code/login`（仅在该次登录会创建新账号时传 `ageConfirmed:true`）
- Android `POST /auth/wechat-login`
- Android `POST /auth/wechat-phone-code`
- Android `POST /auth/wechat-bind-phone`

Android 微信首次绑定手机号而创建账号时，`POST /auth/wechat-bind-phone` 也必须传 `ageConfirmed:true`。已有账号登录或绑定不会重新收集该确认。

服务端把同意记录写入 `say_ring_user_agreement` 和 `say_ring_privacy_policy`，不会写入国际主 App 的 `user_agreement` 或 `privacy_policy`。产品对应文档不存在时返回 `legal_unavailable`；版本过期返回 `consent_outdated`。

### iOS 邮箱密码登录

既有国际账号与 Saydian Health App 共用 `POST /auth/login` 和同一套用户数据；从 Say Ring 登录时必须提交：

```json
{
  "channel": "email",
  "identifier": "user@example.com",
  "password": "<PASSWORD>",
  "product": "say-ring",
  "locale": "en",
  "consentVersion": "<capabilities 返回的当前版本>",
  "consentAccepted": true
}
```

服务端先确认两份当前已审专属文档，再验证已有 ACTIVE 账号的密码；验证成功后才写入两条专属同意记录并签发会话。该流程不创建账号、不写入 `say_ring_minimum_age`，也不改变 `emailVerifiedAt` 或 `mobileVerifiedAt`。

`consentAccepted` 不是默认值：缺失或非 `true` 返回 HTTP 400、`errorKey=consent_required`；无专属文档返回 503、`legal_unavailable`；版本过期返回 409、`consent_outdated`。凭据错误、无密码哈希或非 ACTIVE 账号仍统一返回不可枚举的 401；客户端不得据此推断账号存在与否。

## 1014 平台边界

- iOS 隐藏微信授权登录，不注册微信 SDK，并由原生方法通道拒绝微信授权和支付；iOS 使用上述邮箱密码登录。邮箱验证码只在 `capabilities.login.email=true` 时显示；天气和推送同样保持不可用。
- Android 保留微信功能，因此 Android 的微信三步请求仍必须传 `product:"say-ring"`。
- 首版 App Store 仅在中国大陆供应；其他地区在国际登录与隐私合规完成前保持关闭。
- iOS 审核体验公开只读、不需要审核账号，并明确标注为演示数据；客户端不得把演示数据提交为真实账号、设备或健康记录。
- 1013 旧包不传产品，会继续读取国际主 App 通用政策；在 1014 上线并完成专属文档审核前，不能把专属政策激活或对外发布。
