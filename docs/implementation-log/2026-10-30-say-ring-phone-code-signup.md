# Say Ring手机号验证码自动注册登录

用户2026-10-30明确要求：没有注册的手机号在验证码登录时自动完成注册和登录。取代该产品此前手机号必须先密码注册的要求，保持邮箱注册、其他产品、验证码所有权、当前已审协议/14岁确认与用户原账号数据。

## 基线和现场

已读AGENTS、handoff、最近模块配置/邮件认证记录。原工作树main干净，fetch/ff-only后与origin均44054d5302c966646f3b4801f84f042af370c187，生产/health/ready及/global/health/ready独立读回同一revision。公开Say Ring能力短信/邮箱/explicitRegistrationCodeLogin均true，同意版本为say-ring-cn-2026-10-05-v3，无自动注册说明能力。独立工作树codex/say-ring-phone-code-signup-20261030以相同origin/main开始，保留原main现场。

初始Git检查误把客户端分支名用于服务端ff-only拉取，因该ref不存在失败且没有修改任何工作树；随后分别核对两库正确远端和SHA。独立依赖offline/frozen-lockfile/ignore-scripts安装906包、0下载，不改锁；首次prisma:generate因shell无node失败，进程PATH明确加入已有Node24运行时后成功，不修改系统、schema或数据。

## 实现

- GlobalAuthService在既有有效短信login挑战事务中允许Say Ring新会员自动注册并签发原共享会话。仍要求实际投递、正确手机号/用途、有效期、尝试上限和一次性CAS；新会员配套协议与14岁确认都成功写入后才签发会话。新用户不伪造密码/邮箱，不使用验证码作为密码。
- 既有active手机号登录同一ID，原密码/资料不改；停用、注销中或已注销账号拒绝，不新建替身。邮件verified-password-v1仍返回registration_required，其他产品/旧客户端兼容保持。
- 仅Say Ring公开login.smsAutoRegistration，受已审配套法律文档、真实短信供应商和业务写入开放状态控制；有旧验证码也不能在停写期间创建新手机号账号。原维护/写入/供应商设置不改。
- 无迁移/seed/会员批量修改。App在独立SayRing库增加按真实能力的简短自动注册说明；当前已安装旧版同一手机号code请求可在服务端修复后直接生效，发布与端上验证分开。

## 验证与发布

`pnpm --filter @saydian/app-api exec vitest run src/auth/global-auth.test.ts src/commerce/commerce-login-code.test.ts --maxWorkers=2 --testTimeout=15000`，56通过。覆盖新账号、旧ID/密码/资料保留、无效/过期/未投递/错误手机号/用途/次数、重放、旧协议/年龄、不可用账号、停写和事务回滚；合成测试没有使用真实会员/短信。

根级typecheck、test、build、接口文档及工具/部署检查串行执行；实际结果续记。发布仅本项目当前app.saydian.cn并使用[deploy cn only]，不发布独立美国环境、不接受新法律协议、不迁移数据库、不改生产配置。CI、真实生产revision、公开能力和手机实际自动注册登录均需独立回执。

## 完整本机检查

typecheck通过7.9秒；全工作区test通过17.7秒（API1419通过/67项可选实库跳过、Admin267、Worker152、VIP81、下载41、迁移器11、contracts71、commerce28）；build通过9.0秒；482路由api:docs:check通过。未安装Docker/PostgreSQL，本机跳过项不当作实库验证。

首次tools:test为57通过/1失败：安全Git流程子进程找不到pwsh（spawn状态null），保留失败日志；找到本机既有PowerShell7.6.6并仅加入本次进程PATH后重跑，部署/工具58、H5流程62、H5契约38全部通过。runtime artifact 3项及git diff --check通过。不改系统安装或部署脚本，不因环境问题放宽断言。

发布前再次确认main与线上均为原44054d5且本次差异只有GlobalAuthService、认证测试、API说明和本实施记录；没有schema/配置/部署脚本更改。独立候选采用与Start-Change/Publish-Change等价的显式文件、全量串行门禁及远端期望SHA保护进行非强推，保留原main现场。
