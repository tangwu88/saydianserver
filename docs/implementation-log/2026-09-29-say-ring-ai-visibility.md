# 2026-09-29 Say Ring AI 内容显示开关

## 修改前与范围

- 用户要求后台新增开关：开启时隐藏 App 中 AI 相关内容，完成后同步 Git、发布线上后台并调试 App。
- 原工作区 `codex/say-ring-legal-20260929` 有未提交法律文档工作；保持原状。新建隔离 worktree `E:\saydian-ai-visibility-20260929`，使用 `main`，运行 `tools/Start-Change.ps1` fetch/快进检查；HEAD 与 origin/main 均为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`。
- 已阅读 AGENTS、handoff 和最近实施记录。`pnpm install --frozen-lockfile --offline` 成功。
- 复用 AppSetting，不增加数据库 migration；开关只控制 Say Ring 的 AI 内容展示，不修改既有 AI 供应商凭据或历史健康数据。

## 契约与文件

- 设置键 `say_ring_app_display`，值 `{hideAi:boolean}`。开启 true 表示隐藏，关闭 false 表示显示；保存必须公开，不保存任意额外 JSON 字段。
- `GET /api/saydian-app/v2/support/app-display?product=say-ring` 返回 `{product:'say-ring',hideAi:boolean}` 标准响应包裹，设置 `Cache-Control:no-store`。国际地址加 `/global`，按各自部署数据库隔离，禁止产品回退。
- 未配置时返回 false 保持旧行为；保存值损坏返回真实不可用，不将字符串隐式转换为布尔值。
- 后台“客服与更新”增加 Say Ring 显示设置专用开关；App 读取公开接口并缓存，启动/回前台刷新，AI问答/健康报告/AI相关入口和内容随开关隐藏。

## 验证与发布

- 定向 API 校验 38/38、后台资源编辑 39/39 通过；后台独立 vue-tsc 通过。接口目录生成并校验 361 条。
- 国际部署结构检查 187 项、H5/手机号入口部署回归 8 项通过；本机无 Docker Compose，原生解析/Nginx 运行时留给 CI 验证。
- 发布前两次 Git fetch 遇到 Empty reply / Connection reset，另一次发布脚本内部 fetch 连接超时；未跳过远端核对。为当前命令子进程使用 Schannel 与 HTTP/1.1 后 fetch 成功，远端 main 仍为原基线。未修改全局 Git 设置或降低 TLS 校验。
- 发布工具下方自动记录串行全仓库检查结果。线上版本与真机结果需另行核对；Git push 不代表部署或真机验收。

- 2026-09-29T12:58:46.7650135Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-29T13:00:11.4587535Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-29T13:00:32.1597476Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-29T13:01:22.5117749Z：pnpm.cmd test，退出码 0。

- 2026-09-29T13:02:13.5589414Z：pnpm.cmd build，退出码 0。
