# 2026-09-13 会员中心推广与奖金

## 原因与范围

- 国际商城个人中心的订单快捷栏与下方“最近订单”重复，按标注删除快捷栏并保留最近三条订单。
- 帮助与服务页不再展示“发票信息”，同时移除会员中心中对应入口，避免保留失效导航。
- “推广与奖金”必须由普通登录会员直接使用，查看本人的推广订单、奖金明细和提现记录，并可提交奖金提现申请；不再以企业微信身份作为普通会员入口的前置条件。
- 仅修改会员推广身份解析、国际商城页面与对应契约/测试；不新增数据库迁移，不自动发起第三方打款，不改动无关订单和支付逻辑。

## 实现

- 普通会员首次进入推广中心时，服务端按会员 ID 建立稳定、隔离的推广账户；后续请求始终解析当前 Bearer 会话对应的账户，不接受客户端传入 `employeeId`。
- 新增会员本人推广工作台、推广素材、推广优惠券、奖金提现摘要和提现申请接口，复用既有佣金账本、规则、人工审核及幂等机制。
- 会员推广账户与企业微信员工账户保持隔离，避免仅凭同手机号合并金融账户；已验证手机号只用于阻止本人绑定本人为推广上级。
- 管理员停用的推广账户不会因会员再次访问而自动恢复；自己的推广券也不会把本人绑定为自己的推广上级。
- 国际商城推广页优先使用普通会员会话，展示推广码、推广订单、奖金明细、推广素材、优惠券和奖金提现；真实企业微信入口仍保留为独立兼容模式。
- 删除国际个人中心的“全部订单 / 待付款 / 待收货 / 售后”快捷栏，继续保留最近三条订单及“查看全部”。
- 删除帮助页与会员菜单中的“发票信息”。

## 主要文件

- `apps/api/src/common/member-promoter-identity.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/commerce/commerce-employee.controller.ts`
- `apps/api/src/commerce/employee-promotion.service.ts`
- `apps/api/src/commerce/commerce-withdrawal.service.ts`
- `apps/shop/src/components/GlobalAccount.vue`
- `apps/shop/src/components/EmployeeWithdrawalPanel.vue`
- `apps/shop/src/pages/employee/index.vue`
- `apps/shop/src/pages/help/index.vue`
- `apps/shop/src/pages/profile/index.vue`
- `apps/shop/src/realm-config.ts`
- 对应单测、H5 回归、API 说明与生成目录。

## 已完成的针对性验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @saydian/app-api typecheck` | API TypeScript 校验通过 |
| `pnpm --filter @saydian/app-api exec vitest run src/commerce/member-promoter.test.ts src/commerce/employee-dashboard.test.ts` | 2 个文件、17 项通过 |
| `node --test apps/shop/tests/global-h5.test.mjs tools/h5-frontend.test.mjs` | 66/66 通过 |
| `pnpm --filter @saydian/app-shop typecheck` | 商城 TypeScript 校验通过 |
| `node tools/build-global-h5.mjs` | 国际 H5 构建成功；仅有既有 Sass 弃用提示 |
| `pnpm api:docs` / `pnpm api:docs:check` | 339 条路由说明已生成且一致 |
| `pnpm contracts:client:check` | 冻结客户端 76 个调用路径缺失为 0；只证明路径契约存在 |

## 失败与修复

- 本地国际 H5 直连正式域名做只读页面预览时，上游证书返回 `stest.saydian.cn`，本地代理因此显示“请求失败”；没有绕过证书校验。导航结构仍可在本地验证，完整内容与控制台将在部署后的同源正式页面复核。
- 普通会员与企业微信员工可能使用相同手机号。为避免未经明确绑定即合并奖金账户，最终采用会员 ID 的独立稳定推广账户；只有自推广判定会使用已验证手机号。

## 安全与未验收边界

- 提现申请只创建待审核记录并冻结可用奖金，不会自动向支付宝、微信或银行卡转账；无可用余额、未核验收款身份、后台未启用或已有处理中申请时均拒绝。
- 本地单测和页面构建不等于真实会员已有推广订单或可提现余额；生产发布后将只读核对页面和健康版本，不使用真实会员发起提现。
- 本机没有 Docker Compose，部署检查仅验证了结构和脚本，不冒充容器运行验收。

## 全量验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm db:generate` | Prisma Client 6.19.3 生成成功，无数据库写入 |
| `pnpm api:docs` / `pnpm api:docs:check` | 339 条路由全部有说明，生成文件一致 |
| `pnpm contracts:client:check` | 76 个冻结客户端调用路径缺失为 0 |
| `pnpm tools:test` | 工具 10 项、H5 流程 61 项、H5 契约/部署边界 38 项，共 109 项通过 |
| `pnpm typecheck` | 8 个工作区项目全部通过 |
| `pnpm test` | 1,111 项通过；4 项现有数据库条件测试按仓库约定跳过 |
| `pnpm build` | API、Worker、后台、商城、下载页及共享包全部构建成功；仅有既有 Sass 弃用和后台大 chunk 警告 |
| `node deploy/global/check.mjs` | 184 项国际部署结构检查通过；未执行运行时操作 |
| `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs` | 8/8 通过 |
| `git diff --check` | 通过 |

## 发布状态

- `origin` 为 `https://github.com/tangwu88/saydianserver.git`，本轮基线与 `origin/main` 均为 `86ce011512b3ddce76946c148fea290fd3360e10`，没有远端漂移。
- GitHub CLI 当前身份为 `saydian88-cmyk`，首次检查时因与远端所有者不一致而停止发布。随后只读检查确认系统凭据管理器另存有 `tangwu88`，并以 `credential.username=tangwu88` 成功读取远端 HEAD；发布命令将仅在本次进程中显式选择该所有者凭据，不修改全局登录状态。
- 所有源码、测试、文档和脱敏视觉证据均保留在当前工作区，未触发真实会员提现、奖金或订单写操作。CI、自动部署和正式同源页面复核结果待发布完成后追加。

- 2026-09-12T19:40:30.5538465Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-12T19:40:59.7888905Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-12T19:41:17.3149553Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-12T19:41:44.2095050Z：pnpm.cmd test，退出码 0。

- 2026-09-12T19:42:16.2284641Z：pnpm.cmd build，退出码 0。
