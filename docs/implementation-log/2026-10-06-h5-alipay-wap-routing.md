# 商城 H5 支付宝宽屏渠道修复

## 原因与范围

- 线上商城 H5 在宽屏浏览器中发起支付宝付款时报错。本轮只调整商城 H5 的支付渠道选择，不改 Flutter App，也不改支付宝密钥、订单金额、支付回调或生产数据。
- 2026-10-06 只读检查确认公开能力同时返回 `alipay_wap` 与 `alipay_page`，支付宝 H5 集成状态为已配置且历史真实成功记录来自手机网页支付。
- 最新异常订单在 2026-10-06 11:14 创建了 `ALIPAY_PAGE` 支付单并一直停留在 `PENDING`。H5 原实现按 `windowWidth >= 900` 直接选择电脑网站支付，使侧边浏览器和宽屏 H5 调用 `alipay.trade.page.pay`；现有可用链路是 `alipay.trade.wap.pay`。

## 修改

- 普通宽屏浏览器在保留微信扫码能力的同时，将 `alipay_wap` 加入可用渠道，并排在现有 `alipay_page` 之前。当前线上能力顺序下，商城 H5 会优先使用已验证的手机网页支付；电脑网站支付仍保留为后备能力。
- 更新 H5 前端渠道测试，覆盖宽屏浏览器同时接收 WAP 与 PAGE 能力的场景。

## 验证与发布

- 修改前 `git fetch origin --prune` 已在共享仓库成功执行，`HEAD` 与 `origin/main` 均为 `6fe11493616fdf2db0e215e70d62a5942ea6ec8e`；随后 GitHub 网络出现间歇性连接失败，没有据此声称远端再次更新。
- `node --test tools/h5-frontend.test.mjs`：18 项通过。
- `pnpm test:h5:flows`：61 项通过；`pnpm test:h5:contracts`：H5 构建通过，38 项通过。
- `pnpm api:docs:check`：通过，共检查 378 条接口；`pnpm db:generate`：通过；`pnpm typecheck`：通过；`pnpm build`：通过；`git diff --check`：通过。
- `pnpm test`：978 项通过、7 项跳过、3 项失败。失败均来自 `src/support/say-ring-avatar-store.test.ts` 在 Windows 下的既有文件系统同步行为，与本次 H5 支付改动无关；Linux CI 仍作为合并和发布门禁。
- `pnpm tools:test`：首次因 Windows `PATH` 中没有 `bash` 失败；补入 Git Bash 并将临时目录放入仓库制品目录后为 40 项通过、7 项失败。剩余失败来自部署夹具的 POSIX shebang/权限行为，是近期实施记录已注明的 Windows 环境限制，没有为本次修改削弱检查或改写部署脚本。
- `tools/Publish-Change.ps1` 已尝试，但在提交前的 `git fetch origin --prune` 阶段因 `github.com` HTTPS 超时停止；该次尝试没有产生提交、推送或部署。随后通过 GitHub 官方 API 使用本机既有仓库凭据再次确认写权限，并确认远端 `main` 仍为基线 `6fe11493616fdf2db0e215e70d62a5942ea6ec8e`。由于 Git 网页端点持续不可达，本轮改用 GitHub Git Data API 创建只包含上述两个源码/测试文件和本实施日志的提交，以非强制方式快进 `main`；Linux CI 与线上版本核对仍是发布完成条件。
- 线上真实小额支付仍需在新版本部署完成后重新发起；既有 `ALIPAY_PAGE` 待付款关系不会由本次前端发布自动改写或关闭。
