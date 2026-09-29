# 国际健康日汇总版本契约（2026-09-29）

## 范围

- 为国际 V2 增加受会员登录保护的 `GET /api/saydian-app/v2/health/capabilities`。经国际静态网关访问时，完整地址是 `https://app.saydian.cn/global/api/saydian-app/v2/health/capabilities`。
- 能力响应声明 `dailySummaryVersions=true`、`dailySummaryVersion=1`，与普通设备能力列表无关。
- 批量健康记录允许显式 `aggregation:{kind:"daily_summary",localDate:"YYYY-MM-DD"}`；日汇总必须带来源设备编号。原始 `values`、`unit`、记录 ID 和版本观察时间保持不变。
- 数据库保留同一天的所有不可变版本，只把同一会员、指标、设备、本地日期中最新的版本用于 V2 会员列表、远程关爱、后台健康摘要和健康报告证据。旧客户端未协商此能力，兼容健康历史接口仍只返回逐条记录。

## 安全边界

- 本轮只在隔离分支和本地测试环境修改、验证；没有写入生产健康数据，没有迁移生产数据库，也没有触发部署。
- App 只有在已登录请求取得 HTTP 200 且标准 V2 `data.dailySummaryVersions` 严格为 `true` 时才上传日汇总。404、鉴权失败或旧版本服务均保持本机待同步。
- U19 偶发 GATT 服务发现超时是客户端/蓝牙链路的独立 P1，本契约不把它归因于服务端。

## 验收场景

1. 有效步数 `{value:n,unit:"步"}` 和睡眠 `{hours:n,unit:"h"}` 日汇总可接收，并完整回显 aggregation。
2. 同设备、指标、日期的新版本折叠旧版本；旧版本仍保存在数据库但不进入统计。
3. 较旧版本晚到不会覆盖较新版本；不同设备的同日数据保持独立。
4. 非法日期、未知 aggregation kind 或缺少设备编号明确返回 `invalid_aggregation`，不会静默丢弃元数据。
5. 普通逐条健康记录、幂等回放、冲突检测和 ECG 文件校验保持原行为。

## 本地验证

- 专项 Vitest：能力路由、DTO、折叠、统计日期和旧客户端隔离共 36 项通过。
- API 全量：816 项通过；4 项需要真实数据库的测试按既有条件跳过。
- 全工作区：`pnpm test` 共 1197 项通过，`pnpm typecheck`、`pnpm lint`、`pnpm build` 均通过。构建只出现既有 Sass 弃用和管理端大分块提示。
- API 目录：361 条路由生成并通过 `pnpm api:docs:check`。
- Prisma schema 使用不可连接的回环合成 URL 完成语法验证；本机没有 Docker/PostgreSQL，因此迁移文件尚未在本机真实执行。后续只允许在隔离 CI PostgreSQL 测试库先跑 `prisma migrate deploy`，成功前不得部署生产。
