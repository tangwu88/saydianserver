# U19 发布原镜像下载恢复

2026-11-10。只优化人工恢复时的原文件下载，不更改应用镜像或会员/设备配置。

- 从独立 worktree 的干净 main 执行 Start-Change.ps1，fetch/ff-only 至591b23331d108ca317aee0637e4d0d6c4c2a7dd9，再建立codex/u19-artifact-transfer-20261110；原U19工作区保留。
- 生产591b233的原verify已成功；普通GHCR拉取、8路HTTPS及SSH分片接收持续偏慢。8路HTTPS任务42765670200由本轮明确停止，约55MiB；SSH任务42766805026在约11分钟后仅确认首个8MiB分片，已取消，终端确认receiver退出。以上均在应用切换前，readiness仍f48866b，未清数据、未删锁或重启应用。
- 仅把runtime-artifact.mjs的固定并发窗从8提升到最多32；单片1MiB、每片重试4次、总时限、可信下载域、令牌不转发到下载域、完整GitHub摘要、ZIP条目/原清单/归档SHA、磁盘余量、OCI镜像ID和发布flock全部保留。
- 新增40MiB异步网络夹具，校验真实重叠数大于8且不超过32、全部40片恰读一次、完整摘要匹配和只清本轮临时文件。先在旧实现失败（实际峰值8），再修改；全部Node下载11项与Python ZIP验证3项通过。
- 仅将恢复工具候选推到独立分支用于现有人工workflow_dispatch，原目标仍591b233、原verify run42763675021、原artifact13738683508；不合并main，不重建/重标应用镜像，不绕过最新main检查。恢复任务与生产切换结果按实际追加。
- 新worktree离线依赖安装成功；生成Prisma客户端、完整typecheck/test/build和接口文档核对均退出0，部署工具/H5及diff检查继续完成后才提交。无本机数据库的用例仍按原规则跳过，不把它写成新实库验收。

最终本机验证：Prisma生成、pnpm typecheck、TMPDIR=/private/tmp pnpm test、pnpm build、pnpm api:docs:check、pnpm tools:test、git diff --check依次退出0。API154文件1548通过，93数据库用例按原规则跳过。Node下载11项、Python归档3项通过。未更改运行应用源码、数据库、正式配置或main。
