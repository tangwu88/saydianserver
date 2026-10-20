# 聚水潭库存同步允许跳过未返回SKU

## 请求、基线与边界

- 用户反馈sd-ring-R8-gold-11未返回库存导致全量同步中止，要求其他库存正常更新。未返回的SKU保留原库存，并展示跳过编码；不会将其记0（与新增商品导入缺库存记0的规则分开）。
- 原E:/saydian h5保留e22b7f9及既有脏文档；第一次openssl fetch发生TLS EOF，改用单次schannel/http1.1/系统代理后成功。origin/main为935deaba0ff237d86857e2d325313d28e98d7a16，保留最新三个App下载页及微信伙伴登录修复。新隔离工作树E:/saydian-inventory-partial-20261020、codex/inventory-sync-partial-20261020，HEAD与远端一致。
- 已读AGENTS、当前handoff和最近下载/伙伴登录/ERP零库存导入记录。Start/Publish限定main且main由其他工作树占用，采用显式文件分支/PR/CI流程，不覆盖、不强推。仅后台H5同步入口及必要服务端库存逻辑，无原生App、迁移、外部供应商配置或生产试写。

## 实现

- 成功且分页完整的库存查询中，按ERP完整SKU编码匹配：有记录的继续数量校验、扣减本站未上传ERP的已付款占用、SKU CAS事务写入；未返回的SKU不写库存、不标记历史待付款库存已释放。
- 待付款/已付款订单重查、行锁、历史扣库存策略审计均限定实际返回的SKU范围，避免缺失SKU的订单变化阻断其他库存。成功匹配范围内并发变化仍事务回滚。缺失项以后再次同步返回时正常处理。
- 新增syncedSkuCount/skippedSkuCount/skippedSkuIds响应，保留原统计字段。全部未返回时不发起库存业务事务，只提示全部跳过；真实零数量仍更新为0，接口授权/网络/HTTP错误、无效数量、错误响应或不完整分页仍中止，避免故障数据覆盖库存。
- 后台部分/全部跳过显示warning及持久提示、完整SKU编码（可滚动），正常库存刷新；重复点击保护及旧响应兼容保留。下次同步/切换资源清除旧提示。

## 验证安排

- 单测新增部分/全部缺失、未变数量与缺失分离、跨100个SKU批次缺失、已付款缺货债务与历史待付款审计仅作用于匹配项、缺失时仍拒绝其他无效数量。更新原“缺失整批拒绝”断言，网络故障仍保留中文安全诊断。
- 后台新增部分和全部跳过警告、保留库存说明、刷新与下次成功清除提示回归。
- CI既有commerce-database真实PG文件新增合成ERP双SKU及旧订单：部分同步更新一个、缺失SKU全行不变且无释放审计，取消混合订单只返还未同步SKU的历史占用；全部空响应全行不变。只允许loopback，按随机商品/订单/审计ID清理，不运行生产fixture。
- corepack pnpm install --offline --frozen-lockfile、db:generate成功；首轮库存同步38项及后台订单/库存按钮14项全部通过。接口目录生成456路由。
- 完整串行typecheck/test/build/api:docs:check/tools:test与diff检查结果续记；主分支CI和真实PG验收通过后发布中国站并核对Actions、双readiness及后台实际资源。无真实供应商/生产库存试写，不将模拟验收认作实际库存已同步。
- 首次完整typecheck发现新增真实PG测试的数组索引在严格模式下可能undefined（TS2375）；将固定两个SKU声明为[string,string]元组后重跑，业务源码未放宽类型。
## 本地完整门禁结果

- 修复元组类型后，串行corepack pnpm typecheck/test/build/api:docs:check/tools:test全部退出0，git diff --check通过。API1285通过/37个真实数据库用例本地跳过，后台247、下载41、伙伴66、商城181通过；PG验收必须由CI显式启用，不冒认本地跳过已通过。
- 实际后台构建index-DLWR2g4S.js含skippedSkuIds/skippedSkuCount及“已保留原库存”“未返回库存的 SKU”。发布回查使用响应字段及业务文案，避免依赖已被压缩移除的局部ref变量名。
- 提交前再次fetch成功，HEAD/origin/main均935deaba0ff237d86857e2d325313d28e98d7a16；显式提交业务逻辑、测试、生成接口文档及本日志。忽略目录仅保存构建与发布回执，无密钥/生产数据进入Git。
