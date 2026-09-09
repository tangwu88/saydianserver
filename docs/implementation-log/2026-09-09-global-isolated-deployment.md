# 2026-09-09 国际服务隔离部署与联合验收

## 目标与基线

- 用户批准把国际 Android 联调服务部署到 `https://app.saydian.cn/global/`，固定 API 前缀 `/global/api/saydian-app/v2`；国内 App 继续访问 `https://app.saidian.cc`，不修改、不迁移账号。
- 独立工作区 `F:/xcodeplace/saydian-server-global`，分支 `codex/global-api-foundation`。修改前重新 fetch，HEAD 与远端分支均为 `bc95f285a305e40ed90b9887792763fdf535a9f1`，`origin/main=795e66bd69c64295a00c2b3e42c52a290c8f56eb`，工作树干净。
- 目标主机只读盘点：4 核/4 GB，内存约 2.0 GB 可用、Swap 约 3.2 GB 可用；系统盘 40 GB 已用 35 GB（93%），约 2.7 GB 可用。现有国内 API/Worker/PostgreSQL/Redis/MinIO 和网关正常运行，网关配置挂载自 `/opt/saydian/config/gateway-nginx.conf`，网络为 `saidian_default`。
- 当前国内线上 revision 为 `795e66bd69c64295a00c2b3e42c52a290c8f56eb`；根路径 V2 的内容与更新接口可读，但 `/api/saydian-app/v2/auth/capabilities` 返回 404，不能作为国际账号域已部署证据。

## 本轮模板修正

- 运行版本与镜像标签分离：镜像标签必须映射到已验收提交，健康探针中的 `APP_REVISION` 使用独立完整 SHA。
- 五个国际容器增加 CPU、内存、PID 和日志轮转上限，合计内存上限 1376 MiB，避免无界占用现有 4 GB 主机。
- 默认安全状态不变；仅三个 QA 开关允许由工作区外私有 env 显式覆盖。即使开启国际合成账号联调，Worker 出站、回调、真实短信、支付、推送和 AI 仍保持强制关闭。
- 不修改国内 compose、数据库、账号、对象桶、JWT、网关既有路由或生产开关。

## 验证与部署记录

- `node deploy/global/check.mjs`：修改前 113 项结构检查通过；本地无 Docker，Compose 原生解析与 Nginx 运行检查待目标主机执行。
- GitHub `release-images.yml` 的 `workflow_dispatch` 尝试被 HTTP 403 拒绝：当前账号无仓库管理员权限，未创建运行、未发布镜像、未触发部署。
- 模板修正后 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check`、`pnpm tools:test` 串行通过；全工作区 502 项通过、4 个数据库测试跳过（API 390 项通过、4 项跳过），工具 9 项通过，306 条接口目录一致。构建仅保留既有 Sass 弃用与后台大 chunk 警告。
- 修正后 `node deploy/global/check.mjs` 为 141 项结构检查通过；`git diff --check` 通过。本机仍没有 Docker，因此目标主机上的 `docker compose config --quiet` 与 Nginx 运行解析是上线前强制检查。
- 目标服务器磁盘清理、镜像构建、独立密钥/env、数据库迁移、桶权限、网关加入、真实接口和双域隔离验收：待执行并在本文件续记。

## 保持关闭或未验收

- 国内数据迁移、国内账号复用、旧会话桥、真实短信/邮件、支付/退款/发货、国际商城结算、推送、AI 和健康报告销售均不在本轮开放。
- 测试账号密码、Token 和独立密钥只存于工作区外受限文件，不写入 Git、日志或对话。
