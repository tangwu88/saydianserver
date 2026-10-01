# 2026-09-29 Say Ring AI 内容显示开关（国际部署分支）

## 修改前与范围

- 用户要求后台新增开关：开启时隐藏 App 中 AI 相关内容，完成后同步 Git、发布线上后台并调试 App。
- 主工作区保持既有法律文档工作；本轮先在独立 main worktree `E:\saydian-ai-visibility-20260929`、基线 `3dab610c447ad2ce92e63b73ed65c3781580b46b` 实现功能。
- 本记录对应独立国际 worktree `E:\saydian-ai-global-20260929`，分支 `codex/say-ring-ai-global-20260929`，fetch 后从 `origin/codex/global-api-foundation` 的 `ed5052aefa10247fefe6fae0258b18e1a12c8816` 建立。已读 AGENTS、handoff 和最近高德地图实施记录。
- 精确移植本次 API、后台 UI、相关回归测试及接口说明；保留国际 `say_ring_map` 设置、高德 Key 加密保存与运动轨迹接口，不移植 main 发布 hook。
- 复用 AppSetting，不增加数据库 migration；开关只控制 Say Ring 的 AI 内容展示，不修改既有 AI 供应商凭据或历史健康数据。

## 契约与文件

- 设置键 `say_ring_app_display`，值 `{hideAi:boolean}`。开启 true 表示隐藏，关闭 false 表示显示；保存必须公开，不保存任意额外 JSON 字段。
- `GET /global/api/saydian-app/v2/support/app-display?product=say-ring` 返回 `{product:'say-ring',hideAi:boolean}` 标准响应包裹，设置 `Cache-Control:no-store`。各部署数据库隔离，禁止产品回退。
- 未配置时返回 false 保持旧行为；保存值损坏返回真实不可用，不将字符串隐式转换为布尔值。
- 后台“客服与更新”增加 Say Ring 显示设置专用开关；App 读取公开接口并缓存，启动/回前台刷新，AI 问答、健康报告及 AI 相关入口和内容随开关隐藏。
- 修改 `apps/api/src/admin/admin.service.ts`、`apps/api/src/support/support.service.ts` 和 `support.controller.ts`、对应 API 测试、`apps/admin-web/src/views/ResourceView.vue` 及会员资源视图测试、`tools/api-notes.mjs`；接口生成产物在本分支重新生成。

## 验证与发布

- `pnpm install --frozen-lockfile --offline`、`pnpm db:generate` 通过；仅生成本地 Prisma Client，未执行数据库 migration。
- `pnpm api:docs`、`pnpm api:docs:check` 通过，351 条路由均有说明。
- `pnpm tools:test` 通过：工具 10 项、H5 流程 61 项、H5 契约 38 项。
- `pnpm typecheck` 通过。
- `pnpm test` 通过：API 813 项通过、4 项既有数据库测试按条件跳过；后台 141 项（资源视图 40 项）；H5 132 项；Worker 49 项；迁移器 9 项；商务领域 28 项；共享契约 12 项；下载页 11 项。
- `pnpm build` 通过。既有 Sass 弃用与后台大包警告仍存在，不影响本次构建。
- `node deploy/global/check.mjs` 187 项结构检查通过；本机无 Docker Compose，运行时 Compose/Nginx 检查未验收。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs` 8 项通过；`git diff --check` 通过。
- 提交、GitHub CI、国际线上 revision 与 App 真机开关刷新仍由本轮发布步骤继续核对；本记录不把代码通过或 Git push 写作已部署。
- 移植时两次 `apply_patch` 因国际基线在相邻位置已有地图接口/商品接口差异而未应用，缩小上下文后精确移植成功；未覆盖整文件、未移除国际既有代码。
