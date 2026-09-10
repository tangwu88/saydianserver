# 国际 H5 公众号登录接入与验收

## 固定入口

- 国际 H5：`https://app.saydian.cn/global/saidian-mall/`
- 登录页面：`https://app.saydian.cn/global/saidian-mall/#/pages/login/index`
- 公众号授权返回地址：`https://app.saydian.cn/global/saidian-mall/oauth/callback`
- 公众号网页授权域名：`app.saydian.cn`（无协议和路径）。用户已确认设置；真实手机授权另行验收。
- 国际商城 API：`https://app.saydian.cn/global/api/saidian-mall/v1`
- 国际协议/账号 API：`https://app.saydian.cn/global/api/saydian-app/v2`

国内 `/saidian-mall/`、`/api/`和国际 `/global/`不是可互换前缀。构建时固定 realm 和 API；消费者/员工缓存、OAuth context、刷新锁和草稿分别命名，不读取国内登录信息。公众号只使用 `wechat_official` 的加密凭据，不覆盖 App 微信、小程序或企微。

## 配置与流程

1. 部署独立 H5 静态树并验证上面固定回调可以访问。回调不使用 hash；code/state由页面启动桥接至登录流程，立即清理地址参数，不写入访问日志或作为Referer发送。
2. 后台“第三方服务配置 → 商城微信登录”保留已保存凭据，填写授权返回地址，启用后显示“待真实验证”。服务端私有配置显式设置 `GLOBAL_WECHAT_H5_ENABLED=true`，不改变短信、邮件、支付或Worker出站开关。
3. 前端读取当前能力和已审核发布协议；明确勾选同意后生成随机浏览器校验值，调用 `POST /auth/wechat/h5/authorize-url`。用户在微信内完成授权；返回state须与当前浏览器上下文一致且未过期。
4. `POST /auth/wechat/h5/login`兑换一次code；已绑定且有真实邮箱/手机号验证的有效会员取得会话，否则只取得5分钟一次性绑定票据，不授予会员权限。
5. 已验证会员使用原账号密码调用 `bind-account`。新账号或未验证账号经 `binding-code`获取真实验证码后调用 `bind-code`；用途和ticket专属，不能借用注册/找回验证码。已有账号还须证明原密码，新账号密码用于创建。首次核验旧账号时撤销旧会话，不让预占账号会话跟随升级。
6. 相同appId下openid/会员冲突不自动覆盖或合并。App和H5绑定成功后继续使用同一国际User.id，数字会员号不变。

请求字段和合成示例见接口中心及 [逐路由目录](api-reference.md)。API成功沿用商城raw响应（`token/refreshToken/user`），不套 `data`；国际协议API仍使用V2包裹。

### 常见返回

| 状态 | 含义与处理 |
| --- | --- |
| 400 `verification_invalid` | 验证码错误/过期/用途或票据不匹配；累计失败达到上限需重新申请。 |
| 401 `wechat_binding_expired` | 绑定票据失效或已用，重新微信授权。 |
| 401 `invalid_credentials` | 原账号或密码错误，不自动注册或修改密码。 |
| 403 `account_verification_required` | 临时免验证账号不能直接用于商城；需要真实联系方式验证。 |
| 409 `consent_outdated` | 协议已更新，重新阅读当前版本并授权。 |
| 409 `identity_conflict` | 微信与联系方式属于不同账号，人工核验，不能合并资产。 |
| 503 | H5开关、维护、公众号、协议或验证渠道未就绪；明确显示原因，不补假数据。 |

## 发布与恢复

`global-admin`同一受限静态容器增加H5树，不增加宿主端口/数据库权限。`deploy/global/install-h5-route.mjs`只在指定网关文件中加入固定国际路由，保留独立恢复副本；必须先`--check`，再显式`--apply`、`nginx -t`和reload。若校验失败，在原文件inode恢复副本，不能直接重启其他系统。

`deploy/global/configure-h5-runtime.mjs`仅接受受限 `/target/global.env` 并修改 H5 opt-in 开关，保留0600副本，不输出其他环境值。恢复时可以先 `--disable` 并仅重建国际API容器，或回退已验证的完整国际应用版本。不得恢复旧数据库、改国内路径或复制国内密钥。

## 验收边界

- 自动单测使用合成传输；`wechat-h5-smoke.mjs --synthetic-wechat-h5`仅检查静态入口、合成账号/会话、权限、无效OAuth参数和无效绑定票据，不调用真实微信或发送验证码，精确清理本轮合成会员。
- 真实手机检查：微信打开登录地址→同意当前协议→授权回跳→绑定自己的已核验账号→退出/再次授权→仍是相同会员。取消/返回/过期可重新授权；另开账号不应继承之前的会员或购物数据。
- 公众号真实code兑换回执、短信/邮件真实送达、正式协议内容审核分别验收。当前模板不会开启国际结算、支付或员工企微；H5登录上线不代表商城交易已正式营业。
