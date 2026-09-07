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
- 待执行：推送 `main`，等待 CI/生产发布，验证公网文件完整 SHA-256、断点下载、清单、`/down` 和健康探针。

- 2026-09-07T02:56:20.6047840Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T02:56:26.2312390Z：pnpm tools:test，退出码 0。

- 2026-09-07T02:56:31.0317580Z：pnpm typecheck，退出码 0。

- 2026-09-07T02:56:34.8464080Z：pnpm test，退出码 0。

- 2026-09-07T02:56:44.2596710Z：pnpm build，退出码 0。
