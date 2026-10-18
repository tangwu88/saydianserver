# 精确模块候选的一次性缓存恢复

- 仅恢复已完整通过CI39133944860的dcc9d2a三镜像缓存；应用源码仍825，生产仍aeb。不是新功能发布，不合入SMTP/会员ID，不改普通main发布流程。
- GHCR拉取被受控结束；Chrome文件权限不足未开启，原artifact的服务器HTTPS样本哈希正确但批量出现连接重置，未导入或切换。改用已配置的Actions受限SSH接收器传送原artifact12140071512，不新增凭据或权限。
- 普通send-offline/send-runtime的main校验、原缓存导入器和生产部署器逐字节不变。单独恢复分支/输入/原CI verify/原ZIP及内部归档hash/原manifest/hash/原目标分支最新SHA均固定；接收器每段在同FD9锁内复验root0600两小时精确批准及三个现有aeb容器。
- 只导入固定三imageID的缓存，绝不compose/restart/迁移/seed/业务配置写入。完成后只重试原失败deploy job117697287831，不重跑verify或镜像构建；最终上线由原管线再次完整门禁。
- 修改前干净、remote仍tangwu88/saydianserver，fetch成功；以固定dcc9建立独立工作树，保留候选分支未提交日志。普通main为0aeb，本次不合并它。验证命令与实际Actions回执待下方补记。
- 服务器HTTPS仅停止本次owner1627409的7个精确curl孙进程（FD9、config及output路径、旧aeb均核验），日志证实nothing imported or restarted；锁idle，三容器仍aeb。不删除旧镜像、卷、库或备份。
- 本地离线安装缺少@types/node包后正常frozen-lockfile安装成功，锁文件未改。Prisma generate、接口文档453路由、工具65+H5流程62+契约38、范围/缓存恢复11、解包器3、部署失败/回退12、全量类型检查均通过。
- 全量pnpm test通过；其中API124文件/1,241测试通过，35项真实数据库用例按默认本地环境跳过，实际PG/HTTP/镜像证据仍来自原dcc9完整CI。未把本机跳过测试冒称通过。actionlint、Shell语法和git diff --check通过；全量构建和实际恢复工作流结果继续补记。
- 全量pnpm build成功（现有Sass弃用及前端chunk大小警告未扩展修复）；apps/packages/锁文件与dcc9无任何差异，运行源码仍825，不产生或发布第四份镜像。恢复分支不触发普通CI镜像构建，手动export只下载已存在的原artifact并复验哈希。实际执行结果待回执。
- Publish-Change.ps1固定只允许main并推送main，不适用于本次用户要求的隔离范围；不改弱该工具，改为完成同一套全量门禁、重新fetch后仅显式暂存本记录与恢复脚本/工作流，在独立恢复分支提交推送。
