# Say Ring 百科与商城显示配置三端同步

## 授权、基线与现场保护

- 用户明确要求截图中百科/商城显示设置对iOS、Android、鸿蒙同步；本轮只扩展模块可见性，不扩展iOS健康/测量授权、商城付款平台、供应商能力或健康上传。
- 原`E:\saydian h5`工作树有其他未提交文档，保持不动。status/remote/fetch完成后，以干净origin/main `f33800038cc1621381be1684a95f51f8368d23d3`建立独立工作树`E:\say-ring-modules-all-platforms-20261028`、分支`codex/say-ring-modules-all-platforms-20261028`。
- 已阅读AGENTS、handoff、最近礼品缺货/商城服务记录及Start-Change/Publish-Change。main由另一个已有工作树占用，不切换/重置同事现场；这两个脚本要求当前main，因此本轮在新分支手动执行同等status/fetch/SHA记录、显式文件列表与实施日志提交、发布前远端变化检查，拒绝强推。
- 线上只读复现：ios返回health_library=true/mall=false；android和harmonyos均没有moduleVisibility，客户端安卓又仅iOS实例化模块租约，是隐藏后仍显示的原因；不是替用户打开/关闭配置。

## 实现

- 复用既有`say_ring_ios_module_display`设置行和schema，保持旧iOS协议兼容，不迁移或改写生产配置；历史key名保留，后台标签改三端共用并提示客户端需升级。
- 显式Say Ring ios/android/harmonyos请求均读取相同公共严格布尔标志，300秒上限；配置缺失/私有/无效/读取失败关闭对应模块。只对ios附带其原只读健康租约，不将健康权限推广到其他平台。
- 显式三端百科/商城公开读在取内容前应用同一可见性检查；不改未声明产品的旧API、其他App、支付/订单写路径或维护状态。新客户端负责携带准确产品/平台并关闭入口、撤回迟到读取；可见性不是可信账号权限。
- Flutter/原生鸿蒙客户端适配在独立SayRing仓库，不把客户端构建产物或任何生产凭据、健康/会员数据提交本库。

## 验证

- 独立工作树`pnpm install --offline --frozen-lockfile --ignore-scripts`成功，使用本机缓存未下载依赖；随后prisma:generate成功。未升级锁文件，未复用会指回脏工作区的workspace链接。
- 定向`pnpm --filter @saydian/app-api exec vitest run src/common/say-ring-module-visibility.test.ts src/support/support-public-config.test.ts --maxWorkers=2 --testTimeout=15000`，56/56通过。覆盖三端相同开关、内容读取前拒绝、旧scope保持、独立健康租约不扩权；调整原“安卓不受开关影响”断言以对应用户本轮新要求。
- 全量typecheck/test/build、接口文档及部署脚本检查串行执行，实际结果和失败修复续记。代码推送、CI、生产revision及三端实际公开响应分别核对，不把推送当部署。
- 实际根检查：typecheck通过（23.9秒），全量test第二轮通过（79.5秒，API1373通过/65项可选实库跳过），build通过（49.1秒），api:docs:check通过（478路由）。首次test的后台文案契约要求保留“不开放购买、支付”，明确为“显示开关本身不开放…”后通过，未放宽支付授权测试。
- 首次tools:test因当前进程缺少便携jq出现127；核对既有jq-1.8.2的SHA256为`a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627`，仅本次进程设置SAYDIAN_JQ/Git Bash PATH/独立TEMP，不改系统或部署脚本。重跑工具58/58、H5流程62/62、H5契约38/38全部通过，最终typecheck和git diff --check再验通过。
- Git外完整日志`E:\say-ring-modules-checks-20261028`；既有国内/国际统一app.saydian.cn生产双地址当前revision=f338000。身份经现有GCM只在进程内核对tangwu88后读取CI，原主CI的verify和本项目auto-deploy成功，失败来自独立US部署，本轮以`[deploy cn only]`发布当前app.saydian.cn，不改变独立美国环境。

## 首轮CI HTTP契约失败及修正

- b3f4895已通过正常非强推更新main；CI40625602829的类型/全量测试/构建、真实PostgreSQL并发、礼品事务及API smoke均成功，但HTTP兼容授权检查失败，部署被跳过，生产仍旧版，未把源码推送写成已部署。
- 定位`tools/http-contract-smoke.mjs`仍要求显式Say Ring Android商城在默认隐藏时返回200、Android模块对象为undefined，属于旧iOS-only契约。更新为canonical与/global两别名、ios/android/harmonyos三端完整关闭/百科独显/商城独显/回滚状态；每种状态继续校验未登录和两账号一致性、no-store、无身份401、陈旧409、非法400、其它App/未声明scope不变及五项iOS健康授权隔离。
- 只有HTTP测试脚本和本日志改变，运行源码与本机/首轮CI已成功的类型/单元/构建逐blob一致；`node --check tools/http-contract-smoke.mjs`及git diff --check通过。此脚本仅在隔离合成数据库运行，不以生产环境执行真实配置写入；完整真实HTTP结果以重新触发的CI终态为准。

## 发布状态回执（尚未线上完成）

- 最终运行版本a5994ee1ab60b0cc66300adb440c64b897843cae已正常推送main。CI40626718918的verify成功，包括新三端HTTP、真实数据库、备份恢复与三个镜像；auto-deploy/resolve成功，独立US按范围跳过。本项目auto-deploy/deploy仍在受限SSH receiver步骤，不能记为已上线。
- 12:01线上/global/health/ready仍旧f338000；暂未执行成功后“三端公开配置+模块404/200”的验收。客户端安卓1154已原证书覆盖安装，鸿蒙双签包已生成，源码0163ec7已推独立SayRing仓库。
- 为只读定位服务器部署进度，按既有授权启动用户输入密码的全新SSH窗口；当前尚未认证，准备的请求仅ps/lslocks/docker inspect/df，不修改服务器或数据库。待用户在窗口输入，不在聊天收集密码。
- 本段回执只推功能分支，不推进main，以免使仍在部署的a5994ee被新文档SHA判定为过期；运行源码与main完全相同。待上线后继续补最终版本/三端响应和手机验收。

## SSH重连与原镜像传输排查

- 用户要求重新打开SSH窗口后，创建全新诊断目录，不复用旧请求；已建立StrictHostKeyChecking=yes的会话，密码仅由用户在SSH窗口输入，没有记录、导出或在聊天获取。诊断仅读取进程、镜像revision、磁盘及下载暂存文件大小。
- 12:13确认部署停在精确digest的API镜像docker pull，已持续约35分钟；12:20仍旧revision=f338000，可用空间16GB，既有API/admin/worker保持运行。下载暂存合计从约93MB增至95MB，不能写成完全无进度或数据库故障。
- 首轮多行交互请求被伪终端输入刷新打断，随后以单行bash -c执行完整只读请求，未通过重放不明确请求操作服务。未取消运行中的receiver、修改Docker设置、维护状态、生产开关或数据库。
- 原镜像备用导出首次及第二次GitHub身份读取超时；确认无新workflow后重试，第三次成功。Export runtime images 40632153118成功，原始artifact12790974683为369618649字节、digest sha256:815b486a1dac2396fb0deedf190a00924186de5644ee5a19bdec10feddd352c2，未重新构建。随后40632331371请求现有artifact的受控HTTPS导入，只暂存/导入镜像、不切服务；同一production并发锁下等待原部署结束，尚不能记导入或上线完成。
- SayRing mobile-ci40627341857的quality、Android、iOS及鸿蒙两个时区均已终态success。Windows本机无iPhone/鸿蒙实物的限制不因云端编译通过而消除。

## 下载路径实测与继续发布（仍待线上验收）

- 原CI40626718918的verify成功保留，auto-deploy在约60分钟后超时取消；现有API仍f338000且healthy。没有手工终止原发布receiver。
- 备用HTTPS导入40632331371于12:39实际开始；12:42只读采样38MB/370MB，下载持续增长但较慢。尝试现有SSH分块路径40634151709前，按进程ID、完整命令、精确暂存路径及原API revision匹配，仅向该HTTPS暂存下载的timeout父进程发送TERM；不作用于API/worker/admin。
- SSH分块实测更慢，12:51首块仅3436544字节、没有已验收块，切换判断没有带来改善；随后按精确timeout head命令、release锁FD及原API revision核对，仅停止该暂存接收。两个备用导入的failure为本轮有范围的暂存传输终止，不是源码/镜像验证失败；没有绕过哈希、镜像ID、迁移或维护门禁。
- 恢复同artifact12790974683的HTTPS导入40634814047，私有staging全新，不重放旧请求。12:56接收29360128/369618649字节，线上仍f338000；实际完成前不标已导入。旧暂存文件没有跨目录删除或替换数据。
- 已将同SHA的离线正式发布40635080045排在当前导入之后。现有生产并发锁、latest-main/原成功verify/原manifest/三镜像ID与revision检查仍生效；未就绪会在切换前失败。此时仍pending，最终上线/公开三端/手机验收待续。
- 用户再次解锁后，按此前调试授权临时保持USB连接时亮屏，用于后续模块入口验证；结束需恢复原stay_on_while_plugged_in=0。
