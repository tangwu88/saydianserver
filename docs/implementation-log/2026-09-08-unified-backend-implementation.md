# 2026-09-08 统一服务端第一轮实施记录

## 范围、原因与成功标准

用户明确要求执行统一后台方案。保留既有菜单、商城界面、文章富文本和接口中心修改；本轮新增旧 Flutter 契约基线、兼容修补、双来源商品/售后/资金基础、来源迁移与停写门禁、字段文档与测试。成功标准是本轮已接线代码通过自动检查和本地测试，并明确未达到的正式接管门槛，不操作生产域名、数据或外部资金。

基线：main/origin `c5218875b614d9278b6849c52fbae3f24aad38d5`；当前客户端 fa79aa3。`tools/Start-Change.ps1 -Resume` 确认安全续接，未合并或覆盖已有修改。各并行领域另有独立实施日志。

## 根代理改动

- Billing：支付对象/参数/商户快照与交易所有权检查；订单锁防重复支付关系；退款额度锁、同键参数检查、超时保留未知状态；支付成功/退款与佣金账本同事务；原始已验签回调持久化/延后/限量回放。
- `commerce-domain` 佣金 hook 由根初建，后交商城子任务抽成共享包并挂接 Worker；口径沿用原商城不含运费、累计退款冲销，增加结算天数快照。
- API 文档：扫描所有 controller；字段 Schema 纳入签名；标准 OpenAPI 参数/请求体/错误包裹；合成请求示例，不再引用不存在的 request.json。未复核字段明确显示，未声称全部接口完成。
- 客户端冻结清单门禁、Schema 示例测试、本地 PostgreSQL 并发测试；功能矩阵和当前阻断项。

## 命令级记录

| 命令/动作 | 预期 | 结果与修正 |
| --- | --- | --- |
| `Start-Change.ps1 -Resume` | 保留已有dirty且核对远端 | main=origin，保留修改 |
| API/Commerce 各源文件只读检查 | 确认真实参数、退款/佣金口径 | 原佣金基数排除运费；退款累计基数扣减，未凭当前配置追改旧规则 |
| 首次 API typecheck | 类型可用 | 发现后台groupBy缺orderBy和process参数遮蔽全局process.env，分别由owner修正 |
| 首次 Prisma generate | 新模型客户端生成 | 本地API DLL占用EPERM；核实8080进程后暂停本项目watch父/子，重跑成功 |
| `pnpm install` + domain/contracts build | workspace共享依赖 | 通过；domain前置build及Docker COPY同步补齐 |
| 首次 docs生成 | 新路由全部有说明 | 正确拒绝遗漏AdminController.batchCommerceProducts；补人工说明后通过，281条（后续提现路由将继续更新） |
| `pnpm contracts:client:check` | Flutter方法路径无缺失 | 76组消费者，missing=[]；仅路径层验收 |
| API `vitest run ...billing-safety...openapi...` | 钱款/Inbox/OpenAPI边界 | 13例通过；含未验签不写Inbox、持久失败不确认、超时不重发退款 |
| 工具Schema/消费者定向测试 | 示例满足声明字段、路径方法匹配 | 2例通过 |
| 数据库连接检查 | 只允许回环地址 | 确认127.0.0.1:5432/saydian_app，不输出凭据 |
| pg_dump本地库 | 模型应用前保留备份 | 完成；`F:/xcodeplace/saidianserver-local-runtime/backups/saydian_app_before_unification_20260908.dump` |
| `pnpm prisma:deploy`（apps/api） | 仅本地应用迁移 | foundation成功；追加多角色migration另行应用，不改已应用checksum |
| `RUN_LOCAL_DATABASE_TESTS=1` 定向Commerce数据库测试 | 真实PostgreSQL事务而非Mock | 3例通过：最后一件库存仅一单成功、地址归属拒绝、并发部分退款不超过实付；只清理本测试随机ID实体 |

## 已知边界

全额积分当前客户端没有零现金成功分支，服务端在扣账前拒绝，不制造已付款微信记录。部分售后积分分摊未实现。旧源真实字段/会话及在途商户关系尚未盘点；真实第三方出站、域名切换、30分钟停写演练、生产备份恢复/逆向回放均未验收。

## 最终整合、失败修复与验收（本地）

| 命令/动作 | 结果 |
| --- | --- |
| 独立 Billing 审查 | 发现并修复支付宝多次部分退款重复使用 trade_no 的唯一索引冲突；同步退款只使用已验签响应的实际金额并核对原支付；微信非成功通知也检查所有权、商户、原交易；订单→支付锁内重算，防止乱序回退成功状态；售后终态改为真实 CANCELLED |
| Provider `vitest ...payment-provider-refund...payment-provider.service...` | 24/24；临时 RSA 密钥 + mock fetch，未访问真实支付平台。微信同步响应缺验证配置在出站前阻断 |
| `pnpm db:generate` / `pnpm db:deploy` | 三项新 migration 全部应用到本地库，共 7 项；未修改生产库，未修改已应用 migration 的 checksum |
| `pnpm typecheck` | 全工作区通过 |
| `pnpm test` | 230 项通过：API 175、Worker 14、后台 6、下载页 10、迁移 9、共享领域 6、contracts 10；4 项数据库测试默认跳过，另行显式运行 |
| `RUN_LOCAL_DATABASE_TESTS=1 ...commerce-database.test.ts` | 4/4 真实 PostgreSQL 测试通过；增加成功/关闭退款回调竞争和重复通知，结果保持 PARTIAL_REFUNDED；本轮随机实体清理完毕 |
| `pnpm build` | 全工作区通过；后台包体积 >500kB、商城 Sass legacy API 为非阻断警告；Docker 本机不可用，未验证镜像构建 |
| `pnpm api:docs:check` | 289 路由目录同步且都有业务说明；并非全部字段级契约完成 |
| `pnpm contracts:client:check` | fa79aa3 的 76 组方法/路径消费者 missing=[]；不等于全字段解析或真机通过 |
| `pnpm tools:test` | 7/7，包括字段示例、缺失方法检测和安全 Git 工作流 |
| 编译 API `pnpm --filter @saydian/app-api start` | 本地 8080 启动成功；避免 watch 反复重启造成登录 ECONNRESET |
| 内部浏览器登录 | 首次遇 `canAdminResource is not a function`：本地 Vite 旧 CJS 预构建缓存。核实项目进程后重启 `vite --force`，重新登录/刷新成功，无需改用户密码 |
| 浏览器菜单和商品 | 主组首次收起；商品→提现→接口中心跳转不收缩。新增 LOCAL 草稿，回读售价 1234 分、库存 5、1 个 SKU；修复本地商品被标成“ERP编号”的文案 |
| 浏览器提现/接口中心 | 提现页明确不自动转账；reset-password 显示字段 Schema、合成 curl、响应及错误处理。源码未复核接口仍显示“字段待完善” |
| UI 清理 | 退出临时会话，按精确 UUID 删除本轮 1 个临时后台账号及 1 个会话、1 个本地商品及其 SKU；回读账号/商品残留 0。保留原有数据与审计日志，浏览器回到登录页 |
| `test:http:unified` 对应工具 | 连续三次通过（含根代理复跑），每次 95 断言、19 次真实本地 HTTP；旧 form 登录 + 8 条新增路径 + 增量数量/归属/预警落库/反馈/版本业务404。每轮 10 类 fixture/map 残留均为 0。另验证缺开关、非回环 API/数据库均拒绝启动 |
| `test:restore:local` 对应工具 | 改造前本地备份恢复到随机命名独立数据库，77 表、未校验约束 0、原 4 项 migration；恢复约 1.3 秒。该备份用户/健康/交易均为空，**不能推算生产迁移时间或证明生产数据完整**；临时恢复库已清理，原备份保留 |
| 最终 `git diff --check` | 通过；没有提交、推送或部署，已有工作区改动保留 |

补记两项诊断修正：HTTP 工具首次使用错误 fixture 枚举 ACTIVE（应为 PUBLISHED）、第二次把旧业务错误预期为 HTTP400（真实为 HTTP200 + code400/401/404），均在清理验证后修正断言而非改业务契约。环境状态检查首次内联 Node 箭头表达式被 Windows 命令层误解析，未执行 JavaScript，产生一个 0 字节 `[k` 文件；核对创建时间和准确路径后已删除，改为直接对象表达式重查成功，无凭据输出。

最终只读核查：当前 API 环境 `LEGACY_DATABASE_URL` 和 `MALL_DATABASE_URL` 均未配置；独立商城工作区仅发现示例和前端环境文件，没有实际数据库连接配置。继续真实来源盘点需要受控只读连接或不可变快照，网页后台登录态不能替代这些数据源。

### 复现命令

在根目录先串行运行 typecheck/test/build；本地 API 8080 已运行时：

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_UNIFIED_HTTP_FIXTURES = 'true'
pnpm test:http:unified
```

本地备份恢复工具需要可信 PostgreSQL 二进制路径和**准确的备份文件绝对路径**：

```powershell
$env:RUN_LOCAL_RESTORE_TEST = '1'
$env:PG_BIN_DIR = 'F:\xcodeplace\saidianserver-local-runtime\pgsql\bin'
pnpm test:restore:local 'F:\xcodeplace\saidianserver-local-runtime\backups\saydian_app_before_unification_20260908.dump'
```

两者均拒绝非回环数据库；不用于生产。完整实施/缺口见 `docs/unification/implementation-status.md`，切换与恢复门槛见 `docs/unification/migration-runbook.md`。
