# 2026-10-03 SAYDIAN Health 国际公开页面

## 范围与边界

- 新增英文隐私声明、用户协议展示、客服和账号删除申请页面，全部限制在 `/global` 国际入口。
- 页面读取现有 Health 国际 API 发布的协议和客服配置；没有创建、编辑、审核或启用法律文档，也未触碰 Say Ring 文档。
- 账号删除页面复用现有登录与 `POST /auth/delete-account`。不在浏览器存储会话，不提交真实删除请求或发送验证码。

## 实现

- 协议页面通过 Health `auth/capabilities` 取得当前已发布文档引用，再经国际网关读取正文；展示原版本和语言，HTML 经过白名单清理。
- 客服页面只显示 `global_support` 公共配置中的已发布字段；缺少配置时提示尚未发布，不填造联系人。
- 删除申请页支持密码与当前启用的短信验证码登录；用户明确勾选确认后才提交既有删除接口，并按响应展示排程时间。现有服务器行为为账号立即进入待删除、撤销会话并停用推送，最早 7 天后由 Worker 处理。
- Admin 静态站加入页面映射、CSP/安全头；国际 Nginx 增加精确页面及资源路由。共享网关修复脚本可幂等补全缺失路由并保留旧 API 转发。

## 验证

- `pnpm api:docs:check`：369 条路由描述完整。
- `pnpm tools:test`：工具 36 项、H5 流程 61 项、H5 合同 38 项通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过。首次类型检查因新工作树尚未生成 Prisma Client 报错；运行 `pnpm db:generate` 后重试通过。构建仅有既有 Sass 弃用及后台 bundle 体积提示。
- 下载页专项 typecheck、11 项测试和 Vite build 通过；`apps/download-web/dist/global/` 含 4 个 HTML 页面与 3 个静态资源。
- `node deploy/global/check.mjs`：12 项通过；`node --check` 及 `git diff --check` 通过。
- 只读线上核对：国际能力接口及 Health 英文协议正文均返回 200，当前协议版本为 `global-appstore-2026-10-02`；客服公开配置返回 200。新增页面公网路径当前仍为 404，线上 `/global/health` revision 为 `e9670670f752485ee187dd6da0946e948cb5f92c`。

## 未完成

- 尚未合入主线或部署；先前生产传输运行已取消，按当前指示不重启、不切换、不重触发部署。
- 新页面未在公网验收，必须等获准的后续发布后再检查 HTTPS 200、资源、公开协议渲染和登录/删除 UI。未用生产账号发短信或提交删除申请；该动作会真实禁用账号。
