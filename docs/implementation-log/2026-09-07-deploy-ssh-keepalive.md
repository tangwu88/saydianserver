# 2026-09-07 生产部署 SSH 保活

## 现象

- 交接文档提交 `be2fc594c5c1a390a9cebe7108c6987727be2665` 的 CI 、镜像构建全部成功。
- 腾讯云从 GHCR 拉取 API 和 Worker 的大体积镜像层时，GitHub Runner 的 SSH 连接报 `client_loop: send disconnect: Broken pipe`。
- 两次失败均发生在容器替换前；发布脚本自动恢复旧 `IMAGE_TAG` 和 `APP_REVISION`，维护值保持 `MAINTENANCE_READ_ONLY=true`。

## 修复

- 生产发布 SSH 增加 `ServerAliveInterval=20`、`ServerAliveCountMax=15` 和 `TCPKeepAlive=yes`。
- 保活包防止长时间镜像拉取被中间网络设备当作空闲 SSH 会话断开；服务器真正不可达时仍会在连续 15 次无响应后失败。
- 工具测试锁定两个保活参数，防止后续误删。

## 验证

- 本轮提交后必须等待 CI 和自动生产部署完成。
- 验收时核对 GitHub Actions 成功、`/health/ready` 的 revision、`/down`、`/admin/` 和 `MAINTENANCE_READ_ONLY=true`。

- 2026-09-06T16:20:05.6568850Z：pnpm api:docs:check，退出码 0。

- 2026-09-06T16:20:17.8203320Z：pnpm tools:test，退出码 0。

- 2026-09-06T16:20:34.2998130Z：pnpm typecheck，退出码 0。

- 2026-09-06T16:20:49.9824400Z：pnpm test，退出码 0。

- 2026-09-06T16:21:19.2223180Z：pnpm build，退出码 0。
