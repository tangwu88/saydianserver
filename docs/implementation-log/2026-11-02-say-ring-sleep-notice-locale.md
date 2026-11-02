# Say Ring睡眠AI说明版本与语言选择修复

## 原因和基线

- 用户报告R7 Ultra在1225正式App生成睡眠报告时提示“睡眠AI服务尚未完成配置”，之前可生成；用户确认未改参数并提供后台截图：启用、已通过真实调用、千问大陆地址及qwen3.8-flash。截图未含密钥，不要求重填凭据。
- 手机实际复现availability返回上述提示，尚未到上传同意确认；未生成、重试报告或上传真实睡眠汇总。公开app-display的sleepAiEnabled=true。线上ready和origin/main均为7f3e816d83568622668537bd3467c24247b797f5。
- 公开睡眠说明：zh-Hans为say-ring-sleep-qwen-2026-10-18-v1，en仍为say-ring-sleep-ai-2026-10-03-v1，其他六种语言无说明。原API/Worker先按账号语言选文档：en及回退到en的账号选中旧智谱说明，即使千问已启用且地址正确也被providerReady拒绝。本机尚未直接读取该账号数据库locale；这是已复现的生产逻辑缺陷，最终手机可用性仍须发布后核验。
- 原E:\saydian h5存在他人未提交文档和法律材料，完全保留。fetch、status、remote与基线核对后，从origin/main创建独立codex/sleep-ai-notice-20261102工作树E:\saydian-sleep-ai-notice-20261102。Start/Publish脚本限定main，而原main占用在其他同事工作树；按已记录的隔离分支等价检查、显式文件提交、提交前fetch及CI流程执行，不覆盖原目录或强推。

## 修改与保护

- contracts增加currentSleepAnalysisNotice：查询结果须是已启用、已审核、已发表并按发布时间倒序；先固定当前版本，再在该版本内选择账号语言、英语或真实可用语言。不能从旧语言版本选择旧接收方，当前正文为空时也不回退旧版。
- API睡眠独立同意读取与Worker传输前/发布前复核使用同一选择器；睡眠查询去掉locale预筛选，保留类型、启用、审核和发表时间限制。响应仍返回真实文档locale、version及已有公开地址，不伪造翻译或更改已发表正文。
- 不改变其他健康报告及注册协议的语言策略。供应商地址匹配、独立新版本同意、撤回/停用/开关/生成期变更的复核继续有效；旧智谱同意不能授权千问，不改Key、模型、设置、Worker维护状态或数据库schema，不批量替用户同意。

## 验证记录

- pnpm install --frozen-lockfile --offline --ignore-scripts成功，缓存复用905项、未下载依赖，锁文件未改；随后contracts build及pnpm db:generate成功，仅生成本机客户端，不连接生产库。
- 先补API/Worker混合新中文Qwen、旧英文BigModel回归，在原实现上分别1失败/22通过、1失败/42通过。失败分别为providerReady=false和Worker拒绝当前授权，保留api-before.log/worker-before.log于Git外E:\SayRing-sleep-ai-audit-20261102。首轮测试编辑误将可变账号locale写到state定义内的文档项，检查立即发现并在执行测试前修正，没有作为产品错误或覆盖原失败。
- 应用选择器后，定向contracts23、API23、Worker43通过。随后补Worker旧英文授权依旧拒绝的反例；最终定向与根级串行检查结果待补记。已触及文件统一格式化，包含原紧凑Qwen用例的换行，不改变旧断言语义。
- 未动生产或进行真实供应商调用，未使用旧授权替用户上传；默认AI开关、发布说明与用户记录保持。公开复现仅存脱敏结论，手机页面和日志留在Git外。
- 根级串行pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check通过，API目录486路由；API1446通过/67数据库依赖项跳过，Worker154通过，跳过不记为实库验收。构建只保留既有Sass与bundle体积警告。
- tools:test首轮失败：本机缺jq，部署夹具exit127；安装Git外官方jq1.8.1并与官方sha256sum.txt核验，SHA256=23cb60a1354eed6bcc8d9b9735e8c7b388cd1fdcb75726b93bc299ef22dd9334。第一次重试仍失败：夹具禁用了MSYS路径转换，Windows jq无法读取/e/路径。随后发现仓库已有SAYDIAN_JQ适配入口，按其配置后再重试；不修改测试/生产脚本或放宽断言，失败和重试各自独立留档。
- 配置SAYDIAN_JQ后完整pnpm tools:test通过，覆盖部署/工具、H5流程和契约；保持全部原断言及真实jq执行。pnpm-lock.yaml、Prisma schema和生产脚本无改动，git diff --check通过。根级五类门禁均已完成，仍不把本机跳过的实库用例计为通过；Linux CI将独立验证。

## 发布与待验

- 需要现有CI及正常CN自动部署后，核对两条ready的准确revision、Actions状态与实际手机availability。接口签名未改，不要求重打App。
- 修复代码/本机测试/生产部署/真实报告生成分别记录；未完成不写已恢复。用户需要在App阅读当前实际说明并主动同意本次睡眠汇总上传，之后才能验收真实报告生成。

## 生产发布跟进（2026-11-02）

- 功能提交1b0fca6c724132b0fccd409c9f0fa990cc512670已推送main；CI41420381603的verify成功，包括Linux构建、测试、迁移/备份恢复检查。自动发布job125200025441最终cancelled，日志最后仅Pulling runtime image api；不能把该CI整体记为部署成功。23:29两条公开ready仍为7f3e816，原服务正常。
- 用户本人两次在可见SSH窗口输入密码，只读检查确认API docker pull运行约17分钟、Docker近30分钟日志无错误/完成记录。后续汇总窗口和简化透明只读窗口均被自动审批拒绝，未执行或绕过，改由用户现有终端提供回执。36:36截图显示拉取仍在；根盘剩9.7G、镜像35.4GB/可回收8.479GB；未清理镜像、删除锁或重启Docker。curl HEAD /v2/返回405仅证明入口有响应，不证明层下载正常。
- 仓库已有Export runtime images工作流41427466713只导出原始已验收镜像成功，artifact13131434977为369767961字节，不重新编译。原清单只读核验三镜像大小合计1752639778字节。后续只读probe41427890592成功，8MiB耗时71.717秒、0.112MiB/s、imported=false；测速不是全量导入/部署成功。
- 23:27按已有受限receiver分块恢复流程启动41471735052：同SHA、同CI原镜像，upload_to_server=true，逐块/整包/原清单及OCI ID校验，并保留5GiB余量。23:29处于Transfer verified images without rebuilding or switching services，未切换服务；导入结果、同SHA离线发布和真实App可用性仍待核对。
- 未修改生产凭据/模型/开关/已发布说明/维护状态/数据库/业务记录，未重打App或代替用户同意真实睡眠汇总上传。SSH密码从未读取或存盘。- 23:39读取41471735052实际日志：首个SSH bundle传输约600秒后接收端超时，cat Broken pipe、exit124，未出现整包/OCI校验通过。受保护后续发布器正确停止，没有在导入失败后部署。GitHub runner的fsverity/nftables警告属于其Docker环境初始化，不能误记为生产失败原因。
- 23:42启动已测速的原artifact HTTPS导入41474145938，复用13131434977、artifact_action=import，不重新构建，不调整原3300秒传输预算/5GiB余量/整包hash与OCI校验。恢复辅助脚本仅在导入workflow成功、main仍为1b0fca6、原CI verify依旧成功时，才发起同SHA offline_images=true的正常Deploy production，并读取两条公开ready。失败、main变化或校验不符均停止，不重复发布、不清理业务或修改凭据。
- 辅助脚本、临时日志和状态文件均位于Git外E:\SayRing-sleep-ai-audit-20261102。导入/生产验收仍未完成；实施日志仅推独立修复分支，不为进度文档再次发布main。App仅新增诊断文档，未改运行代码或换包。