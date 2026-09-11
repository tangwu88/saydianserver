# 商品 SKU 售价与库存快速修改

## 目标与边界

- 用户在国际版总后台商品详情的“SKU 与库存”区域要求快速修改售价和库存。
- 修改前执行状态、远端、交接记录检查并 fetch；`codex/global-api-foundation` 本地与远端均为 `47433e84e20e58dd5e11876d36ff7942bdcd1fb8`。工作区原有京东 ERP 抽样日志和两个脚本继续保留，不修改、不暂存。
- 本轮只增加后台 SKU 快改界面、受权限保护的国际管理 API、字段校验、并发保护、文档及测试；不修改 Prisma schema、ERP 凭据、支付配置、订单、生产库存数据或维护状态。
- ERP 同步仍是来源数据。后台手工调整会立即影响商城报价和可售库存，但下一次 ERP 同步可能覆盖；界面明确提示，不能把手工值描述为已回写聚水潭。

## 实现

- 商品详情增加“快速修改”，售价用人民币元输入并保留两位小数，库存使用非负整数；保存成功后原位更新详情并刷新列表，失败保留用户输入。
- 新增 `PATCH /api/saydian-app/admin/v1/commerce-products/:id/skus`，仅 `SUPER_ADMIN`、`COMMERCE_OPERATIONS` 可用。请求按分传价，每次 1 至 100 个 SKU。
- 服务端校验 SKU 归属、重复项、金额、库存和 `updatedAt`。全部 SKU 在一个事务中保存；任何行已被其他管理员或 ERP 更新时返回 409，整批不部分覆盖。
- 成功修改同时刷新商品更新时间；购物车、结算和下单仍使用服务端最新 SKU 价格及库存，既有重新报价和库存竞争校验不变。
- 后台写请求继续经过统一审计拦截器。没有新增绕过审计、权限或生产只读开关的路径。

## 定向验证

- `pnpm.cmd --filter @saydian/app-api exec vitest run src/admin/commerce-admin.test.ts`：6/6 通过。
- `pnpm.cmd --filter @saydian/app-admin-web exec vitest run src/product-sku-quick-editor.test.ts`：最终 4/4 通过；没有实际变化时不会发送写请求。
- API 与后台定向类型检查通过。
- `pnpm.cmd api:docs:check`：321 条路由全部有说明且生成文件一致。
- 第一次 `pnpm.cmd tools:test`：9 项工具和 61 项 H5 流程通过，契约组因国际 H5 构建产物尚未生成而 37/38；不是业务断言失败。按生产参数执行国际 H5 构建后重跑，9 项工具、61 项流程、38 项契约/隔离检查全部通过。
- `pnpm.cmd typecheck`：全工作区通过。
- 最终 `pnpm.cmd test`：退出码 0；商城 107、后台 100、API 680、Worker 43 及其他工作区测试通过。API 的 4 项既有条件数据库测试因专用开关未启用而跳过，未冒充已运行。
- `pnpm.cmd build`：全工作区通过；只有既有 Sass 弃用和后台大 chunk 警告，无构建错误。
- `pnpm.cmd contracts:client:check`：冻结客户端 `fa79aa3610be25762fc4b5e7245de0f1f86245ef` 的 76 条路径/方法均存在，`missing=[]`；这不代替字段解析或真机验收。
- `node deploy/global/check.mjs`：176 项结构检查通过；本机没有 Docker Compose，真实容器与 Nginx 由目标服务器发布器验证。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。

## 验收标准

- 有商品写权限的管理员能在详情中直接修改多条 SKU 的元价格和库存；只读角色没有入口。
- 非法金额、负数/小数库存、跨商品 SKU、重复 SKU 和过期页面均不能保存；错误后不清空已填内容。
- 保存后商品列表、再次打开的详情及 H5 商品详情读取相同新值；ERP 商品显示同步覆盖提示。
- 发布后公网 `/global/health` revision 等于本轮提交，国际后台真实渲染快改入口；国内 `/health/ready` revision 不变。
