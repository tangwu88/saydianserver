# Say Ring 邮箱验证码与密码登录注册

用户2026-10-24补充：邮箱接阿里云邮件推送API；手机/邮箱注册均需密码及验证码；默认密码登录，可切换验证码登录。只修改本项目认证与集成配置、独立Say Ring客户端，不迁移数据库、不修改现有供应商凭证、不发送真实验证码。

已读AGENTS、handoff及最近2026-10-23/22实施记录；status/remote/fetch成功，HEAD与origin/main均90acb7f97cb13228600ecdaf6762df7ed3b57edc。Start-Change按约定因当前分支非main拒绝；保留原本所有未提交交接/法律文档，不merge/reset/stash。由相同HEAD创建codex/say-ring-aliyun-email-auth-20261024独立候选，不自动发布main已有待发差异。

现有register-with-code已校验密码、一次性purpose=register验证码、已审协议及14岁确认，可复用。客户端恢复独立注册、两个渠道密码默认及验证码切换。Say Ring不使用旧临时免验证码入口，验证码登录不再为Say Ring新建无密码用户；其它App兼容行为保留。原无密码会员可验证码登录/找回密码，不批量改密码。

阿里云依据官方SingleSendMail、RPC签名及2015-11-23服务接入点文档（2026-10-24核对）：https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-singlesendmail 、https://help.aliyun.com/en/direct-mail/signature 、https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-endpoint 。固定允许的HTTPS端点、POST表单HMAC-SHA1、不跟随跳转、限时、严格成功回执。保留wecom_smtp/webhook，不迁移其配置。AccessKey只存加密secret；换发件人/区域/凭证需重新投递验收，配置保存、API接收与实际收件分别表述。

测试命令、失败修复、发布边界据实续记。

兼容复核：已发布旧Say Ring是验证码单入口、没有注册入口，不能直接关闭其自动注册。新增显式authFlow=verified-password-v1及login.explicitRegistrationCodeLogin能力，新版只对已有账号验证码登录；旧版无该字段仍保留原契约。新客户端缺能力时不请求该流程，不会向旧服务端静默创建无密码账号。先部署兼容服务端，再交付新版App。Say Ring临时免验证码register入口关闭，正常register-with-code仍必需密码及验证码。

## 本机验证及失败修复

- pnpm（现有11.25.0，进程PNPM_CONFIG_PM_ON_FAIL=ignore，不改锁文件/仓库packageManager）定向API邮件/认证61项通过；后台配置/SFC交互最终50项通过，包含阿里云测试只发送收件地址且不自动验收。
- 后台定向首轮1失败/48通过，为新增方式误改默认provider使旧webhook未配置fixture不匹配；恢复旧默认webhook，新增阿里云仅显式选择，不自动迁移已有配置，最终50项通过。
- pnpm typecheck全工作区通过；pnpm test全工作区通过：API1332通过/42实库依赖跳过，Admin261通过（新增SFC后最新全量262），contracts58、commerce28、worker141、download41、vip77、migrator11。类型和全量test在最终authFlow兼容修复后再次通过。
- pnpm build全工作区首轮及最终authFlow后重跑均退出0；仅既有Sass弃用和大chunk警告。
- pnpm api:docs:check：459路由均已说明，无新增URL；新增字段及公开能力见独立客户端文档。
- pnpm tools:test前两次因当前checkout无既有便携jq失败（第二次原路径不存在，未把失败写成通过）；GitHub公开API限流，改从jqlang官方release下载jq-1.8.2及sha256sum.txt，校验SHA256=a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627。仅Git忽略artifacts/toolchain、进程SAYDIAN_JQ及Git Bash PATH，无系统/生产修改。第三次58部署/工具、62 H5流程、38 H5契约均通过。
- git diff --check本轮文件通过；其它人原文档保持未暂存。没有执行迁移/seed、没有真实账号/OTP/邮件测试、未操作生产。

## 提交与部署边界

Start-Change/Publish-Change的main专用门禁不能用于本次已有未提交文档的候选分支；不改脚本或伪造检查点、不切main夹带历史待发差异。完成同等串行检查、重新fetch/核对main基线后只显式暂存本轮文件，提交/推送独立分支。CI/部署/真实邮件收件未验收，不能把推送写成上线；上线须单独审核main相对线上已有待发差异及当前维护状态。
