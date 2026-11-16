# Say Ring 邮箱验证码自动注册登录

## 基线与范围

- 用户要求邮箱与手机号一样，验证成功自动注册并登录；未授权向真实邮箱发送验证码，本轮使用合成投递。
- fetch后origin/main为c7bd29f675c0ed98b83fa6bb2edd8413632e32c8，原诊断审计分支341fda2干净；从main另建codex/say-ring-email-code-login-20261116，不覆盖E:/saydian h5和其他main工作区。Start/Publish只接受main，隔离分支手动执行同等fetch、显式提交、全量检查和发布前远端校验。
- 修改global-auth.service.ts及global-auth.test.ts，移除Say Ring新邮箱仅密码注册限制，新增严格布尔emailAutoRegistration能力；保留真实投递/一次性验证码、身份归一、协议版本、年龄确认、账号状态、事务回滚及暂停写入门禁。其他产品和原注册/密码接口保持。无迁移、无供应商配置修改。
- 客户端布局及正式签名安装另见SayRing仓库专项记录。

## 检查记录

- 搜索最初使用Windows字面glob和不存在的DTO文件导致只读查找失败，改为rg目录过滤和实际global-auth.test.ts；未修改行为。
- 定向、全量、构建、Git及部署结果待执行后追加；不把源码完成当作线上启用。

## 本机验收与提交

- `pnpm --filter @saydian/app-api exec vitest run src/auth/global-auth.test.ts --maxWorkers=2`：70项通过，包含新邮箱成功注册、重放/错误/过期/未投递/跨邮箱/跨渠道/用途错误/次数耗尽、缺年龄/旧协议/停写、协议写失败事务回滚及既有账号状态保护。均为合成投递与事务替身，不代表真实邮箱收件或生产实库并发。
- 顺序执行`pnpm api:docs:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm tools:test`和`git diff --check`均通过；API1595通过、94项可选实库跳过，后台326、Worker170通过/5跳过、contracts92、commerce28、health29、download41、vip86；部署工具59、H5流程62、H5契约38通过。
- 使用前轮已校验jq及Git Bash进程PATH，未改部署门禁。API路由未变，无生成接口目录差异。修改邮箱说明及调用指南，保持公开能力字段可选向后兼容。
- 发布前再次fetch确认origin/main仍为c7bd29f，显式暂存本轮5个文件；分支推送后以HEAD:main快进生产分支，不切换其他main工作区。最终Actions/线上能力另行核验。

## 线上独立读回

- 运行时代码d090de979d67983a910292f51133546dc08be282的[CI/双区发布43826724525](https://github.com/tangwu88/saydianserver/actions/runs/43826724525)全部success。
- 公开`/health/ready`与`/global/health/ready`均返回ready/database ok且revision完整等于d090de9。`/global/api/saydian-app/v2/auth/capabilities?product=say-ring&locale=zh-Hans`返回200/product say-ring，login.email、sms、emailAutoRegistration和smsAutoRegistration均为true。未发送实际OTP或建立生产测试会员。
- 只读Actions查询短暂403/认证探针未取得结果，后续重新核对GitHub用户仍为tangwu88并正常完成查询；没有更换账号/凭据/放松TLS。发布过渡期间一次健康响应不能解析JSON，独立再读两个地址和能力后均成功；不以瞬时响应冒称验收。
- 本次无需SSH、停止进程、导入镜像、迁移或修改供应商/维护状态。发布后审计仅提交专项分支，main保持已验收运行时代码，避免文档追加再次触发生产构建。
