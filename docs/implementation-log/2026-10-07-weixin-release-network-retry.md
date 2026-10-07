# 小程序支付补填入口的发布恢复

用户反馈线上仍没有“补填小程序 AppID”入口。main 89fe54d7a02bbcd31d81cb9ea367a31958029302 包含已通过完整门禁的补填功能及独立保存路由；线上双 readiness 仍为 f58878a。原 H5 开关保持不变，未保存任何生产支付凭证。

恢复失败证据：37606949435 下载到 138412032 / 366908846 字节中断，37607921406 在初始 HTTPS 请求失败；37608065116 SSH 分块仅完成 chunk-000，下一块以 124 超时。均未导入镜像或切换服务。下载器会因任一临时网络错误放弃全部已完成分块，因此在独立 codex/weixin-release-network-retry-20261007 分支修复下载恢复，不修改 main 业务代码和支付配置。

修改前阅读 AGENTS.md、handoff、最近库存编辑日志；Start-Change 成功 fetch、快进检查，main / origin/main 均为 89fe54d。新工作树 E:/saydian-weixin-release-recovery-20261007 仅承载恢复脚本、测试和本日志。原 Start/Publish 工具要求 main，因此本恢复分支手动串行执行同等门禁、重新 fetch 核对基线、仅提交三份显式文件，不合并 main、不强推。

下载元数据和单分块最多尝试五次，1/2/4/8 秒等待；分块失败不重下其他已完成分块，每次更新短期签名地址。GitHub API 单次等待由 15 秒增至 60 秒，单分块体读取上限 180 秒，全流程和 receiver 的原有超时保留。原受信 HTTPS 域名、禁止转发 token、206/Content-Range/长度、完整 archive SHA256、OCI 镜像 ID 与标签校验全部保留。重试日志只打印尝试号/分块索引，不输出凭证或签名 URL。

增加临时元数据/网络/不完整分块恢复测试，证明已成功分块仅下载一次；持久无效响应五次后拒绝且无输出，临时文件清理和全量摘要检查继续有效。计划在恢复分支运行 workflow_dispatch，revision 固定 main 89fe54d、build_run_id 固定其成功 verify 37596359486，复用原 artifact 11471920923；受原生产锁保护，不重新构建或替换应用镜像。镜像导入成功后仅部署当前 main 已验证版本，核对双健康 revision、后台实际 bundle 的按钮和独立路由，以及 H5/下载清单原值。未验收：入口实际上线、用户补填、开启小程序支付和真实付款。

- 2026-10-07T10:57:09.1893600Z: pnpm api:docs:check exit 0

- 2026-10-07T10:57:31.5483024Z: pnpm tools:test exit 1

本地首次 tools:test 失败因新进程遗漏 SAYDIAN_JQ 测试适配器变量；便携 jq.exe 仅在 PATH 不足以处理 Git Bash 的参数转换。补上原工作树已使用的 SAYDIAN_JQ，恢复部署夹具检查，不改生产脚本。

- 2026-10-07T10:59:27.0853394Z: pnpm api:docs:check exit 0

- 2026-10-07T11:01:15.9180791Z: pnpm tools:test exit 0

- 2026-10-07T11:01:20.4207589Z: pnpm typecheck exit 2

新工作树 pnpm install --offline 未生成 Prisma client，typecheck 报 @prisma/client 缺导出。仅运行 pnpm db:generate 生成本地类型，不连接数据库；保留 api:docs:check / tools:test 已通过结果，继续串行 typecheck/test/build。

- 2026-10-07T11:02:57.5208319Z: pnpm typecheck exit 0

- 2026-10-07T11:03:56.7425025Z: pnpm test exit 0

- 2026-10-07T11:04:31.1056562Z: pnpm build exit 0

- 恢复 37611760048 下载至 234881024 字节，rangeIndex=18 连续按约 180 秒重试仍失败；其他分块持续成功。初版新增的 180 秒读取上限在当前慢链路过短，改为 600 秒并将下载并发由 8 降为 4，减少同链路竞争；原 receiver 3300 秒/下载总限仍保留。此前 SSH 8 MB 单块耗时约 8 分钟，支持该限时调整。业务 main、artifact、实际镜像仍为原 89fe54d，无支付资料写入。

- 2026-10-07T11:25:56.2996956Z: adjusted pnpm api:docs:check exit 0

- 2026-10-07T11:27:44.8079132Z: adjusted pnpm tools:test exit 0

- 2026-10-07T11:28:04.2381871Z: adjusted pnpm typecheck exit 0

- 2026-10-07T11:28:57.6954438Z: adjusted pnpm test exit 0

- 2026-10-07T11:29:29.8518996Z: adjusted pnpm build exit 0

提交前两次 fetch 分别连接重置/空响应，未暂存提交；通过原内存凭证/单进程 OpenSSL + HTTP/1.1 transport fetch 成功。核对原 main/恢复分支基线后继续，不打印凭证、不修改 Git 全局配置。
