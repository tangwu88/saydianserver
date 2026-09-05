# 2026-09-06 下载配置后台编辑与页面精简

## 目标

- 将 `app_update` 从通用 JSON 文本框改为可视化三端编辑器，让运营人员可维护版本、构建号、状态、链接、文件信息和哈希。
- 精简 `/down` 文案和重复提示，保留内部测试版、Android 签名冲突、手动下载和健康数据声明等必要边界。

## 实施

1. 新增 `download-setting.ts`，在后台表单模型与 `DownloadManifest v1` 之间双向转换，保存前复用共享合约验证。
2. Android 和 HarmonyOS 可编辑版本号、构建号、发布状态、文件名、下载链接、字节数和 SHA-256，并可按文件名生成同源链接。
3. iPhone 可切换待开放或可下载；开放时可选 TestFlight/App Store 并填官方链接，待开放时不保存任何链接。
4. 修复 `ResourceView` 中无条件 `<template>` 包装导致工具栏和表格未渲染的问题，恢复“客服与更新”列表及编辑入口。
5. 下载页标题改为“下载 Saydian赛电 App”，删除重复的 iPhone 安装步骤、二维码域名、页脚口号和冗长设备提示，压缩首屏与版本卡片高度。

## 验证

- 后台编辑转换单测 4/4 通过；原后台 API 测试 1/1 通过；下载页单测 10/10 通过。
- Admin 与 Download Web 类型检查、Vite 构建通过；Admin 大分包为已有警告。
- Playwright 以受控 manifest 渲染后台，验证三端字段可见，修改 Android 版本后的 PATCH 请求包含新版本及完整三端 manifest。
- 下载页以 1440×1200 桌面视口和 390×844 Android 视口完成图像检查，无明显溢出或遮挡。

## 失败与修复

1. 首次 Admin 构建时 Vite 没有将 CommonJS 形式的 Contracts 子路径纳入转换，报 `parseDownloadManifest is not exported`。已在 Admin Vite 配置中增加 Contracts 包转换范围，复测通过。
2. 后台模板视觉验收发现旧的无条件 `<template>` 在运行时为空，因此表格不显示。改为实际容器后复测通过。
3. GitHub Actions `33980798766` 重跑后仍在未启动 step 前因账户付款或消费上限失败，不是代码测试失败。

## 生产边界

- 后台保存配置不会上传或生成安装包；新文件必须先按受审流程放入服务器，再发布对应大小与 SHA-256。
- Actions 结算恢复前无法走标准 SHA 镜像自动发布；可使用只读静态容器热更新 Admin 与 Download Web，API 镜像仍待标准链路恢复后滚动。

- 2026-09-05T17:42:27.7384990Z：pnpm api:docs:check，退出码 0。

- 2026-09-05T17:42:46.1256730Z：pnpm tools:test，退出码 0。

- 2026-09-05T17:43:08.5345660Z：pnpm typecheck，退出码 0。

- 2026-09-05T17:43:25.4209540Z：pnpm test，退出码 0。

- 2026-09-05T17:43:56.2733430Z：pnpm build，退出码 0。
