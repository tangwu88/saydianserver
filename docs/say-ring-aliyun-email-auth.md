# Say Ring 登录注册及阿里云邮箱配置

## 客户端行为

- 默认中国手机号＋密码登录；可选邮箱＋密码，两个渠道均可切换验证码登录。
- 独立注册要求渠道所有权验证码＋8至72字节密码（至少8字符），当前已审Say Ring协议和14岁确认；验证码用途为register。验证码login不能替代register。
- 已存在的无密码账号仍可验证码登录或找回密码。新版Say Ring验证码登录显式发送authFlow=verified-password-v1，不会新建无密码账号；已发布的旧版验证码单入口及其它App旧兼容流程不变。
- 注册/密码复用POST auth/verification-code、auth/register-with-code、auth/login、auth/reset-password，first-party前缀保持/global/api/saydian-app/v2；验证码登录沿用/global/api/saidian-mall/v1/auth/code/request与/code/login。产品显式say-ring，不能回退其他App协议。错误registration_required应引导注册，而非循环重发login验证码。

## 后台填写

在第三方服务配置→邮箱验证码（email_otp）选择“阿里云邮件推送（API直连）”。填写独立RAM AccessKey ID/Secret、阿里云控制台已经验证的完整触发发信地址、相同发信区域和1至14字发信名称。RAM最小权限为dm:SingleSendMail；不要填阿里云主账号密码或SMTP密码。使用现有加密secret存储，App和公开能力接口不返回AccessKey。

先关闭“已完成投递验收”，保存为启用，再发测试到本人授权测试邮箱。API受理不代表实际收件；收到后才人工勾选投递验收并保存。OTP真实发送成功才记真实调用，测试不创建可登录验证码、不自动打开验收。更换区域/发信人/凭证后验收重新关闭。无配置、暂停、未验收或缺少凭证均不开放邮箱验证码。维护或外发暂停时不发测试。

阿里云使用官方SingleSendMail，固定HTTPS白名单端点和2015-11-23 API，POST表单HMAC-SHA1签名，不跟随重定向，10秒超时；成功必须确认RequestId/EnvId，无自动重试以防重发。只投递单收件人验证码纯文本，无营销订阅、任意模板、附件或健康数据。保存配置不发送邮件。已有wecom_smtp和webhook配置保留，不自动切换其它应用的邮件渠道。

官方依据：
- https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-singlesendmail
- https://help.aliyun.com/en/direct-mail/signature
- https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-endpoint

## 验收与上线边界

服务端能力login.explicitRegistrationCodeLogin=true表示已支持新版显式注册策略；新版App在缺少该能力时不发验证码登录，防止连接旧服务端后静默自动注册。密码登录和register-with-code仍走原有已审接口。应先部署兼容服务端，再交付新版App；旧版App验证码登录不被提前停用。

合成fetch测试不是实际投递。本轮未持有或修改生产阿里云邮件参数，未向真实邮箱/手机号发送OTP。源码候选、CI成功、生产发布、管理员真实收件及App实机验收必须分别确认；没有这些证据不能写“邮箱已接通”。无需数据库迁移或清理已有会员。
