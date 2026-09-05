# 本地预发布、生产发布与回滚

## 本地预发布

1. 从 `.env.example` 复制 `.env` 并只填本地测试值。
2. 执行 `pnpm.cmd install --frozen-lockfile`、`pnpm.cmd db:generate`、`pnpm.cmd typecheck`、`pnpm.cmd test`、`pnpm.cmd build`。
3. 有 Docker 的机器执行 `docker compose up -d --build`。
4. 验证 `/health/live`、`/health/ready`、管理后台 `/admin/`、商城 H5 `/saidian-mall/` 和 V1/商城兼容只读快照。

当前开发机未安装 Docker CLI，因此容器运行时冒烟必须由 GitHub Actions 或装有 Docker 的验收机执行；不能用 TypeScript 构建结果替代容器验收。

## 生产准备

- Ubuntu 24.04 LTS，至少 4 核/8GB/200GB 加密 SSD。
- 防火墙仅开放 22/80/443；数据库、Redis 和管理后台容器不暴露宿主端口。
- 复制 `deploy/.env.production.example` 为 `/opt/saydianapp-server/deploy/.env.production`，权限 600。
- 值中若包含 shell 特殊字符，必须按 POSIX shell 规则转义；发布脚本会加载该文件。
- 默认通过 GHCR 只读凭据拉取私有运行镜像。若使用 `Export runtime images` 工作流导出的短期制品离线导入镜像，则设置 `PRIVATE_IMAGES_PRELOADED=true`；预检查和回滚会核对 API、Worker、Admin 三个精确版本都已存在于本机，不再访问私有仓库。
- 配置主机外置 `INTEGRATION_MASTER_KEY`、对象存储、所需第三方集成、加密 Restic 异地仓库和已固定的 SSH known_hosts。集成密钥通过总后台写入后不得回显。
- GitHub `production` Environment 必须启用人工审批。

### 与现有赛电网关共存

`49.232.231.131` 已由 `saidian-gateway-1` 占用 80/443，并承载商城及运营系统。部署 App 服务时：

- `.env.production` 设置 `USE_SHARED_GATEWAY=true`、`GATEWAY_NETWORK=saidian_default`。
- API 和后台只通过 Docker 外部网络暴露为 `saydianapp-api`、`saydianapp-admin`，不新增公网端口。
- `configure-shared-gateway.sh` 会先备份原网关配置，再依次增加 HTTP 证书挑战和 HTTPS 反向代理；每次写入后先执行 `nginx -t`，失败时自动恢复备份。
- 现有实例为 4 核/4GB/40GB，低于长期生产建议；Compose 已设置逐容器 CPU/内存上限。首次发布可以用于灰度，但健康数据和附件增长前必须扩容磁盘并评估升级到至少 8GB 内存。
- 对象存储使用独立私有 COS 存储桶和最小权限子用户；不得复用客服素材桶或主账号永久密钥。

### 服务器本地文件过渡模式

新 COS 凭据尚未就绪时，可设置 `LOCAL_OBJECT_STORAGE_ENABLED=true`，并将 `OBJECT_STORAGE_ENDPOINT` 指向 `http://minio:9000`、`OBJECT_STORAGE_FORCE_PATH_STYLE` 设为 `true`。发布脚本会启动仅接入 Compose 内网、没有宿主机端口的 MinIO，创建私有文件桶与 Restic 桶，并把数据保存在 `minio_data` 持久卷中。

该模式只用于过渡：文件和加密备份仍在同一台服务器，不能抵御整机或磁盘故障。必须监控 40GB 系统盘空间；COS 可用后用 S3 兼容工具校验并同步对象，再切换 endpoint。切换前不得删除本地卷。

## 镜像和发布

### 当前自动路径

1. 每次 main 源码 push 先运行 `CI`，完成真实 PostgreSQL/Redis、HTTP 契约、Compose 和三镜像构建验证。
2. 只有仓库变量 `AUTO_DEPLOY_ENABLED=true` 时，成功 CI 才调用 `Deploy production`；发布固定使用本次完整 Git SHA，不接受分支名或浮动 latest 标签。
3. 工作流构建并推送 API、Worker、Admin 三个 `sha-<40位提交号>` 私有 GHCR 镜像，再经专用 SSH forced-command receiver 传入短期 GITHUB_TOKEN 和经校验的 deploy 目录。
4. 服务器先备份 PostgreSQL、环境/Compose 和实际运行镜像 ID；发现待执行或失败的 Prisma migration 会停止，**不会自动变更数据库结构**。
5. 仅更新 API/Worker/Admin（Admin 镜像同时包含商城 H5），保留发布前 `MAINTENANCE_READ_ONLY`；不重启原商城、旧服务或共享基础设施。共享 Nginx 只执行配置检查和 reload。
6. 外网 `/health/ready` 的 `revision`、管理页面、三容器和维护值全部匹配才完成；失败时尝试恢复前一配置和镜像。
7. 首次接入、Secrets、主机指纹、停用和故障步骤见 [持续部署说明](continuous-deployment.md)。当前工作流不再使用旧文档中的 `dry_run/open_writes` 输入。

### 手工/离线回退路径

- `Release images` 与 `Export runtime images` 保留为受控手工/离线方案，不是当前 main 自动发布的正常路径。
- 无法使用 GHCR 临时身份时，可下载 1 天有效的导出制品，校验 SHA-256 并 `docker load`；只有三个精确版本均可 inspect 时才设置 `PRIVATE_IMAGES_PRELOADED=true`。
- 旧的 `preflight.sh`、`release.sh`、`rollback.sh` 属于人工维护工具。执行前必须对照当前 Compose、备份、目标 SHA 和维护状态；不得用它们绕开 CI、schema gate 或发布权限审批。
- 开放写入不是发布参数。登录、健康、关爱、旧订单、附件、双端 App 和外部集成全部验收后，另行审批修改维护状态。
- `database-backup` 可在本机生成自定义格式备份；只有 Restic 指向真实异地仓库并完成恢复演练后，才能称为异地容灾。

生产环境必须设置 `SEED_PREVIEW_CONTENT=false`。本地示例文章和示例协议不得进入正式数据库；正式协议须由审核后的迁移或后台发布流程写入。

## 回滚与恢复

- 发布健康检查失败会调用 `rollback.sh` 回到上一镜像标签并保持只读。
- 手工回滚：设置 `DEPLOY_ROOT` 后执行 `deploy/scripts/rollback.sh`。
- 每月至少执行一次 `restore-drill.sh /absolute/path/to/backup.dump`，记录恢复时间和目标数据计数。
- DNS 切换前降低 TTL；域名切换和旧服务停写属于单独生产变更，必须复核备份、迁移报告、回滚标签和窗口时间。

## 监控与告警

至少采集：`/health/ready` 可用率、5xx/429、P95 延迟、Outbox pending/dead-letter、数据库连接数、磁盘/WAL、最后成功备份时间、Restic 快照新鲜度。任何备份超过 26 小时或死信增加都应触发告警。
