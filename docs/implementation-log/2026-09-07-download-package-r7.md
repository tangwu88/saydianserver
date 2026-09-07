# 2026-09-07 下载页 HarmonyOS r7 更新记录

## 目标与范围

- 将 `/down` 的 HarmonyOS 包更新到私有 App 仓库最新预发布 `qa-20260907-r7`。
- Android 仍使用 `qa-20260907-r6` 的 QA Release；iPhone 没有 TestFlight/App Store 地址，保持待开放。
- 安装包不进 Git；Release 原文和原始附件不修改。

## 发布依据

- 标签：`qa-20260907-r7`，发布名“赛电鸿蒙运动与记录验证包 2026-09-07（0.1.4 / r13）”。
- 文件：`Saydian-Harmony-0.1.4-build8-r13-Release-development-signed.hap`。
- 大小：9,394,620 字节。
- SHA-256：`1efe85575a9f79ecebd373fd402704a212db3503d01bb606b6ced661c98d0795`，与 Release `SHA256SUMS` 和 GitHub 资产摘要一致。
- 签名边界：Release 仍使用开发 Profile，只能在已登记设备上安装，不等于 AppGallery 正式发行签名。

## 实现

- 更新 `deploy/app-update.internal-test.json` 中 HarmonyOS 版本、构建号、文件名、大小和哈希。
- 人工生产工作流可接收 GitHub 短期 Release 资产地址，在 Runner 和服务器两端校验文件名、字节数和 SHA-256。
- 服务器只会新增不可变版本文件；同名文件必须完全一致，不覆盖差异内容。
- 显式启用发布标记时，数据库备份后才更新 `app_update`；公网回读失败时恢复原设置。
- 自动代码发布未携带上述显式输入时，不会覆盖后台编辑的下载配置。

## 验证记录

- `pnpm api:docs:check` 通过：271 条路由完整且文档一致。
- `pnpm tools:test` 通过：5/5，包含部署 Shell 语法和安全约束。
- `pnpm typecheck` 通过；`pnpm test` 通过 107/107；`pnpm build` 全部应用构建通过。
- `git diff --check` 通过。
- 首次提交 `c8aa8932186b2cdf1c8a0a8034be17002f7d1d88`：CI 全量验证和三个镜像构建通过，自动部署失败。原因是普通发布也会带上 `deploy/downloads/.gitignore`，脚本把“目录存在”误判为“已携带安装包”，在备份和容器变更前安全退出。
- 修正为仅在 `SHA256SUMS` 存在时进入安装包流程；若出现 APK/HAP 但缺少校验清单，仍硬失败。
- 修正提交 `376bf918980aa207b019ae7adbb8b49bea087b24` 的全量 CI 再次通过；生产服务器从 GHCR 拉取镜像层长时间无进展，下载页和健康探针期间一直正常，未切换线上修订。确认仓库管理员凭据后取消该次卡住的发布，未修改生产配置。
- 新增显式 `package_only` 模式：跳过镜像构建和服务器镜像拉取，只执行数据库备份、包校验/不可变落盘、清单更新和公网回读；应用容器和线上修订保持不变。
- 新模式首次 `pnpm tools:test` 为 4/5：新增静态断言误在工作流文件中查找服务器脚本的输出文案。已将该断言分别对准工作流的 `PACKAGE_ONLY` 与服务器脚本的修订不变文案，不改业务实现。
- `Publish-Change.ps1` 首次执行的全量检查通过，但提交前第二次 `git fetch origin` 因 `LibreSSL SSL_ERROR_SYSCALL` 停止；脚本未暂存或提交文件，现场保留后重试。
- 待执行：推送 `main`，等待 CI/生产发布，验证公网文件完整 SHA-256、断点下载、清单、`/down` 和健康探针。

- 2026-09-07T02:56:20.6047840Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T02:56:26.2312390Z：pnpm tools:test，退出码 0。

- 2026-09-07T02:56:31.0317580Z：pnpm typecheck，退出码 0。

- 2026-09-07T02:56:34.8464080Z：pnpm test，退出码 0。

- 2026-09-07T02:56:44.2596710Z：pnpm build，退出码 0。

- 2026-09-07T03:09:48.0905070Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T03:09:55.3072260Z：pnpm tools:test，退出码 0。

- 2026-09-07T03:10:02.8810280Z：pnpm typecheck，退出码 0。

- 2026-09-07T03:10:09.6945560Z：pnpm test，退出码 0。

- 2026-09-07T03:10:24.3016560Z：pnpm build，退出码 0。

- 2026-09-07T03:59:25.1166360Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T03:59:30.6497280Z：pnpm tools:test，退出码 0。

- 2026-09-07T03:59:35.4998260Z：pnpm typecheck，退出码 0。

- 2026-09-07T03:59:39.3329220Z：pnpm test，退出码 0。

- 2026-09-07T03:59:49.0292010Z：pnpm build，退出码 0。

- 2026-09-07T04:00:18.4299430Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T04:00:23.9315470Z：pnpm tools:test，退出码 0。

- 2026-09-07T04:00:28.5982320Z：pnpm typecheck，退出码 0。

- 2026-09-07T04:00:32.3762810Z：pnpm test，退出码 0。

- 2026-09-07T04:00:42.0274650Z：pnpm build，退出码 0。
