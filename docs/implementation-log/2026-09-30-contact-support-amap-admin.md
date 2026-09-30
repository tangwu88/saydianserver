# 2026-09-30 Say Ring 客服页配套与高德地图后台上线

## 修改前检查

- 服务端工作树：`E:\saydian-ai-visibility-20260929`，修改前 `HEAD=37ff0faa4eaca64ee270c0bf4d804a816ab26f14`，`main` 与 `origin/main` 一致且工作树干净。
- 已执行 `tools/Start-Change.ps1`、`git status --short --branch`、`git remote -v`、`git fetch origin --prune`；没有覆盖原工作区的法律文档改动。
- 已阅读 `AGENTS.md`、`docs/handoff.md`、最近的 AI 显示配置记录，以及高德运动地图原实施与主线同步记录。

## 原因、范围与预期

- 用户要求线上后台加入高德地图配置。此前实现只在国际分支和未合入主线的同步分支中，线上 `/admin/settings` 使用主线构建，因此看不到“Say Ring 运动地图”。
- 本轮把既有高德 Web 服务配置、安全存储、轨迹静态图接口、后台编辑器和测试合入当前主线，同时保留已上线的 `say_ring_app_display`，不互相覆盖。
- 后台只接收高德“Web 服务 API”Key；Key 通过现有集成密钥服务加密保存，不写入 AppSetting、响应、源码或日志。公开配置只返回是否可用，运动轨迹图片接口要求会员会话。
- 不写入真实 Key，不修改数据库结构，不修改生产数据、维护状态、DNS 或外部供应商配置。Key 留给管理员在上线后的“设置 → Say Ring 运动地图”中填写。

## 文件与影响

- 管理后台：设置列表、地图启用开关、Key 状态和密码输入框；与 Say Ring AI 显示开关并存。
- API：全局环境地图配置、GPS 至高德坐标转换、静态轨迹图片代理及输入/大小/类型限制；非全局环境保持关闭。
- 契约与文档：新增运动地图配置和轨迹图片路由说明。
- App 联系客服页面的视觉与交互修改位于独立 `tangwu88/SayRing` 仓库，不在本服务端提交中混入。

## 验证记录

- 定向 API 与管理后台测试：3 个文件、67 项通过，覆盖高德配置白名单、密钥不落 AppSetting、后台编辑器和轨迹图参数/响应限制。
- `pnpm api:docs`：成功生成；API catalog 共 363 条路由且全部有说明。
- `pnpm db:generate`：成功生成 Prisma Client；本轮无 schema 变化、未执行数据库迁移。
- `pnpm api:docs:check`：363 条路由校验通过。
- `pnpm tools:test`：18 项工具测试、61 项 H5 流程测试、38 项 H5 契约测试全部通过；H5 构建通过，仅有既有 Sass 弃用提示。
- `pnpm typecheck`：8 个工作区项目类型检查通过。
- `pnpm test`：contracts 12、commerce-domain 28、migrator 9、shop 134、admin-web 142、API 826、download-web 11、worker 49，共 1211 项通过；API 数据库集成 4 项按既有门禁跳过。
- `pnpm build`：contracts、commerce-domain、migrator、shop、admin-web、API、download-web、worker 全部构建通过；仅保留既有 Sass 弃用与管理后台大 chunk 提示。
- `git diff --check`：通过。
- 提交、GitHub Actions 与线上版本核对在发布步骤后执行；仅推送成功不能写为已部署。

- 2026-09-30T04:14:04.2856219Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-30T04:15:21.3125913Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-30T04:15:44.7380172Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-30T04:15:53.4737712Z：pnpm.cmd test，退出码 1。

- 2026-09-30T04:17:08.8343454Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-30T04:18:24.0886531Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-30T04:18:46.0168250Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-30T04:19:28.8913453Z：pnpm.cmd test，退出码 0。

- 2026-09-30T04:20:04.7730634Z：pnpm.cmd build，退出码 0。
