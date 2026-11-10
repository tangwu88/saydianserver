# Say Ring U19 独立功能目录

基线 f48866b，开始时 main 干净；fetch 与 ff-only 更新成功，独立分支 codex/say-ring-u19-health-20261110。本机无 PowerShell，按 Start-Change.ps1 同等顺序核验，不绕过 Git 状态检查。

新增 support/app-display?product=say-ring&platform=ios 的可选 u19Health 兄弟字段，公开配置键 say_ring_u19_health。schemaVersion=1、readMetrics/manualMetrics 字符串数组、300秒有效期，固定血压/心率/血氧目录。缺失、私有或无效数据仅关闭 U19。旧 readOnlyHealth 结构、五项白名单、其他产品和平台不变。无数据库迁移，不改用户数据、不创建/激活生产配置。

自动验证、构建和 Git 结果待实际执行后追加。客户端与手表真机、服务端部署分别记录，未用本机单测声称上线。


本轮补齐同一数据链路中的两个遗漏：新客户端以 `u19HealthVersion=1` 请求独立手表指标，查询在 SQL 分页前将新增指标限定为 urion/watch 来源；旧客户端和旧 readOnlyHealth 指标保持原调用。U19 日汇总保留设备日期、日精度、实际读取时间，上传使用既有 daily_summary 契约，避免把日累计步数相加；不新增数据库字段。

验证记录：初次本地工具因 Node 未在 PATH 失败，改用已安装的私有工具路径后通过。初次全量包上传测试在 macOS 临时目录符号链接解析处失败，使用 TMPDIR=/private/tmp 重跑通过，不修改生产路径检查。首轮完整 API 153 文件/1540 测试通过，9 文件/93 数据库用例因无数据库跳过；新增 SQL/日精度契约后再次执行全量。初次从错误目录执行构建因无 package.json 失败，改回本仓库后构建通过。完整命令与实际退出结果将在本轮完成时记录。


最终服务端本机检查：`pnpm typecheck` 退出 0；`TMPDIR=/private/tmp pnpm test` 退出 0，API 153 文件、1543 用例通过，93 数据库用例因无本机数据库跳过；`pnpm build` 退出 0。增加新查询参数后接口文档检查指出目录过期，执行 `pnpm api:docs` 更新三个生成文件后 `pnpm api:docs:check` 退出 0。`pnpm tools:test` 首次因 pwsh 未在 PATH 而使隔离 Git 流程用例失败，随后找到本机已有 PowerShell 7.6.6，加入 PATH 重跑完整工具及 H5 检查，未跳过用例。根级 contracts 生成与测试、构建依次执行，不并行修改共享产物。`git diff --check` 退出 0。

本次无数据库迁移、无既有健康记录修改。上线仍以 CI、指定中国站部署及 readiness 的相同完整版本为准；公开 U19 配置缺失时保持关闭，不默认激活新权限。
