# Say Ring 同步诊断与恢复配套后台

## 需求、工作区和边界

用户明确批准已登录且同意隐私协议后自动上报失败摘要并保留手动入口，以便无法取得客户手机时核对同步阶段。本轮也优化App登录注册未勾选协议的可见反馈，相关客户端日志在独立SayRing仓库。

- 原`E:/saydian h5`有同事未提交实施记录、法律资料及鸿蒙目录，完整保留；该工作区分支不是main。不切换/覆盖旧工作区，另从最新origin/main建立`E:/say-ring-sync-diagnostics-server-20261114`、`codex/say-ring-sync-diagnostics-20261114`。
- 起始和核对fetch的main为`f3e06dff0a6a125336b72d1e59632107dc30cd7a`。Start/Publish脚本只接受main，因此本轮在隔离分支手动执行同等检查、显式文件提交和发布前fetch；不强推、不覆盖其他工作区。
- 复用既有Feedback私有类别槽，每会员一槽、最近5份；不新增表或数据库迁移，不修改客户健康/绑定/首绑授权，不开生产写入、供应商或维护开关。

## 变更

- 登录态GET诊断能力配置（product=say-ring、no-store）、POST摘要：版本/型号/固件/系统大版本、阶段/固定错误枚举、耗时和数量白名单；单报告4KiB、最多16个阶段。拒绝任意异常文本、健康值、记录ID、原始蓝牙包、MAC/设备ID、账户凭据等额外字段。
- 账号从认证上下文取得，body不能选择其他会员；数据库事务行锁序列化同一会员额度及单槽写入。报告ID幂等，所有模式每会员每小时最多4份；未接受不返回成功。
- SUPER_ADMIN/APP_OPERATIONS可在会员列表“同步诊断”读取最近5份；校验UUID并审计读取动作（不记报告内容）。迟到请求不能串到下一会员，关闭或卸载不显示旧响应。只读角色无按钮且接口后端拒绝。
- 私有诊断槽不进入普通用户反馈/后台反馈工单或未处理数；禁止普通反馈创建保留类别或编辑该类别，避免绕过限流/容量。
- 生成3个新增路由的API目录，共573条。既有App/H5接口保持；旧App无诊断记录不代表无故障。

## 检查、失败与修正

- offline frozen安装、contracts构建及Prisma生成通过；只生成客户端，未连生产数据库。
- 首轮定向服务端29项、后台迟到响应隔离4项通过。覆盖隐私字段拒绝、产品/版本/数量边界、幂等/额度/隔离/私有工单及认证角色。事务并发用替身串行模拟，不冒称真实PostgreSQL并发验收。
- 根级pnpm typecheck通过。首次pnpm test发现旧后台反馈测试精确where尚未包含私有类别排除条件；更新原测试以断言新过滤，重跑全量通过：API1579项通过、94项可选实库跳过；其他包结果见外部日志。
- 根级pnpm build通过，含后台实际生产构建。
- 首次tools:test缺Windows jq和PATH导致Linux脚本夹具失败127；从jqlang官方固定jq1.8.1下载并核对官方SHA256，在本机临时SAYDIAN_JQ/PATH配置重跑，不改部署脚本/断言以掩盖环境失败。后续结果提交前补记。
- 后台生产构建的本机浏览器替身验证：超级管理员、App运营可打开诊断，只读角色无入口；无JS页面错误。夹具首轮路径分隔符误判返回403，修正本机静态服务路径；关闭按钮本地化不匹配导致超时，改点击可见实际关闭按钮。均只访问127.0.0.1及合成报告，未读取生产会员。
- `git diff --check`通过。线上Git/CI/部署以及客户端正式包状态提交前/后另记，不将“已推送”写成“已部署”。

## 最终本机门禁

- 根级typecheck、test、build顺序通过。API1579通过/94可选实库跳过；后台326、Worker170通过/5跳过，contracts92、commerce-domain28、health-domain29、download-web41、vip-web86均通过。
- jq固定版本官方校验后，tools:test全量通过：部署/工具59、H5流程62、H5契约38。原失败没有改生产代码或削弱断言。API文档573路由完整，diff检查通过。
- 生产构建浏览器以SUPER_ADMIN、APP_OPERATIONS、READ_ONLY分别验证，前两者能读固定摘要，只读无入口，页面异常0。动画完成后截图检查表格、中文说明和编号完整可读；只使用本机合成会员。
- 客户端UTC/Asia-Shanghai全量各2425项通过；正式APK仍在编译和验签。无Xcode环境，本轮未构建iOS；没有客户实机故障复现或生产实库并发验收。
- 本轮代码已具备提交条件；实际Git SHA、Actions、公开health revision在发布后独立核对，旧App不会因仅更新后台自动获得诊断能力。

## Git、网络恢复与生产验收

- 源码`c7bd29f675c0ed98b83fa6bb2edd8413632e32c8`已推送main与专项分支。[原CI 43578887669](https://github.com/tangwu88/saydianserver/actions/runs/43578887669)的verify成功，美区自动发布成功；北京发布在GHCR原始API镜像拉取停留约20分钟。生产旧revision f3e06df及原API/Admin/Worker一直健康，未通过改维护开关绕过。
- 用户在单独窗口认证只读SSH。只读确认磁盘约9.7GiB可用、下载进程及旧容器状态；随后用户明确允许仅终止本次卡住的下载并使用同一验收原镜像恢复。严格核对PID2275965的命令、父进程、镜像摘要后TERM该timeout，使原发布自然退出；没有直接停止业务容器或重置数据。
- [原镜像导出43581400234](https://github.com/tangwu88/saydianserver/actions/runs/43581400234)成功，未重新构建。原始artifact14108328344，372701977字节，ZIP SHA256 `3c7505366e8a072f65d33c3055bc8d3ef811fd90780b28f8c0d6ddae697d8c64`。
- [HTTPS恢复43581999465](https://github.com/tangwu88/saydianserver/actions/runs/43581999465)进度缓慢，只得到约45MiB；取消该任务并仅清理本轮独有挂载和命令匹配的临时下载容器。[构建器直传43582699283](https://github.com/tangwu88/saydianserver/actions/runs/43582699283)也遇到跨境传输缓慢，取消本轮任务。两个取消是传输恢复选择，不是代码验证失败；未换镜像、改自动发布配置或处理其他项目。
- 本机使用同一下载器的临时副本，保留可信主机/TLS、范围与完整SHA校验，只提高受控并发并缩短单次传输等待；最终完整373MB原ZIP验证通过。全文件curl方案超时/未完成而未使用；一次本地模板断言因源码有两个Array.from命中而失败，改为精确下载循环。初次本机计划写入出现ENOSPC，复查空间后小文件重试成功，没有删除现有资料。
- SCP第一次未保留活动进程及回执，核对原ZIP/程序后按用户要求重新发起；使用保持打开的命令窗口，经用户独立认证上传。SCP明确exit0，耗时2746.7秒。密码只在本人本机窗口输入，未记日志或提交；文件只到本次0700私有目录。
- 在发布互斥锁下复用本轮root-owned CI上下文及既有receive-runtime/verify-runtime-artifact/receive-offline原始校验导入门禁，仅以本机传入且哈希匹配的ZIP替换HTTP下载输入。保留ZIP条目、manifest逐字节、归档/分块哈希、磁盘5GiB保留、三组件OCI ID及revision标签核验；没有重建验收镜像。45块完成且原API/Worker/Admin镜像全部导入后才进入正式发布。无业务容器在镜像导入阶段被重启。
- 只读磁盘预检查第一次因ubuntu无权访问root目录返回Permission denied，改为sudo只读检查；原导入保留门禁未降低。本轮临时TTY进度采样修正了换行/命令回显解析，最终按服务器真实字节和SCP回执判断完成，不按界面估计成功。
- [正式恢复发布43589089364](https://github.com/tangwu88/saydianserver/actions/runs/43589089364)使用`revision=c7bd29f...`、`offline_images=true`、`first_cutover=false`成功，仍使用原CI的成功verify及原始manifest，不重跑/替代镜像，不改变维护/业务写入/供应商配置。
- 独立公开读回`/health/ready`和`/global/health/ready`均为ready、database ok、revision完整等于c7bd29f...；发布后的后台真实静态bundle含同步诊断入口；未登录访问新配置接口实际401。没有创建或修改生产会员健康数据来伪造联调成功。客户安装支持的新App后才会产生摘要。
- 以上发布后审计只提交专项分支，main保持已验收的运行时代码c7bd29f，避免仅追加文档又触发新一轮生产镜像发布。原`E:/saydian h5`的同事修改未覆盖。
