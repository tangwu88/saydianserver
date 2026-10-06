# 2026-10-06 H5 结算收起、商城图片上传与内容 App 分类

## 原因与范围

- H5 确认订单页的“优惠、积分与备注”原先默认展开，与本轮截图要求不符。
- 商城商品和 SKU 已有图片字段，但后台只能手工填写 URL，运营无法直接上传。
- 协议和更新配置已有产品含义，文章没有持久化的前端 App 归属，后台列表也没有统一的 App 筛选。
- 本轮只修改商城 H5、管理后台和为其提供数据的服务端，不修改 Flutter、Android 或 iOS 原生 App 源码。

## 实现

1. `apps/shop/src/pages/checkout/index.vue`
   - 将优惠、积分与备注区域的初始状态改为收起，保留原有展开按钮、ARIA 状态和表单逻辑。
2. 商品及 SKU 图片
   - 新增后台商城图片上传接口 `POST /api/saydian-app/admin/v1/commerce-images`，仅允许 `SUPER_ADMIN` 与 `COMMERCE_OPERATIONS`，继续使用既有 JPG/PNG/WebP 签名校验、10 MB 上限和对象存储。
   - 商品编辑增加封面上传和相册追加上传；本地及 ERP 商品的 SKU 都显示规格图片上传入口。
   - ERP 的价格、库存和规格继续由 ERP 管理；仅提交发生变化的 SKU 图片，并用 `updatedAt` 做并发冲突保护。
   - 商品列表的 SKU 快速编辑器同步支持图片修改。
3. 内容 App 分类
   - `Article` 增加 `product` 字段，允许 `shared`、`saidian`、`saydian-global`、`say-ring`；旧文章通过数据库默认值归为通用内容。
   - 后台内容新增/编辑增加“所属 App”，内容、协议、客服与更新列表增加 App 标签和筛选。
   - 公开文章接口接受可选 `product`，只返回通用内容和指定 App 内容；旧 V1 内容接口固定使用原赛电范围，未分类旧文章继续可见。
   - 协议沿用既有文档类型对应的产品归属；客服与更新按既有设置键显示对应 App，不改动现有配置值。

## 数据库迁移独立审查

- 文件：`apps/api/prisma/migrations/20261006123000_article_product_scope/migration.sql`。
- 迁移仅新增带常量默认值的非空文本列、取值约束和查询索引，不删除列、不改写正文或发布状态。
- 旧记录自动为 `shared`，避免上线后既有内容消失。
- SQL SHA-256：`213776146a65f609b67bb1e5f89d05aa8b1f17e65754d12b1ef422e1dd142d3d`，已登记到 `deploy/compatible-migrations.json`；SQL 如再变化，发布清单会因摘要不匹配而停止。
- 生产发布脚本会在迁移前检查历史和磁盘并生成数据库备份；迁移失败不会启动新镜像。用户已于 2026-10-06 明确批准将本轮功能与 schema 迁移推送并部署到生产。

## 验证记录

- `pnpm db:generate`：通过。
- `$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/saydian_validate'; pnpm --filter @saydian/app-api exec prisma format; pnpm --filter @saydian/app-api exec prisma validate`：通过；使用无真实凭据的仅校验连接串，没有连接数据库。
- `pnpm --filter @saydian/app-api exec vitest run src/admin/commerce-admin.test.ts src/admin/admin-content-locale.test.ts src/content/global-content.test.ts --maxWorkers=1`：37 项通过。
- `pnpm --filter @saydian/app-admin-web exec vitest run src/product-sku-quick-editor.test.ts src/content-editor.test.ts src/member-resource-view.test.ts --maxWorkers=1`：76 项通过。
- `node --test tools/h5-frontend.test.mjs`：19 项通过。
- `pnpm --filter @saydian/app-shop test`：134 项通过；首次全量测试发现 3 条旧断言仍要求默认展开，已改为验证默认收起、手动展开后继续兑换优惠码与填写备注。
- `pnpm test:h5:flows`：62 项通过。
- `pnpm test:h5:contracts`：H5 构建通过，38 项契约/集成测试通过。
- `pnpm api:docs; pnpm api:docs:check`：379 条路由全部有说明并通过一致性检查。
- `pnpm typecheck`：通过；`pnpm build`：全部应用构建通过。H5 仍有既有 Sass 弃用提示，后台仍有既有大 chunk 提示，均未阻断构建。
- `pnpm test`：商城、后台、Worker、下载页、共享包及 API 其余测试通过；API 为 981 项通过、7 项数据库测试按配置跳过、3 项 `say-ring-avatar-store.test.ts` 在 Windows 本地硬链接行为下失败。该失败与本轮文件无关，Linux CI 继续作为提交后的强制门禁。
- `pnpm tools:test`：首次因 Windows `PATH` 找不到 Bash 等 POSIX 工具出现 10 项夹具失败；指定 Git Bash 并把临时目录移入工作区后为 40/47 通过。剩余 7 项是 Windows 下 shebang、路径或 `chmod/install` 权限语义差异；接口目录、契约、Git 安全流程和迁移精确审核测试已通过，Linux CI 仍须全部通过。
- `git diff --check`：通过。
- Node SHA-256 独立复算：迁移文件与兼容清单均为 `213776146a65f609b67bb1e5f89d05aa8b1f17e65754d12b1ef422e1dd142d3d`。

## 尚待验收

- 当前尚未提交、推送或部署；没有修改生产数据库。发布批准已取得，下一步按显式文件清单提交并推送。
- Linux CI 仍须完成全部工具测试、PostgreSQL 新库迁移、HTTP 契约、备份恢复演练和三镜像验证；随后核对生产迁移备份、部署任务、双 readiness revision、后台三个分类筛选、商品/SKU 实际上传以及 H5 默认收起。

## 发布尝试

- 获得批准后两次调用 `tools/Publish-Change.ps1`，均在任何暂存或提交之前的 `git fetch origin --prune` 阶段停止：第一次为连接被重置，第二次为 GitHub 443 端口连接超时。`Test-NetConnection github.com -Port 443` 同期返回失败；没有据此声称远端已更新或生产已发布。
- 发布前最近一次成功 fetch 已确认本地 `HEAD` 与 `origin/main` 均为 `ed801b568d626bc5be54a9a4edb9137290d70772`。网络恢复后的普通 push 必须保持快进，远端如变化则停止并重新衔接，禁止强推。
