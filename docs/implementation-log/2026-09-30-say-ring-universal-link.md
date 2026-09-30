# Say Ring iOS Universal Link 配置

## 范围与基线

- 用户要求配置赛电戒指 Universal Link，固定包名 `cn.saydian.ring`；用户已确认对应微信移动应用 AppID，本轮不接触 AppSecret。
- 修改前 `tools/Start-Change.ps1` 成功：干净 `main`，HEAD 与 `origin/main` 均为 `6896df3564cc3ddf48f3af49ec25c12816fc48f0`。
- 线上 AASA 原本只有 `W7SXQ4A226.cc.saidian.app` 的 `/wechat/*`；专属 `/global/wechat/sayring/` 返回 404。

## 变更

- `UniversalLinksController` 仅追加公开关联 `W7SXQ4A226.cn.saydian.ring` → `/global/wechat/sayring/*`，保留原 App 关联不变，不匹配其他国际版页面或 API。
- 已有 HTTPS 网关模板新增该前缀的静态 200 回退页，不代理请求、不执行登录、不记录查询串、不回显参数；设置 no-store、no-referrer 和严格 CSP。
- 继续使用既有 `configure-shared-gateway.sh` 的备份、语法检查、回滚、重载与国际路由保留机制；不修改部署权限、服务、计时器、数据库、供应商凭据或只读开关。
- 新增关联白名单、不可变对象、静态回退隐私、网关保留国际兜底拒绝的回归；通过生成器更新接口说明。
- iOS 对应配置保存在 SayRing 独立工作树的忽略文件，不提交真实微信构建参数或签名资料到代码仓库。

## 检查与发布

- `pnpm api:docs`：成功，363 条路由，未新增业务 API；只更新 AASA 的已有说明。
- `pnpm --filter @saydian/app-api exec vitest run src/universal-links.controller.test.ts`：2/2 通过；`git diff --check` 通过。
- iOS `xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Profile -destination generic/platform=iOS -showBuildSettings -json`：已核实固定 Bundle ID、团队、微信 AppID、完整 HTTPS 链接及 host 的实际展开值。未将配置核验写成重新打包或安装成功。
- 接口文档校验、部署工具测试、全仓类型检查/单测/构建将由发布工具串行执行并逐条追加结果。
- 本机未安装 nginx，模板结构测试不等于生产 nginx 语法验证；正式部署沿用既有 `nginx -t` 后才重载的门禁。
- 当前没有执行数据库迁移、OTP 或真实 OAuth 授权；微信开放平台字段需账号持有人手动填写，本工具不绕过站点访问策略。
- 提交/推送不等于部署成功，必须回读 Actions、线上 revision、AASA 和静态链接，并另行检查 Apple CDN。
- 新目标 iPhone 在 Apple 开发者平台仍处于 Processing；本轮不能据此声称真机回跳或微信登录已验收。

- 2026-09-30T08:06:05.9471600Z：pnpm api:docs:check，退出码 0。

- 2026-09-30T08:06:13.0584600Z：pnpm tools:test，退出码 1。

- 首轮工具门禁失败：macOS 未安装 `timeout`，既有国际部署隔离测试 4 条报 `command not found`；本次新增的 AASA/静态路径/网关保留测试通过。发布工具按预期停止，未暂存、提交或部署。
- 从 uutils/coreutils 官方 GitHub Release 安装用户级 0.12.0 Apple arm64 `timeout`；压缩包 SHA-256 与 GitHub 发布摘要 `7caea447564405b3eb50cce2a89d314df07d1b7a67090dc4cc7c82eba7014052` 一致。仅暴露 `timeout` 命令，未替换系统工具；真实 0.1 秒超时退出 124 验证通过。生产脚本/测试未弱化，继续重跑完整门禁。

- 2026-09-30T08:08:24.4906280Z：pnpm api:docs:check，退出码 0。

- 2026-09-30T08:08:46.2869020Z：pnpm tools:test，退出码 0。

- 2026-09-30T08:08:54.7068690Z：pnpm typecheck，退出码 0。

- 2026-09-30T08:09:11.4900130Z：pnpm test，退出码 0。

- 2026-09-30T08:09:24.0901800Z：pnpm build，退出码 0。
