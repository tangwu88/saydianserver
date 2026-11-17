# 2026-11-17：经会员确认撤销未执行的账号注销

## 原因与范围

中文版 Android 的微信分身授权成功，服务端正确以 `409 account_unavailable` 拒绝注销中的账号。会员明确选择“取消注销并恢复登录”。原后台没有撤销入口，不能仅修改 User.status 留下删除任务。本次添加通用、仅超级管理员可执行的撤销入口；只对另存于受控本地诊断目录的指定申请执行经确认的恢复，不在仓库记录会员标识、手机号、授权码或凭证。

基线 origin/main 与线上根路径及 /global readiness 均为 `8e395c6c9e1e85c2d3319bd2845d3b6642d4432b`。原工作区均保留，创建干净 worktree / 分支 `codex/cn-account-deletion-cancel-20261117`。Start/Publish-Change 工具强制 main，而 main 被另一历史工作区占用，故采用独立 worktree、同等命令门禁、显式文件提交及发布前再次 fetch 的快进推送，不改动其他工作区、不强推。

## 实现

- `account-deletion-cancellation.ts`：严格确认会员、任务时间、confirm 和原因；超级管理员双重鉴权。事务先锁 User，再锁该会员全部注销任务；仅 DELETION_PENDING + REQUESTED 可以恢复，拒绝 PROCESSING/FAILED/COMPLETED、DISABLED/DELETED 及过期确认。
- 同事务 CAS 取消所有重复排队任务、恢复 ACTIVE、写结构化审计；任一步失败整体回滚。相同撤销可幂等重试，旧 CANCELLED 任务不能撤销后续新申请。
- 不修改健康记录、资料、微信绑定、验证状态、密码或同意记录；原会话保持撤销、推送安装保持停用，须通过正常登录重新创建会话。
- 管理后台注销任务表增加有原因确认的撤销按钮，防止跨后台会话或页面卸载后继续写入。接口及字段契约同步生成。
- 无 schema 迁移：已有 CANCELLED 枚举。注销 worker 的 REQUESTED→PROCESSING CAS 在撤销持锁后将失败，worker 先取得任务则拒绝恢复。

## 验证记录

- `pnpm install --offline --frozen-lockfile`：成功，905 包，零下载；`pnpm db:generate`：成功。
- 新增18项单测：成功，包括任务/用户状态、重复任务、越权、过期确认、worker CAS、审计回滚、幂等及后续注销保护。
- `pnpm typecheck`：成功；`pnpm test`：成功，API 1637 passed / 101 skipped（含新增3项 PostgreSQL 集成测试在本地无数据库而跳过）；`pnpm build`：成功。
- `pnpm api:docs` / `pnpm api:docs:check`：603条路由；成功。
- `pnpm tools:test` 第一次失败：Windows Bash fixture 临时路径包含空格，另缺少 Bash PATH。使用物理无空格临时目录及 Git Bash PATH 后重试，注册表测试通过，部署 fixture 仍因缺少 jq 失败（环境限制，未改动部署脚本或测试以绕过）。下载官方 jq 的独立尝试分别遇到匿名 API 限流和代理 TLS EOF，未安装未校验的二进制。
- `python -B deploy/scripts/verify-runtime-artifact.test.py`、`python -B deploy/scripts/measure-image-layers.test.py`：成功。H5 flows / contracts 独立执行，结果在后续发布验收补记。
- 新增3项真实 PostgreSQL 验证：保留微信/健康/会话/推送、worker 两种竞争顺序、审计失败原子回滚；加入原 CI PostgreSQL job，等待 Linux CI 实际执行。CI verify 成功前不发布到线上。
- 只读检查失败记录：曾尝试不存在的 deploy.yml、vitest.config.ts、shell-test-helpers.mjs；改读实际文件，不影响实现。没有数据库管理权限或直接 SQL 生产改写。

## 发布验收待办

提交前再次 fetch、diff --check；CI 各门禁及 PostgreSQL 集成测试；中国线上 readiness 新 SHA；仅指定申请执行取消及审计核验，比较恢复前后健康记录/设备总数；用微信分身重新授权验证正常登录。正式手机包恢复普通构建，移除临时诊断输出。美国部署保持跳过（提交标注 `[deploy cn only]`）。
