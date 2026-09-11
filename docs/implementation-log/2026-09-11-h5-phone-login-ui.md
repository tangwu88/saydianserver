# H5 微信手机号登记与 App 风格界面

## 需求与基线

- 用户要求微信授权后完成手机注册/登录，H5 基础界面与 App 一致、精简“国际版”和内部提示。
- 本轮追加明确要求：暂不真实发短信，任意验证码可通过。实现限定为真实微信授权后的临时手机号登记，任意 6 位数字不作为手机号归属证明，不接管已有会员，不标记手机号已验证。
- 当前仓库 `F:/xcodeplace/saydian-server-global`，分支 `codex/global-api-foundation`；修改前工作区干净。指定已授权 GCM 账号执行 `git -c credential.username=tangwu88 fetch origin --prune`，本地/远端均 `3717e3ca123d0d3f505110ef8f91db80db9fc364`。
- 已阅读 AGENTS、handoff、最近实施记录。Start-Change/Publish-Change 限定 main，不用于本独立部署分支；本轮执行等价的远端核对、串行检查、日志与显式暂存，不切换或合并 main。
- 视觉只读参考当前国际 App `F:/xcodeplace/saydian-app-global`，HEAD `6217b16bdeff0e2a69e481e1682ce2ef1182535e`：`global_auth_page.dart`、`app_theme.dart`。App 源码不修改。红色品牌图原样复制，源/目标 SHA-256 均 `02a0732ae454032f4d32cf570764c16ec06850f87009591eb51c2e1b3b58fdff`。

## 实现边界

- 新模式使用独立 `GLOBAL_WECHAT_PHONE_TEST_ENABLED`，代码/部署示例默认关闭，仅 API 可接收开关，Worker、国内 App/商城、真实短信及支付不受影响。
- 临时手机号保持未验证；测试会话持久记录来源，不能用于 App 接口或交易，关闭测试开关后临时 access/refresh 均失效。
- 已被其他会员占用的手机号直接拒绝，不通过任意码合并身份、资产或重设密码。微信回调仍校验一次性 state、PKCE 风格 challenge、有效期、协议和账号状态。
- 短信真实配置现场显示未配置；两份用户第三方资料没有短信信息。本轮不发送短信，不把无验证码校验登记写成真实手机号核验。

## 命令与结果

- 修改前 Git status、remote、fetch、SHA 对照通过。
- App 品牌图 Copy-Item 原样复用，Get-FileHash 比对一致；其他源码与文档用 apply_patch 编辑。
- 首次只读腾讯云检查时会话已过期；重新连接后显示登录二维码，已请用户恢复登录。未绕过认证。
- 新增 `phone-code`、`bind-phone`、`account` 三条 H5 接口，标准文档增加正式短信/临时登记的字段与示例；目录共 315 条路由。原邮箱绑定后缺手机时继续手机步骤，不绕过登记。
- 受限会话的来源保存在 UserSession，H5 刷新保留来源；App/交易接口拒绝，退出可用。号码冲突不自动合并；关开关即拒绝受限 access/refresh。正式短信找回密码必须有真实手机核验记录。
- API 定向 8 文件 209 项通过；新增会话测试 18 项，绑定测试增至 71 项。独立复核了作用域、事务与脚本清理边界。
- 根级 `pnpm typecheck`、`pnpm test`、`pnpm build` 依次运行并通过：761 项测试通过，4 项原数据库测试因未提供测试数据库而跳过。本地不宣称真实数据库并发已验收。
- `pnpm api:docs:check`：315 条一致；`pnpm tools:test`：9/9；部署补丁测试：7/7；`node deploy/global/check.mjs`：176 项通过；`git diff --check` 通过。本机无 Docker，Compose/Nginx 运行检查仍待目标机。
- 国际 H5 独立环境构建通过；构建有 Sass 旧接口/导入弃用及原后台大 chunk 警告，无构建错误。
- `node tools/h5-phone-ui-fixture.mjs --local-fixture` 仅监听 127.0.0.1:5188，不连接数据库/真实微信/短信。内部浏览器 390×844 完成合成 OAuth 回调、手机、任意六位码、会员 ID 81/手机号待验证、刷新回读、退出；1280×900 登录布局与 768×1024 平板布局核验通过，平板无横向溢出，结束恢复浏览器尺寸。
- 本地夹具计数：oauth=1、codeRequests=1、phoneBindings=1、accountReads=2、logouts=1、服务端 externalCalls=0。此证据仅为隔离 UI 联调，不是微信真实换码或生产 HTTP 验收。
- `phone-test-smoke.mjs` 为显式 opt-in 的目标机合成 HTTP 验收工具；要求独立库、专用开关启用、通用 OTP bypass 关闭且短信 provider 禁用。仅创建随机合成微信身份/未占用虚构号码，清理需同时匹配本轮时间/身份/号码/认证字段，冲突时保留而非误删。源码解析及独立复核通过，本轮尚未在生产执行。
- 提交前再次 fetch，本地与远端仍为原基线，无分叉或其他远端修改。

## 待完成验收

- 目标机登录恢复后开启已授权的专用临时手机登记开关，仅重建 global-api；不更改其他维护/供应商/Worker 开关。
- 部署 revision、公开入口、生产合成 HTTP 测试及真实手机微信授权后流程复验。真实短信仍不在本次临时模式的验收范围。
