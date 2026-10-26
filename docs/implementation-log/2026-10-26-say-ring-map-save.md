# Say Ring地图配置首次保存及事务修复

用户报告后台地图保存报通用英文错误，随后明确同意修复及发布。只修本项目Say Ring地图保存；不读取/提交真实Key、不开启服务、不发真实高德请求，不改维护、支付、数据结构或其他App配置。

原目录E:/saydian h5处于旧候选分支且有他人未提交文档，保留原样。独立clone到E:/say-ring-map-save-fix-20261026，origin改回tangwu88/saydianserver并fetch；干净main与origin/main均09790c6b2b699ba30a8ae637fb8f028073602c4c。运行原Start-Change通过，已读AGENTS/handoff及最新实施记录。两生产readiness同为该SHA，地图公开状态configured=false；没有生产写入。首次读取推测的商城日志文件名不存在，改读取实际2026-10-25-mall-menu-latest-copy.md，不影响源码。

代码证据：IntegrationSecret.integrationKey外键指向IntegrationConfig.key。地图首次保存直接调用secret.save，没有建立say_ring_amap父记录，seed也没有此项；测试mock掉secret.save，未覆盖真实外键。截图本身仅通用提示，尚未取得该次请求线上数据库日志，不把源码缺陷等同于已读取生产堆栈。

修复：独立writeSayRingMapSetting先校验及加密，再在同一个Prisma事务创建缺失父记录、写加密密钥及地图配置。已有父记录update为空不重置状态；首次元数据仍UNCONFIGURED，不以保存冒充真实供应商调用。configured从实际密钥记录派生，忽略客户端伪造标志；启用但无密钥给明确提示。加密/事务失败不给半成功，错误仅含固定中文及errorKey，不回显SQL/密钥。App公开契约、地图入口及其他设置不变；留空Key继续保留原加密值。

后续在本记录追加定向/完整串行门禁、失败及修正、Git/Actions与真实线上版本；未填写真实Key或供应商验收必须分别标注。

离线frozen依赖安装及Prisma客户端生成成功（现有pnpm11.25.0，进程PNPM_CONFIG_PM_ON_FAIL=ignore，不改锁文件）。定向首轮44项通过、5项真实PostgreSQL用例本机缺服务跳过；API typecheck发现测试直接读取Prisma JsonValue.configured的类型错误，改为toMatchObject断言，不改变产品逻辑。新增真实外键及首次/替换失败回滚用例进入CI已有PostgreSQL阶段，不再仅靠mock验收。

更正后API typecheck及44项定向复验全部通过；新增3个TypeScript文件经prettier格式化。测试覆盖先加密再写、父子顺序、空Key保留、伪configured拒绝、未配置关闭、格式/类型拒绝、密钥存储失败及通过真实异常过滤器后的中文错误，不回显凭证。真实数据库5项仍待CI执行，不能以本地跳过冒充通过。

发布前使用原Publish-Change显式7文件清单，串行运行文档、工具/部署、类型、全量测试及构建；仅进程PATH补本机既有pwsh和Git Bash，SAYDIAN_JQ指向原已验签便携jq，不改系统工具/仓库工具门禁。发布消息限定[deploy cn only]，不触发独立美国环境。依赖安装、检查原始输出存Git忽略artifacts/map-save-20261026，不提交产物。发布后另核对Actions真实PostgreSQL门禁、部署结果与双地址revision；保持地图configured=false，不替用户填/启用真实凭证。

- 2026-10-26T07:30:23.6446113Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-26T07:33:00.8436251Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-26T07:33:24.1191672Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-26T07:34:48.0192461Z：pnpm.cmd test，退出码 0。

- 2026-10-26T07:35:20.1869875Z：pnpm.cmd build，退出码 0。

## Git及CI实际结果

原Publish-Change显式7文件提交并推送main：ab77f8e7c08544ea711bef5c7e7036e0ebb16b38。源目录所有脏文档保留，独立clone无其他源码差异。全量API1343通过/47数据库项本机跳过、后台262通过，文档459路由检查及部署工具检查通过，既有Sass/大chunk警告保留。

公开GitHub API第一次命中匿名限流；新clone尚无原项目本地credential helper，首次只读认证检查未取得凭证。复用原目录现有helper到此clone的.git本地配置，拒绝内嵌Token形式，不修改全局配置、账号或凭据，GET /user核对仍tangwu88后读取Actions。凭证仅存在进程内，不输出、不写日志/仓库。

Actions https://github.com/tangwu88/saydianserver/actions/runs/40286720827 的verify已success。实际日志07:40:01Z明确显示say-ring-map-database.test.ts共5项通过（191ms），含旧密钥直写外键失败、首次事务保存、留空保留和两类失败回滚；不是本地跳过推断。auto-deploy/resolve成功，美国部署按[deploy cn only]跳过。

截至北京时间16:19，auto-deploy/deploy仍在受限SSH receiver步骤运行，线上两readiness仍为09790c6，旧服务正常。不能声称已上线；未取消/重复发布或绕过发布门禁。进行中job日志暂不可下载，未取得服务器内部进度，不能把等待猜测成确定的镜像/网络故障。部署终态及线上核对另行追加。

## 发布终态：未上线

北京时间16:47取得最终结果：整个run为cancelled，verify成功，auto-deploy/resolve成功，auto-deploy/deploy在60分钟上限取消，美国跳过。不是由本轮人工取消，也不是代码/数据库测试失败。

已下载部署job 121455437377日志到Git忽略目录：07:46:16Z预检pending=[]；API镜像07:46:50Z拉取并验真成功，耗时34秒；同秒开始“Pulling runtime image worker.”，此后没有完成或明确网络错误，08:46:05Z被工作流超时取消。不能进一步断言网络、磁盘、Docker锁或认证是哪项导致；需要服务器只读进程/拉取状态检查。没有盲目重试、修改镜像源、替换不可变manifest或关闭安全门禁；SSH断开是否留下远端进程也尚未确认。

取消后再次检查/health/ready和/global/health/ready，两者仍ready、database=ok、revision=09790c6b2b699ba30a8ae637fb8f028073602c4c；没有切换到修复源码ab77f8e。地图Key未读取或重填，未写生产设置；真实管理员保存和高德出图均未验收，不能告知用户线上已修好。后续需取得现有服务器终端/只读诊断入口，核实残留拉取后再决定是否重试原发布。

将本次CI及失败回执单独提交codex/say-ring-map-release-receipt-20261026分支，不推进main或触发重复发布，保持main仍为已测试的ab77f8e，便于恢复同SHA的原发布；本轮源码修复已在main，回执分支只增加本日志。源码未变，不重复将前轮门禁记作新执行；日志diff --check及显式文件/远端守卫另行核对。

回执提交前首次fetch遇到Connection was reset，守卫正常中止，未切分支或提交；保留日志后重试只读fetch，不绕过远端变化检查。

HTTP/1.1只读fetch重试返回Empty reply from server；日志仍保留本机且main源码ab77f8e此前推送已核实，不把回执声称已提交。

## 用户服务器只读回执及一次受控重试

用户随后提供服务器截图：df显示约19GB可用，无docker pull进程，原容器仍运行；lslocks筛选发布锁无输出。Docker日志15:46:50证实API镜像已拉取，16:46:16出现extract快照NotFound清理错误，与取消时间接近。该清理错误不足以证明最初拉取卡住原因，不据此删镜像/快照或重启Docker。

17:15重新查询双readiness仍为09790c6、服务正常。按原“修复并发布”的授权继续同一次发布恢复：从现有helper只在内存取得凭证，核对GET /user=tangwu88、REST最新main=ab77f8e、原run completed/cancelled且attempt=1、没有活跃main workflow、目标job确为原auto-deploy/deploy、原release-ab77f8e产物未过期。按GitHub官方POST actions/jobs/121455437377/rerun只重试发布job（debug logging=false），返回201。没有重建或更换原manifest、没有重跑其他环境、没有修改生产凭证/维护值或手工数据库操作。重试终态待后续核对，不能把201当作部署成功。

## 重试终态及线上验收：已更新

用户回报再次筛选docker pull没有输出。北京时间17:57重新核对，run 40286720827已completed/success，第二次发布job 121490295764为success，美国仍skipped。下载该次部署日志验证：09:18:33Z原API镜像已在本地验真，跳过拉取；Worker在09:35:59Z拉取并验真成功，实际1046秒；Admin随后4秒成功。此次没有重编或替换镜像，没有清理快照/镜像、重启Docker或改镜像源。前一条清理错误不能据此视为已证实的Docker损坏。

GET /health/ready和/global/health/ready均status=ready、database=ok、revision=ab77f8e7c08544ea711bef5c7e7036e0ebb16b38，证实这次修复已切换线上，而非仅Git推送/CI成功。公开sport-map-config仍provider=amap/configured=false，符合未代填或启用真实Key的边界。已告知用户刷新后台、重新填写并保存；真实管理员保存、高德Key有效性及运动地图出图仍待用户操作，不以部署通过冒充真实供应商验收。

最终HTTP/1.1 fetch已恢复成功，HEAD和origin/main仍ab77f8e；此前失败回执/诊断/重试记录保留。仅将本日志后续回执提交独立codex/say-ring-map-release-receipt-20261026分支并推送，保持main与实际运行revision一致，不触发第二次部署。产品源码无新增变化，沿用本轮已记录门禁；新增日志通过diff --check和显式文件检查，不把历史全量检查写成新执行。
