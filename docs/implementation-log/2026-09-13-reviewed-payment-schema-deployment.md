# 2026-09-13 App 支付配置字段受控发布

## 目标与现场

- 目标仓库为 `tangwu88/saydianserver`，发布国际 App 商城登录、推广归属和 App/H5 支付配置隔离改动。
- 远端 `main` 为 `e6ba420c151975e5568c87a90a9a3910f378dd8b`；CI 的类型、测试、构建、隔离数据库 migration、HTTP 冒烟和三镜像均通过。
- 两次生产发布均在切换容器前被 schema 闸门停止，原因是 `20260913120000_app_payment_integration_binding` 尚未应用；线上主服务仍为旧 revision，失败发布保留了生产备份和回滚目录。
- 新 migration 只给 `PaymentIntent` 增加可空 `integrationKey` 和 `(integrationKey, status)` 索引，不删除、重命名或回填既有交易记录。真实支付、退款、提现和奖金打款不在本轮自动验收范围。

## 发布机制修复

- 普通 main 自动发布继续只运行 `prisma migrate status`，遇到任何 pending/failed migration 仍停止。
- `Deploy production` 增加默认关闭的 `apply_migrations` 手工输入；只有 `workflow_dispatch`、当前 main 完整 SHA 且已有成功 CI 时可用，并拒绝与 `package_only` 同时启用。
- 发布器在已有生产数据库备份之后才识别空的 `.apply-reviewed-migrations` 标记，使用同一不可变 API 镜像执行 `prisma migrate deploy`，再运行 `prisma migrate status` 和原有容器、页面、外网 revision 门禁。
- 不把数据库地址、GitHub Token、SSH 密钥或支付凭据写入源码、Actions 输入和日志。

## 本地验证结果

- `node --test tools/tooling.test.mjs`：10/10 通过；包含部署脚本语法、受控 migration 标记、自动发布禁止迁移、回退与接收器拒绝检查。
- `node deploy/global/check.mjs`：184 项结构检查通过；当前电脑没有 Docker Compose，因此原生 Compose 展开和 Nginx 运行态检查仍由 CI/生产发布门禁负责。
- `pnpm tools:test`：工具测试、61 项 H5 流程测试和 38 项 H5/国际商城契约测试全部通过；H5 生产构建成功。
- `pnpm api:docs:check`：351 条 API 路由均有描述并通过校验。
- `pnpm typecheck`：8 个工作区项目全部通过。
- `pnpm test`：服务端、后台、商城与公共包共 1132 项通过；4 项需要显式数据库验收环境的集成测试按既有规则跳过，没有失败。
- `pnpm build`：API、Worker、后台、商城、下载页及公共包全部构建成功。仅保留既有 Sass 弃用和后台产物体积提示，不作为本次发布阻断项。
- `git diff --check`：通过。

## 发布待核对项

- 本文件所在源码提交、CI/部署运行号、生产 `/health/ready` 精确 revision、管理后台和商城页面结果将在实际提交与部署后追加到 Git；未取得公网 ready 与精确 revision 前不得标记部署成功。
- 独立国际服务 `/global/health` 在发布前返回 503，不能用主服务部署结果替代；必须单独核对并明确通过或未恢复。
