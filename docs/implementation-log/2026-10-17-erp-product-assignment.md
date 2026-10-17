# ERP混放规格归属校正

## 原因及边界

- 用户指出sd-ring-R7和sd-ring-R7y为不同款式，但在商城同一商品下混放。公开商品详情只读核对确认当前商品有21规格，含屏显、青春款及指模。用户聚水潭截图证明R7y-silver-9的正确款式编码是sd-ring-R7y，不能归入R7。
- 当前导入/Worker代码按ERP返回i_id精确归组，上一轮伙伴列表按已有商城商品ID汇总，并未创造或移动SKU；无法仅凭截图确定历史错误写入的具体时间和入口，不把推测写成已证实根因。现有错误需要实际校正规格外键，单改列表显示不能修复。
- fetch确认origin/main为3bef1f0c2180c80974262ca23028263268642fde；上轮工作树有发布回执，原用户目录还有文档，均保留。在独立codex/erp-product-assignment-20261017、E:/saydian-erp-assignment-20261017实现。Start/Publish脚本只允许main，其他任务占用main，故采用显式文件PR提交，不重置或强推。仅H5后台及配套服务，不改原生APP。

## 实现及独立数据验收

- 新后台核对入口按每个完整SKU实时查聚水潭i_id；缺失、多个不同i_id或分页超限即中止。禁止从R7/R7y前缀猜款式，无库存调用、无供应商回写。
- preview不改商品/SKU业务数据。返回逐规格当前/目标款式、是否新草稿及摘要。管理员显式确认后apply重新查询ERP和当前版本，锁定源与目标商品、CAS核对SKU版本；任何变更回滚，拒绝LOCAL/归档目标。
- 写入只调整原SKU的productId/erpItemId，原SKU id/erpSkuId、价格、库存、图片、伙伴合作价与历史订单不变。新款式创建为草稿，需后台核对后上架；已有目标保持原状态，源商品及历史快照不删除。
- 该功能不含SQL迁移或自动生产数据修复。历史数据校正需要在后台查看本次实时预览后确认；部署不会移动真实商品。实际校正为独立管理员验收，有逐SKU审计和事务回滚边界。
- 新增接口由SUPER_ADMIN/COMMERCE_OPERATIONS授权；只读/财务/客服不能预览或校正。商品详情挂载独立确认组件，取消或离开来源组件不会发送待确认写入。

## 验证

- 定向API测试11项通过（含R7/R7y/相似SKU90精确匹配、缺失款式不猜、预览不写、只改原SKU归属、新商品草稿、CAS、LOCAL保护）。首次类型检查发现requestId可选值需转null，已修复。
- 新增隔离PostgreSQL验收：构造两款混放的合成SKU、负库存、伙伴别名/合作价和历史订单，校正后断言ID/价格/库存/伙伴价格/订单快照保持，新商品DRAFT。由CI现有partner-database文件执行，不改生产数据或CI门禁。
- 新增权限及真实SFC预览/确认/取消/离开流程测试。全量门禁和云端实库结果待后续补记。

- 按聚水潭官方普通商品资料查询文档核对sku_ids为逗号分隔字符串、每次最多20个：https://openweb.jushuitan.com/dev-doc?docId=14&docType=2 。核对函数按20分批、40秒总预算，新增21规格分批回归。审计同时保留原父商品款式与原SKU款式字段，便于核对及恢复归属。

- 首轮完整api:docs:check、tools:test、typecheck、test、build及diff检查均通过。随后补充审计原SKU款式字段、伙伴列表/采购展示ERP款式编码，保留伙伴独立名称不覆盖；对最终源码重新运行类型、全量测试与构建。云端实库仍待执行。

- 最终源码pnpm typecheck、pnpm test、pnpm build均退出0，先前api:docs:check和tools:test通过。git fetch后HEAD/origin/main仍为3bef1f0，未覆盖其他工作。git diff --check通过。无新SQL，无自动历史数据回填。准备显式文件提交并让CI执行新增PG归属修复验收。
