# 国际 H5 后台 ERP 按 SPU 导入与商品删除

## 原因与范围

- 同一个 ERP 款式（SPU）下存在多个 SKU。原后台只按管理员输入的单个 SKU 查询和保存，因此部分商品只导入一个规格。
- 商品列表缺少单条删除入口，误导入且没有业务历史的商品无法直接清理。
- 本轮只修改国际 H5 后台及其服务端接口，不修改 Flutter App，也不修改数据库结构。

## 实现

- ERP 导入先按输入 SKU 精确定位聚水潭款式编码 `i_id`，再通过聚水潭官方商品接口的 `i_ids` 条件分页查询同一 SPU 下全部 SKU。
- 对同款 SKU 去重后，按每批最多 100 个编码查询库存；任何一个同款 SKU 缺少库存时整次导入失败，不产生部分写入。
- 在一个数据库事务内创建或更新同一商品下的全部 SKU，并将聚水潭本次不再返回的旧规格停用、库存归零。
- ERP 快照增加 SPU 编码、SKU 数量、完整商品资料数组和库存数组，保留原输入 SKU 的单条快照字段以兼容后台展示。
- 新增 `DELETE /admin/v1/commerce-products/:id`。没有订单或评价历史的商品可物理删除，同时清理购物车和收藏引用；已有订单或评价的商品拒绝删除并提示改用归档。
- 商品列表增加“删除”按钮和二次确认，删除成功后刷新当前列表。

## 验证

- `pnpm --filter @saydian/app-api test -- jushuitan-product-import.test.ts commerce-admin.test.ts`：API 全套 784/784 通过，数据库条件测试 4 条按预期跳过；新增按 SPU 返回两个 SKU、批量库存、旧规格停用和安全删除覆盖通过。
- `pnpm --filter @saydian/app-admin-web test -- member-resource-view.test.ts`：后台全套 133/133 通过；新增删除确认、请求和刷新覆盖通过。
- `pnpm --filter @saydian/app-api typecheck`、`pnpm --filter @saydian/app-admin-web typecheck`：通过。
- `pnpm api:docs`、`pnpm api:docs:check`：344 条路由均有说明并保持生成结果最新。
- `pnpm tools:test`：工具测试 10/10、H5 流程测试 61/61、H5 合约与部署边界测试 38/38 通过。
- `pnpm typecheck`：8 个工作区项目全部通过。
- `pnpm test`：商城 132、后台 133、API 784 等全仓测试通过；API 数据库条件测试 4 条按预期跳过。
- `pnpm build`：全部工作区构建通过；仅保留既有 Sass 弃用提示和后台大分块提示。
- `node deploy/global/check.mjs`：184 项国际部署结构检查通过；当前环境没有 Docker Compose，未执行原生 Compose 与 Nginx 运行时检查。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过。

## 未验收事项

- 尚未在生产环境执行真实商品删除；该动作会永久删除数据，应由管理员在明确选定可删除商品后完成。
- 发布后需核对国际 API revision 与后台静态资源版本，并使用真实存在的 ERP SKU 验收同一 SPU 的完整规格数。
