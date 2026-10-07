# 2026-10-07 保留 H5 支付资料补填小程序 AppID

用户已有 H5 支付资料且无法重新提供整组凭证，要求只填写小程序 AppID，保留原支付参数。本轮增加专门补填入口并发布，不代填生产 AppID、修改已有商户参数、开启支付、绑定微信商户或发起真实交易。

阅读 AGENTS、handoff 与近期微信/聚水潭记录；status/remote/fetch 及 Start-Change 成功，干净 main 的 HEAD/origin/main 为 f58878a8a918f97d72cfa87b23928b4d109d519e，无覆盖用户原工作区。原通用表单使用整组替换，不能只填 AppID，否则会丢失数据库密钥，故保留它并新增专用语义。

## 修改

- admin-web 微信支付卡片增加“补填小程序 AppID”按钮和单字段弹窗；只发送 miniPaymentAppId，不发送 state、publicConfig、secrets 或空商户字段。仅原微信支付 CONFIGURED 且有集成写权限可用。
- 原受 SUPER_ADMIN/INTEGRATION_ADMIN 保护的 PATCH integrations/:key 增加单字段请求。只允许 wechat_pay，拒绝组合修改，校验原支付已配置及与商城小程序登录 AppID 一致。不更新集成状态、H5 公共配置、回调及验证记录。
- IntegrationSecretsService 在服务端解密原支付凭证，增加 appIdMini 后重新加密，保留全部未知/旧字段。无数据库凭证时只存新 AppID，原服务器环境凭证仍按原字段回退。已有不同 AppID（包括环境回退）拒绝覆盖，同值幂等。更新以原 ciphertext/iv/authTag/keyVersion 做 CAS，并发更新或首次创建冲突返回 409，不以旧资料覆盖新资料。
- 不回显任何原密钥，不改变整组替换/清除行为，不迁移 schema，不绕过小程序支付启用和商户绑定验证。配置说明同步新增操作路径。

## 验证与失败修复

首个补丁末尾 UI 上下文不匹配，apply_patch 原子验证失败、无文件改动；修正上下文重试成功。API 补填/加密保留/环境回退/幂等/旧 ID 防覆盖/CAS/组合参数拒绝/状态与 ID 校验 12 条测试通过；admin 配置测试 32 条通过。后续按 Publish-Change 串行执行完整门禁，日志记录每项结果。

首次发布工具在门禁前 fetch 遇到连接重置，未暂存或提交。补充现有集成 PATCH 的字段契约备注并重新生成接口目录，再正常重试 fetch 和发布。无新增路由，不改变旧接口响应。

## 未验收

上线后核对后台 bundle 有补填入口及双健康版本。保留发布前维护、短信、支付能力和三产品下载配置快照。不替用户保存生产 AppID，也不把新增入口或配置就绪当作真实下单付款、回调、退款、商户绑定或真机验收。

- 2026-10-07T07:02:26.4729133Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-07T07:04:28.5378283Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-07T07:04:50.0265905Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-07T07:05:55.5751854Z：pnpm.cmd test，退出码 0。

- 2026-10-07T07:06:32.5590698Z：pnpm.cmd build，退出码 0。
