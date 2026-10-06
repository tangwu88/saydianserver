# 三个 App 的后台安装包上传入口

## 原因与范围

- 用户明确要求为赛电、SAYDIAN Health、Say Ring 全部补齐安装包上传入口。旧后台只对 Say Ring 显示文件选择控件，服务端也固定按 Say Ring 存储。
- 三个更新设置均可上传 Android APK / HarmonyOS HAP，限制 128MB；自动回填文件名、链接、大小、SHA-256，保存设置才发布。iPhone 仍使用官方 TestFlight / App Store 链接。
- 接口增加 product=saidian/saydian-global/say-ring；省略参数仍默认 Say Ring，保留旧调用。对象键、文件名和 purpose 按产品区分，原赛电返回国内 API 路径，另两项返回 global API 路径；下载仍只查询安装包用途的 ACTIVE 对象。
- 未修改 schema、生产配置、已有下载清单、业务写入开关或实际安装包。不声称已验证包内应用 ID、签名或真机覆盖安装；当前文件校验仍为扩展名、ZIP 头、大小及服务端摘要。

## 工作区与同步

- 原工作区 E:/saydian h5 位于 codex/local-main-sync-20261005，HEAD=6fe11493616fdf2db0e215e70d62a5942ea6ec8e，包含用户未提交的法律/图标资料；全部保留。
- 阅读 AGENTS.md、docs/handoff.md，以及 2026-10-05/06 最新实施记录。执行 git status --short --branch、git remote -v。
- tools/Start-Change.ps1 按预期在非 main 分支停止，没有覆盖或切换原工作区。
- git fetch origin --prune 及带连接超时的重试均无法连接 github.com:443，不能声称已更新到远端最新版本。
- 基于现有 origin/main 缓存 dc4ca3fddc00a665a19ee65962c5f61f4a218dac 创建独立 worktree E:/saydian-package-upload-20261006，分支 codex/app-package-upload-20261006；没有 merge、reset、强推或替换其他工作区。

## 文件与验证

- 后台 ResourceView.vue；AdminController、SupportService；服务端与后台下载设置回归测试；tools/api-notes.mjs、生成接口目录及调用指南。
- pnpm install --offline --frozen-lockfile：通过，未改锁文件。
- pnpm db:generate：通过。
- pnpm api:docs：379 条路由生成成功。
- pnpm typecheck：通过。
- 回归覆盖三个产品的 APK / HAP 存储及下载、未知产品拒绝、默认旧调用兼容、用途不匹配拒绝、清单保存与重新打开。
- 全量测试、构建、接口目录检查、工具/部署脚本检查及 git diff --check 的最终结果在下方追加。

### 最终本地结果

- pnpm test：安装包 API 16/16、后台下载设置 15/15 通过；后台全量 186/186 通过，Worker 111/111、下载页 31/31 通过。API 987 通过、7 跳过、3 失败，失败均为未修改的 say-ring-avatar-store.test.ts，错误为 Windows 本地头像硬链接文件服务不可用，与最近实施记录相同。全量 test 退出码 1，不视为全量通过。
- pnpm build：全部应用构建成功，退出码 0；保留已有 Sass 弃用及后台 chunk 大小提示。
- 补充公开下载接口说明时，首次 api:docs:check 发现生成文档过期；重新 pnpm api:docs 后 api:docs:check 的 379 条路由全部通过。最终 pnpm typecheck 再次通过，退出码 0。
- pnpm tools:test：第一次 36/47 通过，含上述文档过期及 Git Bash PATH 问题。修正文档，指定 SAYDIAN_BASH、Git usr/bin PATH 及工作区临时目录后重试为 40/47；仍有 7 项 Windows shebang/路径或 install 权限语义失败，未改动部署脚本。退出码 1，Linux CI 仍须通过。
- git diff --check：通过。所有本轮源码、接口说明和实施日志均留在独立工作区，无安装包、凭据或构建产物进入提交文件清单。
- tools:test 的首段失败使后续 H5 检查未自动执行，随后串行单独运行 pnpm test:h5:flows（62/62）及 pnpm test:h5:contracts（构建成功，38/38），均退出码 0。

## 未验收

- 2026-10-06 后续发布加速任务中网络恢复，基线重新 fetch 一致；已将本轮改动安全应用到干净 main 工作区，保留原独立分支。后续最终发布记录以 2026-10-06-deployment-acceleration.md 为准。

- GitHub 网络恢复后须重新 fetch，核对基线并安全整合到 main，再按 tools/Start-Change.ps1 与 tools/Publish-Change.ps1 显式文件清单发布。
- 尚未提交、推送或部署；线上浏览器上传、对象存储真实联调、实际包名/签名与真机安装未验收。
