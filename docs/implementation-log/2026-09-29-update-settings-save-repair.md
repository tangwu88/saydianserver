# 2026-09-29 客服与更新保存失败修复

## 原因与范围

- 用户在国际后台编辑 Say Ring 更新配置时看到通用英文失败提示；空草稿还曾提示 `publishedAt 长度无效`、`android.versionName 长度无效`。
- 修改前读取工作约定、交接和最近实施记录；`git status --short --branch` 干净。原工作区位于已分叉的功能分支，`Start-Change.ps1` 按规则停止；切换到干净的 `main` 后重试，`git fetch origin --prune` 和 `git merge --ff-only origin/main` 通过，基线为 `7d355a4ee65146c16f2e056cafe4cf1813cefc92`。
- 只读线上核对：`https://app.saydian.cn/global/health` 返回 `ready`，国际 API revision 为 `a134be05e02fb7c48063345a4d87ef06362caa81`；`/admin/` 现有脚本包含“应用市场链接”和 HarmonyOS。该 API 源码的下载契约不支持 `market`，会拒绝截图中的 Android 市场链接；国际异常过滤器将无 `errorKey` 的中文校验消息替换成通用英文。
- 国内 `/health/ready` 的 revision 为本轮基线 `7d355a4ee65146c16f2e056cafe4cf1813cefc92`。本轮不修改数据库结构、真实版本数据、维护开关或供应商配置。

## 修改内容

- `apps/admin-web/src/download-setting.ts`：保存前给空发布时间、三端版本号/构建号提供中文可操作提示，避免直接暴露契约字段名和“长度无效”。
- `apps/admin-web/src/views/ResourceView.vue`：明确保存所需字段及待开放平台不需下载链接。
- `apps/api/src/admin/admin.service.ts`：下载清单校验失败附带 `download_manifest_invalid` 错误码，让国际后台收到实际字段原因。
- `apps/admin-web/src/global-download-setting.test.ts`、`apps/api/src/admin/admin-global-content.test.ts`：覆盖空草稿提示、截图形式的完整编辑值与 Android 市场链接保存。

## 命令与结果

- `pnpm --filter @saydian/app-contracts build`：通过。
- `pnpm --filter @saydian/app-admin-web exec vitest run src/global-download-setting.test.ts`：首次修改后 8/8 通过；新增截图回归用例后待复跑。
- `pnpm --filter @saydian/app-api exec vitest run src/admin/admin-global-content.test.ts`：17/17 通过。
- `node deploy/global/check.mjs`：187 项结构检查通过；本机没有 Docker Compose，运行时解析与 Nginx 容器验收未执行。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- 根级接口文档、工具、类型、全量单测、构建、部署脚本和最终差异检查：待本轮完成后补记。

## 失败与修复

- 首次 `Start-Change.ps1` 在旧功能分支按规则拒绝；切换干净 `main` 后，第一次 GitHub fetch 连接重置，重试成功并安全快进。
- 首次 `Publish-Change.ps1` 在提交前 fetch 遇到 GitHub 连接重置；重试后接口文档与工具检查通过，但类型检查指出回归测试直接访问 Prisma `Json` 字段缺少窄化。修正测试读取的类型断言后重跑全套门禁，未暂存或提交失败版本。
- 国际 API 与后台页面部署 revision 不一致，需要将已通过验证的市场链接契约发布到国际环境；仅推送国内 `main` 不会让国际 API 自动升级。

## 尚未验收

- 本轮代码提交、GitHub CI、国内与国际部署、国际后台真实账号保存回读，均需在后续步骤核对。

- 2026-09-29T03:38:14.0368019Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-29T03:39:11.8162579Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-29T03:39:37.0735605Z：pnpm.cmd typecheck，退出码 2。

- 2026-09-29T03:40:28.3879935Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-29T03:41:00.5059858Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-29T03:41:21.9540701Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-29T03:42:13.5377543Z：pnpm.cmd test，退出码 0。

- 2026-09-29T03:42:52.5168013Z：pnpm.cmd build，退出码 0。
