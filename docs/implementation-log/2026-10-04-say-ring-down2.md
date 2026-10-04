# Say Ring 专属下载引导页 /down2

## 范围与基线

- 用户要求仿照 `/down`，新建 `/down2`，只提供苹果和安卓版本。
- main 基线：94573ac4b63f3b89cf96d85f241f0400c7d6f38e。编辑前 Start-Change.ps1 已完成；不修改其他 App API、账户、健康数据或 App Store 审核。
- 原版素材只读复用。旧 `/say-ring` 别名保留；二维码和产品导航统一指向 `/down2`。
- 按产品接口读取 Say Ring 发布清单，隐藏其他产品入口和鸿蒙卡片；保留现有 Health、旧 App 下载页面。
- 增加生产静态服务器、TLS 网关及旧网关对账规则的精确路由；页面 no-store，指纹资产缓存不变。生产部署烟测包含带/不带尾斜线两种 URL。

## 已执行命令与结果

- `pnpm --filter @saydian/app-download-web test`：31/31 通过。
- `pnpm --filter @saydian/app-download-web typecheck`：首次因过滤后的数组推断过窄报错；增加 readonly DownloadPlatform[] 注解后退出 0。
- `pnpm --filter @saydian/app-download-web build`：退出 0；63 模块，JS gzip 14.41 KB。
- `node --test deploy/scripts/unified-deployment.test.mjs deploy/scripts/deploy-failure.test.mjs`：14/14 通过。
- `node --test deploy/global/public-pages.test.mjs`：4/4 通过，覆盖两个静态配置的精确路由和 no-store。
- 本地生产构建通过专用临时预览服务器只读访问现有公开清单；1280、390、320 像素浏览器验收详见根目录 design-qa.md。
- 线上清单目前没有可用 Say Ring 安装资源：安卓为百度占位链接、iOS 未开放。未改动发布清单，未伪造下载地址；开放下载需要该产品真实合格资源。

## 发布验证

- Publish-Change.ps1 自动追加全量检查结果；提交推送后核对 CI/部署及公开页面，不以推送代替部署证据。

- 2026-10-04T10:45:46.3895180Z：pnpm api:docs:check，退出码 0。

- 2026-10-04T10:46:22.1168420Z：pnpm tools:test，退出码 0。

- 2026-10-04T10:46:31.5044660Z：pnpm typecheck，退出码 0。

- 2026-10-04T10:46:54.4522090Z：pnpm test，退出码 0。

- 2026-10-04T10:47:35.2814110Z：pnpm build，退出码 0。
