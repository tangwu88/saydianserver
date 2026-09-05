# 2026-09-06 App 三端下载引导页实施记录

## 目标与边界

- 新增公开、无需登录的 `/down`，展示 Android、iPhone 和 HarmonyOS 三端内部测试版。
- 页面不自动下载；Android 与 HarmonyOS 仅提供经核对的版本化安装包；iPhone 在取得真实 TestFlight 地址前保持禁用。
- 原 APK、HAP 和 Logo 只读；仅复制到发布目录，安装包不进 Git。

## 实施内容

1. 新增 `apps/download-web` Vite/TypeScript 应用，包含设备识别、三端卡片、桌面二维码、安装步骤、SHA-256 和健康数据声明。
2. 新增 `DownloadManifest v1` 共享合约；校验三端唯一性、状态、同源直下载路径、文件名、大小和 SHA-256，iPhone 只允许受信的 TestFlight/App Store HTTPS 地址。
3. Admin 保存 `app_update` 时执行合约校验；公开接口对已存数据再校验，异常配置失败关闭。
4. Admin 镜像构建下载页，生产 Compose 只读挂载 `deploy/downloads`；Nginx、Caddy 与共享网关同时处理 `/down`、`/down/` 和 `/down/files/*`。
5. 重写共享网关托管块更新逻辑：更新前备份，精确替换旧块，通过 `nginx -t` 后重载，失败自动回滚。
6. 新增独立静态容器和热路由脚本，用于在旧 API/Admin 镜像尚未滚动时安全先行上线下载页。

## 安装包证据

- Android `Saydian-Android-0.1.19-build23-QA.apk`：64,401,320 字节，SHA-256 `d81d46ed1b100b13aca43bf3e0323a5c0d2e1004840831a10c2f3cd385c1bf26`，QA/Debug 测试签名。
- HarmonyOS `Saydian-HarmonyOS-0.1.3-build5.hap`：8,595,228 字节，SHA-256 `22c03c4b88448e11412f1bb1397275760aa29e72135d395e008f97d53b40358f`，已校验 AppGallery Release 签名。
- iPhone `0.1.19（23）`：`coming_soon`，无 IPA、TestFlight 或虚假链接。

## 生产发布与验收

- 安装包已以不覆盖文件名复制到 `/opt/saydianapp-server/deploy/downloads`，服务器端大小和 SHA-256 与原包一致。
- 静态页以只读 Nginx 容器 `saydianapp-production-download-1` 运行，共享网关语法校验与重载通过。
- 网关原配置备份为 `/opt/saydian/config/gateway-nginx.conf.before-download-20260905T170351Z`。
- 生产仍运行旧 API 响应包装；已通过数据库 upsert 发布同一份受审 manifest，新页兼容旧包装与新直接 manifest 两种过渡格式。
- 公网 `/down` 与 `/down/` 返回 200 且无需登录；桌面实机浏览器与 390×844 Android 视口已验证三端布局、版本、按钮状态和二维码。
- 公网完整下载的 APK/HAP 大小和 SHA-256 均与原包一致；APK `Range: bytes=0-1023` 返回 206、1,024 字节和正确 `Content-Range`。
- Android 签名不一致时明确要求停止安装，未引导卸载；健康数据明确不用于诊断或治疗。

## 测试与构建

- 定向验证已通过：Contracts 6/6、下载页 10/10、API 75/75、工具 5/5。
- 下载页类型检查与 Vite 构建通过；接口文档目录与说明已同步。
- 源码发布前使用 `Publish-Change.ps1` 串行执行文档检查、工具测试、类型检查、全量测试、全量构建和 `git diff --check`，详细退出码由发布脚本追加。

## 失败、根因与修复

1. 生产旧 API 的公开设置接口返回 `{value, public}` 包装，而新源码返回直接 manifest。页面增加有限过渡解析并补充 3 个单测。
2. 旧管理员初始密码已被修改，无法使用旧密码调用 Admin 发布接口。本次仅对 `app_update` 执行精确 upsert，立即从公开接口回读验证，未重置密码。
3. 本机无 Docker CLI，不能本地执行镜像构建；生产专用静态 Nginx 容器已实际启动并通过 `nginx -t`。

## 未验收

- 待真实 TestFlight 或 App Store 地址取得后，通过后台校验后再开放 iPhone 按钮。
- Android 使用 QA 签名，尚需测试机在保留本地数据前提下完成升级签名兼容验收。
- 源码推送后仍需核对 GitHub Actions 与自动发布结果；页面的实际生产可用性不依赖该次滚动。
- 公网 `/admin/` 和 `/health/ready` 回归返回 200；现有 `/saidian-mall/` 仍返回 404。下载热路由未改动该路由，但商城回归不能标记为已通过，待新 Admin 镜像自动发布后复验。

- 2026-09-05T17:18:49.5356240Z：pnpm api:docs:check，退出码 0。

- 2026-09-05T17:19:04.5999490Z：pnpm tools:test，退出码 0。

- 2026-09-05T17:19:23.8651300Z：pnpm typecheck，退出码 0。

- 2026-09-05T17:19:38.3519470Z：pnpm test，退出码 0。

- 2026-09-05T17:20:05.2934780Z：pnpm build，退出码 0。
