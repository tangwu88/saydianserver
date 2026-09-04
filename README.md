# Saydian赛电 App 服务端

独立的 App 服务端、异步 Worker、运营管理后台、V1 兼容层和旧数据迁移工具。当前 Flutter App 是接口第一标准，旧小程序是兼容依据；旧客户端全量验收和旧数据迁移尚未完成。商品、库存、新订单、支付、物流和售后由现有赛电商城负责。

## 工程结构

- `apps/api`：NestJS 模块化 API，含 V2、管理端和 V1 兼容接口。
- `apps/worker`：通知 Outbox、账号删除、文件和迁移后置任务。
- `apps/admin-web`：Vue 3 + Element Plus 运营后台。
- `apps/migrator`：旧库只读盘点、幂等导入和迁移核验。
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
- 未配置的短信、AI、推送、对象存储和商城服务保持禁用，不返回伪成功。
- 旧数据访问必须使用只读数据库账号和受限附件导出权限。
- 正式迁移、暂停旧服务写入、DNS 切换和旧数据清理均需要独立审批。

## 当前交付边界

- 本地预发布源码、V1/V2 接口、Worker、管理后台、商城适配、迁移框架、CI 与部署/回滚模板已进入同一仓库。
- 旧库真实字段映射必须以只读盘点结果填写，不能根据旧文档猜测；未提供只读账号前只验证脱敏示例映射。
- 新服务已部署至 `https://app.saydian.cn`，保持维护只读；附件暂存服务器私有 MinIO。短信、AI、极光/APNs、商城内部令牌和异地备份仍按实际配置验收。
- 生产停写、最终增量迁移和 `app.saidian.cc` 切换不在本地预发布动作中。

## 文档索引

- [`docs/architecture.md`](docs/architecture.md)：模块和数据边界。
- [`docs/api-coverage.md`](docs/api-coverage.md)：App/旧路由/V2/数据来源覆盖。
- [`docs/api-guide.md`](docs/api-guide.md)：鉴权、参数、错误和完整调用示例。
- [`docs/api-reference.md`](docs/api-reference.md)：从控制器生成并校验的 156 条接口目录。
- [`docs/continuous-deployment.md`](docs/continuous-deployment.md)：修改前更新、显式提交、CI 与自动发布。
- [`docs/security-model.md`](docs/security-model.md)：鉴权、RBAC、健康数据与推送边界。
- [`docs/test-matrix.md`](docs/test-matrix.md)：自动化与真机/外部集成验收。
- [`docs/handoff.md`](docs/handoff.md)：下一位同事接手顺序。
