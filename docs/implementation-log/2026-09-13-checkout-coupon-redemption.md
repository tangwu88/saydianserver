# 2026-09-13 结算页优惠码兑换修复

## 原因与范围

- 用户在生产国际商城结算页输入 `SAY100` 后收到英文通用错误，优惠券未选中、应付金额未变化。
- 只修复顾客凭后台配置券码领取优惠券的资格判断与安全错误契约；不改变自动公开领券池、员工分发库存、订单核价、优惠金额或支付流程。

## 现场证据与根因

- 后台只读核对显示 `SAY100` 已启用，有效期为 2026-09-13 至 2026-10-13，面额 ¥100，门槛 ¥800，发行 100、累计领取 0；用户截图订单商品金额 ¥1498，满足使用门槛。
- 该券同时开启“员工可分发”。服务端公共领券方法将 `employeeDistributable=true` 解释成“仅员工券”，导致即使设置了顾客兑换码也拒绝领取；国际错误过滤器随后把没有错误键的中文 400 信息替换成英文通用错误。
- 后台编辑说明已明确“优惠码可由顾客在结算页输入领取”，“员工可分发”是独立能力，因此两项配置应可同时成立。

## 实现

- 保留公开优惠券列表和按券 ID 领取对员工分发券的隔离，避免把员工库存自动暴露给所有顾客。
- 顾客持有效、精确券码领取时允许同一优惠券同时开启员工分发；仍在事务行锁内复核状态、有效期、总库存、已领取量和已预留赠券量，避免超领。
- 券码格式错误、券不存在/失效/领完统一返回稳定错误键和中文安全提示；不泄露具体券状态，也不再被国际错误过滤器替换成英文通用提示。

## 变更文件

- `apps/api/src/commerce/commerce-store.service.ts`
- `apps/api/src/commerce/commerce-customer-assets.test.ts`
- `tools/api-notes.mjs` 及重新生成的 API 目录
- `design-qa.md`
- `docs/qa/2026-09-13-coupon-redemption/`
- 本实施记录。

## 已执行验证

| 命令 / 验收 | 结果 |
| --- | --- |
| `pnpm --filter @saydian/app-api exec vitest run src/commerce/commerce-customer-assets.test.ts` | 38/38 通过，新增员工可分发券码领取回归用例 |
| `pnpm --filter @saydian/app-api typecheck` | 通过 |
| `pnpm api:docs` / `pnpm api:docs:check` | 339 条路由说明生成并校验通过 |
| `pnpm db:generate` | Prisma Client 生成通过 |
| `pnpm contracts:client:check` | 76 个客户端消费者均有匹配路由 |
| `pnpm tools:test` | 工具 10/10、H5 流程 61/61、国际商城契约 38/38 通过 |
| `pnpm typecheck` | 全仓通过 |
| `pnpm test` | 全仓 1112 项通过、4 项数据库集成测试按环境配置跳过 |
| `pnpm build` | 全仓构建通过；仅既有 Sass 弃用和后台大包体积警告 |
| `node deploy/global/check.mjs` | 184 项结构检查通过；本机无 Docker Compose，运行时 Compose/Nginx 检查未执行 |
| `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs` | 8/8 通过 |
| 本地浏览器 1123 × 1074 合成流程 | `SAY100` 从英文失败态变为已选中“满800减100”，应付 ¥1498.00 → ¥1398.00 |
| 本地页面控制台 | `error=[]`；仅既有 vue-router 弃用警告 |

## 失败与修复记录

- 原共享 H5 演示 profile 绑定另一工作区，启动时按安全校验拒绝复用；没有修改或绕过该 profile。
- 为当前工作区创建独立私有演示 profile 后，发现本机 PostgreSQL 5432 未运行，因此未把数据库启动失败写成真实库验收。
- 最终使用只监听回环地址的合成 HTTP 响应完成页面交互和视觉对照；服务端业务逻辑由单元测试验证，生产效果仍以 CI 发布和线上 revision 为准。

## 未验收边界

- 本地合成浏览器验收不创建生产优惠券领取、订单或支付记录。
- 发布前不在用户生产账号上再次点击兑换；生产同源验收需在新 revision 上确认接口与页面，再由用户正常使用或在明确授权范围内复核。
- 支付、退款、员工赠券和真实库存并发不是本轮新增范围。

- 2026-09-12T20:19:52.7959605Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T20:20:37.4021456Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T20:21:12.3934614Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-12T20:21:52.1997039Z：pnpm.cmd test，退出码 0。

- 2026-09-12T20:22:44.3817560Z：pnpm.cmd build，退出码 0。
