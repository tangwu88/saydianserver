# 2026-10-01 Say Ring 专属隐私政策核对与草稿

## 本轮范围

- 只读核对线上通用隐私政策、Say Ring 1.0 (1013) 归档、客户端源码、国际服务端和生产公开能力。
- 记录用户确认的隐私处理者 `Xuewu Tang`、联系邮箱 `kf@saydian.com` 和企业微信客服入口。
- 新建不公开的 Say Ring 英文隐私政策草稿；未改国内版、国际主 App 或现有通用政策。

## 已核实事实

- 生产 Say Ring 已隐藏 AI；1013 的 App Store 配置关闭商城。
- 1013 未配置 QWeather API Key，天气功能不可用；未配置 JPush App Key，推送 SDK 不初始化。
- 健康摘要会上传；详细睡眠阶段时间线保存在本机加密数据库，当前健康批量接口不上传该时间线。
- 头像由用户选择后上传；蓝牙连接会提交设备元数据和连接证据。
- 注销申请立即禁用账号、撤销会话，并安排七天后执行删除或匿名化。
- `saydian.com` 有有效 MX 记录；本轮未向邮箱发送测试邮件。

## 阻止公开发布的问题

- 1013 的法律能力请求不带 `say-ring` 产品标识，仍会读取通用国际政策；服务端不能在不影响其他 App 的情况下单独替换。
- 当前注销 Worker 未清空邮箱和原生微信 OpenID，头像文件只进入待删除状态；不能宣称七天后全部删除。
- 1013 包含多个穿戴设备厂商 SDK 和可见网络端点，但尚无所有厂商的书面数据清单、法定主体及隐私链接。
- 腾讯云合同主体、备份和安全日志保留期、跨境保障、最低年龄和未成年人规则仍待确认。

## 结论

- 草稿保存在 `docs/legal/say-ring-privacy-policy-draft.md`，标题明确标记 `DRAFT, DO NOT PUBLISH`。
- 本轮不新增公网 URL、不激活法律文档、不修改 App Store Connect，也不触发生产部署。
- 完成上述事实和代码闭环后，再实施 Say Ring 独立法律 API、App 取值、公开页面及生产回读。

## 验证

- `pnpm api:docs:check`：363 条路由均有说明。
- `TMPDIR=/private/tmp pnpm tools:test`：工具、H5 流程及契约测试通过。
- `pnpm typecheck`：通过。
- `TMPDIR=/private/tmp pnpm test`：除两项密码哈希用例超过默认 5 秒外，829 项通过、4 项数据库环境测试跳过；无断言失败。
- `TMPDIR=/private/tmp pnpm --filter @saydian/app-api exec vitest run src/auth/global-auth.test.ts src/auth/global-wechat-binding.test.ts --testTimeout=20000 --pool=threads --poolOptions.threads.singleThread=true`：两个目标文件 107 项全部通过，原超时用例分别耗时 1.818 秒和 1.357 秒。
- `pnpm build`：全部工作区构建通过；仅保留既有 Sass 弃用和后台大包提示。
- `node deploy/global/check.mjs`：187 项结构检查通过；本机无 Docker Compose，未执行容器运行态检查。
- `git diff --check`：通过。
