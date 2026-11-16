# Say Ring 中国区客服后台发布准备

## 合并范围

- 从主线 `aed4a21a17c5704bddb187bc5c6ffe2d97f47b8d` 合入客服、常见问题、手机诊断字段及游客会话修复 `9c82b529f4ed0f124bba9ec23fe429fb45556dd0`。保留主线邮箱登录和首次连接诊断规则。只有具备首次绑定资格的账号可以提交一份诊断，两种协议都遵守相同的限制和账号隔离。
- 审核 `20261114230000_say_ring_online_support`。SQL 仅新增四张客服表及其索引、外键。核对实际 SHA-256 后登记到 `deploy/compatible-migrations.json`。由既有生产流程执行迁移及备份检查。
- 菜单排列随 Say Ring App 更新。后台发布范围为中国生产环境，客服开关、FAQ 分类及 WhatsApp 地址以生产配置为准。

## 验证

- `pnpm api:docs:check` 校验 602 条接口。`pnpm db:generate`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 Prisma schema 校验通过。API 常规测试通过 1,619 项，98 项可选测试跳过。本机首轮的 12 项安装包上传测试受临时目录符号链接影响，改用真实路径后全部通过。
- 在隔离 PostgreSQL 上先应用主线迁移，再填入合成会员。应用新迁移后确认四张客服表存在，原会员行摘要一致。客服 HTTP、数据库、诊断及自动回复专项共 54 项通过。
- `pnpm tools:test` 的部署工具、H5 流程及 H5 契约分别通过 59、62、38 项。本机补齐 PowerShell 后重跑通过。镜像清单、镜像层大小与发布脚本独立测试通过。
- 发布后以两个 readiness 地址的实际 revision、客服配置及 FAQ 的公开只读回执验收。人工值守、真实推送到达与各商店已装客户端的更新需要分别验证。
