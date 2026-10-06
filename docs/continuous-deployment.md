# 安全更新、提交与自动部署

> 当前执行 [统一生产手册](unified-production.md)。下文独立 tag 构建、旧部署参数及 package-only 入口仅作历史参考，不再用于新发布。

## 当前启用状态

- 2026-09-06 已在 `tangwu88/saydianserver` 配置 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS` 和 `AUTO_DEPLOY_ENABLED=true`；文档只记录名称，不记录值。
- 受限 SSH receiver 已安装，`status` 返回线上完整 revision；普通 shell 命令被拒绝。
- [生产部署 34006385576](https://github.com/tangwu88/saydianserver/actions/runs/34006385576) 已成功。接手时仍须查看最新 run 与 `/health/ready`，不要复用历史结论。
- GitHub `production` Environment 当前没有 required reviewers。若要增加审批规则，应作为独立权限变更处理。

## 使用方式

每轮修改前，从仓库根目录执行：

```powershell
pwsh -NoProfile -File tools/Start-Change.ps1
```

脚本检查 main、仓库地址、暂存区，fetch 后仅在干净工作区做 fast-forward。遇到他人改动或分叉会停止，不覆盖、不强推。继续本轮尚未提交的工作时，审阅归属后使用 `-Resume`；仅当本地 HEAD 与远端一致才建立检查点。

修改后，显式列出本轮源码和日志文件：

```powershell
& ./tools/Publish-Change.ps1 -Files @(
  'apps/api/src/本轮修改文件.ts',
  'docs/implementation-log/本轮记录.md'
) -Message 'fix: describe the verified change'
```

示例路径必须替换为实际文件。脚本不扫描并提交全部工作区：先检查接口文档、工具测试、类型、测试、构建，再重新 fetch；远端改变会停止。通过后才暂存显式文件、提交并推送 main。构建命令串行运行，结果追加到指定日志。当前脚本面向新增/修改文件；删除文件需单独审阅和显式 `git add -- 路径`，不得使用广泛的 `git add .`。

## 发布链路

### 组件复用与重试加速

CI 对 API、Worker、Admin 各自的构建输入计算指纹。受信任 main 发布可复用此前通过真实镜像验收的同指纹文件层，仅更新当前发布版本标签；锁文件、共享契约、schema 或构建规则变化会使相关缓存失效。PR 始终普通构建，缓存不存在或校验失败也普通构建，完整质量检查和三镜像验收均保留。

API/Worker 的生产依赖打包、共享包构建与 Prisma 客户端生成放在独立 dependencies 阶段，业务源码随后编译。运行镜像从 dependencies 复制 node_modules，从 build 复制 dist；只改业务源码时不重新生成整层依赖，依赖、契约或 schema 变化仍重新构建对应阶段。

服务器重试发布时，对完整匹配发布清单 digest/imageId 的本地镜像跳过远端拉取，继续检查版本标签和健康状态。日志报告每个镜像的拉取/验证耗时；没有关闭备份、只读保持、迁移门禁或回滚。首次发布需建立缓存，实际耗时必须以 Actions 和线上验收计量。当前未接入国内镜像仓库。

Windows 本地部署夹具需要 Git Bash 和 jq；便携 jq 可通过 `SAYDIAN_JQ` 指向已验证的本地二进制，`SAYDIAN_BASH` 可指定 Git Bash。仅测试夹具模拟 Windows 不支持的 Linux 权限/目录同步操作，生产脚本不因此跳过这些操作。

`main push → CI verify → GHCR digest 镜像 → 短 SSH 发布指令 → 服务器拉取镜像 → 备份/检查 → 更新 API、Worker、Admin+商城 H5 → 外网版本验收`

- 仅 `AUTO_DEPLOY_ENABLED=true` 时自动发布；当前仓库已开启。新环境或密钥轮换时重新执行下方一次性接入。
- CI 包含真实 PostgreSQL/Redis、HTTP 兼容/权限测试、生产 Compose 校验和三镜像构建。本机无 Docker 不影响前置检查，但不能宣称本地容器已通过。
- 固定使用通过 CI 且仍是 main 最新提交的完整 SHA；旧的排队版本不会主动覆盖新 main。
- GitHub `production` 环境如设有审核规则，仍会等待审核；本流程不移除审批规则。
- 镜像私有保存于 GHCR。接收器用本次 Actions 的短期 GITHUB_TOKEN 拉取；不在服务器永久保存个人 Token。
- 日常发布不通过 SSH 发送镜像归档，旧 transport 变量不再选择该路径。只在人工灾备恢复时导出同一批原始镜像；详细门禁见统一生产手册。
- 服务器保存当前环境、Compose、运行中镜像 ID 和数据库备份后更新三项应用；商城 H5 已打入 Admin 镜像并发布到 `/saidian-mall/`。不启动或重建原商城、旧库或其他应用。
- 保持原有 MAINTENANCE_READ_ONLY；发布清单中没有通过精确 SQL SHA-256 审核的待执行迁移会在变更服务和结构前停止。
- 已独立审查并登记在 `deploy/compatible-migrations.json` 的兼容迁移，会在目标 main SHA 通过 CI、校验生产迁移历史与磁盘空间并生成生产备份后执行；SQL 内容变化会使摘要失配并停止发布。失败迁移不会启动新应用镜像。
- API/公开 readiness 版本不符、启动或页面检查失败时尝试恢复上一版镜像与配置；日志会明确报告回退失败，不假报成功。不会自动覆盖数据库。
- 首次部署后 `/health/live`、`/health/ready` 的 `revision` 应等于 GitHub 提交号；仅显示 200 不足以证明新版已运行。

## 一次性接入或密钥轮换（受控管理员执行）

1. 为本仓库生成独立 ed25519 密钥，私钥存放在 Git 工作区外，不复用个人 SSH 密钥。不要把任何私钥粘贴到日志或提交 Git。
2. 通过已认证的服务器连接上传本仓库 `deploy/scripts/ci-receiver.sh`、`install-ci-receiver.sh` 和公钥（不是私钥），检查内容/SHA 后执行：

   ```bash
   sudo bash install-ci-receiver.sh ci-receiver.sh deploy-key.pub
   ```

3. 安装器建立 `saydianapp-deploy` 专用账号，强制 SSH command，不加入 docker/sudo 组，禁止 SSH 转发；只允许 receiver 的 `status`/`release SHA`。它确实具备部署 root/Docker 服务的能力，持有此密钥和仓库发布权限应视为生产访问权限，而不是普通只读权限。
4. 从已认证服务器读取 `/etc/ssh/ssh_host_ed25519_key.pub` 或 fingerprint，与 SSH 客户端捕获的主机密钥比对。不能只用未经核对的 ssh-keyscan 自动信任主机。
5. 在 GitHub Secrets 配置 `DEPLOY_HOST`（本项目服务器）、`DEPLOY_USER`（专用账号）、`DEPLOY_SSH_KEY`（专用私钥）、`DEPLOY_KNOWN_HOSTS`（已核对的主机记录）。不得启用 StrictHostKeyChecking=no。
6. 验证 SSH `status` 成功、任意 shell 命令被拒绝；核对 `production` 环境规则及 GHCR 仓库读写权限，再将仓库变量 `AUTO_DEPLOY_ENABLED` 设为 `true`。
7. 推送/运行当前 main 的 CI，检查所有 job 成功、线上 revision、Admin 页面、API/Worker 状态和维护值。本轮实际接入结果只写实施日志，文档存在不代表已启用。

接收器固定操作 `/opt/saydianapp-server`；共享网关按现有配置只执行 Nginx 配置检查及 reload，以更新容器 DNS。不改网关路由、不开放新端口、不修改旧域名。安装脚本只管理本项目专用账号与 receiver，不变更已有 ubuntu/root 的登录方式。

## 失败与回退

- CI 失败：不发布；读失败步骤和本轮日志，先安全更新再修复。
- 服务器发布失败：保留 `releases/rollback-*` 和 `deploy/backups/saydian-ci-*.dump`，核对是否已自动恢复，再决定重试；不要删除失败证据。
- 数据库迁移待执行：先单独审查锁表、数据兼容性、精确 SQL 摘要、备份和恢复点；通过后才登记兼容清单并发布，不能跳过迁移状态检查。
- 外部服务未配置：继续返回真实不可用状态，不能在发布中写入模拟短信、推送、支付或健康数据。
- 停用自动部署：将 AUTO_DEPLOY_ENABLED 设为 false；撤销服务器专用公钥和 GitHub Secret 需作为独立安全变更记录。
- 现有本机备份不等于异地容灾；定期做容量检查和恢复演练。本脚本不自动清理备份/镜像，清理前需确认精确范围。

## 官方依据

- [GitHub 可复用工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)：调用者需授予被调用 workflow 所需的权限，不能在嵌套调用中提升。
- [GHCR 身份验证](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)：仓库 Actions 可使用有包访问权限的 GITHUB_TOKEN。
