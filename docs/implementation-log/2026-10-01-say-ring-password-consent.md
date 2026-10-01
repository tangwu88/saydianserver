# 2026-10-01 Say Ring 邮箱密码登录专属同意

## 范围

- 在 Saydian Health App 既有 `POST /auth/login` 和同一套国际用户数据上，为 `product=say-ring` 的密码登录补充显式专属法律同意；国际主 App 和国内登录保持原有请求与行为。
- 不部署、不执行既有 Prisma migration、不创建或激活法律文档，也不读取、重置或猜测演示账号密码。

## 实现

- Say Ring 登录要求 `locale`、当前 `consentVersion` 与 `consentAccepted:true`；先确认两份已审、已启用、到期可用且同版本的专属文档，再进行密码认证。
- 认证成功后在事务中 upsert `say_ring_user_agreement` 和 `say_ring_privacy_policy`，随后才签发会话。持久化失败不签发会话。
- 密码登录不创建账户、不写入最低年龄确认、不变更邮箱或手机号验证时间。
- 默认产品 `saydian-global` 保持旧密码登录路径；请求/错误契约已更新到 API 目录与客户端契约。

## 验证

- `pnpm --filter @saydian/app-api exec vitest run src/auth/global-auth.test.ts --maxWorkers=1 --testTimeout=20000`：35/35 通过。最初误用 `@saydian/api` 过滤器，pnpm 报未匹配项目；改为仓库实际包名后通过。
- `pnpm api:docs` 更新 355 条路由目录；`pnpm api:docs:check` 与 `pnpm contracts:client:check` 通过。
- `pnpm tools:test`、`pnpm typecheck`、`pnpm build` 均通过。
- 首次 `pnpm test` 在多个工作区并行跑 Vitest 时，两项既有验证码/微信绑定测试超过默认 5 秒而失败；随后单独运行 `pnpm --filter @saydian/app-api exec vitest run --maxWorkers=1 --testTimeout=20000`，API 850 项通过、4 项按原配置跳过。根命令本次未获得通过结果，保留该事实。
- `node deploy/global/check.mjs`：205 项结构检查通过，未执行部署；`git diff --check`：通过。

## 上线门禁

- 候选 PR 仍含尚未受控执行的既有数据库 migration；不能自动部署。
- 仅在 Say Ring 两份协议完成法务审核、发布并包含 `kf@saydian.com` 后，才可验证非空 `consentVersion` 和发布该候选。
- 邮箱验证码仍另受 `capabilities.login.email` 的真实投递配置门禁；本变更不把未验证邮箱标记为已验证。
