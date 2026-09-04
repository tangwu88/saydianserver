# 安全更新、提交与自动部署

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

`main push → CI verify → SHA 镜像 → 受限 SSH 接收器 → 备份/检查 → 更新 API、Worker、Admin → 外网版本验收`

- 仅 `AUTO_DEPLOY_ENABLED=true` 时自动发布；默认关闭，先完成下方一次性接入。
- CI 包含真实 PostgreSQL/Redis、HTTP 兼容/权限测试、生产 Compose 校验和三镜像构建。本机无 Docker 不影响前置检查，但不能宣称本地容器已通过。
- 固定使用通过 CI 且仍是 main 最新提交的完整 SHA；旧的排队版本不会主动覆盖新 main。
- GitHub `production` 环境如设有审核规则，仍会等待审核；本流程不移除审批规则。
- 镜像私有保存于 GHCR。接收器用本次 Actions 的短期 GITHUB_TOKEN 拉取；不在服务器永久保存个人 Token。
- 服务器保存当前环境、Compose、运行中镜像 ID 和数据库备份后更新三项应用。不启动或重建商城、旧库或其他应用。
- 保持原有 MAINTENANCE_READ_ONLY；出现待执行/失败的数据库迁移时停止，不自动变更结构。
- API/公开 readiness 版本不符、启动或页面检查失败时尝试恢复上一版镜像与配置；日志会明确报告回退失败，不假报成功。不会自动覆盖数据库。
- 首次部署后 `/health/live`、`/health/ready` 的 `revision` 应等于 GitHub 提交号；仅显示 200 不足以证明新版已运行。

## 一次性接入（受控管理员执行）

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
- 数据库迁移待执行：保留维护状态，单独审查兼容性、备份和恢复点后实施；不能跳过迁移状态检查。
- 外部服务未配置：继续返回真实不可用状态，不能在发布中写入模拟短信、推送、支付或健康数据。
- 停用自动部署：将 AUTO_DEPLOY_ENABLED 设为 false；撤销服务器专用公钥和 GitHub Secret 需作为独立安全变更记录。
- 现有本机备份不等于异地容灾；定期做容量检查和恢复演练。本脚本不自动清理备份/镜像，清理前需确认精确范围。

## 官方依据

- [GitHub 可复用工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)：调用者需授予被调用 workflow 所需的权限，不能在嵌套调用中提升。
- [GHCR 身份验证](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)：仓库 Actions 可使用有包访问权限的 GITHUB_TOKEN。
