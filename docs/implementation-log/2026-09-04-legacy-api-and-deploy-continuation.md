# 2026-09-04 旧接口兼容与发布流程续作

## 修改前

- 阅读 AGENTS、handoff 和 2026-09-03 实施日志。
- `git status --short --branch`：上轮改动全部保留，未暂存。
- `git fetch origin`、`git remote -v`、`git rev-parse HEAD origin/main`、`git rev-list --left-right --count HEAD...origin/main`：远端无新提交，双方为 `a29054e1866eab0467f9491b59aadf09e624c43f`，差异 `0/0`；不对脏工作区执行 merge。

## 上轮中断与复核

- 2026-09-03 定向执行 legacy-contract、legacy-health-mapper、health-warning：3 文件、16 项通过；此结果早于最后一批补丁。
- 上轮最后补丁增加支付方式映射、旧订单写入阻断、数字标识查询保护、关爱重复邀请处理；未宣称完成回归。
- CUA 多次连接超时；随后 Windows computer-use 因无法可靠识别浏览器 URL 主动中断。本轮先完成本地工作，不绕过该安全限制。
- 本轮 `pnpm --filter @saydian/app-api typecheck` 首次失败：正则捕获组在严格索引检查下可能为 undefined；改为先检查捕获组存在后解码。
- 补上健康单条详情的 UUID 过滤，新增支付编号、数字 ID、旧订单只读及关爱重复邀请回归测试。

## 验收目标

- 完整类型检查、测试和构建；逐路由接口列表/调用说明与旧功能缺陷清单。
- 修改前安全更新脚本，修改后显式文件提交，CI 成功后版本化发布；线上验证与未配置边界分别记录。
- 不变更原域名、不迁移旧库、不自动开启维护中的写入。

后续执行结果继续追加，未执行不标记通过。

- API 类型检查复测通过；API 全量 10 文件 41 项单元测试通过（在通知 eventId 补充保护前）。
- `pnpm api:docs`、`pnpm api:docs:check`：156 条控制器路由全部有说明，生成/校验通过。
- 部署/Git 脚本首次大补丁因同文件同时 Delete/Add 被工具拒绝，未改文件；拆为新增与 Update 后应用成功。
- 本机无 Docker CLI；真实 PostgreSQL/HTTP/镜像构建交由隔离 GitHub CI，不伪报本地 Docker 验收。
- `pnpm tools:test` 首次 3/4 通过，Git 防护测试失败：PowerShell Push-Location 不改变 .NET 相对路径解析基准，检查点写到了调用目录；改为显式绑定任务仓库绝对路径，测试会再次验证跨仓库行为。
- 工具测试第二次失败是 Windows Git autocrlf 使测试文件带 CRLF；断言规范化换行（不改变源码文件）。第三次 4/4 通过，含真实隔离 Git 工作区/远端分叉保护。
- 根级 `pnpm typecheck`、`pnpm test`、`pnpm build` 串行完成，全部成功：共 48 项单元测试。管理前端存在 bundle >500kB 的性能提示，构建仍成功，不为本轮兼容工作重构打包。
- 改写原先过度笼统的“已实现”覆盖表，区分有代码、单测、真实联调、未配置，并列 P0/P1 缺口；生成的 156 条接口有参数/鉴权/响应说明，不声称是完整 OpenAPI DTO schema。
- 复核 AppShell 已用 route.fullPath 作为 router-view key，资源路由切换会重新加载；没有错误地修改这一正常行为。
- 用户确认内置浏览器腾讯云已登录后，直接选择内置浏览器成功（全局 getState 仍一次超时）；定位轻量实例而非空 CVM 列表，免密登录 49.232.231.131 成功。
- 服务器只读检查：本项目 API/PostgreSQL/Redis/MinIO 健康；/ 根盘 40GB、已用23GB、可用16GB。未发现专用 CI receiver/账号；读取的是 SSH 主机公钥而非私钥。部署授权接入单独确认。
- Publish-Change 完成全部 5 组检查，但暂存后 whitespace 检查发现新增部署文档末尾多余空行，正确阻止提交。只移除该空行，记录后显式重新暂存这两个文档；再次 fetch 确认远端未变，保留已通过的代码检查结果并继续提交。
- Windows 自带 ssh-keyscan 不支持服务器 KEX，改用 Git 附带新版 ssh-keyscan 成功；通过已认证云终端读取主机 fingerprint 进行核对，不关闭 StrictHostKeyChecking。

- 2026-09-04T05:55:05.9723377Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-04T05:55:23.4562986Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-04T05:55:44.0758900Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-04T05:55:58.4500283Z：pnpm.cmd test，退出码 0。

- 2026-09-04T05:56:16.8416833Z：pnpm.cmd build，退出码 0。
