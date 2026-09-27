# 2026-09-27 国际 App 微信授权登录

## 原因与范围

- Say Ring 需要使用微信开放平台移动应用授权登录，并与国际 H5 共用会员、手机号、头像和昵称。
- 微信 `AppSecret` 只保存在服务端；App 只接收公开 `AppID`，并只把微信 SDK 返回的一次性 `code` 交给服务端。
- 首次微信授权必须绑定已验证手机号；后续授权直接进入原账号。手机号、公众号/服务号 UnionID 与移动应用身份发生冲突时拒绝自动合并。
- 本轮不修改旧后台、国内商城、DNS、生产数据或现有健康数据。

## 修改文件

- `apps/api/src/auth/global-wechat-app.service.ts`
  - 增加国际移动 App 微信能力查询、授权码换身份、首次绑定票据、短信验证码、手机号绑定和会话签发。
  - 绑定票据与验证码均一次性、限时、哈希存储，并在事务内锁定和消费。
  - 已有 H5 手机会员、服务号 UnionID 或已有移动应用身份优先回到同一用户；多归属时返回身份冲突，不静默合并。
  - 头像昵称只接受微信服务端换码后返回的数据，并用服务端证明在绑定阶段回传。
- `apps/api/src/auth/auth.controller.ts`、`auth.module.ts`、`global-auth.service.ts`
  - 国际环境接管 `wechat-login`，新增 `wechat-phone-code`、`wechat-bind-phone`。
  - 能力接口返回 `login.wechatApp.enabled/appId/phoneBindingAvailable`；不返回密钥。
- `apps/api/src/auth/wechat-app-auth.service.ts`
  - 将实际完成换码的公开 `appId` 带入可信身份，避免配置切换后串绑。
- `apps/api/src/auth/*test.ts`
  - 覆盖公开能力、已绑定直登、首次绑定、H5 手机账号复用、短信失败、过期/重放/冲突和不泄露密钥等路径。
- `docs/api-*`、`packages/contracts/src/api-catalog.generated.ts`、`tools/api-notes.mjs`
  - 更新三条微信 App 登录接口文档；生成后的接口总数为 346。

## 接口契约

- `GET /global/api/saydian-app/v2/auth/capabilities`
  - `login.wechatApp.enabled`：服务端已配置移动应用且当前允许登录。
  - `login.wechatApp.appId`：公开 AppID，供 Android 在调用微信 SDK 前注册。
  - `login.wechatApp.phoneBindingAvailable`：首次授权是否可发送绑定短信。
- `POST /global/api/saydian-app/v2/auth/wechat-login`
  - 输入：`code/state/platform/consentAccepted/consentVersion/locale`。
  - 已绑定返回会话；首次授权返回一次性 `bindTicket` 和经服务端签名的微信资料证明。
- `POST /global/api/saydian-app/v2/auth/wechat-phone-code`
  - 输入绑定票据、E.164 手机号、协议版本与语言；使用后台已配置的真实短信通道。
- `POST /global/api/saydian-app/v2/auth/wechat-bind-phone`
  - 原子校验绑定票据、短信挑战和验证码，完成身份绑定后签发会话。

## 验证记录

- 在 `origin/main` 新建 `codex/wechat-app-login`，仅拣选本轮提交；生成文档的唯一冲突通过重新运行 `pnpm api:docs` 解决，没有把分叉功能分支的其它提交带入主线。
- `pnpm tools:test`：通过，工具/H5 流程与契约测试全部通过。
- `pnpm api:docs:check`：通过，主线接口文档为 358 条。
- `pnpm typecheck`：首次失败，因为新工作树尚未生成 Prisma Client；执行 `pnpm db:generate` 后重新运行通过，未用代码绕过类型错误。
- `pnpm test`：通过，API 81 个测试文件通过、1 个跳过；798 项通过、4 项跳过；其余工作区测试同时通过。
- `pnpm build`：通过。
- `node deploy/global/check.mjs`：通过。
- 部署脚本测试：通过。
- `git diff --check`：通过。
- Docker Compose：当前 Windows 环境没有可用命令，未执行容器级验证；不影响上述构建和单测结论。

## 失败与修复

- 旧国际能力接口没有移动 App 微信能力，App 无法区分“后台未配置”和“客户端缺失”。本轮改为能力驱动，未配置时入口保持关闭。
- 旧移动 App 接口让客户端直接提供身份字段，不符合微信 SDK 只返回一次性授权码的流程。本轮改为服务端用 `code` 换取身份，客户端不再提交 `openid/unionid/AppSecret`。
- 首次授权不得先创建未验证用户。本轮只创建短期绑定票据；手机号验证码在同一事务内验证成功后才创建或复用会员。

## 尚未验收

- 尚待提交并推送后核对 GitHub Actions、线上版本和线上能力接口，本节将在发布后补记实际结果。
- 未使用真实微信账号完成授权回跳，也未向真实手机号发送本轮绑定短信；自动测试不能替代微信开放平台和阿里云通道现场验收。
- 微信开放平台仍需登记 Android 包名/签名，以及 iOS Bundle ID、URL Scheme 和 Universal Link；后台填写参数不会自动完成客户端平台登记。
