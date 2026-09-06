# 2026-09-06 生产自动部署最终交接

## 目标

- 把三端 App 下载页、后台下载配置和生产自动部署整理成可直接接手的仓库状态。
- 删除交接文档中“尚未部署、Secrets 为空、自动发布关闭”等过期结论，不改写历史实施日志。
- 不提交安装包、生产密钥、SSH 私钥、数据库备份或真实业务数据。

## 接手基线

- 修改前本地 `main`、`origin/main` 均为 `36ad693917da957f423135bbe8c3e065aeed3290`，工作区干净。
- 远端为 `https://github.com/tangwu88/saydianserver.git`。
- 本日志所在提交及后续线上 revision 必须现场用 `git rev-parse HEAD origin/main`、GitHub Actions 和 `/health/ready` 核对。

## 已完成的生产状态

- 新仓库四个生产 Secrets 与 `AUTO_DEPLOY_ENABLED=true` 已配置；专用 SSH receiver 只接受 `status` 和 `release SHA`。
- [Deploy production 34006385576](https://github.com/tangwu88/saydianserver/actions/runs/34006385576) 成功发布基线 `36ad693917da957f423135bbe8c3e065aeed3290`。
- 生产数据库备份、备份校验、隔离恢复演练和 4/4 Prisma migrations 已完成；维护值保持 `MAINTENANCE_READ_ONLY=true`。
- `/health/ready`、`/admin/`、`/down` 返回 200；共享网关只解析到正式 `saydianapp-admin` 后端。
- `app_update` 已从旧包装归一为 `DownloadManifest v1`；公开接口返回 Android、iPhone、HarmonyOS 三端配置。

## 下载页验收

- Android：`0.1.19（23）`，64,401,320 字节，SHA-256 `d81d46ed1b100b13aca43bf3e0323a5c0d2e1004840831a10c2f3cd385c1bf26`。
- HarmonyOS：`0.1.3（5）`，8,595,228 字节，SHA-256 `22c03c4b88448e11412f1bb1397275760aa29e72135d395e008f97d53b40358f`。
- iPhone：`0.1.19（23）`，`coming_soon`，没有 IPA、TestFlight 或虚假链接。
- 两个公开安装包均完成全文件字节数与 SHA-256 校验；各连续 20 次 Range 请求全部返回 206。
- 后台“客服与更新”可编辑三端版本、构建号、状态、下载链接、字节数和 SHA-256；安装包仍须先放入服务器 `/down/files/`。

## 本轮文档整理

- 更新 `README.md` 的工程结构和生产边界。
- 更新 `docs/handoff.md` 的当前状态、接手步骤、下载页和自动部署说明。
- 更新持续部署与生产手册，明确自动发布已启用及当前环境无 required reviewers。
- 未删除历史日志；历史记录中的旧仓库、账单失败和热修复结论只代表当时状态。

## 未完成与禁止误判

- 旧库真实迁移、关闭维护只读、旧域名切换、真实支付、推送、短信、AI、企业微信、聚水潭和异地容灾仍未完成。
- Android 为 QA 测试签名；签名不一致时停止安装，不能为升级而直接卸载造成数据丢失。
- iPhone 取得真实 TestFlight 或 App Store 地址后才能在后台改为可下载。
- 新 Prisma migration 会阻止自动发布；必须先做生产备份、恢复演练和人工迁移。

## 下一位同事执行

```shell
git clone https://github.com/tangwu88/saydianserver.git
cd saydianserver
pwsh -NoProfile -File ./tools/Start-Change.ps1
pnpm install --frozen-lockfile
pnpm db:generate
pnpm api:docs:check
pnpm tools:test
pnpm typecheck
pnpm test
pnpm build
```

提交时使用 `tools/Publish-Change.ps1` 显式列出文件。推送后等待 CI 与自动部署结束，再核对线上 revision 和维护值。

- 2026-09-06T15:31:28.2012860Z：pnpm api:docs:check，退出码 0。

- 2026-09-06T15:31:44.6970950Z：pnpm tools:test，退出码 0。

- 2026-09-06T15:32:32.3393950Z：pnpm typecheck，退出码 0。

- 2026-09-06T15:32:51.6304390Z：pnpm test，退出码 0。

- 2026-09-06T15:33:20.5748260Z：pnpm build，退出码 0。
