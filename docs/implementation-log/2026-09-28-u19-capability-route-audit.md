# 2026-09-28 U19 日汇总能力路由复核

## 范围与基线

- App 真机读取 `/global/api/saydian-app/v2/health/capabilities` 返回 404，日汇总因此继续待同步。只检查国际服务端实现，不更改国内服务、生产数据或部署开关。
- 工作区 `saydian-server-u19`，分支 `codex/u19-daily-summary`；开始时 HEAD 为 `ab23483af0151b9f4cd19d81813a5f8e6f9a50f6`。已 fetch，`origin/main` 为 `11278f0ddf0dc17be1470ca1e6ce9b6e1582ea59`。
- 原工作区已有 12 个修改文件及 `20260928010000_u19_daily_summary_versions` 迁移目录，包括能力路由、日汇总持久化及旧版本折叠。本轮保留这些未提交工作，不拉取合并、不覆盖、不提交或推送。

## 发现与本轮修改

- 本地 `HealthController.capabilities` 已返回 `{dailySummaryVersions:true}`，且继承会员鉴权。App 路径与国际网关 `/global/api/` 到 API `/api/` 映射一致。
- 只读公网复核：能力路由 HTTP 404；`/global/health` 返回 ready、database=ok，revision 为 `a134be05e02fb7c48063345a4d87ef06362caa81`。仅代表此次探针结果，不等于验证会员数据读写。
- 原实现缺少接口说明，`pnpm api:docs:check` 实际失败于 `Missing interface explanation: HealthController.capabilities`。补充 `tools/api-notes.mjs` 的能力声明、日汇总上传/显式查询说明，重新生成接口目录，并在 `docs/global-api.md` 记录契约及未发布状态。
- 新增 `health-controller.test.ts`：验证能力路由继承鉴权，旧客户端缺省不返回日汇总，只有精确 `includeDailySummaries=true` 进入折叠后的查询，会员身份与游标正确传递。
- 本轮没有改变既有健康算法或业务数据，也没有为了取消 404 将客户端标记为“已同步”。

## 验证命令与结果

- `pnpm --filter @saydian/app-contracts build`：通过。
- `pnpm --filter @saydian/app-api exec vitest run src/health/health-controller.test.ts src/health/health-validation.test.ts src/health/health-reliability.test.ts src/health/health-evidence.test.ts`：4 文件、34 项通过。覆盖聚合格式校验、1000→2000→重复2000、不可变记录冲突、旧客户端范围、证据日期及多表累计不相加。
- `pnpm --filter @saydian/app-api typecheck`、`pnpm --filter @saydian/app-api build`：通过。
- `pnpm api:docs`、随后 `pnpm api:docs:check`：359 路由生成/验证通过。
- `node deploy/global/check.mjs`：184 项结构检查通过；Docker Compose 不可用，容器及 Nginx 运行检查未验收。
- `git diff --check`：通过。

## 发布缺口与后续顺序

1. 日汇总业务代码仍是原工作区未提交改动；需完整复核后，在独立分支安全整合最新 main。不得把脏工作区直接覆盖到服务器。
2. 增量迁移新增可空列和索引；先在独立国际备份副本演练迁移、旧客户端兼容、并发修订、分页、撤销关爱授权及恢复方案，再执行国际库迁移。当前测试使用模拟持久层，未取得实际 PostgreSQL 迁移/事务证据。
3. 最新无有效数值修订、旧关爱兼容与设备所属日筛选的本地修复和失败复现见下节；这些边界仍需要数据库级回归。本轮未扩大为这些业务实现的正式验收。
4. 通过全量类型/测试/构建、数据库验收及部署脚本检查后，国际 API/Worker 使用同一完整 SHA；保持现有维护和渠道开关。不得推送 main 触发未经验收的生产迁移或覆盖国内服务。
5. 线上先验证无凭据能力请求被拒绝、授权请求返回支持，再用专用测试账号检查上传 `acceptedIds`、1000→2000→重复2000、睡眠6→7小时、旧版本迟到和新设备同日记录回读。未经此闭环，App 仍显示本机待同步。

本轮未部署、未推送、未执行数据库迁移、未调用付费渠道、未读取或输出密钥/会员健康原始数据。

## 后续有界修复：无效日汇总遮蔽有效数据

### 缺陷与复现

- P1：原通用标量校验会接受日汇总 `{value:null}`、没有当前指标字段、无效文本及超出既有有效范围的数值；这些记录可能成为最新修订，并把此前有效版本标记为过期。
- 证据组装原先也先选择最新日汇总，再判断数据有效性；晚到的无效候选使同日此前有效证据消失。
- 修改前先补回归并执行 `health-validation.test.ts` 与 `health-evidence.test.ts`：8 项失败、12 项通过，明确复现输入被错误接受以及旧有效记录被遮蔽。

### 最小修复

- `health-validation.ts`：仅对声明 `daily_summary` 的新输入，复用现有 `isUsableRecord` 有效性规则；失败返回 `invalid_aggregation`，不写入记录、不替换旧版本。普通单次记录的原接收语义不变。
- `health-evidence.ts`：先按原有规则筛选有效记录，再在有效日汇总中选择最新候选；无效记录仍列入无效证据 ID，不进入分析。没有修改既有阈值、单位换算或健康算法，也不补造数值。
- 未执行历史数据修补。若外部实验库曾运行旧未发布实现并保存了错误 `supersededAt`，需另行只读审计后恢复可见性，不能把本次代码变更表述成已修复历史数据库。

### 日期、版本和幂等约束复核

- `observedAt` 保留实际读取瞬间，`aggregation.localDate` 独立保存设备所属日；测试覆盖读取 UTC 日期与设备日期不同，不修改输入的时间、时区或数值。
- 日汇总最新版本以读取时间及记录 ID 稳定排序；晚到的较旧版本可作为不可变记录保存，但不会替换较新可见版本。
- 原请求、原幂等键重试复用原响应；同记录 ID 改采集时间仍拒绝为 `record_conflict`。每次内容修订需新 ID；`rawVersion` 没有作为修订号使用。
- 覆盖步数 1000→2000→重复2000、睡眠6→7小时、同账号多设备、不同账号使用相同 clientRecordId/幂等键。测试保持各设备数据独立，报告证据按现有规则选一份当日总量而不相加。
- 写入持有会员级 PostgreSQL advisory lock，版本标记与幂等响应位于同一事务；当前仅验证调用和模拟回滚，实际数据库并发与分页仍未验收。

### 修复后验证

- 四个健康相关文件：47 项通过，新增失败回归全部转绿。
- `pnpm --filter @saydian/app-api test`：83 文件通过，824 项通过；4 项依赖实际数据库的测试跳过，未计为通过。
- `pnpm --filter @saydian/app-api typecheck`、`pnpm --filter @saydian/app-api build` 及 `git diff --check`：全部通过。

## 后续有界修复：旧关爱兼容与所属日筛选

- P1 复现：关爱原先无条件纳入日汇总，而旧 `LegacyMemberController` 复用该方法，导致本人旧接口排除、关爱旧接口却返回，可能按旧采样逻辑重复累计。
- P1 复现：报告/关爱按 `observedAt` 查询后才使用 `aggregationLocalDate` 计天。较早所属日的新补读会错误进入当前区间，当前所属日的较晚补读又会缺失。
- 修改前新增 `daily-summary-period.test.ts`，7 项全部失败，覆盖缺省范围、V2开关、旧所属日排除、晚补读保留、夏令时、未知时区和分页前过滤。
- `CareService.preview` 新增缺省 `false` 的参数；V2控制器只有 `includeDailySummaries=true` 才打开，旧接口不传则继续排除。
- 新增共享 `daily-summary-period.ts`：读取被查询会员已保存的 `HealthProfile.timezone`，用 `Intl.DateTimeFormat` 转换查询区间触及的本地日；关爱结束点仍为左闭右开，报告结束点仍包含。缺失/无效时区返回无日汇总条件，不猜北京或UTC。
- 普通记录保持原 `observedAt` 条件；日汇总按 `aggregationLocalDate` 及 `supersededAt:null` 在数据库查询内过滤，再应用 `skip/take`，不在分页后删除结果。
- 未修改存量日期、读取时间、会员时区或原始值。历史 schema 的 `HealthProfile.timezone` 默认 `Asia/Shanghai`，现有 App 没有已核实的时区更新入口；上线前必须确认国际会员的实际时区，不能把数据库默认值当成用户已确认偏好。
- 相关9文件116项回归通过，包括已有后台报告、分析授权和旧接口测试；接口说明/目录同步更新为359条。
- 最终全量 API 测试：84文件、831项通过，4项数据库测试跳过；API类型检查、构建、359接口目录校验和`git diff --check`通过。真实PostgreSQL迁移、查询计划、DST边界分页和关爱撤销并发仍待独立数据库验收。
