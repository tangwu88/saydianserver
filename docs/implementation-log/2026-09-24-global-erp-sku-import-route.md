# 2026-09-24 国际 H5 后台 ERP SKU 导入路由修复

## 原因与范围

- 用户在国际 H5 总后台“商城 → 商品 → 新增商品”填写 ERP SKU 并点击“获取 ERP 资料”时，页面返回 `Cannot POST /api/saydian-app/admin/v1/commerce-products/erp-import`。
- 现场只读复核确认国内入口对该路由返回 401，说明路由存在；国际 `/global` 入口返回 404，且线上国际 API revision 为 `f6e419e035a1e47039feba6dbf7f0b315d8ec4d9`。
- 根因是国内 `main` 已包含按 SKU 实时导入 ERP 商品的服务端实现，国际 `codex/global-api-foundation` 分支只有前端入口，遗漏同一 API 与导入服务。
- 本轮只修复 H5 管理后台及其服务端接口，不修改 Flutter App，不修改数据库 schema。

## 实现

- 国际 API 新增 `POST /api/saydian-app/admin/v1/commerce-products/erp-import`，权限限定为 `SUPER_ADMIN` 与 `COMMERCE_OPERATIONS`。
- 复用国内已验证的聚水潭实时导入逻辑：按单个 SKU 同时查询商品和库存，两项成功后才新增或刷新 ERP 草稿商品。
- 后台新增商品流程以 ERP SKU 为起点，成功后回填商品、SKU、价格、库存和只读 ERP 快照；未取得 ERP 资料时禁止保存。
- 保留国际分支现有会员推广、积分和商城逻辑。聚水潭仍是 ERP 商品编码、SKU、价格和库存的权威来源。

## 安全与失败边界

- 聚水潭未配置、密钥不完整、接口无权限、SKU 不存在、库存缺失或供应商失败时均不写入商品。
- 本轮没有读取生产密钥，也没有使用用户截图中的 `sd-watch-w8` 发起真实聚水潭调用。
- `git fetch origin --prune` 首次因网络连接被重置失败，因此不能据此声称远端引用已刷新；本轮基于现有 `origin/main` 中已验证实现移植，并在发布前重新 fetch。

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @saydian/app-api exec vitest run src/admin/jushuitan-product-import.test.ts` | 4/4 通过 |
| `pnpm --filter @saydian/app-admin-web exec vitest run src/member-resource-view.test.ts` | 34/34 通过 |
| `pnpm --filter @saydian/app-api typecheck` | 通过 |
| `pnpm --filter @saydian/app-admin-web typecheck` | 通过 |
| `pnpm api:docs` / `pnpm api:docs:check` | 343 条路由生成并校验通过 |
| `pnpm tools:test` | 工具 10/10、H5 流程 61/61、H5 契约与部署边界 38/38 通过 |
| `pnpm typecheck` | 8 个工作区项目全部通过 |
| `pnpm test` | 商城 132、后台 131、API 782 等全仓测试通过；API 4 项数据库条件测试按既有条件跳过 |
| `pnpm build` | API、Worker、后台、商城、下载页与共享包全部构建成功；仅有既有 Sass 弃用和后台大分块提示 |
| `node deploy/global/check.mjs` | 184 项国际部署结构检查通过；当前环境没有 Docker Compose，未执行原生 Compose 与 Nginx 运行时检查 |
| `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs` | 8/8 通过 |
| `git diff --check` | 通过 |

## 待完成

- 发布后核对 GitHub Actions、国际 `/global/health/ready` revision，以及未登录请求由 404 变为 401。
- 真实 ERP SKU 查询仍由有权限管理员在生产集成配置核对完成后验收。
