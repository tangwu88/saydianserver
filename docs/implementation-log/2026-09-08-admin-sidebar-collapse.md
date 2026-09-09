# 2026-09-08 管理后台侧栏折叠菜单

## 目标与边界

- 将管理后台侧栏的“总览、会员与健康、商城、运营、系统”改为可点击展开/收起的主菜单。
- 页面首次加载时全部主菜单默认收起，子菜单仅在点击对应主菜单后显示。
- 主菜单字号调整为 `16px` 并加粗；保留子菜单路由跳转和当前路由高亮。
- 仅修改管理后台侧栏，不改 API、商城、数据库、权限或生产配置。

## 修改与处理

- `apps/admin-web/src/views/AppShell.vue`
  - 将静态分组标题和始终可见的菜单项替换为 Element Plus `el-sub-menu`。
  - 给各主菜单设置稳定索引，使用 `default-openeds=[]` 表达默认收起状态。
  - Element Plus 会因当前激活子路由自动展开父菜单，因此在组件挂载并完成首轮渲染后显式关闭全部分组，确保刷新任意子页面时仍符合“默认关闭”。
  - 使用 scoped deep 样式将主菜单标题设为浅色、`16px`、`font-weight: 700`。

## 命令与结果

- `pwsh -NoProfile -File .\tools\Start-Change.ps1 -Resume`：通过；当前 `main` 的本地 HEAD 与 `origin/main` 一致，保留上一轮已审阅的未提交改动，没有执行合并。
- `pnpm --filter @saydian/app-admin-web typecheck`：通过。
- `pnpm --filter @saydian/app-admin-web test`：通过，2 个测试文件、6 个用例通过。
- `pnpm --filter @saydian/app-admin-web build`：通过，1689 个模块完成转换；保留现有大 chunk 提示。
- `pnpm api:docs:check`：通过，271 条路由完整。
- `pnpm tools:test`：通过，5 项工具和部署脚本检查通过。
- `pnpm typecheck`：全 workspace 通过。
- `pnpm test`：全 workspace 通过；其中 API 19 个测试文件、75 个用例通过，管理后台 6 个用例通过。
- `pnpm build`：全 workspace 通过；保留现有 Sass legacy API 和管理后台 chunk 大小提示。
- `git diff --check`：通过。

## 浏览器验收

- 在 Codex 内部浏览器刷新 `http://localhost:5173/admin/api-docs`，确认五个主菜单全部处于 collapsed 状态，当前子路由不会强制展开“系统”。
- 点击“会员与健康”后，会员与健康档案、远程关爱、健康预警、健康报告、报告方案、设备共 6 个子菜单显示。
- 点击“会员与健康档案”后正常进入 `/admin/members`，再点击“会员与健康”可收起子菜单。
- 截图检查确认五个主菜单字号增大且加粗，折叠箭头可见。

## 失败与修复

- 首版只设置 `default-openeds=[]` 时，当前位于 `/admin/api-docs` 会让 Element Plus 自动展开“系统”。增加组件挂载后的显式关闭逻辑后，刷新任意子页面均默认收起。
- 辅助功能树对父菜单的 `Collapse` 次要操作未触发页面变化；改为点击可见主菜单文本后正常收起。这是验收工具操作差异，页面鼠标点击行为正常。

## 未验收事项

- 本轮未提交、未推送、未部署生产环境。
- Redis、Worker、MinIO 及短信、AI、推送、支付、企业微信、聚水潭等外部集成仍未配置/未验收，与本轮侧栏改动无关。
