# 商城与伙伴平台一并提交 Git

用户要求把本次商城和伙伴平台修改一起提交 Git。待发布的本地提交为 `1fb134e66aedf7f98b1009545fa23f836adce740`（商城邀请注册、合作申请和个人资料）及 `d0f3d6697ad8f7e6c8564765062a0eb7879f0d73`（伙伴会员列表基础资料）。对应实现与本地浏览器验收见同日两份实施记录。

## 合并与边界

- 再次阅读 AGENTS、handoff、上述实施记录及远端健康大屏发布记录。status/remote/fetch 成功；工作分支干净，比最初基线多两个本地提交，远端 main 已新增 `90f7477df0c244e2498cc172c286596ffa0cc592`。
- 在独立工作树 `saydianserver-partner-flow-20261107` 合并当前远端 main，本地保留两个原始功能提交和远端健康大屏提交。合并前建立本地保护分支，不重置、强推、暂存或覆盖原主工作树。
- 商城路由白名单冲突采用两个功能并存：保留 `member-profile` 和 `health-screen-authorize` 及双方 API 白名单。接口说明冲突通过现有生成器重新生成，544 条 HTTP 路由均有说明。
- Start/Publish 脚本要求在 main 上工作；本轮保留现有隔离分支，执行相同的 fetch、基线核对、串行验证及显式文件检查。合并产生的既有远端文件不作为本轮额外开发。
- 本轮没有新增数据库结构、迁移、生产配置或供应商调用；远端已有健康大屏迁移及其审核记录完整保留。提交信息沿用 `[deploy cn only]`，不触发美国站发布。

## 检查与结果

完整命令输出保存于忽略目录 `artifacts/mall-partner-git-20261107/`。合并后串行执行：

- `pnpm install --offline --frozen-lockfile --ignore-scripts` 和 `pnpm db:generate` 成功；锁文件不变，未连接或迁移数据库。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check`、`pnpm tools:test`、普通和暂存区 `git diff --check` 全部退出 0。
- 根测试：API 1517、伙伴 86、商城 223、总后台 293、Worker 161、health-domain 28、contracts 90，其余套件通过；API 91 和 Worker 5 项专用数据库测试跳过，不记为实库验收。
- 工具/部署 59、H5 流程 62、H5 契约 38 项通过；本轮无新增失败。

原生 Git dry-run 因本机缺少 HTTPS 凭据失败，未写入远端。已连接的 GitHub 账号核验为仓库所有者，改用该连接上传已验证文件对象，生成一个同时包含两项功能的主线提交；完整 Git tree 必须与本地合并结果一致，再使用预期远端 SHA 和非强制更新推进 main。两个原始本地提交保留在原功能分支和保护分支，远端既有主线历史不变。

Git 发布与服务器部署分别核对，不把远端提交成功记成线上发布完成；Actions 和线上版本以后续实际回执为准。
