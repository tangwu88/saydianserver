# 2026-11-03 首次绑定决定的持久回执与安全恢复

## 原因和范围

用户要求修复独立复查发现的重复问题，保留手机、戒指和云端数据，华为实测后再提交 Git。服务端本轮基线 `a60394996d5894c53045d838eb2d5461a6c7803a`；修改前工作区干净、fetch 成功、远端 main 一致。本轮不提交、不推送、不部署，不改变维护或业务写入开关。

原客户端先持久化 `decisionUnknown`，再请求一次性决定。登录刷新在请求前失败、鉴权 401 或响应丢失，都会变成同一个未知状态。原只读证明要求“当前目标存在，且有另一枚更早绑定”；因此目标根本未入库、或老会员只用过同一枚戒指时，会长期无法恢复。

## 协议与实现

- 增加专用 `POST /api/saydian-app/v2/devices/first-binding-decision`，使用原设备信息、`product=say-ring`、`initializeFirstBinding=true` 和小写 UUIDv4 `initializationOperationId`。客户端必须在网络请求前按 owner/target 持久化操作号；旧未知状态不得临时生成新号。专用路由可让旧服务端明确拒绝新协议，不允许降级普通 POST 消耗授权。
- 复用既有 `IdempotencyRecord`，scope 为 `say-ring:first-binding:v1`，唯一键为会员、scope、操作号。`requestHash` 绑定版本、会员、产品、精确目标和操作号；严格版本化 `responseBody` 保存同一身份、硬件摘要和 `preserve` / `clear-issued` 原决定。绑定、连接事件与回执在同一会员行锁事务内提交，失败整体回滚。
- 同操作号重复 POST：原 `preserve` 只读恢复 `shouldClear=false`，不新建连接事件、不重算当前绑定数量；原 `clear-issued` 返回 409 `RING_INITIALIZATION_ALREADY_ISSUED`，永不重发 true；跨目标复用、损坏回执都返回冲突。首次执行且无历史才保留原有一次 true 行为。
- 增加只读 `GET /api/saydian-app/v2/devices/binding-initialization-status?product=say-ring&deviceId=...&operationId=...`，只返回精确操作的 `preserve`、`clear-issued`、`not-found`。GET 从不授权清空。客户端仅凭 `preserve` 解除决定未知；`not-found` 只允许用原持久操作号请求首次决定；`clear-issued` 继续等待真实设备回执。
- 回执是业务证据，不是过期请求缓存。当前仓库没有通用 TTL 清理，生产删除只有合法账号注销。新 scope 的 `expiresAt` 使用 9999-12-31，读取和重复请求即使看到已过期值也仍使用原决定。未来新增通用 TTL 清理必须排除此 scope，不能删除后重新授权。账号注销保持既有清理规则。
- 不增加 DDL，不封装或改变 `DeviceConnectionEvent.rawPayload`，既有后台/伙伴标识提取兼容。旧普通 POST 和无操作号初始化行为保留；若普通 POST 误带新操作号则明确拒绝，要求正确专用路由。

## 旧未知状态的可证明范围

`binding-history-status` 改为同一会员行锁事务读取。若精确目标缺失，但会员有任一终生绑定（含已解绑），返回 true：原清空决定与目标入库原子提交、解绑仅软标记，目标缺失可证明该目标未提交过清空授权；行锁避免并发首绑在两次读之间改变结论。此分支不创建绑定或事件，客户端恢复后普通上报仍需完成。

目标已存在时，继续要求另一条绑定早于目标超过 30 秒，防事务创建时间与提交顺序倒置。旧无操作号、仅同一目标历史、原生重置结果不明或 `resetAttempted` 不凭当前 count>0 放行。这类历史缺少原请求关联，不能伪造回执或宣称已全部自动解锁。新协议防止后续再产生无法追溯的同目标响应丢失问题。

## 验证记录

- 首轮定向：原绑定、旧历史证明、新持久回执 3 文件共 44 项通过；TypeScript API 类型检查通过；接口目录生成 489 条路由。
- 新回归覆盖同目标老会员响应恢复、认证未入库后的同操作重试、新会员仅一次授权、GET 不返回 true、已过期回执不重算、跨目标/跨账号、损坏回执、客户端伪造字段、旧路由误投、回执写入失败拒绝返回授权。
- 新增实际 PostgreSQL 用例：并发同操作仅一次 true、老会员并发重试无重复事件、回执写失败回滚绑定和事件。该套只允许显式本机测试库；本机没有满足条件的数据库，未冒充实库通过，保留到已配置数据库的 CI。
- 后续完整串行门禁结果另追加，原失败记录不得覆盖。源码、CI、部署、真机新协议验收分别确认；不把手机已有同步恢复当作此服务端候选已上线。

### 本机完整门禁

运行前仅补齐既有 Node v24 和 PowerShell 7.6.6 的 PATH，并将 TMPDIR 规范为本机真实路径；不改依赖、锁文件或安全规则。定向命令为 `pnpm --filter @saydian/app-api exec vitest run src/devices/binding-history-status.test.ts src/devices/first-binding-decision.test.ts src/devices/devices.service.test.ts --maxWorkers=2 --testTimeout=15000`，44 项通过。

串行执行 `pnpm api:docs:check`、`pnpm tools:test`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`，全部退出 0，分别耗时 0.32、65.48、8.77、19.54、9.25、0.03 秒。完整日志与命令结果保存在忽略目录 `artifacts/ring-binding-recovery-20261103/decision-receipts-v1/`。

全量 API 测试 1,480 项通过、71 项因实际数据库条件未开启而跳过（其中设备实库 7 项），不能称这些实库用例已在本机执行。其余工作区通过：migrator 11、commerce-domain 28、contracts 90、download-web 41、vip-web 81、worker 154、admin-web 275 项。本轮没有新失败，既有复查的缺陷复现结果仍保留；上述结果不替代生产部署、实际会员或华为新协议验收。

### 随后补齐真实 PostgreSQL 验收

进一步检索找到本机既有 `embedded-postgres` 16.14 二进制，未安装新依赖。保留原有其他测试库，在本轮私有日志目录另建空数据目录，仅监听 `127.0.0.1:55439`；使用明确合成角色，完整应用原有迁移后运行 `RUN_LOCAL_DATABASE_TESTS=1 pnpm --filter @saydian/app-api exec vitest run src/devices/devices-database.test.ts --maxWorkers=1 --testTimeout=15000`。

**7 项实际 PostgreSQL 用例全部通过**，包括并发首次决定唯一授权、同目标旧会员 no-clear 并发重试去重、原回执过期不重算，以及回执写失败导致实际事务回滚绑定与事件。测试仅创建自己的随机合成会员，并由既有 afterAll 按其明确 ID 清理；未使用生产连接、会员或戒指。

初始化、启动、迁移、数据库测试、停止分别退出 0（0.91、0.14、1.44、2.36、0.12 秒）；测试后停止该独立 PostgreSQL，确认端口无监听，保留专属数据目录及日志供核验。复跑脚本 `run-local-postgres.py` 遇到既有数据目录会拒绝覆盖。证据 `decision-receipts-v1/postgres-results.json` 与 `pg-device-tests.log`。前述默认全量跳过记录仍如实保留；本段只补验设备数据库 7 项，不冒充其他 64 项数据库场景已执行。
