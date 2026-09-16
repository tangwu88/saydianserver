# 2026-09-16 微信授权绑定手机号验证码按钮修复

## 问题与现场证据

- 用户反馈国际商城微信授权后的手机号绑定页没有“获取验证码”按钮，并要求本轮及后续修改同步更新国内、国际版本。
- 国际生产能力接口在修复前返回 `login.sms.enabled=true`、`wechatBinding.smsOtpAvailable=true`，但同时返回 `wechatBinding.phoneCodeMode=test`。商城模板在 `bindTicket && temporaryPhoneCode` 时通过 `v-if` 整体移除了发码按钮。
- 生产健康探针为 `ready`、数据库正常；本轮不使用真实手机号，不发送真实短信。
- 应用内浏览器控制组件仍因本机路径错误无法启动；没有伪造可视化点击证据，改用线上能力接口、生产静态资源、组件/API 自动化测试进行复核。

## 修复

- 微信手机号绑定页始终渲染“获取验证码”按钮，只在加载、请求中或倒计时期间禁用；移除临时模式下隐藏按钮的布局分支。
- 微信绑定能力在真实 SMS 已配置时优先返回 `phoneCodeMode=sms`，临时 test 只在 SMS 未配置且显式开关开启时作为隔离回退。
- 绑定专用发码端点在真实 SMS 可用时调用实际验证码投递链路；带 `expectedMode=test` 的过期客户端请求会在发送前拒绝，不会静默回退或混用模式。
- 保留临时 test 的隔离、安全限制和既有账号兼容行为；国内 realm 不启用国际微信绑定流程。

## 验证

- `pnpm --filter @saydian/app-api exec vitest run src/auth/global-wechat-binding.test.ts`：78/78 通过。
- `pnpm --filter @saydian/app-shop test`：127/127 通过。
- 国际分支全量门禁：
  - `pnpm api:docs:check`：341 条路由全部具备说明。
  - `pnpm tools:test`：工具测试 10/10、H5 流程测试 61/61、全局契约测试 38/38 通过。
  - `pnpm typecheck`：8 个工作区类型检查通过。
  - `pnpm test`：API 774/774（另 4 项数据库测试按配置跳过）、商城 127/127、后台 127/127、worker 48/48、下载站 10/10、迁移器 9/9、contracts 11/11、commerce-domain 28/28 通过。
  - `pnpm build`：全部工作区构建通过；仅有既有 Sass 弃用提示和后台 chunk 体积提示。
  - `node deploy/global/check.mjs`：184 项国际部署结构检查通过；本机无 Docker Compose，未执行容器运行时检查。
- 两分支提交、CI 与国内/国际生产 revision 待本记录后续补充。
