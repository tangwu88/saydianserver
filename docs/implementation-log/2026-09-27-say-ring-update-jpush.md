# 2026-09-27 Say Ring 在线更新与极光推送

## 原因与范围

- Say Ring Android 包名为 `cn.saydian.ring`，不能继续读取包名为 `cn.saydian.app.global` 的旧国际 App 更新清单。
- 一个极光 Android 应用绑定一个包名；Say Ring 的 AppKey、Master Secret 和 Registration ID 必须与旧 App 分开。
- 本轮增加独立的后台配置、更新清单选择和推送路由，不修改数据库结构，不写入真实供应商密钥，不发布或上传安装包。

## 修改文件与预期结果

- `apps/api/src/support/*`：`product=say-ring` 只读取 `say_ring_app_update`，并校验 Say Ring 三端包标识。
- `apps/api/src/admin/admin.service.ts`：允许国际后台读取和保存 Say Ring 独立更新配置。
- `apps/admin-web/src/global-download-setting.ts`、`views/ResourceView.vue`：增加“Say Ring App 更新”表单；Android/iOS 可见，隐藏尚未纳入产品范围的 HarmonyOS 编辑卡片，但清单仍保留明确的待开放项。
- `apps/admin-web/src/integration-settings.ts`：增加“Say Ring 极光推送”，说明后台与安装包必须使用同一极光应用。
- `apps/api/src/notifications/notifications.service.ts`：把带 `product=say-ring` 的 JPush 登记存为独立内部 provider。
- `apps/worker/src/push-provider.ts`：分别加载 `push` 与 `say_ring_push`，只向对应 Registration ID 发送。
- `.env.example`、`deploy/.env.production.example`、`compose.yaml`：提供可选的 Say Ring 极光环境变量回退，不包含真实值。
- `tools/api-notes.mjs`、接口文档和测试：记录并验证新契约。

## 验证记录

- 定向测试：API 3 个文件 24 项、Worker 2 项、后台配置及会员视图 72 项，全部通过。
- `pnpm api:docs` 与 `pnpm api:docs:check`：重新生成并校验 358 条接口说明，通过。
- `pnpm tools:test`：工具检查 10/10、H5 流程 61/61、H5 契约 38/38，通过。
- `pnpm typecheck`：全部工作区通过。
- `pnpm test`：商城 134、后台 135、API 802（另 4 项数据库测试按环境跳过）、Worker 49、下载页 10、迁移器 9、共享契约 11、交易域 28，全部执行项通过。
- `pnpm build`：商城、后台、API、Worker、下载页与共享包全部构建通过；保留既有 Sass 弃用和后台大分包提示，不是本轮失败。
- `node deploy/global/check.mjs`：184 项结构检查通过；本机没有 Docker Compose，因此原生 compose 展开和 nginx 容器运行检查仍未执行。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过。

## 失败与修复

- `tools/Start-Change.ps1` 因原工作区位于 `codex/global-api-foundation` 而非 `main` 主动停止，没有修改文件。随后确认工作区干净、抓取远端，并从 `origin/main@51e02549cb6e393c6a481f208ecfcf75a8d1a509` 创建 `codex/say-ring-update-push`，避免把已分叉历史带入本轮。
- 后台首次类型检查发现包标识类型被旧国际 App 的字面量锁死，无法接收 `cn.saydian.ring`；改为按平台键约束的字符串映射后，定向和全量类型检查均通过。

## 尚未验收

- 后台尚未填写 Say Ring 极光 AppKey 与 Master Secret，Worker 尚未重启加载配置，真实通知送达未验收。
- Say Ring 当前 QA 包未内置真实 AppKey；正式构建必须通过受保护构建环境注入与后台同一 AppKey。
- 线上更新仍需上传同包名、同签名的不可变 APK，并在后台填写真实版本、构建号、字节数和 SHA-256 后才能验证。
- 生产数据库、旧后台、共享商城和现有配置未修改。

- 2026-09-27T11:41:41.7758311Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-27T11:42:32.9997751Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-27T11:42:56.3001485Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-27T11:43:47.1158144Z：pnpm.cmd test，退出码 0。

- 2026-09-27T11:44:23.6520534Z：pnpm.cmd build，退出码 0。
