# 本地预发布、生产发布与回滚

## 本地预发布

1. 从 `.env.example` 复制 `.env` 并只填本地测试值。
2. 执行 `pnpm.cmd install --frozen-lockfile`、`pnpm.cmd db:generate`、`pnpm.cmd typecheck`、`pnpm.cmd test`、`pnpm.cmd build`。
3. 有 Docker 的机器执行 `docker compose up -d --build`。
4. 验证 `/health/live`、`/health/ready`、管理后台 `/admin/` 和 V1 登录/内容快照。

当前开发机未安装 Docker CLI，因此容器运行时冒烟必须由 GitHub Actions 或装有 Docker 的验收机执行；不能用 TypeScript 构建结果替代容器验收。

## 生产准备

- Ubuntu 24.04 LTS，至少 4 核/8GB/200GB 加密 SSD。
- 防火墙仅开放 22/80/443；数据库、Redis 和管理后台容器不暴露宿主端口。
- 复制 `deploy/.env.production.example` 为 `/opt/saydianapp-server/deploy/.env.production`，权限 600。
- 值中若包含 shell 特殊字符，必须按 POSIX shell 规则转义；发布脚本会加载该文件。
- 默认通过 GHCR 只读凭据拉取私有运行镜像。若使用 `Export runtime images` 工作流导出的短期制品离线导入镜像，则设置 `PRIVATE_IMAGES_PRELOADED=true`；预检查和回滚会核对 API、Worker、Admin 三个精确版本都已存在于本机，不再访问私有仓库。
- 配置对象存储、商城内部令牌、加密 Restic 异地仓库和已固定的 SSH known_hosts。
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

1. `Release images` 工作流构建 API、Worker、Admin 三个不可变标签，同时生成 provenance 与 SBOM。
2. 无法在生产机保存 GHCR 凭据时，运行 `Export runtime images`，在制品 1 天有效期内下载并校验 SHA-256，再执行 `docker load`；仅在三个版本标签均可由 `docker image inspect` 找到后设置 `PRIVATE_IMAGES_PRELOADED=true`。
3. `Deploy production` 首次必须保持 `dry_run=true`。
4. dry-run 通过后，以 `open_writes=false` 发布。脚本对已有数据库先备份；首次部署没有旧数据库时明确跳过空备份，再迁移并以只读方式启动和检查 HTTPS。
5. 完成登录、健康历史、关爱、旧订单、附件和后台审计冒烟后，第二次明确选择开放写入。
6. `database-backup` 每日生成自定义格式备份；PostgreSQL 持续归档 WAL；Restic 加密同步到异地仓库并执行保留策略。

生产环境必须设置 `SEED_PREVIEW_CONTENT=false`。本地示例文章和示例协议不得进入正式数据库；正式协议须由审核后的迁移或后台发布流程写入。

## 回滚与恢复

- 发布健康检查失败会调用 `rollback.sh` 回到上一镜像标签并保持只读。
- 手工回滚：设置 `DEPLOY_ROOT` 后执行 `deploy/scripts/rollback.sh`。
- 每月至少执行一次 `restore-drill.sh /absolute/path/to/backup.dump`，记录恢复时间和目标数据计数。
- DNS 切换前降低 TTL；域名切换和旧服务停写属于单独生产变更，必须复核备份、迁移报告、回滚标签和窗口时间。

## 监控与告警

至少采集：`/health/ready` 可用率、5xx/429、P95 延迟、Outbox pending/dead-letter、数据库连接数、磁盘/WAL、最后成功备份时间、Restic 快照新鲜度。任何备份超过 26 小时或死信增加都应触发告警。
