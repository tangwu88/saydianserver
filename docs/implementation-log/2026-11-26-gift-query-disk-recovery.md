# 查询功能上线：磁盘余量恢复操作分支

功能PR #73（036ee8f）完成CI 45735996459验收，squash到中国站main be3b56a7445cf100841dc5e277213c714c7daa58；核对两棵源码树完全相同。主线CI 45737095759的verify成功，美国站跳过；生产receiver于01:53:24Z因空间门槛失败，要求7,324,057,617字节（含5GiB保留）。未进入迁移、备份或应用切换，原版本仍f8652f9。

用户已授权上线，进行必需的镜像容量恢复。原feature工作区干净，从同一origin/main建立codex/gift-query-release-ops-20261126，只用于运维，不合并main、不重建已验收镜像。已读AGENTS/handoff及本轮发布记录，Start-Change仍因非main分支限制不适用，按等价显式暂存、串行检查和fetch核对执行。

操作workflow只复用受限receiver及现有生产Secrets，锁与普通发布相同；严格固定目标main、成功verify run、原运行版本与精确清理计划。审计只输出项目镜像元数据、所有容器引用和可用空间。清理只接受现场审计后明确列出的1至9个完整镜像ID，每张删除前重查所有运行/停止容器引用，保留每组件最新两个未引用备用镜像，保留7天内镜像，排除外部仓库或混合引用。使用无force的docker image rm，Docker自身继续防止并发引用冲突；不删容器、卷、备份、业务文件，不prune，不降低空间门槛；恢复目标达到后立即停止。

新增定向测试覆盖引用保护、备用保留、仓库/时间范围、审计无删除、清理计划校验、删除前重查和达到余量即停止。实际审计、候选ID复核、释放空间与同SHA重试结果后记在Git外artifacts/gift-query-release。

- 2026-11-26T02:01:57.2547476Z pnpm api:docs:check exit=0

- 2026-11-26T02:05:09.3178956Z pnpm tools:test exit=0

- 2026-11-26T02:05:47.7804735Z pnpm typecheck exit=0

- 2026-11-26T02:07:58.5656217Z pnpm test exit=0

- 2026-11-26T02:08:34.7789547Z pnpm build exit=0

定向保护6项测试通过，Node已有yaml依赖完成运维workflow解析；根级五项检查及差异检查通过。首次python命令解析到Windows Store占位程序，没有测试回执，随后使用捆绑Python实际运行6项；该Python未含PyYAML，YAML验证改用已有Node yaml包，没有安装/升级依赖。仅推操作分支，不改main或重建产品。

最终处理与上线证据见同目录2026-11-26-gift-query-release.md末节；原镜像导入及生产发布均已验收成功。两轮明确旧镜像清理9+7，总计16个；未合并运维辅助代码至main。
