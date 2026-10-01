# Say Ring 年龄确认与法律草案补充（2026-10-01）

## 本次范围

- 仅对国际域的 `product=say-ring` 新建账号增加最低年龄确认；现有账号和 `saydian-global` 流程不变。
- 隐私联系邮箱统一为 [kf@saydian.com](mailto:kf@saydian.com)。
- 新增未发布的 Say Ring 用户协议草案，并更新隐私草案、客户端契约和生成的 API 文档。

## 服务端行为

- 新建 Say Ring 账号必须提交 `ageConfirmed: true`，否则返回 `400 minimum_age_confirmation_required`。
- 不收集出生日期。服务端只保存 `say_ring_minimum_age`、版本 `14-plus-v1`、记录时间和来源。
- 覆盖验证码注册、临时免验证码注册、商城验证码首次建号、原生微信首次绑手机号及 H5 微信首次建号。
- 仅当相应流程实际创建用户时校验年龄；既有用户登录或绑定不会被该字段阻断。

## 发布前置条件

- 产品约定为 14+；App Store Connect 必须确认使用 16+ 年龄分级后才能激活该文案和接口。
- 13 岁用户尚不支持；不得描述为已有监护人同意流程。
- Say Ring 协议草案尚未经过法务审定、设置生效日期或发布到法律文档 API。
- 腾讯云控制台可见北京实例和 Party-A 档案，但合同记录为 0；档案不是已签合同。生产备份和安全日志保留期也尚未取得运行时验证。
- 穿戴 SDK 的供应商主体、网络行为、数据类别和隐私链接仍待供应商书面确认。

## 已执行验证

- `vitest`：`global-legal`、`global-auth`、`global-wechat-app`、`global-wechat-binding`、`commerce-login-code`，共 120 项通过。
- `node --check`：三个接口契约工具通过。
- `pnpm api:docs`：363 条路由均有描述，生成成功。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过；全量 API 测试为 836 项通过、4 项既有数据库集成项跳过。
- Docker 守护进程已可用，但此自动执行通道会在镜像首层依赖安装期间回收构建客户端，未能取得三张镜像的完成证据；需在持续终端重跑 `docker build -f docker/api.Dockerfile .`、`docker build -f docker/worker.Dockerfile .`、`docker build -f docker/admin.Dockerfile .`。
- 生产 Compose 需要未纳入 Git 的 `deploy/.env.production`，因此未以伪造生产密钥生成配置；本地 Compose 的必需变量校验已执行。
- 尚未合并到 `main`、未部署生产、未激活协议。
