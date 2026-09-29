# 国际健康日汇总版本契约（2026-09-29）

## 范围

- 为国际 V2 增加受会员登录保护的 `GET /api/saydian-app/v2/health/capabilities`。经国际静态网关访问时，完整地址是 `https://app.saydian.cn/global/api/saydian-app/v2/health/capabilities`。
- 能力响应声明 `dailySummaryVersions=true`、`dailySummaryVersion=1`，与普通设备能力列表无关。
- 批量健康记录允许显式 `aggregation:{kind:"daily_summary",localDate:"YYYY-MM-DD"}`；日汇总必须带来源设备编号。原始 `values`、`unit`、记录 ID 和版本观察时间保持不变。
- 数据库保留同一天的所有不可变版本，只把同一会员、指标、设备、本地日期中最新的版本用于 V2 会员列表、远程关爱、后台健康摘要和健康报告证据。旧客户端未协商此能力，兼容健康历史接口仍只返回逐条记录。

## 安全边界

- 本轮只在隔离分支和本地测试环境修改、验证；没有写入生产健康数据，没有迁移生产数据库，也没有触发部署。
- 发布目标是独立国际服务分支，不是国内 `main`。移植工作从已在线且数据库正常的国际 revision `ef2f64323df46ddfe6ffeb415795429d3ed3e37e` 创建 `codex/global-u19-daily-summary-release`；同期国内 `/health/ready` 为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`，本轮未修改国内分支或服务。
- App 只有在已登录请求取得 HTTP 200 且标准 V2 `data.dailySummaryVersions` 严格为 `true` 时才上传日汇总。404、鉴权失败或旧版本服务均保持本机待同步。
- U19 偶发 GATT 服务发现超时是客户端/蓝牙链路的独立 P1，本契约不把它归因于服务端。

## 验收场景

1. 有效步数 `{value:n,unit:"步"}` 和睡眠 `{hours:n,unit:"h"}` 日汇总可接收，并完整回显 aggregation。
2. 同设备、指标、日期的新版本折叠旧版本；旧版本仍保存在数据库但不进入统计。
3. 较旧版本晚到不会覆盖较新版本；不同设备的同日数据保持独立。
4. 非法日期、未知 aggregation kind 或缺少设备编号明确返回 `invalid_aggregation`，不会静默丢弃元数据。
5. 普通逐条健康记录、幂等回放、冲突检测和 ECG 文件校验保持原行为。

## 本地验证

- 将已经审阅并通过 CI 的功能提交 `ef51e665babdc3c9e5cd1b7a7dbb24e918c84695` 移植到上述国际基线。两处文本冲突分别保留现有 ERP 导入与新增健康折叠 import，并重新生成接口目录；没有用国内生成文件覆盖国际路由集合。
- 专项 Vitest：能力路由、DTO、版本折叠、后台报告、原始健康权限与 AI 授权共 8 个文件、86 项通过。
- `pnpm test`：全工作区通过；API 80 个文件、803 项通过，4 项需要真实数据库的测试按既有条件跳过；管理端 137 项、Worker 49 项、共享契约 12 项、商城领域 28 项和迁移器 9 项均通过。
- `pnpm tools:test`：工具 10 项、H5 流程 61 项、国际 H5 契约/隔离 38 项通过。
- `pnpm typecheck`、`pnpm build`、`git diff --check` 均通过。构建只出现既有 Sass 弃用和管理端大分块提示。
- API 目录：349 条路由重新生成并通过 `pnpm api:docs:check`；`node deploy/global/check.mjs` 187 项结构检查通过，国际 H5 网关/临时手机号开关测试 8 项通过。
- GitHub PR CI 在 PostgreSQL 16 测试库成功执行全部 17 个迁移（含 `20260929110000_health_daily_summary_versions`），随后 seed、全量测试、构建、API smoke、鉴权 HTTP smoke 和容器构建全部通过；PR 自动部署按预期跳过。

## 隔离 PostgreSQL / HTTP 验收

- 在本机独立 PostgreSQL 数据目录 `u19-global-pgdata-20260929`、独立数据库 `saydian_u19_global` 上执行全部迁移和 seed；API 以 `APP_REALM=global`、revision `a3e4e5ee3ec254b229bfe7879163e2a5a7b5dd68` 启动于 `127.0.0.1:58082`。首次启动使用了非标准 issuer/audience 并被启动校验正确拒绝，改为国际域固定值后正常启动；这项修正只发生在隔离运行参数中。
- `/health/ready` 返回数据库正常且 revision 匹配；未登录请求 `/api/saydian-app/v2/health/capabilities` 返回 401 而不是 404，证明路由存在且鉴权生效。隔离库加入合成本地协议后，用 `example.test` 合成会员注册成功；未输出或持久化账号密码、access token。
- 登录请求能力接口返回 `dailySummaryVersions=true`、`dailySummaryVersion=1`。依次写入同设备、同指标、同日期的步数 v1=1000 与 v2=1200，两次 `acceptedIds` 均成功；幂等键重放返回相同业务结果。
- V2 列表只回读 v2=1200，并完整回显 `unit=步`、`aggregation.kind=daily_summary`、`localDate=2026-09-29` 和采集来源元数据。数据库核对为 2 个不可变版本、1 个 active，active 记录是 v2。
- 上述数据只存在于本机隔离数据库；没有连接、迁移或写入生产数据库。生产发布仍以 App 隔离真机回读为门禁，本轮不合并、不部署。
