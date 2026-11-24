# 礼品兑换批量开启、换绑上线

用户明确要求上线 2026-11-23 已完成的按管理编号批量操作。实现范围与原验收见同目录 2026-11-23-gift-bulk-numbers.md。

## 发布准备

- 已阅读 AGENTS.md、handoff、最近健康记录/中文协议和本功能记录；执行 status、remote、fetch。远端 main 和双线上 readiness 均为 dccccf3f38e853878120e6bff978b3fe9f1713ca，原 CI 44861927012 成功。
- 原工作区有用户未提交文件，原功能在独立 codex 分支未提交。为使用仓库发布工具，创建独立共享对象克隆 E:/saydian-gift-release-20261124，跟踪相同 HTTPS origin，main 从最新 origin/main 开始。原工作区和旧 main 所在 worktree 不变。
- 干净 main 成功执行 tools/Start-Change.ps1；随后仅复制原功能14个明确文件。没有迁移、seed、维护/只读状态或兑换总开关变更。
- 补充真实 PostgreSQL 用例：跨批次粘贴去重开启及换绑并保留凭证；缺失/非未启用编号整批拒绝；重叠编号并发仅一次开启和逐卡审计。由现有 CI 的隔离 gift_test 数据库门禁执行，失败时自动部署不会运行。

## 检查、发布与待验收

通过 Publish-Change 显式列出本功能、生成文档、两份实施日志和数据库用例文件；工具按序重跑完整检查、fetch、提交和推送。仅发布中国站，提交包含 [deploy cn only]。正式结果另附，未将推送等同于已部署；不使用真实礼品卡做写入验收。

Publish-Change 的五项检查和差异检查均通过，提交阶段因新克隆没有仓库级 Git 作者配置失败，暂存区由工具保留。沿用原 E:/saydian h5 的 user.name/user.email 到本克隆，不修改全局配置。修复仅影响 Git 元数据和本日志，重新 fetch 核对基线、显式暂存文件及凭据检查后从提交步骤继续，不重复无源码变化的全量检查。

- 2026-11-24T02:45:20.5328821Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-11-24T02:48:19.1327235Z：pnpm.cmd tools:test，退出码 0。

- 2026-11-24T02:48:53.0075381Z：pnpm.cmd typecheck，退出码 0。

- 2026-11-24T02:50:51.6332917Z：pnpm.cmd test，退出码 0。

- 2026-11-24T02:51:29.9426090Z：pnpm.cmd build，退出码 0。
