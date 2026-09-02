# 2026-09-02 服务端重写首轮实施记录

## 成功标准

1. 新建独立私有仓库和可构建的 NestJS/Worker/Vue/Prisma 工程。
2. 当前 Flutter V1 路由可兼容，新 V2 使用规范契约。
3. 健康与商城边界隔离，商城新订单不复制。
4. 本地静态检查/测试/构建通过；容器和数据库冒烟有可执行 CI。
5. 部署、迁移、备份、回滚、覆盖表和未配置项可交接。

## 修改与理由

| 范围 | 修改 | 原因/预期 |
|---|---|---|
| 仓库 | 创建私有 `saydianapp-server`，主分支 `main` | 与 App/商城分离并保留清晰权限边界 |
| API | NestJS 模块化账号、会员、健康、设备、关爱、通知、内容、AI、支持、商城和后台 | 覆盖 App 规划，避免微服务复杂度 |
| 数据库 | PostgreSQL Prisma 模型和首个迁移 | 健康、审计、Outbox、兼容映射与迁移可追踪 |
| V1 | 补齐 `/api/v1/site/*`、会员健康/关爱/通知、文章、商城、支付、文件 | 旧 App/小程序平滑过渡 |
| 商城兼容 | CUID↔稳定整数 ID，首页结构、商品、地址、订单、物流、售后和支付参数映射 | 现 App 强依赖整数 ID 和旧字段 |
| 健康 | 200 条幂等批量、部分成功、ECG gzip 对象、用户阈值事件 | 不丢未知值，不在 Push 泄露健康值 |
| 账号 | 原子 Refresh 轮换、会话 JTI、退出即时失效、验证码次数/重放控制 | 通过并发与重放验收 |
| Worker | Outbox 重试/死信、Push 适配、到期注销匿名化 | 耗时任务不阻塞 API |
| 后台 | 六角色 RBAC、会员摘要/原始健康审计、关爱/设备/预警/通知、内容/协议/反馈/配置 | 完成运营管理入口且默认脱敏 |
| 迁移 | 只读盘点、会员/健康幂等导入、冲突队列和数量/首尾 ID 核验 | 未得到旧库结构前不猜字段 |
| 交付 | CI、版本化镜像、生产 Compose、Caddy、WAL、Restic、备份/恢复/发布/回滚脚本 | 新服务器资料到位后可审计部署 |

## 命令与结果

| 命令/检查 | 结果 | 失败与修复 |
|---|---|---|
| `git status --short --branch` + `git fetch`（App/商城） | 两仓库修改前远端与本地 HEAD 一致 | 商城已有未跟踪 `artifacts/`，保持不触碰 |
| `gh repo create ... --private` + clone | 私有空仓库创建成功 | 无 |
| `pnpm.cmd install` | Workspace 依赖安装成功 | 首次 pnpm 阻止依赖构建脚本；配置允许的构建依赖后重装 |
| `prisma format/validate/generate` | Schema 有效，Client 生成成功 | 首次迁移 diff 使用了不存在的 `--to-schema`；改为 `--to-schema-datamodel` |
| API Vitest | 首轮 7 项通过，新增后继续增加 | 首次误指定不存在的 `apps/api/vitest.config.ts`；改用包内 `vitest run` |
| 包筛选 TypeScript 检查 | API 与商城通过 | 首次使用错误包名得到 `No projects matched`；改为 `@saydian/app-api`、`@saidian/api` |
| API TypeScript | 通过 | Seed 加入后触发 `rootDir` 不包含 `prisma/seed.ts`；类型检查根目录改为包目录，构建根目录仍限定 `src` |
| 商城 Prisma/TypeScript | 通过 | 无 |
| Docker CLI 探测 | 本机未安装 | 未伪造容器结果；交由 CI Docker build + PostgreSQL 冒烟 |
| `apply_patch` | 所有源码最终落盘 | 两次组合补丁校验失败且未改文件；拆成独立补丁后成功 |

## 关键测试证据（本文件最终提交前更新）

- `pnpm typecheck`：API、Worker、Migrator、Contracts、Admin 共 5 个包全部通过。
- `pnpm test`：API 15 项、Worker 2 项、Migrator 1 项、Contracts 3 项、Admin 1 项，共 22 项通过、0 失败。
- `pnpm build`：API、Worker、Migrator、Contracts 和 Vue 管理后台全部构建成功；后台仅有约 1.09 MB 的非阻断 chunk 提示。
- Prisma：`format`、`validate`、`generate` 全部通过；初始 PostgreSQL 迁移与脱敏种子数据已生成。
- API 覆盖旧健康字段、健康校验、商城整数 ID、血压收缩压/舒张压独立阈值、Refresh 并发、Push 隐私和批量订单兼容入口。
- Worker 覆盖 Mock Push、重试/去重基础流程和注销匿名化；Migrator 覆盖 SQL 标识符注入防护；Contracts/Admin 覆盖统一响应与权限契约。
- 本机 Docker CLI 不存在，因此未伪造容器启动结果；GitHub Actions 已配置 PostgreSQL/Redis、Prisma 迁移/种子、API 冒烟和镜像构建门禁。

## 最终修复与复核

- 健康预警初版把血压两个数值共用一个高阈值，不足以表达收缩压与舒张压；新增 `secondaryHighThreshold`，数据库、V2 服务、事件判断和测试同步更新。
- App 多商品结算需要在新服务可用时只生成一个真实商城订单；兼容层新增 `/api/inv-shop/v1/order/order/create-batch`，旧客户端原有单品路由保持不变。
- 最终差异审查发现商城对象展开后可能附带内部 CUID；V1 兼容映射显式剔除用户、商品、SKU、订单、地址和供应商内部标识，并新增不泄露断言。
- 迁移器只实现能由通用结构安全确定的会员、密码兼容、健康与核验框架；未取得真实旧库最小权限结构前，不猜测关爱、消息、内容、AI、地址、旧订单和附件字段。
- 生产 Compose、Caddy、备份、恢复、发布和回滚脚本均为模板；未获得服务器、DNS、对象存储和第三方凭据前，不执行生产变更。

## 最终命令复核

- 并行重跑 `pnpm typecheck`、`pnpm test`、`pnpm build`：5 个包类型检查通过，22 项测试通过，全部构建成功。
- YAML/工作流解析首次因 PowerShell 内嵌 Python 引号截断而失败，敏感信息正则也因字符类转义失败；两者均未修改文件。
- 简化命令后重试：7 个 YAML 文件均可解析；私有仓库属性由 GitHub 返回 `PRIVATE`。
- 敏感字样初筛只命中环境模板、变量引用和测试固定值；进一步只检查带引号长字面量后，仅命中 `auth-refresh.test.ts` 的测试密钥，未发现生产私钥或真实集成凭据。
- 内部 CUID 清理断言首次运行 15 项中 1 项失败：顶层订单仍保留原始 `items` 数组；同时复核到商品详情会保留原始 `skus`。删除这两个原始集合，只保留转换后的 `product`/`sku` 旧契约字段后重新执行门禁。
- 修复后定向兼容测试 4/4 通过；最终再次执行类型检查、22 项全量测试和全部构建，均成功。
- 首次暂存后 `git diff --cached --check` 标记 48 个新文件末尾多余空行；仅机械归一化 EOF 后复查通过，未改业务内容。
- 新仓库首次 `git commit` 因仓库内尚无作者身份而中止，暂存内容未变化；复用现有赛电 App 仓库作者身份写入本仓库本地 Git 配置后重试，不修改全局配置。
- 首次远端 CI 在 `actions/setup-node` 的 pnpm 缓存初始化阶段失败：工作流当时尚未执行 `corepack enable`，因而找不到 `pnpm`；改为先使用 `pnpm/action-setup@v4` 安装固定版本，再由 `setup-node` 接管缓存。
- 第二次远端 CI 在类型检查阶段失败：干净检出没有本地残留的 `packages/contracts/dist`，递归并行任务使 API/Worker 在共享契约包生成前解析依赖。根级 typecheck/test/build 改为先构建 `@saydian/app-contracts`，再执行全仓库任务，并以删除生成目录后的冷启动复验。
- 首次尝试用 PowerShell 清理生成目录被本机安全策略拒绝，未删除文件；改用 `git clean -ndX -- packages/contracts/dist` 精确 dry-run 确认唯一目标后再清理。冷启动 typecheck、22 项测试和全部构建均通过，契约产物已由构建重新生成。

## 明确未配置/未执行

- 新服务器、DNS、旧库只读账号、对象存储、短信、AI、JPush/APNs、商城内部令牌、支付商户与异地备份凭据均未提供或未验证。
- 本机无 Docker，因此未在本机启动 PostgreSQL/Redis/MinIO 容器。
- 未暂停旧服务写入、未迁移真实数据、未改 DNS、未删除旧库/附件。
- 真实旧库盘点前，关爱、消息、内容、AI、地址、旧订单和附件字段映射仍需补齐；不能标记全量迁移已验收。
