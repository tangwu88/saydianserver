# 国际 H5 微信支付结果修复

## 目标与安全边界

- 修复微信内已完成付款后，H5 仍停留在“付款结果确认中”、订单状态不更新的问题。
- 生产只读核对订单 `SD2026091112240029D7650C`：订单为 `PENDING_PAYMENT`、支付单为 `PENDING`，支付发生后没有微信 `ProviderEvent`；同时发现公网网关此前因上游解析失败发生重启，恢复后健康检查为 `ready`。
- 不手工修改订单或支付状态。只有微信支付 API v3 查单响应通过平台签名校验，且支付单号、商户号、AppID、币种、金额和渠道交易号全部与原支付记录一致时，才调用既有事务结算逻辑。
- 不修改国内 App、国内数据库、旧商城或生产密钥；国际私有支付配置继续由服务器上的加密/私有覆盖文件提供。

## 实现

- 支付提供方增加按商户支付单号查询微信订单；GET 请求不发送请求体，沿用既有商户签名、微信平台响应验签、超时和集成健康记录。
- 会员查询自己的待支付记录时执行安全查单。微信返回 `SUCCESS` 且所有绑定字段完全一致后，幂等更新支付单与订单；未支付、查询失败或字段不一致均保留原状态并记录服务端告警。
- 微信 OAuth 登录或绑定完成后执行一次完整页面跳转，确保 iOS 微信后续 JSAPI 支付使用 `/global/saidian-mall/` 的已登记支付目录，而不是最初的 OAuth callback 文档 URL。

## 命令、失败与验证

- 首次定向 API 测试因隔离工作树没有独立依赖与已构建工作区包而无法解析；删除仅为本轮创建的 `node_modules` 目录联接，使用冻结锁文件独立安装，生成 Prisma Client，并先构建 contracts 与 commerce-domain 后恢复。
- `pnpm --filter @saydian/app-api test`：66 个测试文件通过、1 个条件数据库文件跳过；700 项通过、4 项因未提供专用测试数据库跳过。
- `pnpm --filter @saydian/app-shop test`：108/108 通过，包含 OAuth 后完整清洁跳转回归。
- API 新增定向测试：32/32 通过，覆盖已签名微信查单、GET 无请求体、商户绑定、成功状态落账、未支付/字段不匹配/网络失败不落账及重复成功不再查询。
- `pnpm --filter @saydian/app-api typecheck`、`pnpm --filter @saydian/app-shop typecheck`：通过。
- `pnpm --filter @saydian/app-api build`、国际 realm 的 `pnpm --filter @saydian/app-shop build:h5`：通过；H5 仅有既有 Sass 弃用提示。
- `pnpm api:docs:check`：324 条路由均有说明且生成目录一致。
- `node deploy/global/check.mjs`：176 项结构检查通过；本机没有 Docker Compose，运行态由目标服务器发布器复核。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `pnpm tools:test`：工具 9 项、H5 流程 61 项、字段/隔离/集成契约 38 项全部通过。
- `pnpm contracts:client:check`：冻结客户端的 76 个接口消费者无缺失路径；不以此代替字段或真机验收。
- `git diff --check`：通过。

## 发布与线上验收

- 发布前 fetch 并确认远端 `codex/global-api-foundation` 仍是本轮基线；仅暂存本记录与本轮 API/H5 源码和测试，不强推、不合并 `main`。
- 发布后必须确认 `/global/health` revision 等于本次提交，国际 API 的出站与回调处理开关保持开启，并保留私有支付覆盖配置。
- 使用会员自己的“刷新订单状态”触发真实微信查单；仅以已验签响应将上述订单更新为已支付，并复核支付单渠道交易号、订单 `paidAt` 与状态。若微信返回未支付或查单失败，不做数据库补写。
