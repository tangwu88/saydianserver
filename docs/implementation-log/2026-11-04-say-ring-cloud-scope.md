# Say Ring 新版生理数据云同步范围说明

2026-11-04。修改前 HEAD 与远端 main 均为 `a7e73da1ebf1fa263b51a635cfe9228973ccd041`，工作区干净并已 fetch。用户要求血压、心率、血氧等也上报云端，明确全部按新规则执行，不增加额外生理云同步开关。

本轮仅修改 Say Ring 公开条款/隐私页面的**新构建适用说明**，匹配客户端1.0.10（1236）新增的自动账号同步范围。保留旧构建说明、当前已审协议/隐私v3正文与配对同意版本。不迁移数据库、不改健康接口、会员同意记录、其他产品或业务开关。旧客户端不会因说明发布自动新增上传。账号存储不代替AI/关爱授权，不承诺医学准确性或苹果批准。

定向公开内容测试19项通过，`pnpm typecheck`通过，修正环境后的完整 `pnpm test`通过：API1481项通过、71项未具备本地数据库等条件跳过；contracts90、commerce-domain28、migrator11、download-web41、vip-web81、worker154、admin-web275项通过。`pnpm build`、`pnpm api:docs:check`和 `node --test tools/tooling.test.mjs`（58项）通过。

失败留档：第一轮子进程PATH没有Node，补入已有Node24路径后启动成功；完整测试首轮12项包上传临时文件夹用例因macOS `/var` 别名而失败，仅将测试TMPDIR改为原目录真实路径后通过，未改上传实现/夹具。工具测试首次缺PowerShell路径，补入现有 `/Users/saydian/develop/powershell-7.6.6` 后58项通过。所有原失败及纠正日志私存 `build/physio-cloud-scope-20261104/`，此目录仅本机Git排除，不提交产物。

本轮只含2个内容源码/测试文件及本实施记录，差异检查通过。待核验：远端CI、生产公开页面和正式JSON协议版本；候选源码、CI、生产发布分别记录。
