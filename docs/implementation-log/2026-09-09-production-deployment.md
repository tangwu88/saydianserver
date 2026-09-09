# 2026-09-09 统一服务端线上发布

## 范围与边界

- 用户明确要求把当前总后台、API 与 H5 商城部署到腾讯云线上服务器。
- 目标仓库为 `tangwu88/saydianserver`，目标域名为 `https://app.saydian.cn`，腾讯云实例为北京 `ubuntu 中台`（`49.232.231.131`）。
- 发布保持生产已有 `MAINTENANCE_READ_ONLY` 值；不开放旧业务写入，不执行旧数据迁移、DNS 切换或第三方供应商启用。
- 当前七个 Prisma migration 经人工阅读，均为新增表、字段、约束、枚举值或索引调整，不含删表、删列及旧数据清理。自动发布仍必须在生产备份后通过独立 schema gate。

## 本地门禁与首次推送

- `tools/Start-Change.ps1 -Resume` 确认本地与 `origin/main` 同为 `c5218875b614d9278b6849c52fbae3f24aad38d5`，保留并审阅 223 个既有业务修改文件。
- 敏感模式扫描未发现 GitHub Token、腾讯云密钥、OpenAI Key 或 JWT；唯一私钥头位于 `integration-settings.test.ts` 的 `synthetic` 测试 PEM。
- `Publish-Change.ps1` 运行接口文档 302 条、工具测试 7 项、全部类型检查、427 项测试（另有 4 项默认数据库条件测试跳过）和全部构建并通过。第一次因 JSON 固件末尾空行停止，修复后重跑完整门禁通过。
- 本地 Git 身份仅在仓库内配置为现有提交者 `saydian`；提交 `001ae5f6613969a061842344a6b4b0d3da051f28` 创建成功。
- 初次推送被旧的 `saydian88-cmyk` 凭据以 403 拒绝。用户明确允许后，通过浏览器中已登录的仓库所有者 `tangwu88` 授权 Git Credential Manager；没有修改仓库成员权限或创建个人访问令牌。随后推送成功。

## CI 首次失败与修复

- GitHub Actions `CI` 运行 `34322582855` 在 `Validate and generate database client` 停止，`auto-deploy` 未运行，生产未变化。
- 根因是本地 schema 没有经过 Prisma 官方格式化，CI 执行 `prisma format` 后检测到 `schema.prisma` 的纯对齐差异。不是迁移 SQL、类型检查或生产数据库故障。
- 执行 `pnpm --filter @saydian/app-api exec prisma format`，只产生字段对齐的机械格式变化；后续用同一 CI 命令验证格式幂等、Prisma validate 和生成，再重新发布。
- 再次格式化前后 SHA-256 均为 `763DEA9742D5E91A1F38AF5FE545B9403DBCFC106CA309E3C8011AF0AC35FD06`，确认幂等；`prisma validate` 通过。
- 本机 `pnpm db:generate` 因当前本地 API 进程占用 `query_engine-windows.dll.node` 而在 Windows rename 返回 `EPERM`。没有停止用户正在调试的 5173/8080 环境；这不是 schema 校验失败，修复提交仍由干净的 Linux CI 完成 `prisma generate`、数据库和容器门禁。

## CI 第二次失败与修复

- GitHub Actions `CI` 运行 `34322988269` 已通过 Prisma 格式、生成、完整类型检查、测试、构建、七个迁移、种子和 API 启动，随后在 HTTP 兼容冒烟中停止；`auto-deploy` 未运行，生产未变化。
- 根因是 `tools/http-contract-smoke.mjs` 仍用旧裸密码注册入口创建两个测试会员，而正式注册策略已经正确阻止未验证手机号并返回 400。
- 测试固件改为先断言裸注册被拒绝，再通过仅限本地测试环境的短信验证码和 `register-with-sms` 创建会员；没有放宽生产注册策略，也没有引入生产可用的模拟成功入口。
- 工具测试新增结构性回归检查，确保 HTTP 冒烟继续覆盖“拒绝裸注册 + 验证码注册”。

## 待完成验收

- 修复提交的 CI、镜像构建、生产迁移门禁与实际部署。
- 线上 `/health/live`、`/health/ready` 完整 revision，Admin、下载页、H5 页面与关键公开 API。
- 腾讯云容器运行状态、维护只读值、备份与迁移状态。真实第三方集成另行验收，不因本次发布标记为已接通。

- 2026-09-09T07:14:44.9754245Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-09T07:14:55.1278183Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-09T07:15:10.4792718Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-09T07:15:26.3826141Z：pnpm.cmd test，退出码 0。

- 2026-09-09T07:15:57.4027234Z：pnpm.cmd build，退出码 0。

- 2026-09-09T07:22:46.4228544Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-09T07:22:56.7984767Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-09T07:23:13.7388321Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-09T07:23:33.8961157Z：pnpm.cmd test，退出码 0。

- 2026-09-09T07:24:05.1067343Z：pnpm.cmd build，退出码 0。
