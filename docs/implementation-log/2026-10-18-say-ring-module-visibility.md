# Say Ring 百科与商城显示：实现、生产验收及主线源码同步

## 交付结论（2026-10-18）

- 生产已发布为`dcc9d2aefeb42b3a0345868a5debc51e8625b213`，与下面候选阶段不同；[CI39133944860 attempt2](https://github.com/tangwu88/saydianserver/actions/runs/39133944860)及实际后台/双地址回归通过。手机正向UI及R12新实测仍待真实设备解锁和连接，不冒认通过。
- 下方“未部署/门槛缺证/不安装依赖”等描述为候选阶段历史，不是当前状态；实际生产恢复、全量门禁、后台保存和主线源码同步以文末回执为准。

## 授权、基线与资源

- 已直接读回客户端聊天用户要求：健康百科、商城由后台控制显示/隐藏，原有功能不要重做。双方锁定普通产品/platform开关，所有用户同配置，无审核身份或时间后门。
- 阅读AGENTS、handoff、五项只读契约及实施记录，status/remote/fetch/prune后原care分支干净，HEAD/远端8d7a8ce，origin/main0aeb6fa。未覆盖原工作区。
- 公开readiness核实生产仍aeb9afcb8bbd8b4168c38e489c827790c448bf7a；从该精确基线创建独立worktree及 `codex/say-ring-module-visibility-20261018`，不合SMTP或care候选，不触发main自动部署。
- 跟踪内容实测12,433,614字节。Mac空闲由约450MiB降至243MiB；不安装依赖、不跑本机大构建/Docker、不清理资料或干扰客户端1117保数据安装。
- 小测试只用原工作树既有依赖的临时只读链接，Vitest别名指向本分支contracts源码，缓存置于本分支ignored artifacts。不是依赖重新安装或完整生产环境验收。

## 实现

- 精确DTO和前后台契约见 [独立说明](../say-ring-ios-module-visibility.md)。同级moduleVisibility包含schemaVersion1、300秒租约及health_library/mall；默认关闭，不扩展旧严格生理目录。
- 独立公开setting、版本冲突保护、操作者/前后快照事务审计及恢复上次配置。抽取原五项写入协议供两者复用，保留原五项key/动作/数据及既有测试；无SQL或新种子。
- 后台只增加现有设置列表和两项表单。只读门禁仅作用明确say-ring+ios的百科三类、商城四类GET；无标识/其他App原语义不变，不修改cart/order/payment/capabilities或法律。
- 服务端模块查询失败只关闭模块，不污染健康租约；新客户端必须独立单调租约、失败关闭并丢弃迟到响应，复用原页面，不靠显示开关抬升支付/购买/医疗/AI能力。

## 红测、修复与小门禁

- 先加8项公开模块回归，原实现29项通过/新增8项因字段缺失真实失败，随后接入实现。
- 第一次大patch因同路径delete/add被工具拒绝，未落盘；改为单文件update后正常完成，不覆盖原始工作树。
- 首轮9文件中8文件109项通过，ResourceView未加载：本地临时contracts别名错误吞掉/download子路径。修复仅ignored本地配置，不改产品或安装插件。
- 重跑9文件179项全部通过，包括固定目录/默认关闭、两个独立布尔、非法/private/查询失败、五项不被污染、后台事务审计/回滚/权限、旧ResourceView及显式scope只读隔离。
- 接口目录453条生成及check通过；新HTTP脚本与notes语法、git diff --check通过。扩展HTTP仅既有隔离CI库，覆盖canonical/global、所有账号同配置、默认关闭/开关独立、旧入口、保存冲突/非法/审计/回滚/角色。
- 本机不执行真实HTTP/实库/镜像或完整根门禁。后续仅推独立分支、draft PR在既有托管CI完成全量类型/测试/构建、HTTP/实库/恢复/镜像门禁；结果另记，不能预写成功。
- 最后补充损坏审计快照必须拒绝恢复，避免无效前后状态同时归一成关闭而伪装一致；旧健康正常保存/回滚测试保持通过。9文件180项通过；接口/语法/diff检查重跑通过。临时依赖链接仅指向原依赖，提交前移除四个本轮链接，不删除依赖原件。
- 保持原生产基线隔离：验证PR目标使用固定aeb9afc的 `codex/say-ring-module-base-20261018`，不指向main，避免原CI默认合成merge夹带主线SMTP/报告差异和路由目录。两ref均非生产入口，CI/部署触发条件不改；推广main仍须单独同步/审阅/组合重验。
- 移除临时依赖链接后直接api:docs:check因找不到typescript未执行，非接口失败；用单进程只读模块解析指向原既有typescript重跑453条通过，未重新安装或创建依赖链接。HTTP语法和diff再次通过。

## 不变与待验

- 不改已有五项生理只读设置、三项手动授权、AI/购买/支付上限、上传规则或正式法律版本；不打开生产新开关。
- 不包含会员ID披露态schema/SQL/候选逻辑，不修改生产迁移白名单、部署触发或现有生产配置。care分支仍独立候选，不发真实邀请。
- 生产受控终端/容量/实例/DB/schema/私有备份恢复仍缺证，不迁移、停写或部署；CI合成恢复不代表生产恢复。原R12三项真实测量和连续稳定性由客户端独立验收。
- 本分支先基于原生产版本验证；推广主线前必须重新同步并审阅最新main、验证组合，不以原生产基线测试冒认未来合并版本通过。

## 生产发布与回读

- 运行源码为825cc51，仅两模块；生产发行SHA为dcc9d2a。该SHA完整CI包含类型/工具/测试/构建、真实PG/HTTP292、CI隔离恢复及三镜像验收。原verify时间13:59:12–14:11:35Z；15:49只rerun原失败deploy job，未重新构建。普通main/US发布均SKIPPED。
- 三不可变镜像：API `ghcr.io/tangwu88/saydianserver-api@sha256:06d021161382c94205c8e7a183077812ec5277f926c72619f8a0c4014bf15ebb`；Worker `ghcr.io/tangwu88/saydianserver-worker@sha256:a64717330998c0a028eebbf0b35c30eb136a3bc268653765783d3ff9294556e2`；Admin `ghcr.io/tangwu88/saydianserver-admin@sha256:3f9b660ea691a0d66f069bb8815f68487241be8b021ce404aba90404e8cf8964`。实际三运行容器ID/标签逐个匹配，双readiness为dcc9/ready。
- GHCR首次拉取严重低速，精确核验timeout PID/父发布/FD9/批准/旧三容器后仅停止本任务拉取，未切换服务。原artifact12140071512由[39136379385](https://github.com/tangwu88/saydianserver/actions/runs/39136379385)只读导出、不重建；ZIP368,019,130字节，SHA-256`eb32f72523215dfd6df79ee4aada0395cd62b26cdd81986ab0f52fdd137a7db1`。
- Chrome上传需新增file-URL权限，未开启或绕过；大段HTTPS和SSH均实测低速/断连，受控停止且旧三容器/锁核验。独立恢复分支e04139c只传小控制包，固定原artifact/清单/范围/短期root批准，复用未改的1MiB八并发重试下载及安全解包/缓存导入器。[恢复39139924409](https://github.com/tangwu88/saydianserver/actions/runs/39139924409)SUCCESS：15:46:24Z整包/清单/内部归档通过，15:47:09Z三镜像ID/标签通过，不重启应用。普通main传输守卫和自动流程未改。
- 原生产部署job117718719073于15:49:41Z三次明确already verified locally/skipping registry pull。精确root0600一次性批准、零待迁移及实际环境防漂移通过；强制新生产备份及隔离恢复7秒成功。私有回执`/opt/saydianapp-server/deploy/unified/backups/20261018T154943Z-dcc9d2aefeb4-13287/migration-rehearsal`；不导出数据库/密钥、不改生产迁移历史、不seed。
- 切换前后AppSetting全行摘要均`973caa5f8393a1e882778b924e767f4b`；网关原文件SHA校验OK，只reload刷新容器DNS，其他路由不改。批准移入同backup的module-release-approval.used.json；锁idle，未删除旧镜像/卷/库/备份，未触发生产回退。
- 15:46前与15:51后10个公开配置场景比较通过，仅Say Ring/iOS双前缀新增moduleVisibility；既有404状态保持。最新外部配置在15:28已变为sleepAiEnabled=false、hideAi=false，五指标仅body_temperature=true，其余false；切换保留最新值，不恢复旧对象。
- 后台用已有自动填充正常登录，未读取/修改密码；同一会话跨部署reload仍有效。15:52:43.582Z仅保存say_ring_ios_module_display为schema1、public=true、false/false，重开两独立switch均为0；公开DTOv1/300秒/falsefalse独立回读。保存后排除该新key的其他全部AppSetting摘要仍同上。
- AuditLog实际回读`SAY_RING_IOS_MODULE_DISPLAY_UPDATED`、15:52:43.582Z，before_closed=t/after_closed=t；不回传账号ID/IP或健康数据。后台验收截图仅留本机ignored artifacts，不提交Git。正向开关未开；客户端独立确认手机passcodeRequired/WDA不可用，正向UI与新实测待验。

## 主线仅源码同步，不做混合生产发布

- 生产验收后发现main尚无模块源码，未来普通发布会覆盖功能。重新fetch，最新main仍0aeb6fa（已有同事SMTP/报告代码），从它创建干净隔离工作树，只cherry-pick --no-commit 825cc51的功能源码，未把临时发布/恢复工作流或root批准脚本加入main；无冲突、不改SMTP源文件/锁文件/schema/部署配置。
- 首次组合api:docs:check指出自动合并的目录未规范化；使用原生成器重新生成，不改接口行为。组合的完整门禁在下方补记；此前候选CI不冒认新主线组合已验收。
- 本次主线源码提交明确`[skip ci]`：生产仍为已经独立验收的dcc9，不自动发布main既有其它待发代码；不修改AUTO_DEPLOY_ENABLED或普通后续main流程。当前源码同步不构建/发布新的运行镜像，也不执行SQL/改生产配置。
- 原素材、既有脏工作区、care候选8d7a8ce及PR40保留。完整恢复过程在`codex/say-ring-module-cache-recovery-20261018`审计记录；生产回退只复用原固定镜像，绝不以旧数据库覆盖新写入。
- 2026-10-19主线组合验证：frozen-lockfile安装、Prisma generate成功；原生成器生成/校验454路由通过。串行tools:test、typecheck、test、build全部退出0，diff及staged diff无空白错误。默认本地实库测试跳过，实际生产版本的PG/HTTP/镜像证据来自上述dcc9 CI，不冒认新主线组合镜像已部署。
- 仅保留必要公共事务助手以复用五项与两个模块设置协议，移除旧健康写入的重复实现；临时恢复代码不进入main。对照main基线，.github/deploy/锁文件/Prisma及SMTP实现无修改。已有SMTP代码原样保留在源码，当前生产仍不包含该批待发功能。
- 按[GitHub官方跳过单次push工作流说明](https://docs.github.com/zh/actions/how-tos/manage-workflow-runs/skip-workflow-runs)使用提交消息，不改仓库/工作流全局开关；本仓库无pull_request_target或workflow_run发布链。源码推送和线上revision最后回读另记，不以本机通过冒称main已发布。
- 源码提交`897b24f5570fcd594fafb6b718aa61c663ee6e09`已正常fast-forward推送main，GitHub ref独立回读一致；该提交Actions列表为空，未触发混合发布。生产独立回读仍dcc9/ready。本条回执为纯文档`[skip ci]`更新，不代表新的运行镜像或生产发布。
