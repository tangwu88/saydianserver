# 2026-09-29 显式调用现有国际部署服务

## 原因和边界

- 用户要求本轮 AI 内容隐藏配置同步国内和国际后台。2026-09-29 现场只读确认国内 `3dab610c447ad2ce92e63b73ed65c3781580b46b` 已发布；国际公网仍为 `ef2f64323df46ddfe6ffeb415795429d3ed3e37e`，国际分支已到 `ed5052aefa10247fefe6fae0258b18e1a12c8816`。
- GitHub main CI 的部署已成功，`AUTO_DEPLOY_ENABLED=true`。原国际路径是主机上已安装的 `saydian-global-auto-deploy.timer`，历史证据见 `2026-09-10-global-member-admin-number.md` 和 `2026-09-12-order-close-promotion-center.md`。仓库没有国际 workflow，本机没有可用 SSH 身份。
- 历史记录未提供可信的国际服务配置文件路径。因此本次不猜测或读取磁盘配置：在服务器只读查询 timer 的 `Unit`，严格匹配预期 service 和 loaded 状态。两套运行配置仅通过 Compose 标签选定 API/Worker，再过滤维护/停写布尔字段。
- 不修改 receiver、service、timer、数据库、网关和维护状态；默认自动发布行为不变。国际失败不回滚本次已成功的国内发布。

## 文件和实现

- `.github/workflows/deploy-production.yml`：仅手动派发增加可选 `global_revision`。校验完整 SHA、国际分支最新值，再由独立 job 检验线上版本祖先关系、数据库 schema/migrations 无变化，以及固定 SHA 的接口目录、工具、类型、单测、构建、国际部署结构。发布前再次校验分支，才写入受审 `.global-revision` marker。
- `deploy/scripts/deploy-ci.sh`：严格验证 marker，并在国内发布完成、回滚 traps 取消后调用国际助手。与迁移/仅安装包模式互斥。
- `deploy/scripts/trigger-global-deploy.sh`：只触发已安装服务；输出白名单 systemctl 状态与退出码。运行前后比较国内 revision 和双方 API/Worker 的维护/停写状态。内部至多等待 14 分钟，外层助手执行上限 15 分钟；超时不终止既有部署服务。服务成功也必须核对国际公网完整 SHA。
- `tools/global-deployment.test.mjs` 与 `tools/tooling.test.mjs`：隔离命令假件覆盖错误目标、分支变化、不重复启动、版本校验、失败保持、维护模式变更和不输出凭据。

## 验证与尚未验收

- `node --test tools/global-deployment.test.mjs`：8/8 独立脚本/工作流契约测试通过，含真实 Bash 解析和隔离命令假件；未调用真实服务器。
- 增补外层 15 分钟超时和 start-limit-hit 处理后，再次运行上述 8 项全部通过；Prettier YAML parser 解析工作流成功，`git diff --check` 通过。
- 本机未运行真实 systemctl、Docker、服务器服务或发布工作流；不能从脚本测试推断国际部署已恢复。
- 原国际 runner 的安装内容、失败原因、备份和内部回滚未能现场读取。助手复用既有服务，不修改其实现；若服务失败，仅报告其白名单结果，后续需受控服务器诊断。
- 全仓库串行检查和正式发布由本轮主代理统一执行，避免并发生成 contracts。
