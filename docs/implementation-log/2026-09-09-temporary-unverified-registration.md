# 国际版临时免验证码注册实施与验证记录

日期：2026-09-09

分支：`codex/global-api-foundation`

基线：合并当时的 `origin/main` 后为 `3c41141179b8097e8b877ba1d60153fd0b5c5274`

## 目标与边界

- 按当前联调要求，国际版注册阶段暂不发送或校验邮箱/手机验证码。
- 邮箱或有效 E.164 国际手机号、8–72 UTF-8 字节密码、已审且版本完全匹配的用户协议/隐私政策仍为必填条件。
- 新账号的 `emailVerifiedAt` / `mobileVerifiedAt` 保持 `null`；不把“免验证码注册”表述为“联系方式已验证”。
- 找回密码仍依赖独立且已验收的邮箱/短信渠道；商城等要求已验证联系方式的写入门禁不放宽。
- 仅 `APP_REALM=global` 且 `GLOBAL_UNVERIFIED_REGISTRATION_ENABLED=true` 时开放。部署模板固定默认 `false`，国内服务不受影响。
- 本轮未部署生产、未触碰生产数据库、未发送真实邮件/短信，也未把 QA 协议占位内容视为正式法律文本。

## 实施内容

- `GET /api/saydian-app/v2/auth/capabilities` 增加 `registration.verificationRequired`；只有国际协议、写入状态和功能开关同时满足时，才声明免验证码注册可用。
- `POST /api/saydian-app/v2/auth/register` 在国际域调用临时注册流程，接受 `channel`、`identifier`、`password`、`nickname?`、`consentVersion`、`locale?`，不接受验证码或伪造投递结果。
- 邮箱统一规范化；手机号使用 `libphonenumber-js/max` 校验并保存为 E.164。重复账号返回稳定冲突，不产生额外会话或同意记录。
- 注册事务写入未验证账号、两条协议同意记录和会话。账号只在开关继续开启时允许密码登录和刷新；开关关闭后未验证账号不能继续登录/刷新。
- 修正国际 E.164 手机密码登录取值，避免错误使用国内手机号字段。
- 同步更新机器可读字段契约、API 目录、部署模板和部署只读检查；API/Worker 模板中的开关均为 `false`。

## 自动化验证

- `pnpm api:docs`：通过，生成 306 条路由且全部有说明。
- `pnpm api:docs:check`：通过。
- `pnpm contracts:client:check`：通过，76 个客户端调用点，缺失字段为空。
- `node deploy/global/check.mjs`：113 项结构检查通过；本机无 Docker，Compose/Nginx 原生运行仍未验收。
- `pnpm tools:test`：9/9 通过。
- `pnpm typecheck`：全部 workspace 通过。
- `pnpm test`：502 项通过、4 项隔离数据库条件测试跳过；其中 API 390、Worker 16、Admin 39、Download 10、Migrator 9、Commerce domain 28、Contracts 10。
- `pnpm build`：全部 workspace 通过；仅保留既有 Sass 与后台分包大小警告。
- 国际认证定向测试覆盖：能力开关、邮箱/国际手机号免验证码注册、验证时间为空、两条协议同意、重复账号、开关关闭不落库、E.164 手机登录及未验证账号登录开关。

## 隔离环境端到端验证

- 使用独立本地库 `saydian_global_demo`、本地 API `127.0.0.1:8082`、国际 realm、关闭验证码供应商、暂停 Worker/回调；13 项迁移已应用。
- 本地仅加入两份 `qa-unverified-registration-20260909`、英文、已标记 QA 的协议占位记录，用来验证门禁；它们不是可发布法律文本。
- 能力响应实测为邮箱/短信注册可用、`verificationRequired=false`、找回密码两渠道不可用。
- Flutter 模拟器经 UI 完成邮箱注册并取得会话；数据库确认该账号两种验证时间均为空、恰有 2 条 `global_app_v2_unverified:en` 同意记录和 1 个会话。
- 清理时仅按精确合成邮箱、两种验证时间为空、恰好两条指定 QA 同意记录的组合条件删除该账号。复核：用户 0、会话 0、同意记录 0；两份 `GlobalLegalDocument` QA 占位记录仍在。

## 失败、原因与修复

- 首次 QA 法律发布时间使用本地 `NOW()` 写入无时区字段，Node 解析后表现为未来时间，能力门禁关闭；仅将两条 QA 占位记录调整到已过去时间后恢复，生产逻辑未放宽。
- 本地 PostgreSQL 没有 `postgres`、`admin` 或误拼的 `saidian_app` 角色；确认隔离环境实际最小权限角色为 `saydian_app` 后继续。不得据此推断生产角色。
- 清理后首次统计了旧 `LegalDocument` 表，显示 0；国际协议实际存于 `GlobalLegalDocument`。随后按正确表复核为 2，未误删协议。
- 模拟器自动输入首字符漏录，预期合成邮箱未命中；通过创建时间、是否含邮箱及未验证状态缩小到唯一 QA 账号，再按实际精确邮箱和协议条件清理。未使用宽泛通配删除。

## 后续验收

- 生产或共享环境保持 `GLOBAL_UNVERIFIED_REGISTRATION_ENABLED=false`，直到独立国际数据库、正式已审协议、隐私评估和运营方案获批。
- 上线前必须复测关闭开关后的未验证账号处置、账号升级为已验证的迁移流程、滥用限流和正式法律版本；不得永久依赖临时开关。
- 邮箱/短信找回、国际短信国家、真实投递、跨设备、国内/国际账号双向隔离仍未验收。
