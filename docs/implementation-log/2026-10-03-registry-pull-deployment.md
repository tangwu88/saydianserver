# 日常自动发布固定直拉镜像 — 2026-10-03

## 范围与基线

- 用户指出镜像传输部署太慢，并明确授权选用更优方案，不再受旧确认约束。本轮只修改发布路径；不改账号、数据库、业务开关、供应商、网关路由或新建付费云资源。
- 修改前检查干净工作区、remote 并 fetch；main 为 `53a2bded2acf601d3e0461e93e354ae10ab3d6c1`。新 worktree 创建遇到本机磁盘不足，Git 已自动清除不完整目录；改在原干净工作区切换独立 `codex/registry-pull-20261003` 分支，HEAD 与 origin/main 一致，保留其他工作区。
- 只删除本任务临时下载分块 `/private/tmp/saydian-d350-original-images-20261003.HauKfW/parallel-parts`（约 374 MiB），此前确认没有打开的文件，完整下载 ZIP 通过 CRC 校验并保留，已解压校验产物也保留。没有清理 App、源码、签名或服务器业务数据。

## 现象与选择

- CI `37132383753` 的测试及构建成功，但自动部署持续停在 SSH 离线预装；线上 API/Worker/Admin 仍为 `36197ef7e3b17a2ddbe91d8679280f4e7d4ba8d2`。
- 仓库变量实际为 `PRODUCTION_IMAGE_TRANSPORT=ssh`，与文档部分直拉描述冲突。服务器网络探针对 GHCR 返回 401（正常未认证挑战），镜像文件域名返回 400，GitHub API 返回 200，响应约 0.4–0.7 秒；不是完整镜像下载证明。
- 不新建镜像服务或复制凭据，复用现有 GHCR、短期 job token 和受限 SSH receiver。固定采用 GitHub 测试/构建/验收一次，服务器按原 digest 拉取分层镜像；不使用每次全量导出和分块传输作为默认流程。
- 已把旧变量改为 ghcr，仅在本次仍处于预装、生产未切换时取消自己发起的慢传输。首次 lslocks 过滤没有输出，但实际锁探测仍返回冲突；不把空输出当作锁已释放。
- 标准部署重试 `37134577995` 使用同一 53a2bde 清单及已构建镜像，`first_cutover=false`、`offline_images=false`；未重新构建、未另启并行发布。另一个纯导出任务 `37134190596` 已成功且 upload_to_server=false，不执行服务器更新。
- 该首次重试被共享锁安全拒绝，未更新服务。确认锁属于取消任务的 53a2bde receiver；精确归档接收子进程 head 的父 PID、fd 1 的本次 ci-stage bundle 路径和父进程 fd 9 的实际锁路径全部匹配，归档尚未收完，部署未执行。只向该已核实子进程发送 TERM，保留归档证据，不删除锁或终止其他任务。

## 代码与验证边界

- 删除日常部署里的 Docker 初始化、归档导出和 SSH 镜像预装步骤；删除 transport 分支和环境变量。SSH 仍发送不超过既有 10 MiB 门槛的发布配置及短期认证，不传三个运行镜像。
- `offline_images` 仅限显式 workflow_dispatch；保留人工导出工具作为同产物灾备恢复，不能由仓库变量自动开启。
- 受限 receiver 的单个配置归档接收加 10 分钟硬上限，保留既有 10 MiB 大小校验；发送方断开不能无限占锁。脚本更新需要校验备份、语法和 SHA 后覆盖已有安装文件，不能仅提交源码就称服务器已更新。
- 保留共享锁、最新 main 检查、digest 验证、磁盘门槛、已审兼容迁移、原业务暂停状态和镜像回退。服务器镜像拉取预算仍为 60 分钟。
- 更新回归测试及三份操作文档，防止重新混入自动预装；没有新增依赖或重复部署脚本。
- 精确残留接收进程结束后，实际 flock 探测返回 0；再次标准重试 `37134846972` 已进入 API 原 digest 的 docker pull。此前没有切换生产服务，不用 lslocks 空输出代替实际锁探测。
- 串行 `pnpm api:docs:check`（374 条）、`TMPDIR=/private/tmp pnpm tools:test`（36 + 61 + 38）、`pnpm typecheck`、`TMPDIR=/private/tmp pnpm test`、`pnpm build`、`node deploy/global/check.mjs`（12）及 `git diff --check` 全部通过。部署测试覆盖拉取失败/提交过期不切换、迁移失败不重启、启动失败镜像回退等；全量 API 的数据库专项仍需 Linux CI 实库验证。
- 接收器 `bash -n` 通过，本轮 SHA-256 为 `30cdba4b3e8084edd6029bc3acce59da60d169c9b48cdd8be98f118940e1a402`。完整检查启动时 Corepack 自动补齐既有指定 pnpm 11.19.0，未变更依赖锁。构建保留原有 Sass/chunk 警告，不修改无关前端。
- PR CI、接收器安装、直拉实际完成及线上 revision 尚待验证。网络连通、提交或 CI 构建成功都不能写成发布完成。

## 2026-10-04：实际吞吐与无新增权限探针

- PR 22 的原提交 `4c6178a` 已通过 CI `37135033793`，包括实库 HTTP 和三个运行镜像验收；尚未合入 main。后续探针改动需要重新验证，不能复用旧绿灯作为新代码验收。
- 直拉重试 `37134846972` 在实际 API blob 下载中吞吐不足；连接延时不能代表镜像可完成。该任务已取消，生产仍为 `36197ef`。核对取消任务的准确 PID、父进程、fd 9 锁路径、目标 digest 及生产旧 revision 后，仅停止该预拉取子进程，没有切换服务或删除锁。
- 腾讯云现有账号尚未启用 TCR，入口要求新增 `TCR_QCSRole` / `QcloudAccessForTCRRole`，含 COS 对象写删能力。用户明确“暂不新增云权限”；已取消授权，没有创建角色、权限、仓库实例、凭据或付费资源。
- 在原人工导出 workflow 增加显式 HTTPS 小样本探针：复用已导出的原 53a2bde 产物和现有 Actions 只读短期 token，SSH 仅送小诊断配置。服务器在隔离只读、无宿主 Docker socket 的临时容器内并行下载 8 个 1 MiB 范围；不导入镜像、不改应用或业务数据。
- 探针复用生产并发组和实际共享锁；验证原 CI、main、发布清单、产物名称/有效期/哈希格式、HTTPS 存储域名、精确范围和大小。GitHub token 不转发给签名下载 URL，输出只含样本吞吐与样本哈希，不能冒充全文件校验或部署成功。
- 新增无网络单测覆盖异常元数据、过期、错误哈希、恶意重定向、凭据转发、错误范围、过小/过大响应及请求取消。实际吞吐、全量下载和部署仍未验收；不因探针存在自动切换到归档路径。
- 新探针修改后，串行接口文档检查（374）、工具测试（44 + 61 + 38）、类型、全量测试、构建、global 部署检查（12）和 `git diff --check` 均退出 0；保留既有 Sass/chunk 警告。共享锁实际探测为 0，三个生产容器均运行原 revision；根盘可用 26 GB。未安装本轮新版 root receiver。
- HTTPS 探针 `37136424766` 成功：8,388,608 字节 / 55.087 秒，0.145 MiB/s，imported=false。没有使用这个样本哈希替代完整 ZIP 校验；约 349 MiB 归档按此速率估算仍需约 40 分钟，因此不设为日常自动默认。
- 只读检查现有 API：dist 约 2,940 KiB，node_modules 452,476 KiB。原 Dockerfile 整包 COPY 让代码与依赖处于同一层；改为独立依赖、package.json、Prisma 与 dist 层，Worker 同理。三个镜像使用各自 GitHub Actions cache v2 scope，现有 job token 自动认证，不加 Secret/IAM；缓存导出失败不作为镜像验收成功依据。
- 拆层后的实际镜像启动、缓存命中及两次发布之间增量字节仍需 CI 和上线验证；不承诺镜像总大小已变小，不额外构建同一提交的第二套生产镜像。
- 拆层修改后的本地全量检查均通过。新增手工 HTTPS 恢复模式，与探针共用下载模块和短 SSH 入口；8 路 bounded Range、每范围更新短期签名 URL、60 分钟下载总上限。整 ZIP 大小/哈希、精确三文件 allowlist、原清单逐字节、内层 gzip 哈希通过后，复用已演练的离线分块导入器，验证每块和三个 OCI ID/revision；不启动应用、不改数据库。
- HTTPS 恢复保留 5 GiB 余量及原清单磁盘门槛，不将 Token 发给 CDN 或落盘，不下载或运行外来脚本。Python 初测发现本机版本没有 hashlib.file_digest，改为兼容的流式 SHA-256；暂存 ZIP 的提取限制支持 GitHub level-0 DEFLATE，不按任意 ZIP 路径解压。完整生产下载/导入仍未验收。
- 恢复流程发现三个原 OCI ID/revision 已存在时直接复核后退出，避免重复下载。下载容器最多 55 分钟，为 60 分钟 Actions job 留出归档校验与导入时间；成功后只删除本次生成的下载副本，保留清单和导入证据，失败不操作生产服务。
- 最新串行本地接口文档、工具（46 + 61 + 38）、Python ZIP 检查（3）、类型、全量测试、构建、global 检查（12）均通过；API 实库专项本地 7 项跳过，交由 CI 验证。新版 Docker/恢复脚本的 PR CI 与完整服务器流程仍待验收。

## 官方依据

- [GitHub 官方镜像发布流程](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)：构建并推送仓库；本项目继续先验收原镜像再发布，部署不构建第二次。
- [Docker 官方 GHA 缓存](https://docs.docker.com/build/cache/backends/gha/)：每个镜像独立 scope，复用 Actions 自带认证；这里只优化现有三次构建，不新增仓库或云权限。
