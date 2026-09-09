# 接口中心示例与说明补全记录

## 范围与原因

- 范围：`/admin/api-docs` 的 271 条代码目录路由，以及接口文档的 Markdown / OpenAPI 导出。
- 原因：接口中心原先仅展示简短标题；未人工保存的“业务示例”和“错误处理”显示为 `{}`，不足以支撑调用与排障。
- 约束：方法、路径、鉴权和参数仍以代码目录为准；不写入真实令牌、手机号、密码、验证码或供应商密钥；已保存且非空的人工说明优先保留。

## 实现

- `ApiDocumentationService.list()` 向前端返回目录中的请求、返回与依赖信息；对未填写或空对象的示例与错误说明生成默认内容。
- 默认示例含脱敏的 `curl.exe`、请求说明、预期返回、依赖和占位符替换提示；动态路径使用尖括号占位符。
- 默认错误指引只覆盖由接口目录和服务端守卫可确认的 400、认证、角色权限和路径资源错误，并给出幂等重试原则；不把未知供应商状态伪造为成功或固定错误码。
- 默认业务说明组合用途、请求、返回与非核心依赖。人工保存后的标题、说明、示例与错误指引仍直接使用保存值。
- Markdown 与 OpenAPI 导出补充请求/返回说明和默认或人工的示例、错误处理；OpenAPI 使用 `x-saydian-*` 扩展保存完整说明。

## 命令与结果

| 命令 | 预期 | 结果 |
| --- | --- | --- |
| `pwsh -NoProfile -File .\tools\Start-Change.ps1 -Resume` | 确认分支和既有修改，安全继续编辑 | 通过；`main` 与 `origin/main` 同步，未合并、不覆盖既有修改 |
| `pnpm --filter @saydian/app-api typecheck` | 后端类型通过 | 通过 |
| `pnpm --filter @saydian/app-api test` | 后端回归测试通过 | 19 个文件、75 个测试通过 |
| `pnpm --filter @saydian/app-admin-web typecheck` | 管理端类型通过 | 通过 |
| `pnpm --filter @saydian/app-admin-web test` | 管理端回归测试通过 | 2 个文件、6 个测试通过 |
| `pnpm --filter @saydian/app-admin-web build` | 管理端生产构建通过 | 通过；保留既有的大 chunk 提示，未视为失败 |
| `pnpm api:docs:check` | 路由目录与人工说明一致 | 通过，271 条路由 |
| `git diff --check` | 无空白错误 | 通过 |

## 本地界面核验

- 刷新 `http://localhost:5173/admin/api-docs` 后，页面提示已说明自动提供示例和错误指引。
- 打开 `POST /api/saydian-app/v2/auth/reset-password`：业务说明显示请求字段、成功返回和短信依赖；示例显示脱敏 `curl.exe`；错误处理显示参数校验与重试原则。
- 未点击“保存草稿”，因此未创建或覆盖任何人工接口文档注释。
