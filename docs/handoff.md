# Saydian赛电 App 服务端交接

交接日期：2026-09-05。源码仓库：`https://github.com/saydian88-cmyk/saydianapp-server`（Private），默认分支 `main`。

## 1. 当前状态

- 已建立统一 NestJS API、Worker、总管理后台、商城 H5、PostgreSQL/Redis、私有 MinIO 过渡存储、V1/V2/商城兼容接口、旧 App/商城迁移器及部署模板。
- 当前 Flutter App 契约是第一标准；原商城 H5/小程序基线 `09963c4` 已迁入 `apps/shop`，旧 Apifox/旧服务行为只作迁移参考。
- 商品、订单、售后、评价、优惠券、员工推广、支付、通知、健康档案、付费报告、接口文档和集成配置已进入一个主系统；聚水潭仍是 SKU/库存/履约权威来源。
- 接口目录共 269 条，详见 [接口调用指南](api-guide.md)、[路由目录](api-reference.md) 和机器可读 [接口目录 JSON](api-catalog.json)。
- 最新交接前 Git HEAD 必须以 `git rev-parse HEAD origin/main` 为准；不要复制本文件中的旧提交号代替现场核对。
- 整合提交 `59aeffba06d8d5b230b3a63265232411a6a94936` 已推送到 `origin/main`；本地已通过类型检查、77 项单元测试（API 62、Worker 9、Contracts 4、Migrator 1、Admin 1）、269 路由目录、全部应用构建及微信小程序构建。
- 本轮 [CI 33955725515](https://github.com/saydian88-cmyk/saydianapp-server/actions/runs/33955725515) 未启动任何步骤：GitHub 注释为账户 Actions 账单失败或额度不足。它不是代码测试失败，也没有提供 PostgreSQL、HTTP 或镜像证据；恢复账户额度后必须对 `59aeffb` 重跑。
- 最近一次已完成的基线 [CI 33943303305](https://github.com/saydian88-cmyk/saydianapp-server/actions/runs/33943303305) 对应 `a484adf`；它不包含本轮商城/报告数据库迁移。
- 生产站 `https://app.saydian.cn` 的 live/ready 当前正常，但返回结果没有 `revision`，服务器仍运行旧 `IMAGE_TAG=2026.09.02-1036afa`。新提交 **尚未部署**。
- 生产 `MAINTENANCE_READ_ONLY=true`；旧 `app.saidian.cc` 未切换，旧数据未迁移。不要把管理后台可打开、CI 通过或 API 探针正常表述成业务全量上线。
- 2026-09-05 查询仓库变量与 Secrets 仍为空，专用 SSH receiver 和 `AUTO_DEPLOY_ENABLED` 尚未接通；CI 的 auto-deploy 会跳过。本轮包含数据库结构变化，即使以后启用自动部署也必须先人工演练并批准迁移。

## 2. 接手第一步

有 GitHub 权限时：

环境要求：Node.js 22 或更高版本、pnpm 11.19.0、Git、PowerShell 7；容器运行另需 Docker Compose v2。

```powershell
git clone https://github.com/saydian88-cmyk/saydianapp-server.git
Set-Location saydianapp-server
pwsh -NoProfile -File tools/Start-Change.ps1
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd api:docs:check
pnpm.cmd tools:test
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
```

`Start-Change.ps1` 只允许安全 fast-forward：工作区脏、分支错误或远端分叉时停止，不覆盖、不强推。继续已审阅的本地改动才使用 `-Resume`。根级命令会生成共享 contracts，必须串行执行。

只有离线 Git Bundle 时：

```powershell
git bundle verify .\saydianapp-server.bundle
git clone .\saydianapp-server.bundle saydianapp-server
Set-Location saydianapp-server
git switch main
git remote add origin https://github.com/saydian88-cmyk/saydianapp-server.git
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
```

最后一条必须是 `0 0` 才能认为离线包仍是远端最新版本；否则只做参考，先安全更新。

## 3. 架构和不可越过的边界

- API 为模块化单体，Worker 处理 Outbox、推送和注销等异步任务；详细模块图见 [架构说明](architecture.md)。
- 健康数据进入本项目 PostgreSQL；未知值保持缺失，不能补 `0`，不能生成诊断、治疗或准确性承诺。
- BLE/手表指令留在 Android/iOS；服务端只保存设备绑定、能力快照、固件、在线时间和同步游标。
- 商品、购物车、地址、新订单、物流、售后、评价、优惠券与员工推广已进入主库；聚水潭继续负责 SKU、库存和履约权威数据。旧订单仅为不可变投影，不得重放支付、库存或 ERP。
- 商城订单、单次报告和健康会员共用 `PaymentIntent`；金额只能由服务端确定。微信、支付宝、StoreKit 和退款通知未获得真实回执前保持未配置。
- 健康报告先清洗数据并建立证据索引，再由 AI 表达；未知/无效值不参与，异常提醒免费，报告不能输出诊断或处方。
- V1 历史拼写、multipart 和 HTTP 200 业务包裹只留在 `legacy`；V2 使用规范字段及真实 HTTP 状态。
- 外部短信、AI、极光/APNs、商城内部调用、支付或异地备份没有真实配置/回执时必须保持 `UNCONFIGURED`，不能用模拟结果冒充生产联调。

## 4. 代码和资料索引

| 内容 | 位置 / 用途 |
|---|---|
| API 主体 | `apps/api`，NestJS 模块、Prisma schema、V1/V2/Admin 控制器 |
| Worker | `apps/worker`，Outbox、健康报告、通知活动、推送、ERP 和注销任务 |
| 管理后台 | `apps/admin-web`，Vue 3 + Element Plus 总后台 |
| 商城前端 | `apps/shop`，原商城 H5/小程序同源代码；H5 发布到 `/saidian-mall/` |
| 迁移工具 | `apps/migrator`，旧 App/商城库只读盘点、幂等导入、永久 ID 映射和核验 |
| 共享契约 | `packages/contracts` |
| 生产配置/脚本 | `deploy`；当前自动路径见 [持续部署](continuous-deployment.md)，完整运维见 [部署手册](deployment-runbook.md) |
| 迁移步骤 | [旧数据迁移手册](migration-runbook.md) |
| 安全/RBAC | [安全模型](security-model.md) |
| 测试证据 | [测试矩阵](test-matrix.md) 与 `docs/implementation-log/` |
| 功能缺陷 | [原后台对接与缺陷清单](api-coverage.md)，以其中 P0/P1 为准 |
| Flutter App | `F:\xcodeplace\国内电商\saidian-app-import-20260811`；本轮未改 App，健康报告/权益/StoreKit 页面仍待接入 |
| 原 H5/小程序参考 | `F:\xcodeplace\国内电商\Saidian-h5-miniprogram-reference-20260812\Saidian\miniprogram`，只读参考 |
| 用户原始服务端信息 | `F:\xcodeplace\国内电商\赛电app服务端信息.txt`，敏感资料，不进入 Git/离线包，只能通过受控渠道交接 |

## 5. 本地运行和调用

1. 复制 `.env.example` 为 `.env`，只填本地测试值。不要复用生产密码或真实手机号。
2. 有 Docker 时执行 `docker compose up -d --build`；本机当前无 Docker CLI，因此容器证据来自 GitHub CI，不能声称本地容器已通过。
3. 本地 API：`http://localhost:8080`；管理后台：`http://localhost:3301/admin/`；商城 H5：`http://localhost:3301/saidian-mall/`；健康检查：`/health/live`、`/health/ready`。
4. V2 基址 `/api/saydian-app/v2`，商城兼容基址 `/api/saidian-mall/v1`，管理基址 `/api/saydian-app/admin/v1`；V1 保持 `/api/v1/*`、`/api/rf-article/*`、`/api/inv-shop/v1/*` 等旧路径。
5. 鉴权、multipart、幂等键、批量健康、关爱授权、支付映射和错误契约示例见 [接口调用指南](api-guide.md)。不要从生产接口创建测试会员或健康记录。

## 6. 生产与发布

- 服务器：腾讯云 Lighthouse `49.232.231.131`，Ubuntu 24.04，4 核/4GB/40GB；项目 `/opt/saydianapp-server`。
- 本项目与商城/运营系统共享 `saidian-gateway-1` 和 `saidian_default`；禁止 `compose down`、Docker prune 或修改无关网关路由。
- 服务器 API/PostgreSQL/Redis/MinIO 已健康，根盘交接前约已用 23GB、可用 16GB。过渡存储与备份都在同机，不是异地容灾。
- 自动发布流程：main push → CI verify → 完整 SHA 镜像 → 受限 SSH receiver → 数据库备份/迁移状态检查 → 更新 API/Worker/Admin+商城 → 外网 revision 验证。
- 自动脚本保留现有维护值；发现待执行/失败的数据库迁移会停止，不自动改 schema。发布失败尝试恢复旧镜像/配置，但仍须人工核对 readiness。
- 启用发布前，按 [持续部署说明](continuous-deployment.md) 建立专用账号、核对主机指纹、配置 4 个 GitHub Secrets 和变量。该账号能执行 root/Docker 应用部署，属于生产权限，必须经负责人确认。
- 不要把私钥、Token、生产 `.env`、数据库备份或真实健康数据放进 Git、聊天记录或交接 ZIP。

## 7. 下一位同事优先级

### P0：开放写入前

1. 强制手机号验证并保存验证状态；未验证账号禁止映射商城身份，完成双账号攻击用例。
2. 用新的旧库最小权限只读账号完成真实字段/数量盘点、迁移 dry-run、冲突复核、金额/附件 SHA 报告和旧会话兼容。旧 root 密码不可使用。
3. 分别配置并真实验收短信、AI、极光/APNs、微信/支付宝/Apple、企业微信和聚水潭；未配置时保持真实不可用。
4. 完成双账号关爱授权/撤销、历史健康、旧订单、附件及 Android/iPhone 真实网络联调后，再独立决定是否关闭维护只读。
5. 在生产备份副本演练本轮两项新增迁移，核对锁表时间、磁盘、枚举变更、回滚点和 4GB 主机峰值；未经批准不部署 schema。

### P1：已知缺口

- V2 同时间多条健康记录的游标、相同 clientRecordId 不同载荷、失败幂等重试。
- 旧日表多样本无损导入、ECG/反馈私有附件授权下载与文件签名校验。
- 关爱到期/并发竞态及 shareWithCare 实际通知闭环。
- 新内容 UUID 与旧整数 ID、LegalDocument 单页协议映射、AI 多轮上下文。
- 旧 App/商城会员、商品、SKU、订单、支付、退款、附件和奖金真实迁移对账；聚水潭写权限、物流、售后和库存并发实测。
- 微信/支付宝/StoreKit 沙箱、退款通知、对账、购买恢复；Flutter 健康档案、报告、权益、购买和历史页面。
- 企业微信 OAuth、推广归因、赠券并发；APNs/安卓厂商通道及前后台/杀进程推送。
- 管理后台富文本、规格批量查看、复杂售后/财务对账/客服回复、按角色菜单、自助改密和最后一位超级管理员保护。

完整说明和影响见 [缺陷清单](api-coverage.md)，不要依据本摘要删除细节。

## 8. 验收清单

- [ ] `git status --short --branch` 干净，HEAD 与 `origin/main` 一致。
- [ ] 接口目录 269 条校验、工具测试、类型、77 项单元测试和全部应用构建通过。
- [ ] CI PostgreSQL 新库迁移/种子、HTTP 断言及 API/Worker/Admin+商城三镜像成功；记录 run URL 和提交 SHA。
- [ ] 线上 `/health/ready` 的 `revision` 等于目标 SHA，API/Worker/Admin 容器均为该镜像。
- [ ] 发布前后 `MAINTENANCE_READ_ONLY` 不变；没有重启商城、旧库或其他系统。
- [ ] 数据迁移报告、冲突、用户/健康/订单/附件校验完整；未迁移时明确写“未完成”。
- [ ] Android/iOS、双账号关爱、推送、支付沙箱、物流、售后和文件授权有真实证据；缺项写“未配置/未验收”。
- [ ] 数据库备份可校验且完成恢复演练；同机 MinIO/备份不写成异地容灾。
- [ ] 每轮原因、命令、失败、修复和结论写入新的 `docs/implementation-log/`，仅显式暂存本轮文件。

## 9. 修改与提交规则

修改前运行 `tools/Start-Change.ps1`；修改后使用 `tools/Publish-Change.ps1` 显式列文件。禁止 `git add .`、强推、覆盖他人改动或提交构建产物/密钥。源码提交通过 CI 后才可能发布；必须核对 Deploy job 和线上 revision，push 本身不代表部署。
