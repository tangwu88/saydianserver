# 国际服务隔离部署骨架

本次交付仅提供可审阅配置和只读校验脚本，没有部署、启动容器、创建数据库角色、执行迁移或发送验证码。国际 App 根域为 `https://app.saydian.cn`，API 前缀为 `/global/api/saydian-app/v2`；国内部署不受本模板修改。

## 固定隔离边界

- 使用当前项目 API/Worker 镜像，但必须选择包含国际账号与 issuer/audience 校验的完整提交 SHA；旧镜像不会因为设置环境变量自动支持国际账号。`deploy/global/compose.json` 是 Docker Compose 支持的 JSON 格式，无新增解析依赖。
- 项目名固定 `saydian-global`；独立 PostgreSQL、Redis、MinIO、命名卷和私有网络。只有 `global-api` 接入已批准的现有网关网络，没有公开主机端口；API/Worker 的独立出站网络供后续已验收集成使用。
- API/Worker 固定 `APP_REALM=global`、`AUTH_ISSUER=saydian-global-server`、`AUTH_AUDIENCE=saydian-global-app`、`PUBLIC_BASE_URL=https://app.saydian.cn/global`。网关将 `/global/api/` 转发到 `http://global-api:8080/api/`，不使用请求头选择数据库或服务。
- 数据库、Redis、对象桶、Token 签名、refresh pepper、字段加密和集成加密凭据全部独立生成。禁止复制国内 `.env`、数据库、账号、会话、积分、库存、支付配置或集成表。即使两边邮箱/手机号相同，也属于不同账号。
- `global_owner` 仅用于独立 PostgreSQL 的初始化及经审批的迁移；API/Worker 使用 `global_app`。MinIO 管理员与应用桶级用户分离，应用仅访问 `saydian-global-private` 私有桶。
- 启动命令明确覆盖已有 API 镜像的自动迁移/seed CMD，只执行 `node dist/main.js`。新库尚未完成迁移时无法作为业务服务验收；启动容器不负责创建 schema、管理员、桶或用户。

## 配置及只读检查

模板为 `deploy/global/env.example`，全部密钥均为占位。填好的 env 文件放在 Git 工作区外，由部署人员控制权限；不将真实值写入命令行、Git、工单或校验输出。密码用于 URL 时采用独立的 URL-safe 随机值；字段和集成加密 key 分别生成 32 字节随机值并 Base64 编码。所有 `replace-with-...` 都必须替换，镜像标签必须为经过验收的完整提交 SHA。

在仓库根执行：

```shell
node deploy/global/check.mjs
# 有 Docker Compose v2 的隔离检查机器必须执行：
node deploy/global/check.mjs --require-docker
```

脚本只读取这三个配置文件，检查隔离网络/数据源、固定 realm/JWT、关闭旧会话桥、维护开关、禁用渠道、无自动迁移和静态路由；Docker 可用时额外执行模板 `compose config --quiet`。不拉镜像、不创建网络/容器、不连接数据库、不调用供应商、不写文件。没有 Docker 时显式标记原生解析与 Nginx 运行校验未验收。

模板中的网关网络名是占位；在目标服务器使用实际私有 env 做同样只读解析时，仅可执行 `docker compose --env-file <私有env绝对路径> -f deploy/global/compose.json config --quiet`，不要打印展开后的配置，因为它包含密钥。该命令不证明密码、数据库、镜像、网关或第三方渠道可用。

## 后续独立部署验收顺序

1. 先检查目标服务器容量及当前国内容器/网关状态，确认新增服务不会挤占既有资源；模板没有修改任何国内 compose、自动发布或共享网关文件。为国际服务另建部署目录、备份和恢复路径。
2. 核对独立私有配置，先准备国际 PostgreSQL/Redis/MinIO。数据库初始化创建 `saydian_global` 与 `global_owner`；另行用私有凭据创建非超级用户、不可创建角色/数据库的 `global_app`。schema 迁移由 `global_owner` 独立执行，完成后授予 `global_app` 对该库连接、public schema 使用、业务表 SELECT/INSERT/UPDATE/DELETE 与序列 USAGE/SELECT 权限，并为该 owner 的未来表/序列设置同类默认授权。不得向应用角色授予 owner/superuser 或访问其他库的权限。
3. 在独立 MinIO 手工准备私有桶 `saydian-global-private`，创建仅允许该桶 ListBucket/GetObject/PutObject/DeleteObject 的专用用户。不要给应用提供 root 凭据，不创建公开桶，不把国内桶挂载进国际服务。真实对象上传/下载及备份恢复必须另外验收。
4. 在独立新库/备份副本核验迁移和合成数据，确认 schema 完整且无国内会话导入，再启动 API/Worker。模板固定维护只读、业务写入暂停、Worker 出站暂停、回调暂停、禁止测试验证码与旧会话桥。开放注册或业务写入需要独立变更及验收，不能通过覆盖模板顺手打开。
5. 只有镜像与 global-api readiness 验证后才可将 `deploy/global/nginx.locations.conf` 纳入既有 TLS server block，先在隔离配置运行 `nginx -t` 再按现有运维流程发布。不可直接替换既有 server block、证书、国内路由或关闭共享 compose。`/global/health` 对应 readiness，`/global/health/live` 和 `/global/health/ready` 对应国际服务自身探针。
6. 验证国际 API 返回正确 realm/版本；国内/国际 accessToken、refreshToken、同账号与跨用户资源 UUID 双向拒绝；伪造 `X-Realm`/`X-App-Realm` 不能切域。再核验国内健康探针和主要路由未变。全程记录实际 SHA、命令、失败、修复及未验收项，统一提交本轮实施记录。

## 暂未开放的入口和渠道

- `GLOBAL_EMAIL_PROVIDER`、`GLOBAL_SMS_PROVIDER` 和旧 `SMS_PROVIDER` 固定 `disabled`。国际验证码配置使用独立集成键 `email_otp`/`sms_global`，真实密钥仅存国际集成配置；新库默认未配置。不启用测试验证码，不因适配器存在将渠道标记为已接通。
- `GLOBAL_UNVERIFIED_REGISTRATION_ENABLED` 固定默认 `false`。临时联调只有在国际独立数据库、已审协议和隔离 QA 环境均已确认后才能显式打开；它不发送验证码、不写入验证时间，关闭后未验证账号不能继续登录或刷新。不得在国内进程或共享数据库打开。
- 商城预留 `GLOBAL_STOREFRONT_URL=https://app.saydian.cn/global/saidian-mall/`，下载预留 `GLOBAL_DOWNLOAD_URL=https://app.saydian.cn/global/down`。这些值仅用于后续构建/部署，不构成页面可用性声明；路径必须保持 `/global/`，不得回退国内地址。
- 模板没有国际 Admin、商城、下载页容器和 OAuth/支付配置。网关对其余 `/global/` 路径返回 404，避免使用国内页面/安装包。上述前端需完成基础路径、多语言、API 前缀和跳转检查后再增加明确路由；原商城支付回跳的硬编码国内路径也必须独立修复验收。
- 本模板不修改国内 CI 自动发布，也不新增自动迁移、自动供应商启用或生产发布工作流。正式国际备份、镜像/配置回滚、运行资源限制、外部短信/邮件和真机联调仍待部署阶段验收。
