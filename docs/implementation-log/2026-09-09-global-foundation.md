# 2026-09-09 国际服务端账号与隔离基础

## 范围与基线

- 用户要求国际版 Saydian：独立安装、独立账号、Android/iOS/Harmony、默认英文与八语、邮箱或国际手机号注册。第一方域名为 `https://app.saydian.cn`；明确采用独立服务实例与 `/global` 网关路径，不通过请求头切账号域。
- 工作目录 `F:\xcodeplace\saydian-server-global`，从现有本地服务仓库 `git clone --no-hardlinks`；原国内脏工作区只读保留。origin/upstream 均指向已有 `tangwu88/saydianserver`，分支 `codex/global-api-foundation`，不新建服务端仓库、不推国内 main。
- 修改前读取根 AGENTS、仓库 AGENTS、handoff 和当日近期实施记录；初次 fetch 验证本地/远端同为 `67479acdd60698fc5c441bfb090eeea044a68d6a`。
- 提交前复核远端发现 `origin/main` 前进到 `5bf5ec6e3fc624587536a2a8e76d28a2a24b6c75`，仅修改 HTTP smoke、tooling 测试与已有生产记录。按协调要求：先显式提交国际 checkpoint，再在本国际分支 merge origin/main、重新检查；不覆盖其他工作区、不强推、不部署。

## 修改批次与原因

1. **固定隔离与身份**：新增 APP_REALM 校验、global issuer/audience，关闭旧会话导入与国内 OTP/微信建号入口。邮箱规范化、`libphonenumber-js/max` E.164 校验、verified identity、刷新和商城门禁兼容。国内默认逻辑与 token claims 保留。
2. **真实验证码**：独立 `email_otp` / `sms_global` webhook 配置；未配置、未验收或无 SMS 国别白名单时关闭。加密随机码、哈希存储、过期、单次消费、用途绑定、并发消费/节流、失败发送失效、密码重置撤销会话；未调用真实发送。
3. **语言与内容**：八个 BCP47 locale；成员/AI 会话/文章/分类/推送安装保存语言，AI system prompt 按所选语言但不改变健康安全边界；文章精确语言筛选，JPush按设备语言分组。Harmony健康/推送来源契约补齐。未翻译健康结论、PDF或存量正文。
4. **已审同意**：独立 GlobalLegalDocument，capabilities 只给真实发布且成对同版本条款，缺失关闭注册；维护期间也不广告可注册。健康分析同意公开当前文档引用，授予校验真实版本，撤回不受文档缺失阻断。
5. **功能最小适配**：care可按邮箱或E.164邀请同域已注册用户；国际地址国别与联系方式；市场/币种/exponent发现。国际 price book、税费、物流和支付尚未实现，结算保持关闭；不把CNY改标签冒充外币。
6. **独立下载**：仅 `global_app_update`，校验显式realm=global与每个平台独立packageId，direct URL只允许 `/global/down/files/`；缺配置404，绝不把国内清单补字段变成国际包。客服仅 `global_support`。
7. **部署交接**：五个独立服务、网络/卷/桶/DB身份/密钥的Compose骨架、静态网关、只读检查脚本、无自动迁移/seed，默认维护/供应商暂停。契约见 `docs/global-api.md`；部署事实与后续验收见 `docs/global-deployment.md`。

## 命令与验证记录

所有根级 typecheck/test/build 串行，未连接生产库、未运行 seed/migrate/deploy，未从生产采集个人健康数据。

| 命令/检查 | 结果与修复 |
| --- | --- |
| `git clone --no-hardlinks`、设置已有origin/upstream、`git fetch origin --prune` | 独立clone建立；基线67479ac；原工作区未编辑 |
| `pnpm --filter @saydian/app-api add libphonenumber-js@1.12.31` | 精确依赖与lock更新；只增加所需号码校验库 |
| `pnpm install --frozen-lockfile` | 首次仅filter安装导致typecheck缺workspace vitest；完整冻结安装后修复 |
| `prisma format`、`pnpm db:generate` | schema格式与客户端生成通过；不是数据库迁移 |
| 首轮目标测试 | global auth 18项 + realm 8项通过；仅mock provider |
| 首轮typecheck | 新测试错误读取类型化Session上的私有email/passwordHash字段；改为检查mock持久化，Session只暴露契约字段，复跑通过 |
| 第一轮全量test | 仅1项旧OpenAPI reset schema单路径断言失败；新双域请求Schema改成anyOf并断言国内mobile与global challengeId/code/password；不是放宽运行时鉴权 |
| 后续全量test | API 375通过、4个需数据库测试跳过；全workspace合计487通过、4跳过（API375+worker16+admin39+download10+migrator9+commerce-domain28+contracts10） |
| `pnpm typecheck` | 最后源码轮次全workspace通过 |
| `pnpm build` | 全workspace通过；已有Sass legacy-js-api和admin大chunk警告保留，不改无关构建架构 |
| `pnpm api:docs`、`pnpm api:docs:check` | 306 routes全部描述，生成与检查通过；生成源码/文档随本轮提交 |
| 首轮 `pnpm tools:test` | 6通过、1失败：OTP示例占位字符串不匹配六位Schema；改为明确合成的000000，并补anyOf样例验证分支，不放宽真实验证码校验 |
| 修复后 `pnpm tools:test` | 7项全部通过，包含部署脚本语法/拒绝检查与安全Git临时仓库测试 |
| `prisma validate` | 仅使用合成不可连接的本地DATABASE_URL校验schema，通过；没有连接或迁移数据库 |
| `node deploy/global/check.mjs` | 111结构检查通过；本机没有Docker，Compose原生解析和Nginx运行检查未验收 |
| `git diff --check` | 通过 |

## 防止复发

- 有效号码≠短信渠道已覆盖：渠道必须独立已验收并列出真实国别，注册默认关闭。
- 不能由客户端传入realm决定DB；同邮箱/手机号也不跨国内和国际复用账号。禁止导入国内会话、WeChat/OpenID或商城身份。
- 协议版本、健康分析同意、下载包名不能由客户端硬编码猜测。读取当前已发布元数据，未配置保持未配置。
- Session只能返回脱敏资料；密码/OTP/供应商密钥不能进入日志、响应或Git。
- 新API成功envelope code是数字200，不是字符串OK；POST HTTP201不能误判失败。用户ID/关系ID是UUID，不转整数。
- 国际价格必须使用市场真实price book与币种minor unit；当前禁用结算，不重用国内CNY渠道。别把列表/单测通过写成支付或跨国注册真实成功。
- 下载校验必须验证实际二进制包名、签名和复下载hash；仅设置JSON metadata不能证明它是国际包。
- root工具Publish-Change要求main并可能触发生产发布，不适用于本国际本地分支；使用等效手工检查、明确文件清单、本地commit，等待统一交付。

## 未验收/下一位同事

先更新远端、读本记录和工作树；不要覆盖原国内未提交改动。国际部署、独立DB迁移与恢复演练、真实webhook邮件/SMS国别送达、macOS/iOS签名与真机、跨域账户双向实测、国际下载页和包发布均未执行。

国际商城price book/SKU、库存与物流规则、税费/地址区域模板、第三方支付和退货路径尚未完成；保持可用性关闭。报告生成/PDF、健康预警/关爱/报告等存储通知正文、帮助/法律/百科/商品内容的八语发布仍需真实内容与验收，当前仅实现AI对话语言、文章locale隔离与push generic alert。数据库测试跳过不能记为通过。

本记录将在合并最新origin/main与最后检查后补充实际结果；当前没有任何生产部署或供应商真实发送。
