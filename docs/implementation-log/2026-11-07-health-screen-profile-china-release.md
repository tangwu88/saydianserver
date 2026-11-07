# 健康大屏资料完善与本人登录：中国站发布

用户已验看本地预览并要求提交 Git、部署中国站。发布前 `tools/Start-Change.ps1 -Resume` 核对本地及远端 main 为 `a6257b1fe641546be470b11da727a2f73f05afb3`；中国站 `/health/ready` 和 `/global/health/ready` 同为此版本，数据库正常。

- 包含会员本人登录、资料进入条件及编辑、按年龄和性别展示的人体图、评分草稿指标、血压高低压标签、生日草稿预填及大屏提示精简。执行范围和本地浏览器验收见[资料与权限记录](2026-11-07-health-screen-profile-access.md)和[界面记录](2026-11-07-health-screen-display-copy.md)。
- 唯一新增迁移 `20261107190000_health_screen_member_access` 为可空姓名列和独立登录凭据散列表。SQL 的 SHA-256 与兼容迁移登记一致。保留原功能开关和评分规则发布状态，本地模拟短信、预览数据库及测量记录不导入生产。
- 发布前重新检查 CI 的部署产物、容量、引导及镜像层脚本，均通过。重新在隔离 PostgreSQL 执行 `tools/test-health-screen-upgrade.mjs` 和 `tools/test-health-screen-database.mjs`：升级、备份恢复成功，112 张旧表摘要一致；19 项 API、5 项 Worker 权限与次数测试通过。新文件的差异检查发现人体素材说明末尾多余空行，已移除。
- 按明确审阅的文件列表执行 `tools/Publish-Change.ps1`，提交消息包含 `[deploy cn only]`。本机 Git 的 HTTPS 凭据未配置，必要时以已连接的 GitHub 账号传输相同 Git 对象，核对完整树、父提交及远端基线后快进 main。

发布结果以后续 GitHub Actions 的中国站部署任务、两个公网 readiness 版本及线上页面检查为准。部署不自动启用会员分析授权、发布评分草稿或调用真实千问。

- 2026-11-07T06:35:07.4100700Z：pnpm api:docs:check，退出码 0。

- 2026-11-07T06:36:11.5076940Z：pnpm tools:test，退出码 0。

- 2026-11-07T06:36:22.3177910Z：pnpm typecheck，退出码 0。

- 2026-11-07T06:36:47.2767790Z：pnpm test，退出码 0。

- 2026-11-07T06:36:57.9498050Z：pnpm build，退出码 0。
