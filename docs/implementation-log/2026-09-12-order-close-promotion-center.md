# 2026-09-12 订单关单与推广奖金中心

## 原因与范围

- 总后台订单详情缺少收货电话、完整地址、推广上级和支付完成时间，抽屉标题仍为“业务详情”。
- 待付款订单存在在线支付记录时无法安全调价，需要先由渠道确认关单，再开放调价或线下收款。
- 超级管理员需要手动关闭未付款订单；关闭后必须原子释放库存、优惠券和积分。
- 国际商城需开放现有的员工推广、奖金明细和提现申请能力，并使推广链接真实绑定首次推荐关系。
- 仅修改国际后台/国际 H5 与共用支付关单代码；不新增数据库迁移，不改国内商城开关。

## 实现

- 后台订单抽屉改为“订单详情”，新增收货人、收货电话、完整地址、推广上级 ID/姓名/推荐码、支付完成时间。收货原号码仅 `SUPER_ADMIN` 可见，其它可读角色继续服务端脱敏。
- 新增超级管理员支付关单接口。执行前先查单；微信支付只在官方关单接口返回 HTTP 204 后写入 `CLOSED`，支付宝只在 `alipay.trade.close` 验签、成功码和原支付单号均匹配后写入。渠道未确认时本地状态不变。
- 支付关单成功后订单仍为待付款，版本递增，后台立即开放“调价 / 线下收款”；关单原因、管理员和时间进入备注与审计。
- 新增未付款订单关闭接口，复用顾客取消的同一事务函数，原子恢复 SKU 库存、解除优惠券占用、返还积分并写流水；存在活跃在线支付时拒绝关闭订单。
- 两个关闭操作都限国际实例的超级管理员，要求 2–500 字备注、当前订单版本和幂等键，并保留审计记录。
- 后台奖金规则入口改为“推广奖金与提现规则”，明确比例以基点保存且只影响后续订单。
- 国际 H5 仅放行员工推广页所需的精确页面和 API 方法；个人中心新增“推广与奖金”。推广链接使用国际命名空间保存推荐码，已验证会员登录后调用现有的首次绑定接口；不覆盖已有推荐人。

## 主要文件

- `apps/api/src/commerce/commerce-order-cancellation.ts`
- `apps/api/src/commerce/commerce-store.service.ts`
- `apps/api/src/admin/admin.controller.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/billing/billing.service.ts`
- `apps/api/src/billing/payment-provider.service.ts`
- `apps/admin-web/src/components/CommerceWorkspace.vue`
- `apps/admin-web/src/views/ResourceView.vue`
- `apps/shop/src/App.vue`
- `apps/shop/src/components/GlobalAccount.vue`
- `apps/shop/src/components/EmployeeWithdrawalPanel.vue`
- `apps/shop/src/pages/employee/index.vue`
- `apps/shop/src/realm-config.ts`
- `apps/shop/src/session.ts`
- 对应单测、H5 工具回归、API 说明与生成目录。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm db:generate` | Prisma Client 生成成功 |
| `pnpm api:docs` / `pnpm api:docs:check` | 333 条路由均有说明，生成文件一致 |
| `pnpm typecheck` | 8 个工作区项目全部通过 |
| `pnpm test` | 1,104 项通过；4 项现有数据库条件测试因未配置独立测试库而跳过 |
| `pnpm build` | API、Worker、后台、商城、下载页与共享包均构建成功；仅保留既有 Sass 弃用和后台大 chunk 警告 |
| `pnpm contracts:client:check` | 冻结 Flutter 客户端 76 个调用路径缺失为 0；仅证明路径存在 |
| `pnpm tools:test` | 工具 10 项、H5 流程 61 项、H5 契约 38 项全部通过 |
| `node deploy/global/check.mjs` | 184 项部署结构检查通过；本机无 Docker Compose，不冒充容器运行验收 |
| `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs` | 8/8 通过 |
| `git diff --check` | 通过 |

## 失败与修复

- 首次运行新增的推荐关系测试时，测试浏览器的 `location` 假件缺少 `search`，无法读取 `?ref=`；只补齐测试假件后 47/47 通过。
- 首次 `pnpm tools:test` 命中旧断言，该断言仍要求国际版拒绝员工推广页。按本轮明确需求改为精确路由/方法白名单，并增加反向方法拒绝断言；重跑 109/109 通过。
- 一次较早的单测假件在更新订单版本时直接引用可变对象，导致期望版本偏移；在更新前固定 `nextOrderVersion`，重跑全部通过。
- 源码提交 `23b6c9fbafb88f76337014d64c1633813aafcac7` 的首次自动发布运行 `34697870280` 中，校验与三个镜像构建均成功；部署主机从 GHCR 拉取镜像时长时间停留在下载阶段并收到中断信号（退出码 130）。回滚钩子保留了部署前配置，生产健康检查仍返回旧版本 `ddfcb430e34d717f14819816482cd3c30da79fbb` 和 `ready`，未切换容器、未执行迁移。
- 当前 GitHub 身份有主分支推送权限，但无 Actions 管理权限，不能直接重跑失败任务或手动派发工作流。为使自动重试能应对生产主机到 GHCR 的慢链路，将镜像拉取改为逐服务、安静输出并进行三次有界重试；对应部署工具测试已补充并通过。

## 安全与未验收边界

- 渠道关单不是本地改状态：必须实时获得微信/支付宝的明确成功结果；无配置、网络错误、验签失败或渠道状态变化均保持本地待处理状态。
- 推广中心仍依赖国际实例已正确配置的企业微信身份、商城推广地址与收款身份；未配置时前端显示真实不可用错误，不伪造奖金或提现成功。
- 本地测试不代表生产渠道实际关单成功，不使用真实顾客订单做破坏性关单验收。
- 提交时生产发布与浏览器视觉/交互验收尚待 CI/Deploy 完成；最终结果将追加在本记录和根目录 `design-qa.md`。

- 2026-09-12T13:54:35.9857431Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T13:55:02.2909983Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T13:55:18.8681510Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-12T13:55:42.0098799Z：pnpm.cmd test，退出码 0。

- 2026-09-12T13:56:10.3641616Z：pnpm.cmd build，退出码 0。

- 2026-09-12T15:00:08.6680242Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T15:00:36.9992137Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T15:01:00.6480653Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-12T15:01:27.9185270Z：pnpm.cmd test，退出码 0。

- 2026-09-12T15:01:58.9158238Z：pnpm.cmd build，退出码 0。

## 生产发布与只读验收

- 部署加固提交 `a8b88824fecf56b4a48be50f6d5d657805387059` 已推送 `main`。GitHub Actions `34701194358` 的 verify、resolve 及 API/Admin/Worker 三个不可变镜像任务均成功；服务器 deploy 任务继续在安静模式拉取镜像。当前国内 `/health/ready` 为 `ready`、`database=ok`、revision `da98e7ac3184e51b8b8e8671f8e295311a662733`，该提交是功能提交 `23b6c9f` 的直接后代，已包含本轮用户功能。
- 重新 fetch 后确认国际分支 `codex/global-api-foundation` 的旧版本 `ddfcb430e34d717f14819816482cd3c30da79fbb` 是 `a8b8882` 的直接祖先；使用已授权账号仅做无冲突快进，没有强推或合并旁支。既有 `saydian-global-auto-deploy.timer` 于 2026-09-13 01:24:00 +08:00 将独立国际 API、Worker、Admin/H5 切换到完整 revision `a8b88824fecf56b4a48be50f6d5d657805387059`；公网 `/global/health/ready` 返回 `ready`、`database=ok`。
- 正式后台按用户标注的同一待付款订单复查：抽屉标题为“订单详情”，显示收货电话、详细地址、推广上级 ID 和支付完成时间；活动支付存在时“关闭订单”禁用、“关闭在线支付”可用。打开渠道关单确认框后立即取消，没有填写原因或提交请求，订单和支付记录未变化。
- 另一笔已支付订单显示非空支付完成时间，且与支付流水成功时间一致。订单列表和详情商品链接均指向国际商城；列表链接为新窗口打开，并带 `noopener noreferrer`。
- “奖金明细”页可打开“推广奖金与提现规则”，包含启用奖金、推广奖金比例、收货等待天数、提现开关与额度，人工审核保持强制；未保存即关闭。商城个人中心显示“推广与奖金”，未带企业微信身份进入时明确提示从企业微信工作台登录，没有伪造推广或余额数据。
- 订单页、奖金规则页和商城推广页控制台均无 error。生产视觉证据只保留脱敏版本，原始订单号、电话、地址和后台列表已在提交前从截图中遮盖；详见根目录 `design-qa.md` 与 `docs/design-qa/`。
