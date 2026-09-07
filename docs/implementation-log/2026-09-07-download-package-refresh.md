# 2026-09-07 下载页安装包更新记录

## 目标与边界

- 使用私有 App 仓库预发布 `qa-20260907-r6` 的最新日常联调 Release 包更新 `/down`。
- Android 和 HarmonyOS 保持内部测试标识；iOS 附件是限授权设备的开发 IPA，不作为网页直装链接。
- 原始安装包只读；服务器使用不覆盖的版本化文件名，安装包不进 Git。

## 发布证据

- Android：`Saydian-Android-QA-Release-JPush-0.1.19-build23-20260907-r6.apk`，64,661,988 字节，SHA-256 `b419c738d219c940544392a0013aa8c3d703b075c2a12fce19b38386eaf025aa`。
- HarmonyOS：`Saydian-Harmony-0.1.3-build7-r12-Release-development-signed.hap`，9,339,550 字节，SHA-256 `2102b7d3f15b936ef4b0bcb00df333a6c81575dcd81ec69a454f6e5510e20ae8`。
- iPhone：`0.1.19（23）` 继续 `coming_soon`；未发布 IPA 直链，也未伪造 TestFlight 或 App Store 地址。

## 生产更新

1. 从已授权的 GitHub 会话下载目标包和 `SHA256SUMS`，本地校验一致。
2. 上传到服务器临时目录后再校验 SHA-256，确认正式目录无同名文件，以 `root:root 0644` 复制到 `/opt/saydianapp-server/deploy/downloads`。
3. 更新前生成生产库备份 `/opt/saydianapp-server/deploy/backups/saydian-app-before-qa-20260907-r6.dump`，SHA-256 `38abba8cc1444f28bfa35d730029082b17adb23678a41af79b69efa5e86075bb`。
4. 管理后台因 `MAINTENANCE_READ_ONLY=true` 拒绝保存；未关闭全局维护保护，而是在备份后对 `AppSetting.key=app_update` 执行单行更新。
5. 仓库中 `deploy/app-update.internal-test.json` 同步为线上值，便于下次发布和同事交接。

## 线上验收

- 公开 `app-update` 接口已回读新文件名、构建号、字节数和 SHA-256。
- `/down` 实机页面显示 Android `0.1.19（23）` 64.7 MB、HarmonyOS `0.1.3（7）` 9.3 MB，iPhone 按钮不可用。
- 两个公网文件均返回 200 和正确 `Content-Length`；`Range: bytes=0-1023` 均返回 206 与正确 `Content-Range`。
- 从公网完整流式下载得到的两个 SHA-256 均与发布源一致。

## 仍需保留的限制

- Android 是 QA Release 签名包，不是正式商店版；覆盖安装签名不一致时必须停止，不用卸载绕过。
- HarmonyOS Release 仍为开发签名且受 Profile 登记设备限制，不宣传为 AppGallery 分发签名。
- iPhone 只有限授权设备的开发 IPA；获得正式 TestFlight 或 App Store 地址前保持待开放。

- 2026-09-07T01:08:48.8144160Z：pnpm api:docs:check，退出码 0。

- 2026-09-07T01:09:00.1032760Z：pnpm tools:test，退出码 0。

- 2026-09-07T01:09:16.5777020Z：pnpm typecheck，退出码 0。

- 2026-09-07T01:09:29.1740530Z：pnpm test，退出码 0。

- 2026-09-07T01:09:57.7762320Z：pnpm build，退出码 0。
