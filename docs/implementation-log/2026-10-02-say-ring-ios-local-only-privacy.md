# Say Ring iOS 本机版公开政策页

## 范围

- 仅为 Say Ring 的中国大陆 App Store iPhone 首发版本提供静态《隐私政策》和《用户协议》。
- 页面固定在 `/say-ring/privacy` 与 `/say-ring/terms`，由既有只读 `global-admin` 静态容器提供；不接入管理后台、数据库或 API。
- 此次改动不改变国内版、国际版或其他图片/附件的存储和公开政策。

## 事实边界

- 文案仅陈述该 iOS 本机版的已实现范围：无账户、无登录、无云同步、无社交登录、无商城及无应用内购买。
- 健康、设备及睡眠数据保留在 iPhone 本机加密存储；页面不对 Android 或未来版本作相同承诺。
- 公开处理者为 `Xuewu Tang`，隐私联系邮箱为 `kf@saydian.com`；最低年龄为 14 周岁。

## 发布核验

- 发布前须构建 `apps/download-web`，确认两份 HTML 均进入镜像中的 `/down/`。
- 发布后分别请求两个 HTTPS URL，确认返回 200、标题正确，且页面不出现管理后台或 API 响应。

## 本轮实施与本地验证

- 新增 `apps/download-web/say-ring-privacy.html` 与 `say-ring-terms.html`，并将 Vite 配置为显式生成两个独立入口；下载页主入口保持不变。
- `docker/admin-nginx.conf` 为这两个精确路径使用 `try_files` 提供静态 HTML；网关模板与现行 global 网关片段只代理这两个精确路径至既有静态容器。
- `pnpm --filter @saydian/download-web typecheck` 与 `pnpm --filter @saydian/download-web build` 通过，构建输出包含 `dist/say-ring-privacy.html` 和 `dist/say-ring-terms.html`。
- 首次误用了不存在的 `@saydian/download-web` 筛选名，pnpm 安全拒绝且未执行构建；已改为实际工作区名 `@saydian/app-download-web` 后重新验证。
- `node --test tools/tooling.test.mjs deploy/global/h5-deployment.test.mjs` 35 项通过。
- 串行根级 `pnpm api:docs:check && pnpm tools:test && pnpm typecheck && pnpm test && pnpm build` 已通过；API 878 项通过、4 项显式数据库专项跳过，下载页 11 项、后台 147 项、Worker 53 项、商城 134 项通过。构建产生的 Sass 与大包提示均为既有弃用/体积警告，没有失败。
- 生产 HTTPS 回读仍待本次提交经 CI 与自动部署完成后执行；在此之前不把本地构建写成线上页面已发布。
