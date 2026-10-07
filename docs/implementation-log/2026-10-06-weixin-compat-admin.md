# 2026-10-06 商城小程序兼容与后台配置

## 原因与工作区

用户要求 H5 商城源码可导入微信开发者工具，并补齐小程序兼容与后台配置入口。原工作区分支 `codex/local-main-sync-20261006`，本地 SHA `dc4ca3fddc00a665a19ee65962c5f61f4a218dac`，有与本轮无关的未跟踪协议文件，未覆盖。已阅读 AGENTS、handoff 和最近实施记录，执行 status、remote 和 Start-Change 检查；因非 main 未执行合并。两次 fetch 失败（连接重置/443 超时），不能声称远端已同步。

隔离工作区 `E:\saydian-weixin-compat-clean-20261006`，分支 `codex/weixin-compat-clean-20261006`，基于本地缓存 origin/main `09c1c7ebc350d0473c3ce02a59a3973dd9631ec5`。无提交、推送、线上配置修改、部署或数据库迁移。

## 修改

- 后台 `integration-settings.ts` 增加“商城微信小程序”卡片：加密 AppID/AppSecret、独立支付开关和三类域名交接清单；保留原支付商户入口，标明历史 AppSecret 不用于新登录。
- API 新增 `common/wechat-mini-config.ts`、`admin/wechat-mini-settings.ts`，先校验后写入；默认关闭，支付要求同 AppID 与完整商户配置；启用中禁止换密钥，已有身份禁止更换 AppID；不向前端公开秘密。
- Auth/commerce controller 新增受鉴权、限流的微信绑定接口；显式同意当前发布协议，微信身份仅连接到已验证的现有会员。首次微信登录无已验证账号时返回绑定提示，不创建无验证账号，不自动合并账号。
- commerce capabilities、global policy、billing/provider 支持小程序容器的 WECHAT_MINI；保持 H5/App 渠道边界，并保留历史支付身份处理路径。
- shop 原生 Canvas 海报、分享卡片、JSAPI 支付字段校验、合法地址/协议请求、原生私有图片文件读写与取消清理、图片 MIME 检测、PNG tab 图标；删除启动时未经同意的自动微信登录。Vite 支持公开 AppID 构建参数。
- 更新接口备注及生成的 API 文档/contracts，共 380 路由。新增配置/导入说明 `docs/shop-weixin-setup.md` 和小程序隔离运行、配置、账户绑定回归测试。

## 命令、失败与修复

- 最初尝试复用旧 node_modules，发现它们对应旧 contracts/Prisma，导致与本轮无关的类型缺失；改用干净隔离工作区，`pnpm install --frozen-lockfile --offline` 复用 900 缓存包，`pnpm db:generate` 生成本地 client，未连接数据库，类型检查通过。
- 旧图标测试硬编码 SVG 名称；改为验证 PNG 签名和体积。原生海报测试补充 CommonJS 默认导入设置。未削弱账户或支付安全断言。
- 初次 AppID 构建参数只改缓存 manifest，编译输出仍为 touristappid；修复 manifest transform，再以合成 `wx1234567890abcdef` 验证输出一致。交付包重新按空 AppID 构建，合成值不作为真实配置。
- `pnpm typecheck`：全部通过，最终再次通过。
- `pnpm test`：1548 通过、7 跳过；其中 shop 140、API 1009、admin 189。随后新增商户 AppID 拒绝测试，针对新配置/绑定/凭证三文件再次执行，19/19 通过。
- `pnpm build`：H5/API/admin/worker 等全部通过；`pnpm --filter @saydian/app-shop build:mp-weixin` 通过。存在原有 Sass 弃用、H5 包体与小程序标签选择器构建提示，不等于真机验证。
- `pnpm api:docs:check`：380 路由完整并一致；`git diff --check` 通过。
- `pnpm tools:test`：第一段 tooling 42/51 通过，9 项失败。日志可见 Windows 环境缺 jq、部分 Bash 启动返回 null/127；相关 deploy 脚本与 shell fixture 未修改，未绕过测试。该串行命令因此未执行后续段。
- 独立串行补跑 `pnpm test:h5:flows`：62/62；`pnpm test:h5:contracts`：38/38，通过且完成 global H5 构建。

根级共享 contracts 检查按串行运行。编译包与日志保留在本地忽略的 artifacts/日志位置，构建产物不纳入源码补丁。

## 交付包复核

独立前端初次离线安装未带锁文件，解析到缓存没有的 acorn 新版本；补齐当前主项目的 shop importer、依赖锁文件、独立 workspace 和已批准的前端构建脚本列表后，`pnpm install --frozen-lockfile --offline` 成功。独立项目 `pnpm typecheck`、`pnpm build:mp-weixin` 均成功。独立包不包含依赖主仓库 fixtures 的回归测试。

打包使用临时 Git index，不改真实暂存区。初次读取未初始化临时 index，文件列表过长导致 Windows 206 错误；修正为先读取 HEAD 树再枚举 50 个修改/新增文件，成功生成包含二进制 PNG 的完整源码补丁，`git apply --reverse --check` 通过。编译目录含 19 页面，49 JS 文件逐一通过 `node --check`，tab 图标验证 PNG 签名，开启 urlCheck；未将 node_modules、构建日志、真实凭证或部署备份纳入 ZIP。

## 未验收事项

未读取生产真实配置，不能断言线上哪个凭证为空。必须由管理员配置实际 AppID/AppSecret、商户绑定、合法域名（含业务图片 CDN）、当前发布协议、短信/邮箱和私有图片存储；域名清单不会自动修改微信平台。本机未安装微信开发工具，未进行真机、实际登录支付、退款回调或微信审核验收。部署脚本 9 项失败仍需相应环境复核。没有执行 Actions 或线上版本核对，因为没有发布。
