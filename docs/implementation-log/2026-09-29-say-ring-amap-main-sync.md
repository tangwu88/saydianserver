# Say Ring 高德地图配置同步主线（2026-09-29）

## 原因与边界

- 用户要求把已经完成的高德地图配置同步到线上后台，并确保 Git 为最新代码。国际版线上 `/global/health/ready` 在修改前仍是 `ef2f64323df46ddfe6ffeb415795429d3ed3e37e`；新增地图配置接口返回 404。
- `origin/codex/say-ring-harmony-download-page` 已有经验证的高德功能提交 `bf36c99546aa59aaaa949243fe270e0d64cbc056`，后续仅文档补记至 `ed5052aefa10247fefe6fae0258b18e1a12c8816`。`origin/main` 为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`，两个历史分叉，不直接合并或强推。
- 当前工作树原本干净。切换到 `main` 后运行 `tools/Start-Change.ps1`，fetch 成功，HEAD 与 `origin/main` 一致。仅移植高德功能源码、测试和接口文档，不移植功能分支上的其他独立历史，不变更数据库 schema、真实 Key、国内业务配置或维护状态。

## 移植与修复

- `git cherry-pick --no-commit bf36c99546aa59aaaa949243fe270e0d64cbc056`：源码与测试自动合并；生成的 `docs/api-reference.md` 因主线和国际分支路由数不同产生内容冲突。
- 运行 `pnpm api:docs` 按当前主线源码重新生成 `docs/api-reference.md`、`docs/api-catalog.json` 与共享契约，得到 362 条已说明路由；不手工保留任一分支的过时计数。
- 影响范围为 Say Ring 国际版管理配置、高德 Web 服务 Key 加密保存、运动路线坐标转换及静态地图图片接口，国内部署在非国际 realm 下仍不启用此功能。

## 验证与发布

- `node deploy/global/check.mjs`：187 项结构检查通过；本机没有 Docker Compose，原生 Compose 展开与线上 Nginx 运行检查未执行。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过。
- 首次调用 `Publish-Change.ps1` 失败：跨 `pwsh -File` 传入的逗号文件串未被解析成 `string[]`，工具正确拒绝缺少实施日志的文件列表；未开始测试、未暂存或提交。改为在当前 PowerShell 进程以数组字面量传入显式文件。
- 发布脚本的接口文档检查、工具测试与类型检查已返回退出码 0；执行到全量测试时，用户明确要求暂时只同步 Git。因 `main` 推送会自动触发国内生产部署，立即停止发布脚本，确认未暂存、未提交、`main` 与 `origin/main` 均仍为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`。随后从该主线基线创建 `codex/say-ring-amap-main-sync-20260929`，只准备主线兼容改动，避免意外生产发布。
- 在独立分支重新运行 `pnpm test`、`pnpm build`、`git diff --check`：均退出 0；API 与后台等工作区测试通过，后台构建仅有既有大分包提示及商城 Sass 弃用警告。`main` 不推送，Actions 国内自动部署不会由本轮触发。
- 提交前首次 `git fetch origin --prune` 遇到 HTTPS 连接重置；改用单次 `git -c http.version=HTTP/1.1 fetch origin --prune` 成功，确认 `origin/main` 仍为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`，并再次通过差异检查。未覆盖远端历史。
- 用户随后要求按此前“在线更新”方式同步。历史记录显示国际服务器上的 `saydian-global-auto-deploy.timer` 读取 `codex/global-api-foundation`；本机没有可用的腾讯云浏览器会话或 SSH 身份。再次 fetch 后确认远端该分支仍为 `ef2f64323df46ddfe6ffeb415795429d3ed3e37e`，功能分支 `ed5052aefa10247fefe6fae0258b18e1a12c8816` 是其直接后代，仅增加高德功能与实施记录。使用非强制 refspec 推送，将远端 `codex/global-api-foundation` 快进至 `ed5052aefa10247fefe6fae0258b18e1a12c8816`；`git ls-remote` 核验成功。推送后的首次 `/global/health/ready` 仍返回旧版 `ef2f643...`，等待服务器定时发布器切换，不能把 Git 提交视为已升级。真实高德 Key 尚未填写，供应商出图仍待验收。

- 2026-09-29T10:56:05.8057177Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-29T10:56:57.3794291Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-29T10:57:26.3419804Z：pnpm.cmd typecheck，退出码 0。
