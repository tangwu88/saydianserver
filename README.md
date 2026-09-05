# Saydian赛电 App 服务端

统一的 App 与商城服务端，包含异步 Worker、总管理后台、H5/小程序商城、V1/商城兼容层和旧数据迁移工具。当前 Flutter App 是接口第一标准，原商城 H5/小程序是兼容依据；旧客户端全量验收、真实支付/推送/ERP 联调和旧数据迁移尚未完成。

## 工程结构

- `apps/api`：NestJS 模块化 API，含账号、健康、商城、统一支付、通知、接口文档、管理端和兼容接口。
- `apps/worker`：事务 Outbox、健康报告、通知活动、推送、ERP 任务和账号删除。
- `apps/admin-web`：Vue 3 + Element Plus 总后台，在一个会话内管理会员、健康、商城、支付、通知、内容、接口和集成。
- `apps/shop`：从商城基线提交迁入的 Vue 3 H5/小程序同源前端，发布在 `/saidian-mall/`。
- `apps/migrator`：旧 App 库和原商城库的只读盘点、幂等导入、永久 ID 映射和迁移核验。
- `packages/contracts`：前后端共享的公开类型和枚举。
- `deploy`：生产 Compose、网关、备份、发布和回滚脚本；异地备份仍需单独配置验收。
- `docs/implementation-log`：逐轮修改、命令、测试、失败和修复记录。

## 本地启动

1. 复制 `.env.example` 为 `.env`，只填写本地测试值。
2. 安装 Docker Desktop 或兼容 Docker Engine。
3. 运行 `docker compose up -d --build`。
4. API 就绪探针：`http://localhost:8080/health/ready`
5. 管理后台：`http://localhost:3301/admin/`

不使用容器时可先执行：

```powershell
pnpm.cmd install
pnpm.cmd db:generate
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
```

本机没有 Docker 时仍可完成静态检查、单元测试和构建；数据库集成与容器冒烟由 GitHub Actions 执行。生产配置、迁移和切换流程见 [`docs/deployment-runbook.md`](docs/deployment-runbook.md) 与 [`docs/migration-runbook.md`](docs/migration-runbook.md)。

## 安全边界

- 生产密钥、旧库凭据、Token、手机号和真实健康数据禁止进入 Git。
- 未配置的短信、AI、推送、支付、企业微信、聚水潭和对象存储保持禁用，不返回伪成功。
- 第三方密钥由主机外置主密钥加密，后台只可写入/清除并显示是否已配置，不回显明文。
- 旧数据访问必须使用只读数据库账号和受限附件导出权限。
- 正式迁移、暂停旧服务写入、DNS 切换和旧数据清理均需要独立审批。

## 当前交付边界

- 本地预发布源码、V1/V2/商城兼容接口、Worker、总后台、商城前端、商城与健康报告模型、迁移框架、CI 与部署/回滚模板已进入同一仓库。
- 商品、SKU、购物车、地址、订单、物流、售后、评价、优惠券和推广已迁入主系统；聚水潭仍是 SKU、库存和履约的权威来源，不允许后台直接改权威库存。
- 健康档案、30 天证据窗口、详细报告权益、微信/支付宝/StoreKit 支付契约、退款撤权、按需 PDF 和 AI 生成任务已实现；正式销售默认关闭，数据不足不创建支付单。
- 旧库真实字段映射必须以只读盘点结果填写，不能根据旧文档猜测；未提供只读账号前只验证脱敏示例映射。
- `https://app.saydian.cn` 当前仍是上一版维护只读环境；本轮包含数据库迁移，必须先由 CI 在空库验证，再经人工备份/迁移审批部署。短信、AI、极光/APNs、支付商户、企业微信、聚水潭和异地备份仍按真实回执逐项验收。
- 生产停写、最终增量迁移和 `app.saidian.cc` 切换不在本地预发布动作中。

## 文档索引

- [`docs/architecture.md`](docs/architecture.md)：模块和数据边界。
- [`docs/api-coverage.md`](docs/api-coverage.md)：App/旧路由/V2/数据来源覆盖。
- [`docs/api-guide.md`](docs/api-guide.md)：鉴权、参数、错误和完整调用示例。
- [`docs/api-reference.md`](docs/api-reference.md)：从控制器生成并校验的 271 条接口目录。
- [`docs/continuous-deployment.md`](docs/continuous-deployment.md)：修改前更新、显式提交、CI 与自动发布。
- [`docs/security-model.md`](docs/security-model.md)：鉴权、RBAC、健康数据与推送边界。
- [`docs/test-matrix.md`](docs/test-matrix.md)：自动化与真机/外部集成验收。
- [`docs/handoff.md`](docs/handoff.md)：下一位同事接手顺序。
