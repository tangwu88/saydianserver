# U19 发布原镜像下载恢复

2026-11-10。只优化人工恢复时的原文件下载，不更改应用镜像或会员/设备配置。

- 从独立 worktree 的干净 main 执行 Start-Change.ps1，fetch/ff-only 至591b23331d108ca317aee0637e4d0d6c4c2a7dd9，再建立codex/u19-artifact-transfer-20261110；原U19工作区保留。
- 生产591b233的原verify已成功；普通GHCR拉取、8路HTTPS及SSH分片接收持续偏慢。8路HTTPS任务42765670200由本轮明确停止，约55MiB；SSH任务42766805026在约11分钟后仅确认首个8MiB分片，已取消，终端确认receiver退出。以上均在应用切换前，readiness仍f48866b，未清数据、未删锁或重启应用。
- 仅把runtime-artifact.mjs的固定并发窗从8提升到最多32；单片1MiB、每片重试4次、总时限、可信下载域、令牌不转发到下载域、完整GitHub摘要、ZIP条目/原清单/归档SHA、磁盘余量、OCI镜像ID和发布flock全部保留。
- 新增40MiB异步网络夹具，校验真实重叠数大于8且不超过32、全部40片恰读一次、完整摘要匹配和只清本轮临时文件。先在旧实现失败（实际峰值8），再修改；全部Node下载11项与Python ZIP验证3项通过。
- 仅将恢复工具候选推到独立分支用于现有人工workflow_dispatch，原目标仍591b233、原verify run42763675021、原artifact13738683508；不合并main，不重建/重标应用镜像，不绕过最新main检查。恢复任务与生产切换结果按实际追加。
- 新worktree离线依赖安装成功；生成Prisma客户端、完整typecheck/test/build和接口文档核对均退出0，部署工具/H5及diff检查继续完成后才提交。无本机数据库的用例仍按原规则跳过，不把它写成新实库验收。

最终本机验证：Prisma生成、pnpm typecheck、TMPDIR=/private/tmp pnpm test、pnpm build、pnpm api:docs:check、pnpm tools:test、git diff --check依次退出0。API154文件1548通过，93数据库用例按原规则跳过。Node下载11项、Python归档3项通过。未更改运行应用源码、数据库、正式配置或main。

## 实际恢复及发布结果

- 工具提交a671b7f06055b1b6323d5780aa4324c2615a0e07、草稿PR69；远端CI run42768725233成功，未合并main。
- 恢复run42768557810/job129670724122（32路下载）成功，完整原文件372558817字节，SHA256 3fe8d20ed9737d8f588cd9b4e113e760849263699919f972159d7ece5c09b8ec。约14分钟完成下载，随后原ZIP、发布清单、分片、归档SHA及三个OCI镜像身份均通过，14:42导入完成。该步骤明确没有重启应用。
- 随后人工部署run42770388727/job129676601710成功：目标仍591b23331d108ca317aee0637e4d0d6c4c2a7dd9，offline_images=true、first_cutover=false，原备份与业务开关保留，无待执行迁移。14:44生产切换完成；根和/global两条health/ready均实读到相同完整SHA、ready、database=ok。
- U19独立公开配置默认为空列表，新增后台页签已核对。开放三项U19健康读取/手动测量的页面草稿尚未保存，等待实际访问扩大确认；生产部署成功不代表U19新测量、云端读回或型号验收通过。
- 保留无副作用失败记录：GitHub工作流按钮同名导致严格定位拒绝，按表单限定后仅提交一次；日志归档首次把两份内容放在同一JavaScript请求超过工具大小上限，改为分开保存成功，未丢失原日志。没有因此扩大来源、放宽校验或更改权限。
