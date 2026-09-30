# 2026-09-30 国际客服配置兼容与专用编辑器

## 修改前检查

- 最初在独立工作树 `E:\saydian-ai-visibility-20260929`、基线 `6896df3564cc3ddf48f3af49ec25c12816fc48f0` 完成修改。发布前远端新增不重叠的 iOS Universal Link 提交 `449227c248d863b0665011f5d032314acb1a1826`，安全门禁自动停止旧基线发布；随后在干净发布工作树 `E:\saydian-support-publish-20260930` 快进到该提交，再普通移植本轮文件，没有覆盖或强推远端修改。
- 已执行 `tools/Start-Change.ps1`、`git status --short --branch`、`git remote -v`、`git fetch origin --prune`，并阅读 `AGENTS.md`、`docs/handoff.md` 与最近实施记录。
- 修改前线上 `/health/ready` revision 为 `6896df3564cc3ddf48f3af49ec25c12816fc48f0`；`/global/api/v1/support/public-config` 返回了历史错误结构 `{"configured":13600136000}`。高德地图后台入口已在线，但公开配置为 `provider=amap, configured=false`，尚未填写真实 Key。

## 原因、范围与预期

- 国际客服此前仍使用通用 JSON 编辑器，线上历史值把手机号错误写入 `configured`，导致 App 无法安全判断是否已配置。
- 增加国际客服专用编辑器，明确提供启用开关、客服电话、微信公众号、服务时间和客服说明；保存时生成严格结构。
- 读取端只白名单输出 App 需要的公开字段，并兼容已存在的数字/字符串旧 `configured` 值为客服电话；不回传其他未知字段。
- 写入端拒绝非布尔 `configured`、无效电话、超长字段及启用后没有任何联系方式的数据，避免继续产生坏配置。
- 不修改数据库结构、不自动写入生产设置、不填入高德 Key、不改变维护/只读状态、DNS 或外部供应商配置。

## 修改文件

- `apps/api/src/support/global-support-config.ts`：国际客服配置解析、旧数据兼容与公开白名单。
- `apps/api/src/support/support.service.ts`：国际环境公开配置使用规范化结果，国内环境保持原契约。
- `apps/api/src/admin/admin.service.ts`：国际客服后台写入使用严格校验。
- `apps/admin-web/src/views/ResourceView.vue`：国际客服专用表单；旧数字配置自动回填为电话，管理员保存后转为正确 JSON。
- `apps/api/src/support/support-public-config.test.ts`、`apps/api/src/admin/admin-global-content.test.ts`、`apps/admin-web/src/member-resource-view.test.ts`：回归覆盖旧值兼容、字段白名单、无效写入拒绝和编辑器保存。

## 验证记录

- 定向 API 测试：43 项通过；定向管理后台测试：40 项通过。
- `pnpm api:docs:check`：363 条路由校验通过。
- `pnpm tools:test`：18 项工具、61 项 H5 流程、38 项 H5 契约测试通过，H5 构建成功；仅有既有 Sass 弃用提示。
- `pnpm typecheck`：8 个工作区项目通过。
- `pnpm test`：contracts 12、commerce-domain 28、migrator 9、shop 134、admin-web 143、API 830、download-web 11、worker 49，共 1216 项通过；API 数据库集成 4 项按既有门禁跳过。
- `pnpm build`：contracts、commerce-domain、migrator、shop、admin-web、API、download-web、worker 全部构建通过；保留既有 Sass 弃用与管理后台大 chunk 提示。
- `git diff --check`：通过。

## 失败与修复保留

- 管理后台定向测试首轮使用了不受产品契约支持的 `email` 示例，并仍期望旧通用状态文案；改为实际支持的公众号字段和专用编辑器状态文案后，40 项全部通过。
- 初次运行格式化工具导致历史压缩文件产生大范围机械重排；提交前使用大行宽机械收敛，保留逻辑修改并重新执行受影响的定向测试。
- 首次调用发布脚本时检测到 `origin/main` 已前进，脚本在暂存和推送前停止；核对新提交文件与客服配置无重叠后，改从最新主线建立干净工作树重新执行全套门禁。
- 新发布工作树首次执行全量门禁时，因刚安装依赖后尚未生成 Prisma Client，`commerce-domain` 类型检查缺少 `Prisma/RefundStatus` 而停止，且没有暂存或推送；执行 `pnpm db:generate` 成功后从头重跑发布门禁。

## 发布与待验收

- Git 提交、GitHub Actions 与线上 revision/资源/接口核对将在发布完成后补记；仅推送成功不能写成已部署。
- 线上兼容发布后，现有手机号应立即恢复为有效公开配置；管理员仍应在“设置 → 国际版客服”中核对并保存标准结构。
- 高德地图配置入口位于“设置 → Say Ring 运动地图”。没有真实高德 Web 服务 Key 时保持 `configured=false` 是预期状态。

- 2026-09-30T08:24:03.8343374Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-30T08:25:40.3335726Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-30T08:25:45.6729037Z：pnpm.cmd typecheck，退出码 2。

- 2026-09-30T08:26:43.4034722Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-30T08:27:55.5771265Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-30T08:28:24.7172457Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-30T08:29:13.2152115Z：pnpm.cmd test，退出码 0。

- 2026-09-30T08:29:53.9138133Z：pnpm.cmd build，退出码 0。

- 2026-09-30T08:31:02.9897215Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-30T08:32:16.1116016Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-30T08:32:40.0010181Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-30T08:33:27.9462384Z：pnpm.cmd test，退出码 0。

- 2026-09-30T08:34:07.3593479Z：pnpm.cmd build，退出码 0。
