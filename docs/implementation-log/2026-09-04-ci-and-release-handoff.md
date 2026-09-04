# 2026-09-04 CI 结果与发布接手记录

## 已提交和验证

- 兼容接口/文档/发布脚本提交：`c47d4f31f09177238c9402e846447d3bfe5b857e`。
- 维护豁免修复提交：`2e86ce000b7fde29da9b22e6cdd8d6ac21203ff2`。
- [首轮 CI 33842404820](https://github.com/saydian88-cmyk/saydianapp-server/actions/runs/33842404820)：成功，耗时 3m34s。
- [维护修复 CI 33842583164](https://github.com/saydian88-cmyk/saydianapp-server/actions/runs/33842583164)：成功，耗时 3m40s。
- 最新源码本地与 CI 均通过类型检查、52 项单元测试、4 项工具测试、全部应用构建、156 路由文档校验；CI 额外完成真实 PostgreSQL 迁移/种子、API 就绪、33 项 HTTP 契约断言及 API/Worker/Admin 三镜像构建。
- `gh run watch --exit-status` 均退出 0；`gh run view --log` 核对 HTTP 33 项断言。测试只在隔离 CI 数据库创建虚构账号、健康值和文章；没有在生产插入测试数据。
- 当前后台前端构建仍有 bundle >500kB 性能提示；GitHub 提示旧版本 Action 的 Node 20 runtime 已由平台切换至 Node 24，不影响本轮成功结果，后续定向升级 Action 版本。

## 服务器与权限状态

- 用户已登录腾讯云内置浏览器，使用 Lighthouse 的现有 TAT 免密连接 ubuntu 成功；没有改密码、添加 root 登录或开放网络端口。
- 目标为 49.232.231.131，目录 `/opt/saydianapp-server`，共享网关 `saidian-gateway-1` / `saidian_default`。
- 主机 SSH ED25519 fingerprint 经已认证云终端与本地 Git OpenSSH 计算一致；没有关闭主机校验。
- 生产现有 `IMAGE_TAG=2026.09.02-1036afa`；APP_DOMAIN=app.saydian.cn；MAINTENANCE_READ_ONLY=true。API/数据库/Redis/MinIO 健康，外网 ready 返回数据库正常，但没有新 revision 字段，说明新版尚未部署。
- GitHub Secrets 与 AUTO_DEPLOY_ENABLED 尚未配置；两个 CI 的 auto-deploy 均 **skipped**，不是部署成功。查询 production 环境返回 404，首次接入时需核对环境是否创建及保护规则，不能擅自移除审批。
- 服务器没有本项目专用 CI receiver/账号。已提交可审阅的安装器/接收器；等待用户确认新建专用受限发布权限，再安装并验证 status/非法命令拒绝。
- 不把专用账号称为无风险：它能更新 root/Docker 应用，仓库/密钥失陷可能影响服务器；私钥只能存工作区外和 GitHub Secrets，不能放文档或日志。

## 下一步

1. 确认专用自动发布权限后执行 continuous-deployment.md 的一次性接入，保持现有维护值。
2. 配置并验证 4 个 Secrets，启用 AUTO_DEPLOY_ENABLED；针对已经通过 CI 的当前 main SHA 手动运行 Deploy production，或由下一次源码 push 自动触发。
3. 验证实际镜像/revision、维护状态、API/Worker/Admin、外网管理页面和错误日志；补充首次发布/回退证据。
4. 阅读 api-coverage.md 的 P0/P1；不把本次 CI 通过当作真实供应商、旧数据迁移或 App 全业务验收。

本轮最后只新增此验收记录，未改变已验证源码。记录前 Start-Change.ps1 确认干净 main 与远端 2e86ce0 一致；文档提交前再次检查接口目录、差异及暂存范围，不覆盖其他改动。
