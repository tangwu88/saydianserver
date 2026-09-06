# 2026-09-06 GitHub 仓库迁移

## 目标

- 将主仓库从 `saydian88-cmyk/saydianapp-server` 迁移到 `tangwu88/saydianserver`。
- 使后续 CI、GHCR 镜像发布和服务器接收脚本不再依赖旧账号命名空间。

## 实施

1. 本地 `origin` 改为 `https://github.com/tangwu88/saydianserver.git`，完整 `main` 历史已推送。
2. `Start-Change.ps1` 的默认远程校验改为新仓库。
3. CI/CD、生产 Compose 和服务器脚本的 GHCR 路径统一改为 `ghcr.io/tangwu88/saydianserver-*`。
4. 更新当前交接文档中的仓库地址与克隆命令；历史 CI 链接保留为原证据。

## 验证

- 迁移后首次 CI `34002613233` 成功：包含完整类型检查、测试、构建、数据库迁移、API 冒烟和容器镜像构建。
- 新仓库未配置 `AUTO_DEPLOY_ENABLED`及生产 Secrets，因此自动部署按安全默认值跳过。

- 2026-09-06T01:04:01.4422420Z：pnpm api:docs:check，退出码 0。

- 2026-09-06T01:04:10.4967870Z：pnpm tools:test，退出码 0。

- 2026-09-06T01:04:25.1797930Z：pnpm typecheck，退出码 0。

- 2026-09-06T01:04:37.7402820Z：pnpm test，退出码 0。

- 2026-09-06T01:05:00.3517740Z：pnpm build，退出码 0。
