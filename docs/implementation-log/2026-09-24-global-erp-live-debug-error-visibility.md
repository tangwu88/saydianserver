# 国际后台 ERP 新增商品线上复核与错误常驻提示

## 原因

- 用户在 `https://app.saydian.cn/admin/commerce-products` 新增商品时，反馈获取 ERP 资料仍失败，并授权直接使用已打开的侧边浏览器调试。
- 本轮只处理 H5 国际后台，不修改 Flutter App、国内后台或旧商城。

## 线上复核

- 当前页面加载的管理后台资源为 `/admin/assets/index-5Z0hhobv.js`，其 API 基址为 `/global/api/saydian-app/admin/v1`，并包含 `POST /commerce-products/erp-import`；已不是截图中的旧 `/api/...` 请求。
- 在用户当前已登录会话中使用 `sd-watch-w8` 触发一次“获取 ERP 资料”。随后“第三方服务”页面显示聚水潭最近真实验证时间更新为 `2026/9/24 17:35:13`，说明路由、管理鉴权和聚水潭凭证均已通过本次真实调用。
- 商品资料没有载入，结合接口实现只有“SKU 未找到”会在商品查询成功后先记录真实验证、再返回失败，可确认本次失败点为聚水潭没有返回 `sd-watch-w8`。当前商品列表可见的相近编码为 `sd-watch-w8u` 与 `sd-watch-w8R`，不能自动替用户猜测或替换 SKU。

## 修改

- `apps/admin-web/src/views/ResourceView.vue`
  - 新增 `erpLookupError`，在新增商品弹窗内持续显示最近一次 ERP 查询错误。
  - 每次新查询前清除旧错误；查询失败后同时保留原消息提示和弹窗内错误提示。
  - 对“聚水潭未找到 SKU”补充“请在聚水潭确认完整 SKU 编码后重试”，避免把业务未找到误认成路由故障。
- `apps/admin-web/src/member-resource-view.test.ts`
  - 增加失败状态测试，验证查询失败后保存仍被阻止，且错误会保留在弹窗内。

## 验证

- `pnpm --filter @saydian/app-admin-web exec vitest run src/member-resource-view.test.ts`：35/35 通过。
- `pnpm api:docs:check`：343 条路由均有说明。
- `pnpm tools:test`：工具测试 10/10、H5 流程测试 61/61 通过；末段 H5 合约检查另以 `pnpm test:h5:contracts` 复核 38/38 通过。
- `pnpm typecheck`：8 个工作区检查通过。
- `pnpm test`：Admin 132、Shop 132、API 782 通过（数据库测试 4 条按预期跳过），其余工作区通过。
- `pnpm build`：全部工作区构建通过；保留既有 Sass 弃用和 Admin 大包警告。
- `node deploy/global/check.mjs`：184 项结构检查通过；本机无 Docker Compose，原生 compose/nginx 运行时检查未执行。
- `node --test deploy/global/h5-deployment.test.mjs`：4/4 通过。
- `git diff --check`：通过。

## 未验收事项

- `sd-watch-w8` 的正确 ERP SKU 需要由商品或 ERP 维护人员在聚水潭确认；本轮不使用相似编码替代，也不写入商品。
