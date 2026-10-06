# H5 商品轮播与后台批量图片上传

## 原因与范围

- 用户要求商品详情展示轮播，后台商品轮播图与详情图支持多图上传，并提交 Git 发布线上。
- 只修改商城 H5 和管理后台，不修改原生 App、数据库结构或生产商品数据。
- 原当前文件夹有 5 个未跟踪文档，全部保留；使用已在 main 的发布工作区开发，其未跟踪的安装包发布验收日志也保留且不纳入提交。
- 修改前重新 fetch 成功，基线 HEAD 与 origin/main 均为 09c1c7ebc350d0473c3ce02a59a3973dd9631ec5；已阅读 AGENTS、handoff 和最近实施记录，通过 Start-Change.ps1 -Resume 建立检查点。

## 实现

- 商品主图改用 uni-app swiper，支持手势切换、5 秒自动轮播、指示点、点击预览；缩略图和 SKU 图片选择同步轮播位置。单图停止自动轮播，空图保留占位。详情图片适配 H5 宽度。
- 商品轮播图增加 ProductGalleryField：批量选择、顺序上传、预览、前移/后移、删除、手工 URL，遵守现有 20 张限制。
- RichTextEditor 增加可选 multiple 与 uploadUrl；商品详情使用商城图片权限入口，按文件选择顺序插入正文，原内容编辑保持单图和原上传入口。
- image-batch 复用图片类型和 10 MB 校验，逐张保留成功结果、明确反馈失败文件并继续上传后续图片。无需新增接口、迁移或修改共享 App 契约。

## 验证与修复

- 首次 Python 自动编辑因 Windows 执行别名不可用退出，未修改源码；改用 apply_patch。
- 后台定向测试：image-batch、content-editor、member-resource-view 共 73 项通过。
- 商城首次 133/134 通过，新增测试错误地用 camelCase 读取原生 swiper 的连字符属性；修复断言为 indicator-dots，保留实际模板行为校验。
- 回归覆盖轮播切换/缩略图/预览、单图停播、无图片占位、批量顺序、部分失败保留成功图，以及非法类型/空文件/超限文件拒绝。
- 全量接口文档、部署脚本检查、typecheck、test、build 和 diff 检查由 Publish-Change.ps1 串行执行，结果在下方追加。

## 发布与待验收

- 用户已明确授权提交并推送线上，采用显式文件清单；不提交其他任务日志或构建产物。
- 提交后须等待 Linux CI 与生产发布，并核对双 readiness revision 和后台/H5 静态入口。
- 真实运营商品批量上传与保存需后台登录会话验收；本轮不会为验收改写生产商品。

- Publish-Change.ps1 两次在暂存之前的 fetch 阶段因 GitHub 连接重置/443 不可达停止；没有产生提交。改为先串行执行全部门禁，再核对远端最新 SHA。
- pnpm api:docs:check：退出码 0，完整输出留在忽略的 artifacts/product-images-api-docs-check.log。
- pnpm tools:test：退出码 1，完整输出留在忽略的 artifacts/product-images-tools-test.log。
- tools:test 首次因当前进程未设置 SAYDIAN_JQ 而失败；采用前轮已下载且校验的真实 jq 测试工具，不修改任何测试或生产脚本，重新运行。
- pnpm tools:test（配置 jq 后）：退出码 1。
- jq 修复后剩余3项失败来自 Git Bash 未在进程 PATH（registry夹具直接调用bash）；补入现有 Git Bash PATH。Git 用单进程 curloptResolve 保持 HTTPS 主机名及证书检查后 fetch 成功，未修改系统 DNS。

- 2026-10-06T11:16:37.2382982Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T11:18:26.8474611Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-06T11:18:46.2775632Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-06T11:19:44.4374191Z：pnpm.cmd test，退出码 0。

- 2026-10-06T11:20:17.1966973Z：pnpm.cmd build，退出码 0。
