# 2026-09-02 腾讯云生产部署记录

## 目标与成功标准

- 目标实例：腾讯云轻量应用服务器 `49.232.231.131`，域名 `app.saydian.cn`。
- 不覆盖或中断现有商城、运营系统与网关。
- 新服务先只读启动，通过数据库、API、后台、HTTPS 和外网冒烟后再开放写入。
- 生产示例内容不入库；对象存储、备份和外部集成以真实配置状态为准。

## 修改前检查

| 检查                                                                 | 结果                                                                                                                               | 结论                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `git status --short --branch`、`git fetch origin --prune`、HEAD 对比 | `7f363c4` 与 `origin/main` 一致，工作区干净                                                                                        | 可安全开始本轮修改                                          |
| Google/Cloudflare 公共 DNS                                           | `app.saydian.cn` 均返回 `49.232.231.131`，TTL 600                                                                                  | DNS 已生效；本机代理的 `198.18.*` 仅是假 IP，不作为验收依据 |
| TCP 22/80/443 与 HTTP(S) 探测                                        | 三端口开放；现有 Nginx 把未知域名导向商城                                                                                          | 禁止新 Compose 直接绑定 80/443                              |
| 腾讯云实例                                                           | Ubuntu 24.04、4 核、3723MB 内存、40GB 系统盘；已用 19GB、可用约 20GB                                                               | 低于原定 8GB/200GB，必须限制资源并规划扩容                  |
| Docker                                                               | Docker 29.1.3、Compose 2.40.3、`ubuntu` 可免密 sudo                                                                                | 运行条件具备                                                |
| 现有业务                                                             | 网关、商城、运营系统、MySQL/PostgreSQL 等容器运行中；网关配置为 `/opt/saydian/config/gateway-nginx.conf`，网络为 `saidian_default` | 使用独立 Compose 并接入共享网络                             |
| 现有 COS                                                             | 仅发现客服素材桶 `saydian-kf-media-*`                                                                                              | 健康 App 不混用，需独立私有桶和最小权限凭据                 |

## 本轮修改

- 用户决定先把文件保存在服务器并运行服务。采用现有 S3 客户端兼容的内网 MinIO 过渡方案，不重写上传接口：文件桶和 Restic 桶均落到独立持久卷，MinIO 不开放宿主机端口；未来可按对象哈希同步到 COS 后切换 endpoint。
- 新增显式 `LOCAL_OBJECT_STORAGE_ENABLED` 开关、本地存储配置约束、私有桶初始化和启动顺序；同机 Restic 只作为临时恢复副本，不声明为异地容灾。备份服务在存储尚未就绪时每 10 秒重试初始化，避免服务器重启竞态导致当天备份被跳过。
- API/Admin 接入 `saidian_default` 外部网络并使用唯一别名，网关无需新增公网端口。
- 新增共享网关配置脚本和 HTTP/HTTPS 模板：修改前备份、配置测试失败自动恢复、证书使用现有 Webroot 续期体系。
- 为 PostgreSQL、Redis、API、Worker、Admin、Caddy 和备份容器设置资源上限，降低 4GB 宿主机 OOM 风险。
- 首次部署没有 App 数据库时不再执行必然失败的预备份；后续发布仍强制先备份。
- 商城内部令牌改为可选：适配器尚未在商城生产环境验收前保持“未配置”，不填假值。
- 生产 Seed 不再发布“本地预发布示例协议/文章”；对象存储和商城集成状态按真实必需配置计算。

## 测试、失败与修复

- 腾讯云最初连接到另一个 Chrome 配置，显示登录页；用户连接已登录的 `用户1` Chrome 后，改用该实例继续。
- OrcaTerm 首次单次 Enter 只输入未执行，两个命令曾被拼接；确认无服务器写入后，改为聚焦终端并双 Enter，后续只读命令结果可复核。
- 本机无 Docker CLI，Compose 运行时和真实网关验证必须在腾讯云执行；本地仍执行 YAML、Shell、TypeScript、测试和构建门禁。
- 首轮为缩短时间并行执行根级 typecheck/test/build，三个任务都会先生成共享 Contracts，导致 Build 写 `packages/contracts/dist/index.js` 时出现 Windows `EBUSY`；类型检查和 25 项测试本身已通过。停止并发写入后改为单独重跑 Build，不把文件锁误判为源码错误。
- 修复执行方式后，5 个包类型检查通过；API 18 项、Worker 2 项、Migrator 1 项、Contracts 3 项、Admin 1 项，共 25 项测试通过；全部服务与管理后台构建通过。
- Git Bash `bash -n` 验证 4 个部署脚本语法通过；Python/PyYAML 验证 Compose 和 3 个 GitHub Actions 工作流通过；Prettier 与 `git diff --check` 通过。
- 提交 `a0267c5` 的 CI 运行 `33620498282` 全部通过；随后触发不可变镜像版本 `2026.09.02-a0267c5`，运行 `33628980918` 的 API、Worker、Admin 三个镜像均发布成功。
- 已创建 `saydian-app-prod-1251011541`：北京地域、私有读写、单 AZ、SSE-COS 服务端加密，标签 `application=saydian-app`；未启用版本控制、图片处理或日志存储等额外计费功能。
- CAM 子用户 `saydian-app-server-cos` 已创建为仅编程访问，但验证码后的腾讯云流程误关联了 10 条预设策略，包含 `AdministratorAccess`、全资源和财务权限。发现后立即停止使用该账号，未把密钥写入服务器；等待明确确认后先解除全部现有策略，再关联仅限指定 COS 桶的自定义策略。
- 本地生成部署包 `D:\Temp\User\saydianapp-server-deploy-a0267c5.tgz`，SHA-256 为 `DCA75E1D423938D1EE14B1CC7BEA5EF282BA2FCDA7DEA78F06BA5C125AB11EBA`，内容仅含 `deploy/`。Chrome 扩展未开启本地文件 URL 访问，文件选择器未出现；服务器未收到文件，等待开启扩展文件权限后重试。
- 用户确认后已解除该 CAM 子用户的全部 10 条宽泛策略，并创建、关联唯一自定义策略 `SaydianAppProdCosBucketAccess`。复核结果为关联策略 1 条，不含管理员、全资源或财务权限；策略资源固定为北京桶 `saydian-app-prod-1251011541/*`，操作只含 API 文件读写/删除与 Restic 列举、地域查询和分片上传所需权限。
- 开启 Chrome 本地文件 URL 权限并重新连接后，OrcaTerm 远程文件管理器仍未触发文件选择器。为避免继续依赖浏览器本地文件传输，新增私有 `deploy` OCI 镜像，把版本对应的 `deploy/` 作为不可变制品发布；服务器将从已登录的 GHCR 拉取并通过 `docker cp` 安装，源码和密钥均不进入公开下载地址。
- 提交 `597d54a` 的 CI 运行 `33631809295` 通过：类型检查、25 项测试、构建、数据库迁移与脱敏种子、API 冒烟及容器构建全部成功。发布运行 `33632283887` 随后成功发布版本 `2026.09.02-597d54a` 的 API、Worker、Admin 和 Deploy 四个不可变镜像。
- 服务器执行 `docker pull ghcr.io/saydian88-cmyk/saydianapp-server-deploy:2026.09.02-597d54a` 返回 `denied`。原因是私有 GHCR 尚无只读登录凭据；未改成公开包，也未把现有高权限 GitHub 登录令牌写入服务器。
- Chrome 文件管理器在扩展权限开启后仍不能把文件选择框交给自动化接口。改用浏览器终端把只含 `deploy/` 的 5,080 字节归档分块编码传入 `/tmp`；本地与服务器 SHA-256 均为 `1A426F1CA4A7387918CC0BBCC4B233756A957E581F4A46CE64FB59EB19A181CE`。
- 写入前确认 `/opt/saydianapp-server` 不存在；随后将归档解压到该独立目录并把 5 个部署脚本设为可执行。现有 `/opt/saydian` 商城目录、容器和共享网关未修改。
- 服务器内生成 PostgreSQL、Redis、访问令牌、刷新令牌、后台初始密码及 Restic 随机密钥；生产配置与初始后台密码文件均为 `root:root`、权限 `600`，未在日志或聊天中输出具体值。
- `OBJECT_STORAGE_ACCESS_KEY`、`OBJECT_STORAGE_SECRET_KEY`、`BACKUP_S3_ACCESS_KEY`、`BACKUP_S3_SECRET_KEY` 保持空值；`preflight.sh` 因首个缺项 `OBJECT_STORAGE_ACCESS_KEY` 按预期退出。未误拉取运行镜像、未启动新服务、未改网关。
- 本轮仅更新部署事实记录；提交前执行 `git diff --check` 并复核仅该日志文件变更，不重复运行已由同一提交 CI 通过的源码测试。
- 服务器只读复核时，Compose 自身解析成功，但共享网络检查返回 `network saydian_default not found`。进一步读取网关真实网络确认名称为 `saidian_default`；这是部署配置中的拼写错误，服务尚未启动、网关尚未修改，因此没有生产影响。随后同步修正环境示例、Compose 默认值、预检查脚本和部署文档，并以服务器真实网络复测。
- 定向复测首次直接调用 `bash -n` 时因 PowerShell 的 PATH 中没有 `bash` 失败；改用 `C:\Program Files\Git\bin\bash.exe -n` 后脚本语法通过。首轮旧名称搜索也命中了本日志保留的真实失败文本，随后把回归搜索限定到实际配置与运行手册，不删除故障证据。
- 修正后 `bash -n deploy/scripts/preflight.sh`、PyYAML 解析 `compose.production.yaml`、Prettier、`git diff --check` 以及配置范围旧名称回归搜索全部通过。
- 本机 `gh` OAuth 令牌只有 `gist, read:org, repo`，向 GHCR 请求只读 Registry 令牌返回 401；它既不能拉包，也不应复制到服务器。新增 `Export runtime images` 手工工作流，在 GitHub Actions 内用仓库短期 `GITHUB_TOKEN` 拉取指定不可变版本的 API、Worker、Admin 镜像，合并为带 SHA-256 的 1 天短期制品。服务器通过单制品短期下载地址导入镜像，不保存 GitHub 凭据，也不把私有包改成公开。
- 新工作流经 PyYAML 解析、Prettier 和 `git diff --check` 验证通过；它只读 Packages，不含生产服务器或云存储凭据。
- 导出运行 `33634602373` 首次在 `docker pull "${images[@]}"` 失败，Docker CLI 的 `pull` 子命令一次只接受一个镜像参数；登录成功但没有上传制品。修复为逐个镜像拉取循环，服务器仍未接收或运行镜像。
- 循环修复经 PyYAML、Prettier 与 `git diff --check` 再次验证通过。
- 修复后的导出运行 `33634744903` 成功生成 1 天有效的私有制品 `runtime-images-2026.09.02-1036afa`。外层 ZIP 为 `299141869` 字节，内层镜像归档为 `299141320` 字节；本地与服务器 SHA-256 均为 `2FDA033A352F7CE278AD9EB5F3C7710D8F35D389DC4430088A3088BBE20B6E09`，服务器 `unzip -t` 与 `gzip -t` 均通过。
- 服务器单连接下载速度过低；首次 8 分片下载又因 GitHub 连接重置导致部分分片失败。核对每段预期字节范围后改为 24 个可重试分片，逐段尺寸、合并总尺寸、ZIP、Gzip 和 SHA-256 五层校验全部通过，再执行 `docker load`。
- 排查分片进程时，一条本地 PowerShell 插值命令误把 GitHub 制品的短期签名下载 URL 写入本地执行输出；该 URL 不含 GitHub 账号令牌且已过期。立即停止通过进程命令行检查下载状态，后续只记录分片字节数和文件哈希，不再输出签名 URL。
- `docker load` 已导入 `2026.09.02-1036afa` 的 API、Worker、Admin 三个镜像。随后用精确标签执行 `docker image inspect` 均返回 `loaded`；`saydianapp-production` 容器数量为 0，说明尚未启动 App 服务，磁盘为已用约 22/40GB、可用 17GB。
- 导入完成后复核发布脚本，发现 `release.sh` 和 `rollback.sh` 仍会强制 `compose pull api worker admin`；在无 GHCR 凭据的生产机上会重复失败，即使本地已有正确镜像。新增显式 `PRIVATE_IMAGES_PRELOADED` 模式及 `check-runtime-images.sh`：开启时必须精确找到 API、Worker、Admin 三个版本标签，发布与回滚均不再访问私有仓库；关闭时保持原 GHCR 拉取流程。
- 新脚本及发布、回滚、预检查脚本通过 Git Bash `bash -n`。模拟 Docker 输出验证“三镜像齐全”成功路径和“缺少 Worker 镜像”拒绝路径；文档 Prettier 与 `git diff --check` 通过。首次把无对应解析器的 `.env` 和 Shell 文件交给 Prettier 导致工具报错，改为 Shell 由 `bash -n` 验证、Markdown 由 Prettier 验证，没有修改源码来规避工具限制。
- 提交 `745bb2b` 已推送到 `origin/main`；CI 运行 `33638686903` 通过类型检查、25 项测试、构建、数据库迁移和脱敏 Seed、API 冒烟及全部容器构建。
- 从已提交版本生成仅含 `deploy/` 的 `D:\Temp\User\saydianapp-server-deploy-745bb2b.tgz`，大小 `5523` 字节，SHA-256 为 `0DEAAFDD5AE7E704F540487DE51275AC4FD415E9C4DF5020D95D6E063A3FC4D7`；服务器接收后的大小和哈希完全一致。
- 覆盖服务器部署脚本前，将原 `deploy/` 保存为 `/opt/saydianapp-server/deploy-backup-before-745bb2b.tar.gz`，归档为 `root:root`、权限 `600`。新脚本已安装并设为可执行，生产配置加入 `PRIVATE_IMAGES_PRELOADED=true`，配置文件仍为 `root:root`、权限 `600`；直接执行镜像检查确认三个版本标签都存在。
- 安装后的复核命令首次用普通用户读取权限为 `600` 的 `.env.production`，因此在最后一个 `grep` 返回 `Permission denied`；此前的备份、解压、配置写入和镜像检查均已成功。随后只用 `sudo grep` 读取非敏感开关并用 `sudo stat` 复核权限，不输出任何密钥值。
- 服务器只读预检查当前仅在 `OBJECT_STORAGE_ACCESS_KEY` 缺失处按预期退出，退出码为 1；`saydianapp-production` 容器仍为 0，未启动数据库、Redis、API、Worker、后台、备份任务，也未修改共享网关。
- 本地文件过渡方案提交 `d925973` 已推送；CI 运行 `33640886870` 通过新增的生产 Compose profile 校验、类型检查、25 项测试、构建、数据库迁移和脱敏 Seed、API 冒烟及全部容器构建。
- 从该提交生成仅含 `deploy/` 的部署包，大小 `6110` 字节，SHA-256 为 `2E49C7FD5280584BA04D1D3655E63DC14FC52A2729307EDE96AAFE62554D9C4A`。浏览器终端在分块传输期间连接超时，未获得服务器端最终大小或哈希，因此没有解压该包、写入本地存储凭据或启动服务；可能存在的 `/tmp` 临时分片必须在恢复连接后重新校验或覆盖。
- Chrome 扩展、浏览器和本地通信组件诊断均通过，但原已登录 `用户1` 会话不再响应标签页请求；按诊断流程新开 Chrome 配置后，OrcaTerm 显示登录二维码。当前阻塞是用户完成该终端登录，不是服务器代码、CI 或权限配置失败。
- 为寻找不依赖浏览器的安全连接方式，只读检查旧服务端信息文件。脱敏正则未覆盖“字段和值之间无冒号”的格式，导致其中已标注为旧服务器的历史凭据出现在本地命令输出；未尝试这些凭据，也未把它们写入代码、Git、新服务器或第三方。应在旧服务器仍可访问时轮换或停用，后续不再读取具体值。

## 2026-09-03 正式启动与故障收口

### 修改前更新与部署包

- 本轮源码修改前执行 `git status --short --branch`、`git fetch origin`、本地与远端 HEAD 对比；工作区干净，`75f039e` 与 `origin/main` 一致。
- 用户恢复 OrcaTerm 登录后重新传输 `D:\Temp\User\saydianapp-server-deploy-d925973.tgz`；服务器文件为 6,110 字节，SHA-256 与本地 `2E49C7FD5280584BA04D1D3655E63DC14FC52A2729307EDE96AAFE62554D9C4A` 一致。
- 覆盖前把服务器部署目录保存为 `/opt/saydianapp-server/deploy-backup-before-d925973.tar.gz`，权限 `600`；生产环境文件另存为 `.env.production.before-local-storage`，原文件及备份均保持 `root:root`、权限 `600`。
- 在服务器内部生成 MinIO 随机凭据并静默写入生产配置；开启 `LOCAL_OBJECT_STORAGE_ENABLED=true`、`PRIVATE_IMAGES_PRELOADED=true`、`MAINTENANCE_READ_ONLY=true`，文件桶和备份桶分别为 `saydian-app-private`、`saydian-app-backups`。未在终端、聊天或 Git 输出任何密钥。
- 安装后的 `DRY_RUN=true` 发布预检通过，确认三个私有运行镜像均已本地加载，且没有启动或修改服务。

### 首次发布发现的问题与修复

- 第一次正式发布已创建 MinIO 私有卷、两个私有桶、PostgreSQL/Redis 数据卷，但 Prisma 迁移返回 `P1000`。配置文件、容器环境和 URL 解码后的数据库用户、库名、密码逐项一致；容器内使用相同密码连接本机 PostgreSQL 返回 `SELECT 1`。
- 进一步从 API 容器查询 DNS，`postgres` 被解析为共享网络旧业务 PostgreSQL `172.18.0.5`，而本 App PostgreSQL 地址为 `172.20.0.3`。根因是 API 同时加入 App 私网和 `saidian_default`，通用服务名发生跨网络冲突，而不是数据库密码错误。
- 为 PostgreSQL、Redis 增加 `saydianapp-postgres`、`saydianapp-redis` 独立别名；生产 URL 改用独立别名，预检脚本拒绝通用主机名。修复后 Prisma 明确连接 `saydianapp-postgres:5432`，初始迁移成功；再次运行显示无待执行迁移。
- 网络隔离修复包 `D:\Temp\User\saydianapp-server-deploy-network-fix.tgz` 为 6,105 字节，SHA-256 为 `193726AA3CFAEE2A71EBDC65AE9E702DA2A8D9A4C00726EC10DA15667FFD120F`；服务器端大小和哈希一致。覆盖前保存 `/opt/saydianapp-server/deploy-backup-before-network-fix.tar.gz` 并设为权限 `600`。
- PostgreSQL 日志同时发现 WAL 归档卷权限不足。发布脚本现在先用一次性 root 容器把精确卷目录设为 `postgres:postgres`、权限 `700`，再以 `docker compose up -d --wait postgres redis` 等待健康后迁移。修复后 10 分钟日志中无 `Permission denied` 或归档失败。
- API 进程和 `/health/ready` 已正常返回，但 Docker 探针长期处于 `starting`；探针使用 `localhost` 时连接被拒绝，容器内访问 `127.0.0.1` 返回 `{"status":"ready","database":"ok"}`。生产探针改为 `127.0.0.1` 后 API、Worker、Admin 均变为 healthy。
- API 镜像原 CMD 调用 `prisma db seed`，项目未配置 Prisma 默认 seed 入口，命令成功但管理员数量为 0。服务器明确执行 `tsx prisma/seed.ts` 后得到 1 个启用管理员和 5 条集成状态；Dockerfile CMD 同步改为明确脚本，避免新环境静默跳过初始化。
- 只读模式真实登录测试最初返回 503。全局通配路由挂载后 `request.path` 被裁剪，例外规则无法识别后台登录；中间件改为优先使用 `request.originalUrl`，并新增“后台登录放行、普通写操作继续阻断”两项回归测试。
- 为在正式 CI 镜像发布前完成验收，服务器基于已校验 API 镜像构建了只包含上述中间件和 CMD 调整的本地热修复层，并重建 API/Worker/Admin。构建成功，但旧式 Docker Builder 把 `/tmp` 作为上下文发送了 1.258GB；数据只进入同机 Docker daemon，后续热修复必须使用空目录上下文，避免重复传输。

### 线上验收

- 完整发布脚本最终输出 `release 2026.09.02-1036afa deployed`。PostgreSQL、Redis、MinIO、API、Worker、Admin、数据库备份和 Restic 备份 8 个容器均运行；带健康探针的容器全部 healthy，服务器无 unhealthy 容器。
- `https://app.saydian.cn/health/live` 返回 `{"status":"ok","service":"saydianapp-server"}`，`/health/ready` 返回 `{"status":"ready","database":"ok"}`；管理后台 `/admin/` 返回 HTTP 200，HTTP 自动 301 跳转 HTTPS。
- Let's Encrypt 证书签发成功，主体为 `app.saydian.cn`，有效期从 2026-09-03 至 2026-12-02；共享 Nginx 配置测试通过并重载，原 `saidian-gateway-1` 继续运行。
- 浏览器实际打开线上后台，显示“Saydian赛电 / App 管理后台”的账号、密码和登录按钮。服务器内使用根目录保护的初始密码执行真实登录返回 201、Token 已生成，带 Token 请求仪表盘返回 200；整个过程未输出密码或 Token。
- 普通 App 登录写请求在维护模式返回 503，文案为“系统维护中，请稍后再试”；说明后台登录例外已恢复，同时生产写入仍未开放。
- MinIO 没有宿主机端口，两个私有桶均可通过内部凭据读取元数据；Restic 已创建仓库并完成首个约 64MiB 快照，策略为 14 个日备份、8 个周备份和 12 个月备份。数据库备份容器已生成迁移后的约 90KiB 自定义格式备份。
- 后台管理员和集成状态初始化后，手工执行 `deploy/scripts/backup.sh` 生成 `saydian-app-20260903T015924Z.dump` 及 SHA-256 文件，并追加 `post-deploy` Restic 快照；该快照处理 16 个文件、约 112MiB，确认当前可登录状态已进入服务器内备份。
- 系统盘 40GB、已用约 23GB、可用约 16GB；内存 3.6GiB、可用约 2.0GiB。当前满足受限资源配置，但仍低于原规划容量。

### 源码验证

- `bash -n deploy/scripts/release.sh deploy/scripts/preflight.sh` 通过；PyYAML 解析生产 Compose 通过；Prettier 和 `git diff --check` 通过。
- `pnpm typecheck` 通过全部 5 个工作包。
- `pnpm test` 通过 13 个测试文件、27 项测试，其中新增维护模式回归测试 2 项。
- `pnpm build` 通过 API、Worker、Migrator、Contracts 和管理后台构建；管理后台仍有既存的单包体积大于 500KiB 警告，不影响本次构建和部署。
- 修复提交 `535b45a` 已推送到 `origin/main`；CI 运行 `33705502647` 在 3 分 41 秒内通过生产 Compose 校验、类型检查、27 项测试、构建、数据库迁移与脱敏 Seed、API 冒烟和全部容器镜像构建。GitHub Actions 仅提示其官方 actions 仍声明 Node.js 20、由运行器强制改用 Node.js 24，不影响本次结果。
- 验证记录提交 `6a47c87` 同步到 `origin/main` 后，CI 运行 `33705799329` 再次通过同一完整门禁，耗时 3 分 31 秒。

## 当前未执行

- 生产服务当前保持 `MAINTENANCE_READ_ONLY=true`。旧数据库全量/增量迁移、数量与哈希报告、维护窗口和回滚点尚未验收，因此不得开放普通写入。
- 当前服务器 API 使用基于 `2026.09.02-1036afa` 的本地最小热修复层；源码和回归测试已补齐，仍需在本次 Git 提交 CI 通过后发布新的不可变 API 镜像，并在后续正常发布时替换本地层。
- MinIO 与 Restic 均落在同一台服务器，只是当前可运行的过渡存储，不是异地容灾。已创建的腾讯云 COS 私有桶尚缺新的可用 SecretKey；迁移到 COS 前不得删除 `saydianapp-production_minio_data` 卷。
- 尚未迁移旧账号、健康、关爱、通知、附件及旧订单投影；旧服务写入未暂停，域名切换也未进入最终迁移阶段。
- 商城内部令牌、短信、AI、极光/APNs 等外部集成仍保持未配置；不得伪造联调完成。
- 服务器 `/tmp` 仍可能保留运行镜像和部署分片等临时文件。本轮未做生产清理；删除前须另行列出精确路径、大小和保留项并确认范围。
