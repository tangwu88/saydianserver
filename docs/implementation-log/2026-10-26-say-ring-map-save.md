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
