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

## 官方依据

- [GitHub 官方镜像发布流程](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)：构建并推送仓库；本项目继续先验收原镜像再发布，部署不构建第二次。
