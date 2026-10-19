# ERP商品导入允许零库存规格

## 用户要求及边界

- 用户截图SKU sd-ring-R7c-pink-8导入时有6个同款SKU未返回库存，要求无库存仍能导入、商城库存记0，并推送线上。
- 新建独立工作树E:/saydian-erp-import-zero-20261019，codex/erp-import-zero-stock-20261019；fetch后HEAD/origin/main均94252e996ef3a8d28d34ec72d7550c54206f6864。原工作树保留未提交发布回执。已读AGENTS、handoff、最近简体版开关/支付及设置整合记录，保留其他任务最新代码。
- Start/Publish限定main，而main在其他工作树占用；沿用显式文件功能分支/PR/CI流程，不覆盖、不强推。用户已授权本次上线，提交使用[deploy cn only]限定中国站。

## 实现

- 仅调整实时商品导入：商品资料有效、库存接口成功且分页完整时，保留全部同款SKU；有库存记录的按原数量规则导入，未返回记录的记0。重复导入时原SKU ID/ERP绑定保留，缺失库存记录不会保留旧正库存。
- erpLookup.zeroStockSkuIds记录缺失库存的完整SKU编码，原始inventory/inventories快照不伪造qty=0。后台新增提示及成功后数量说明，零库存导入可继续编辑保存。
- 库存调用授权/HTTP/网络错误、缺失有效数据列表/规格编码、无效数量、未完整分页仍中止，事务之前验证完毕，不把请求故障当零库存。库存批量同步的既有缺失SKU保护、付款扣库存/超卖规则保持原有流程。
- 无迁移或批量生产数据修复，不调用供应商写接口，不改原生App。仅上线后用户主动导入时按新规则处理；不在生产用真实商品试写。

## 验证安排

- 新增V1/V2成功空库存导入、同款部分缺失及输入SKU自身缺失、八类库存故障不写入回归；保留现有正常库存和库存同步保护测试。
- 既有CI明确执行的commerce-database测试增加真实PG验收：空库存创建两个草稿规格、部分库存重导入保留SKU ID并将旧正库存置0、授权失败保留全部原数据。仅loopback且显式开启，清理精确随机款式编码，供应商为合成fetch响应。
- 新增后台零库存成功导入后继续编辑/保存及提示回归。安装、串行门禁及CI/线上结果续记。
## 本地执行结果

- corepack pnpm install --offline --frozen-lockfile、corepack pnpm db:generate成功；使用项目锁定pnpm 11.19.0。
- 串行执行corepack pnpm typecheck、corepack pnpm test、corepack pnpm api:docs:check、corepack pnpm tools:test、corepack pnpm build全部退出0。API 1281通过/36跳过（真实PG本地未开启），后台245通过；工具三组58/62/38项全部通过。构建仅有既有chunk体积提示，无错误。
- node tools/generate-api-reference.mjs生成456路由文档；git diff --check通过。构建产物已确认包含零库存导入说明、计数和结果提示。
- 首次补丁包含空hunk被apply_patch拒绝，未写文件，修正hunk后成功。未绕过校验。
- 提交前重新fetch；HEAD与origin/main仍为94252e996ef3a8d28d34ec72d7550c54206f6864。使用单次http.sslBackend=openssl保证本机Git连通，不改全局配置。
- 后续PR CI需通过真实PostgreSQL验收；仅CI成功后合并main。推送与生产发布状态分别核对，需验证中国站两处readiness修订及实际后台资源包含零库存提示。生产业务未试写，需用户刷新后主动重试导入。
