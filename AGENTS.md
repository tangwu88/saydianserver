# Saydian App 服务端工作约定

## 修改前

1. 阅读本文件、`docs/handoff.md` 与 `docs/implementation-log/` 中最近的记录。
2. 执行 `git status --short --branch`、`git remote -v`、`git fetch origin --prune`。
3. 仅在工作区干净、当前分支为 `main` 且可快进时执行 `git merge --ff-only origin/main`，记录本地与远端 SHA。存在未提交改动或分叉时保留改动，不覆盖、不强推。
4. 优先使用 `tools/Start-Change.ps1` 完成上述检查。不能联网时不能声称已更新。

## 修改、验证与提交

- Flutter App 契约优先，原小程序是 V1 兼容依据；只改本轮明确范围。
- 每轮在 `docs/implementation-log/` 记录原因、文件、命令、结果、失败与修复，以及未验收事项；日志随源码提交。
- 提交前运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、接口文档检查、部署脚本检查及 `git diff --check`。根级检查会生成共享 contracts，必须串行运行。
- `tools/Publish-Change.ps1` 只提交显式指定的文件，拒绝未包含实施日志的提交；提交前重新 fetch，远端变化时保留本地工作并停止。
- `main` 上源码提交通过 CI 后自动发布；必须核对 Actions 结果和线上版本，不把“已推送”写成“已部署”。

## 部署与业务边界

- 自动部署只更新本项目，不修改旧后台、共享商城、DNS、外部供应商或旧数据。
- 保持部署前的维护/只读状态；不能通过自动发布打开原本关闭的生产写入。
- 数据迁移、停写、开放写入、清理旧数据和不可逆数据库变更仍需独立验收。
- 不把生产密钥、SSH 私钥、Token、真实健康数据、构建产物或服务器备份提交 Git。
- 未接通的短信、AI、推送、商城内部调用保持未配置；接口存在、单测通过、真实联调通过是不同状态。
- 健康未知值不能补零；历史记录不能因聚合、分页或时区处理丢失；关爱查询必须逐指标校验授权。
