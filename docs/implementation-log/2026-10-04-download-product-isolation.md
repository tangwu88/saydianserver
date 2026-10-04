# 产品下载入口隔离与等待审核状态 — 2026-10-04

## 范围与基线

- Health 联调任务传达用户的新授权：停止安卓实机测试，全面更新下载页相关入口和地址。只维护下载页面、下载元数据编辑和静态路由；不修改健康 API、账号库、签名、数据库 schema、云权限或其他 App 源码。不构建鸿蒙，不发布新 APK。
- 阅读 AGENTS、交接和最近实施记录；`Start-Change.ps1` 安全同步干净 main，HEAD 与 origin/main 都为 `d0b97acf37b9b4d29a0f5ba1924478a9b4f74377`。上次 [CI 37144213699](https://github.com/tangwu88/saydianserver/actions/runs/37144213699) 成功。
- 原 `/down` 混合 Health 安卓与原赛电 iPhone/HAP；`/global/down` 为 404。本轮移除混合加载的重复逻辑，复用同一下载前端，按路径只加载一个产品清单。

## 页面、配置与安全边界

- `/down`、`/down/`、`/global/down`、`/global/down/`：Health 专用页面、二维码规范地址 `/global/down`；仅使用 `product=saydian-global`，逐平台校验 Health packageId 和 `/global/` 安装包路径，失败不回退国内包。
- `/down/legacy` 与末尾斜杠：原赛电全部三端清单，保留原 `app_update` 及文件 URL；`/say-ring` 保持独立产品。页首明确切换产品，Health 页尾只链接自身隐私政策、协议、客服和注销页。
- Health 安卓保持 `cn.saydian.app.global`、`1.0.0 (1012)`、68,029,891 bytes，SHA-256 `92a22d88e6b1f8d3f397a6f2c777b94c1079fad92a9925ad60a69fc7f9ddebf6`，文件 `/global/down/files/SAYDIAN-Health-Android-1.0.0-build1012-QA-92a22d88.apk`。明确内部 QA、非 Google Play 正式版，不能覆盖 Windows 签名的 3012，禁止以卸载或清数据强装。
- Health 任务独立完整下载并校验 APK，报告 Android Debug 证书 SHA-256 `1350168096373439fbb4fb80c0acd145f209e06310ddb658ce318d765525cb97`，与旧 Windows 3012 的 `99b006c6394e55f78ad6d71867d5051384a0f64b839fea432e57a7ac9935819e` 不同。本任务不再次运行手机测试，不据此宣布覆盖升级验收。
- Health 任务通过原已登录后台仅将 iOS 改为 `1.0.1 (1013)`、`coming_soon`、无 destination，publishedAt `2026-10-04T10:13:20.018Z`；公开 GET 已读回。Android/HarmonyOS 保持不变，表单保存与页面代码发布分别验收，本任务不重复保存。外部 Beta Review 仍等待审核（由 Health 任务实时核对）。TestFlight `https://testflight.apple.com/join/Tp2ThpNm` 尚不是获准安装证据，不配置为可安装链接。
- 用兼容的可选 `pendingReason=review` 表示 iPhone 等待审核，仍为 coming_soon，禁止 destination；后台支持编辑并保留该字段。现有 Health 1013 元数据尚无此字段，新后台上线后由 Health 任务在原登录会话补设；页面不硬编码版本或猜测审核状态。available 状态只在真实获准后独立发布，不由页面自动开启。
- 原赛电清单保存不变；Say Ring Baidu 占位配置保留但页面禁用该按钮，不猜新下载地址。没有替换或上传安装包。
- 精确 Health 页面代理复用现有 Admin 静态镜像；保留 `/global/down/files/` 内部重写与只读挂载。网关依旧使用唯一托管块、备份、语法检测和失败回滚。自动部署新增对所有页面别名和旧入口的检查，不改变业务开关或发布方式。

## 验证与待完成

- 本地修改前根盘剩余约 2.3 GiB，不新下载 APK、不构建 Docker 镜像；全量源码验证和真实 CI 镜像验证分别记录。没有清理用户文件、旧包或业务数据。
- 实现产品隔离、三平台身份/路径校验、iOS 待审禁用、正式可用链接、错误不回退、旧链接保留、Baidu 占位禁用、编辑器往返、网关幂等/错误上游/重复路由和自动部署失败回退测试。
- 聚焦验证成功：下载页初轮 24/24、后台编辑器 15/15、公开清单 10/10、部署/网关/失败回退 14/14；API 文档已重新生成 377 条。随后补充二维码规范地址和审核字段可清除的回归，最终总数以提交检查输出为准。
- 新打开的后台标签因独立会话停在登录页，未输入凭据；Health 任务确认原登录标签仍有效，已接管该表单。本任务未同时编辑配置，也不需要用户重复登录。
- 最终聚焦下载页测试 26/26。首次完整提交检查通过文档和工具测试，但 Vue 严格类型检查发现新增 switch 回调参数隐式 any；提交工具停止且未暂存。补充 Element Plus change 参数类型后重新检查，不绕过门禁。
- 本任务独立公网流式读取原 Health APK（不落盘、不安装）：200，68,029,891 bytes，全文件 SHA-256 与上文一致；Range 0-1023 返回 206、`bytes 0-1023/68029891`、1,024 bytes。四个 Health 政策/客服/注销页均为 200 HTML。旧 Windows 签名限制放在卡片直接可见文字，不仅藏在折叠安装说明。
- 第二次完整提交检查还发现新增 API 测试夹具在 noUncheckedIndexedAccess 下将固定数组项推断为可能缺失；对明确存在的静态夹具索引作断言，保留生产输入校验。提交门禁再次停止，尚未推送或影响线上。
- 发布门禁：显式提交文件到 main → CI 测试/构建一次/真实镜像启动 → GHCR digest 自动部署 → 两个健康地址 revision 一致 → 公开新旧页面、包大小/哈希/206 范围及元数据回归。不得把 push 当作上线。

## 回滚点与验收边界

- 上一已验收源码/镜像 revision：`d0b97acf37b9b4d29a0f5ba1924478a9b4f74377`，由原不可变 release manifest 及部署备份保留。例行部署失败由原发布器回退固定镜像和网关；恢复后须重新核对两个 readiness。未变更 schema、包文件或签名，不使用数据库旧备份覆盖新增数据。
- 必须独立回退代码时，用审阅的 revert 提交走同一 main 自动部署，不重新构建旧源码冒充原产物。要回退 Health iOS 配置，仅在后台恢复保留的原清单；不得改原赛电/Say Ring，也不得把未获准 TF 设为 available。
- Health 任务保留了配置修改前临时备份；代码部署不覆盖配置。最终 Actions 链接、revision、公开路由、哈希和截图回执将在部署后追加；此预发布记录不证明上线成功。

- 2026-10-04T10:23:28.6279160Z：pnpm api:docs:check，退出码 0。

- 2026-10-04T10:24:02.4869800Z：pnpm tools:test，退出码 0。

- 2026-10-04T10:24:09.4381800Z：pnpm typecheck，退出码 2。

- 2026-10-04T10:25:20.5055730Z：pnpm api:docs:check，退出码 0。

- 2026-10-04T10:25:54.8537630Z：pnpm tools:test，退出码 0。

- 2026-10-04T10:26:02.5993020Z：pnpm typecheck，退出码 2。

- 2026-10-04T10:27:44.0068450Z：pnpm api:docs:check，退出码 0。

- 2026-10-04T10:28:22.0621790Z：pnpm tools:test，退出码 0。

- 2026-10-04T10:28:30.1855030Z：pnpm typecheck，退出码 0。

- 2026-10-04T10:28:49.5299620Z：pnpm test，退出码 0。

- 2026-10-04T10:29:03.2586410Z：pnpm build，退出码 0。

## 生产发布回执与并行主线衔接

- 功能提交 `94573ac4b63f3b89cf96d85f241f0400c7d6f38e` 已推送 main。[CI 37195510578](https://github.com/tangwu88/saydianserver/actions/runs/37195510578) 的 verify 成功，包含实库、HTTP、恢复演练、三个镜像及真实离线导入夹具验收；生产步骤于 11:41:16 UTC 达到 60 分钟上限后被终止。API 原镜像已拉取，Worker 未完成；未进入备份/网关/迁移/应用切换，两个 readiness 仍为 `d0b97ac`，没有把该任务写成上线成功。
- 同事于 10:47:37 UTC 将 Say Ring `/down2` 提交 `2f7b78a820daad8b92c16c9378743c2624911cab` 推到 main，父提交为本轮 `94573ac`，完整保留 Health 变更。审阅相关差异、保留其已提交文件；最新目标改为合并后的主线，不强推、不重复触发或并行操作生产。
- [CI/自动部署 37196520415](https://github.com/tangwu88/saydianserver/actions/runs/37196520415) 的 verify、resolve、deploy 全部成功，deploy 于 11:57:51 UTC 完成。新 receiver 的 preflight 通过同一实际 flock，证明旧发布锁已释放；本轮未取得宿主机 PID 快照，不假称通过日志完成了进程清理。API 11:41:54、Worker 11:56:41、Admin 11:57:15 UTC 分别返回原 digest；无现场编译、无新构建替代产物。
- 最终三镜像：API `sha256:653ae0393bebb65fddc282f8ab6cf72aaae93f90e492337ccfc3a23a335f546b`；Worker `sha256:3cccd5ef1dd964778466c0ace45c91b5794b40c729df2ade78dec2a623d78a73`；Admin `sha256:401a8554fb974e30ebb296836ac76eee54285d03e63bb6aa5582eb259307bb54`。与原 CI release manifest 一致；21 个迁移名和校验值与 `d0b97ac` 完全相同，生产日志确认没有待执行迁移。
- 网关两次 `nginx -t` 成功；原部署器确认业务开关保持不变。回退备份为 `/opt/saydianapp-server/deploy/unified/backups/20261004T115716Z-2f7b78a820da-18921`，仅记录位置，不提交备份内容、令牌或密钥。

## 公开页面、配置与文件回归

- 独立 GET（不自动跟随跳转）检查 18 个地址均 200 HTML：`/down`、`/down/`、`/global/down`、`/global/down/`、`/down/legacy`、`/down/legacy/`、`/down2`、`/down2/`、`/say-ring`、`/admin/`、两个商城入口、四个 Health 政策/客服/注销页及两个 Say Ring 协议页。两个公开 readiness 均 200、ready、database=ok、revision=`2f7b78a`。
- Health 任务于 `2026-10-04T12:00:54.354Z` 保存 iOS `pendingReason=review`；本任务独立读取公开接口，确认仍为 `1.0.1 (1013)`、coming_soon、无 destination。Android/HarmonyOS 两个 release 与修改前逐字段相同；原赛电和 Say Ring 完整清单与快照相同。App Store Connect 等待审核状态由 Health 任务实时核对，不将本记录当作将来审核获准证明。
- 发布后再次公网完整流式校验 Health APK：200、68,029,891 bytes、SHA-256 `92a22d88e6b1f8d3f397a6f2c777b94c1079fad92a9925ad60a69fc7f9ddebf6`；Range 0-1023 为 206、`bytes 0-1023/68029891`、1,024 bytes。未落盘或安装、未操作手机。原赛电 Android/HAP 的 HEAD 均 200，长度分别 64,661,988 / 9,394,620 bytes；不据此冒称重新验证旧包签名或鸿蒙实机。
- 浏览器与 Health 任务最终验收已看到 Health 1012 QA 安卓、1013 iPhone 等待审核且无 href、Health 鸿蒙 9 待开放，不再混入原赛电 HAP；签名限制直接可见。原赛电 APK/HAP 保留，Ring 只有安卓/iPhone 且 Baidu 按钮禁用，四个 Health 页尾页面产品内容一致。Health 任务另验三包 HEAD 200 与 206/1,024 bytes，并保存公开页面截图 `/Users/mycodex/电商/outputs/download-page-20261004/after.jpg`（不含真实健康数据、不提交图片产物）；本任务已查看截图，未同时编辑其后台表单或提交登录/注销申请。

## 已准备但未启用的原镜像灾备

- 只读评估既有分块 SSH/HTTPS 恢复路径后，按同产物补给范围运行 [纯导出 37198960959](https://github.com/tangwu88/saydianserver/actions/runs/37198960959)。成功复核原三 digest、导出原镜像并生成 gzip SHA 文件；没有重建。服务器传输、HTTPS probe/import 两步均 skipped，不新增云/SSH 权限、公共下载入口、网络设置或生产发布流程。
- GitHub artifact `11302750678`，`runtime-images-2f7b78a820daad8b92c16c9378743c2624911cab`，366,300,651 bytes，API 提供 ZIP digest `sha256:78809ef97ca8cc9918c0a38dc0c2b419498807b67faf5289839941a64e8d5322`，到期 `2026-10-11T11:31:11Z`。这是平台元数据与导出校验记录，不冒称本机独立下载/hash 整 ZIP；本机余量约 443 MiB 时未下载大归档，未清理用户文件。
- 当前主线最终直接 GHCR 发布成功，归档没有导入或用于切换。按 ZIP 上界保守计算，分块路径需要约 8,564,867,756 bytes，HTTPS 路径 9,297,469,058 bytes，均已包含三镜像和额外 5 GiB；服务器这两个门槛未单独实测。未来使用仍须检查有效期、当前目标 SHA、原清单、整 ZIP/内层 hash、容量、OCI ID/revision 和共享锁；不能拿本历史归档发布更晚提交。
- 本次收尾仅补实施/交接记录，未改运行源码或配置。该文档提交仍按正常 main 自动流程验证；最终当前 revision 以最新 Actions 和公网读回为准，避免为回执 SHA 无限再做文档提交。

- 2026-10-04T15:15:01.1211210Z：pnpm api:docs:check，退出码 0。

- 2026-10-04T15:15:37.9581590Z：pnpm tools:test，退出码 0。

- 2026-10-04T15:15:46.3686150Z：pnpm typecheck，退出码 0。

- 2026-10-04T15:16:04.3883730Z：pnpm test，退出码 0。

- 2026-10-04T15:16:16.9955950Z：pnpm build，退出码 0。
