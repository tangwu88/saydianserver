# 2026-09-28 国际 App 设备连接后台可见

## 范围与实现

- 国际 App 已有的受登录保护设备绑定端点 `POST /api/saydian-app/v2/devices` 继续作为唯一写入入口；本轮不新增数据库表或迁移。
- 后台设备列表改为稳定的管理员展示契约：会员编号、昵称、显示名称、厂商、型号、固件、能力、绑定时间、最近连接和绑定状态。
- 列表不再返回内部 UUID、原始设备标识或数据库指纹。设备原始标识只用于服务端按会员作用域计算单向哈希，后台不展示 MAC 或序列号。
- “最近连接”定义为客户端在连接就绪后成功上报的时间，不表示服务端实时蓝牙在线状态。

## 已完成验证

- `pnpm --filter @saydian/app-api test -- admin-devices.test.ts`：806 项通过，4 项既有真实数据库条件测试跳过；新增测试覆盖后台不泄露设备标识和解绑状态。
- `pnpm exec vitest run src/member-resource-view.test.ts`：35 项通过；空列表仍显示固定列、能力标签和隐私提示。
- `pnpm api:docs:check`、`pnpm tools:test`、`pnpm typecheck`、`pnpm test` 与 `pnpm build` 均通过；完整 API 测试为 806 项通过、4 项既有数据库条件测试跳过。
- `node deploy/global/check.mjs` 通过 187 项结构检查；本机没有 Docker Compose，容器运行态与线上回读需在发布服务器侧确认。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8 项通过。

## 联调边界

- 真机连接成功后由国际客户端提交同一端点；需要在发布后的国际 App 安装包与一台实际设备上复核：连接就绪、后台刷新出现一行、同一设备再次连接只更新“最近连接”。
- 本轮未创建真实会员、未连接蓝牙设备、未读取或输出生产设备标识。
- 服务端尚未提交或推送；提交后的 CI、实际发布 revision 与生产接口回读应另行记录。

- 2026-09-28T12:13:33.5764542Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-28T12:14:05.2163256Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-28T12:14:24.9716295Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-28T12:14:54.1801692Z：pnpm.cmd test，退出码 0。

- 2026-09-28T12:15:27.0400022Z：pnpm.cmd build，退出码 0。
