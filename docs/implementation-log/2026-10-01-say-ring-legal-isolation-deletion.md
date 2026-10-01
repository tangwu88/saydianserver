# 2026-10-01 Say Ring 协议隔离与注销清理

## 范围与原因

- 为 Say Ring 1014 增加显式产品法律契约，保持国内版、国际主 App 和既有通用协议不变。
- 修复注销 Worker 遗留的邮箱、验证时间、微信标识、公众号身份和用户文件物理删除缺口。
- 隐私政策继续保留为不公开草稿；本轮不创建或激活法律文档，不部署生产。

## 实现

- `GET /auth/capabilities` 增加 `product` 查询；`say-ring` 只读取 `say_ring_user_agreement` 与 `say_ring_privacy_policy`，省略产品仍读取原 `user_agreement` 与 `privacy_policy`。
- 注册、验证码登录、原生微信和国际 H5 同意链路接收 JSON `product`，并按产品写入对应 `ConsentRecord.documentType`。未知产品在查询数据库前拒绝。
- OAuth state 与微信绑定票据新增带默认值的 `product` 字段；后续步骤产品不一致返回 `product_mismatch`，避免先展示一套协议、再把同意写入另一套协议。
- 后台允许保存 Say Ring 两种文档类型，但仍保留 `reviewed=true` 才可激活的原发布闸门。本轮没有写入文档数据。
- 注销 Worker 先把当前账号名下文件精确标记为 `DELETION_PENDING`，再按对象键批量调用兼容 S3 的物理删除；成功后才删除这些文件记录并完成账号匿名化。
- 注销同时清空 `email`、`emailVerifiedAt`、`mobileVerifiedAt`、`wechatAppOpenId`，并删除该用户的 `WechatOfficialIdentity`。对象存储失败时注销请求记为失败，不会误报完成。
- 1014 iOS 已由客户端确认隐藏微信 UI、关闭 SDK 注册并拒绝微信方法通道；Android 保留微信。草稿已区分 1013 旧包与 1014 目标包。
- 送审首版仅在中国大陆供应；1014 iOS 天气和推送保持关闭。公开只读审核体验不需账号，只使用明确标注的合成演示数据；跨境措辞保留为未来开放前置事项。

## 客户端契约

- 能力：`GET /global/api/saydian-app/v2/auth/capabilities?locale=<locale>&product=say-ring`。
- 同意相关 JSON 请求：固定传 `"product":"say-ring"`，不使用自定义请求头。
- 完整入口和错误契约见 `docs/say-ring-legal-client-contract.md`。

## 已完成验证

- API 定向测试 171 项通过；Worker 定向测试 6 项通过。覆盖产品映射、未知产品、同意记录、微信票据产品不一致、精确对象键、1000 条分批、存储失败不完成和账号作用域。
- `pnpm typecheck`、`TMPDIR=/private/tmp pnpm tools:test`、`TMPDIR=/private/tmp pnpm test` 和 `pnpm build`：全部通过。全量 API 测试 835 项通过、4 项数据库测试按既有条件跳过；Worker 53 项、Admin 143 项、Shop 134 项通过。
- `pnpm api:docs:check`：363 个路由全部有契约说明；Prisma schema 在本地占位连接串下静态校验通过。
- `node deploy/global/check.mjs`：187 项部署结构检查通过，未执行运行时操作。
- API Docker 镜像完成从锁文件安装、Prisma 生成到生产编译的整体构建。Worker 镜像在依赖安装后因主机磁盘容量耗尽导致 Colima overlayfs I/O 失败，未完成镜像验收；本轮新建虚拟磁盘已删除，主机可用空间从约 101 MiB 恢复到 5.6 GiB。
- `git diff --check`：通过。

## 未验收

- Worker Docker 镜像尚未在空间充足的容器运行时完成构建；本轮不将容量失败冒充为代码通过。
- 尚未合并或部署；生产仍是旧注销行为，Say Ring 专属协议仍不存在于生产数据库。
- 穿戴 SDK 主体/网络行为、腾讯云合同主体与留存、跨境保障、最低年龄及未成年人规则仍需运营和法律确认。
