# 2026-09-28 Say Ring 下载页、HarmonyOS 更新与安装包管理

## 原因与范围

- Say Ring 检查到新版本后需要统一进入独立下载页，而不是在 App 内直接安装或打开不透明地址。
- 后台需要同时维护 Android、iOS、HarmonyOS 三端版本；Android/HarmonyOS 支持上传不可变安装包，也支持填写应用市场 HTTPS 链接。
- 本轮只扩展 Say Ring 更新、下载与后台管理链路，不修改 Prisma schema，不填写生产密钥，不替用户发布真实安装包。

## 修改内容

- `packages/contracts/src/download.ts`：下载目的地增加 `market`；Android/HarmonyOS 直传路径接受下载静态目录或受控后端包路由，市场链接只接受无凭据 HTTPS。
- `apps/api/src/admin/admin.controller.ts`、`apps/api/src/support/*`：增加受 RBAC 保护的 APK/HAP 上传接口与公开下载接口；限制扩展名、128 MiB 大小和 ZIP 文件头，生成 SHA-256，写入对象存储与 `FileObject`，下载文件名使用服务端生成值。
- `apps/admin-web/src/*`：Say Ring 更新表单显示 HarmonyOS；Android/HarmonyOS 可选择“上传安装包”或“应用市场”，上传成功后回填文件名、字节数、SHA-256 和受控下载路径。
- `apps/download-web/*`：同一构建根据 `/down` 或 `/say-ring` 选择普通 App/Say Ring 文案与清单，Say Ring 二维码固定指向 `/say-ring`。
- `deploy/*`：生产和国际版静态容器都包含下载页；网关增加 `/say-ring` 与 Say Ring 安装包上传/下载所需路由，上传接口限制为 130 MiB。
- `tools/api-notes.mjs` 与生成接口目录：补充管理上传和公开包下载说明，当前目录为 360 条路由。

## 验证记录

- `pnpm api:docs:check`：360 条路由均有说明并与生成文件一致。
- `pnpm tools:test`：工具检查 10/10、H5 流程 61/61、H5 契约 38/38，通过。
- `pnpm typecheck`：全部工作区通过。
- `pnpm test`：商城 134、后台 136、API 805（另 4 项数据库环境测试跳过）、Worker 49、下载页 11、迁移器 9、共享契约 12、交易域 28，全部执行项通过。
- `pnpm build`：商城、后台、API、Worker、下载页、迁移器和共享包全部构建通过；保留既有 Sass 弃用和后台大分包提示。
- `node deploy/global/check.mjs`：187 项结构检查通过。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过。

## 失败与修复

- 初次接口文档检查发现新增上传/下载控制器缺少接口说明；补入 `tools/api-notes.mjs` 后重新生成并校验通过。
- 初次国际部署检查拒绝带动态查询变量的上游地址；改为静态 `proxy_pass`，由 nginx 保留原始查询参数后，187 项结构检查通过。
- 第一次全量测试的终端会话未保留最终退出码；本记录前重新串行运行接口文档、工具、类型、全量测试和构建，最终退出码均为 0。

## 尚未验收

- 本机没有 Docker Compose，compose 展开及 nginx 容器运行检查未执行；只能确认静态部署检查通过。
- 尚未在生产后台上传真实 APK/HAP、填写应用市场链接或把版本状态改为 `available`。
- `/say-ring`、上传接口、对象存储下载和 App 跳转需要 CI 发布成功后再做线上验收；推送到 Git 不等于已部署。
- 未修改生产数据库、维护只读状态、旧后台、共享商城数据、DNS 或任何供应商配置。

## 国际历史分支同步复验

- 同一提交移植到 `codex/say-ring-harmony-download-page` 时，仅 `docs/api-reference.md` 因该分支保留独立商城历史而发生生成计数冲突；源码文件均自动合并。
- 第一次 `pnpm api:docs:check` 明确失败，原因是移植后的目录仍写主线 360 条路由；执行 `pnpm api:docs` 后得到该分支实际 348 条路由，再次检查通过。
- `pnpm typecheck`：全部工作区通过。
- `pnpm test`：商城 132、后台 136、API 793（另 4 项数据库环境测试跳过）、Worker 49、下载页 11、迁移器 9、共享契约 12、交易域 28，全部执行项通过。
- `pnpm build`：全部工作区通过；仅保留既有 Sass 弃用和后台大分包提示。
- `pnpm tools:test`：工具检查 10/10、H5 流程 61/61、H5 契约 38/38，通过。
- 国际部署结构检查 187 项及部署测试 8/8 通过；Docker Compose 仍不可用，未执行容器运行检查。
- `git diff --check`：通过。
