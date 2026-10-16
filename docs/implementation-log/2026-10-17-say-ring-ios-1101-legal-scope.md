# Say Ring iOS 1101 公开版本适用说明

- 用户明确授权：仅发布已审阅的 Say Ring 中英文版本适用说明，然后继续 TestFlight / App Store 送审。批准稿在独立 SayRing 仓库 docs/IOS-1101-POLICY-SCOPE-UPDATE.md；不修改已发布协议正文/同意版本、其他产品或用户数据。
- 已读 AGENTS、handoff、最新伙伴发布记录和自动部署约定；Start-Change.ps1 完成干净 main 的检查。原本地 eda3c665 已快进至远端 e22b7f9355ff2cf0b7f5abb6b96361eadd2faaf9；两个公开 readiness 同时回读 e22b7f9 / ready / database ok，确认没有把本轮说明夹带到未发布的旧业务差异中。
- apps/api/src/content/say-ring-legal-page.ts 仅区分已发布 iOS 1062–1064 与本次 1.0.2（1101）的实际范围，说明固件监测设置和可选 AI 睡眠参考报告；保留临床/生理展示限制、访客本机边界、原始分段留本机和单独授权/本次确认。
- 发送智谱 BigModel / GLM 的信息及第三方身份来自当前已发布睡眠独立说明，不新增第三方或上传字段。保留数据库中当前 reviewed/published 文档内容和版本，HTML 清洗与只读流程不变；不写入同意或撤回状态，不访问/修改用户数据，不执行迁移。
- 配套测试确认旧构建范围、新构建说明、中英文、第三方与摘要边界、真实正文/版本原样保留及既有无副作用/HTML安全规则。
- 首轮定向 15/16，通过范围扩展后 English 主语由 edition does 改为 builds do，旧测试字符串未对应调整；已修正断言，仅纠正文本期望。原失败日志保留于忽略 artifacts/sayring-ios-1101。
- 后续依照 Publish-Change 串行执行接口文档、工具/部署/H5、类型、全量测试与构建；具体结果由下方命令日志追加。提交需重新 fetch 并保留他人工作。推送不等于部署，必须核对 CI / Deploy production 与双地址 revision、Say Ring 中英文实际页面和未改动的文档版本；线上接收回执随 App 发布记录保存，避免只为回执再次触发服务端部署。

- 2026-10-16T16:52:18.0626010Z：pnpm api:docs:check，退出码 0。

- 2026-10-16T16:53:23.3231000Z：pnpm tools:test，退出码 0。

- 2026-10-16T16:53:33.3598470Z：pnpm typecheck，退出码 0。

- 2026-10-16T16:53:51.7675150Z：pnpm test，退出码 0。

- 2026-10-16T16:54:01.8987510Z：pnpm build，退出码 0。

- Publish-Change 已完成并通过全部五个根级门禁、差异检查及显式三文件本地提交；原生 HTTPS push 因本机未配置 Git 用户凭据失败，未强推。使用用户已授权的 GitHub 连接推送同一最终树；本条仅补充交付回执，不改变已通过测试的运行时代码。
