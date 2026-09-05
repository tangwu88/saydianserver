# 2026-09-05 原生微信授权登录实施记录

## 目标与边界

- 为 Android、iOS 和 HarmonyOS App 提供服务端原生微信一次性 code 兑换，同时保留 V1 客户端兼容入口。
- AppSecret 只由服务端集成密钥管理；不写入 App、Git、日志、调用文档或响应。
- 本轮只实施和验证源码，不自动部署生产、不执行生产数据库迁移、不关闭维护只读。

## 实施内容

1. 新增 `WechatAppAuthService`：校验 code、平台与 10 分钟内的 state，使用 `wechat_login` 集成配置向微信开放平台兑换身份。
2. 新增 V2 `POST /api/saydian-app/v2/auth/wechat-login` 和 V1 `POST /api/v1/site/wechat-login`，两者都要求明确协议同意。
3. `User` 新增唯一 `wechatAppOpenId`，与小程序 OpenID 分离。只有 UnionID 一致时合并已有账号；OpenID/UnionID 指向不同账号时拒绝自动合并。
4. 微信资料只回填缺失的昵称、HTTPS 头像和性别，不根据微信资料构造手机号。
5. 新增 Prisma 迁移及默认 `UNCONFIGURED` 集成记录；未配置时接口返回真实暂不可用，不伪造登录成功。
6. 补充接口目录、HTTP 合约冒烟、集成 seed 策略、环境占位配置和交接文档。

## 外部配置现状

- 原 `app.saidian.cc` 后台的微信登录配置已保存并重新打开核对；本文不记录任何明文密钥。
- 原后端的同名 URL 仍是微信网页入口；对合成无效 code/state 的 POST 探测返回业务 404，不具备本轮原生兑换合约。
- 微信开放平台的 HarmonyOS 应用身份变更已提交，页面状态为“审核中”。审核通过前不能声称真实授权闭环完成。
- 新 NestJS 服务端尚未部署到生产，`wechat_login` 生产集成也尚未写入。生产库迁移、配置和域名切换必须按发布手册独立审批。

## 测试与构建

- `pnpm api:docs:check`：通过，271 条路由全部有说明。
- `pnpm tools:test`：4/4 通过。
- `pnpm typecheck`：API、Worker、Migrator、Contracts、Admin 和 Shop 通过。
- `pnpm test`：87/87 通过，其中 API 72、Worker 9、Contracts 4、Migrator 1、Admin 1。
- `pnpm build`：全部应用构建通过；商城 Sass 弃用提示和后台大分包为既有警告。

## 失败、根因与修复

1. 新 state 测试最初使用了固定时间，在当前日期下被正确判定为过期。修复为测试显式固定 `Date.now`，生产校验逻辑不放宽。
2. 首次单独运行 API 测试时共享 Contracts 尚未构建，导致无关导入失败。按根级命令先生成 Contracts 后复测通过。
3. 安全 Git 工具测试在 macOS 临时目录中将 `/var` 与 `/private/var` 视为不同根路径。修复为用 Git 的空相对前缀判定仓库根目录，不再比较未解析的文本路径；完整快进、脏工作区和远端分叉用例复测通过。
4. 开工时环境未能直接调用 `pwsh`，因此先人工完成脚本要求的分支、远端、工作区和分叉检查；后续 PowerShell 可用后已用工具测试复核。

## 尚未验收

- 微信开放平台审核通过后，用已登录微信的 HarmonyOS 真机完成授权、取消、code 重放、换账号和冲突处理。
- 新服务端经数据库备份/迁移演练与发布审批上线后，在集成中写入公开 AppID 和加密 AppSecret，再以真实成功回执标记已验证。
- 完成 App API 域名切换/兼容策略和旧会话迁移后，再做 Android、iOS、HarmonyOS 三端回归。

- 2026-09-05T15:17:49.8914810Z：pnpm api:docs:check，退出码 0。

- 2026-09-05T15:19:44.5603720Z：pnpm tools:test，退出码 0。

- 2026-09-05T15:21:21.2899570Z：pnpm typecheck，退出码 0。

- 2026-09-05T15:22:13.4029670Z：pnpm test，退出码 0。

- 2026-09-05T15:24:00.5539600Z：pnpm build，退出码 0。
