# 会员手机与邮箱验证状态管理

## 目标与边界

- 用户要求在国际版会员后台明确显示手机号、邮箱是否已验证，并允许后台人工调整确认状态。
- 复用 `User.mobileVerifiedAt`、`User.emailVerifiedAt`，不新增数据库字段或迁移；正式短信/邮箱验证码仍是自动验证来源，临时“任意验证码”测试流程仍不写真实验证时间。
- 本轮只调整国际版新会员系统。后台不能在此修改手机号或邮箱内容，不自动合并账号，不把临时测试会话原地提升为正式会话。
- 修改前执行状态、远端与交接记录检查；分支 `codex/global-api-foundation` 的本地和远端均为 `d3a1fedd04f34ec0f9478789d5476a64707bc28a`。原有京东 ERP 抽样日志及两个脚本继续保留，不修改、不暂存。

## 实现

- 会员列表的脱敏手机号和邮箱旁显示“已验证 / 未验证 / 未填写”，不会通过是否填写联系方式推断验证成功。
- 仅 `SUPER_ADMIN` 显示“人工确认 / 撤销确认”。操作前明确提示能力影响，会员需重新登录；其他后台角色前后端均无权调用。
- 新增 `PATCH /api/saydian-app/admin/v1/members/:id/verification`，只接受 `mobile` 或 `email`、布尔状态和列表数据版本；只能调整已经存在的联系方式。
- 使用 `User.updatedAt` 做并发保护，过期页面返回 409，不覆盖刚发生的会员资料变化。
- 状态修改与 `USER_CONTACT_VERIFICATION` 专门审计同事务提交；审计记录操作人、渠道、前后状态、时间和请求编号，不写原始手机号或邮箱。统一后台写审计仍保留。
- 人工撤销会立即影响依赖真实验证状态的服务端权限判断；人工确认不会改造或提权已有临时测试 Token，会员重新走登录流程后才取得正式会话。

## 验证记录

- 修改前 `pwsh -NoProfile -File .\tools\Start-Change.ps1 -Resume` 因脚本只允许 `main` 而按设计停止；未切换分支、未覆盖工作区。随后手工确认远端、当前分支和 ahead/behind 为 `0 0`。
- `pnpm.cmd --filter @saydian/app-api exec vitest run src/admin/admin-member-verification.test.ts`：4/4 通过。
- `pnpm.cmd --filter @saydian/app-admin-web exec vitest run src/member-resource-view.test.ts`：第一次因基础合成会员从“无手机号”改成“有手机号”导致原缺失值断言失败；恢复基础样例并在新用例单独设置手机号后，24/24 通过。
- API 与后台定向类型检查通过。
- `pnpm.cmd api:docs`：接口目录从 321 条更新为 322 条，全部有业务说明。
- 第一次全量 `pnpm.cmd test`：商城 107、后台 101、Worker 43 及其余工作区通过；API 683 通过、4 项条件数据库测试跳过，1 项旧会员编号测试夹具因缺少 Prisma 实际必有的 `updatedAt` 失败。补齐该合成夹具的验证字段和更新时间后，会员编号及新验证测试 8/8 通过；重新执行全量测试最终商城 107、后台 101、API 684、Worker 43 及其余工作区全部通过，API 的 4 项既有条件数据库测试仍按开关跳过。
- `pnpm.cmd typecheck`：全工作区通过。
- `pnpm.cmd build`：全工作区通过；只有既有 Sass 弃用和后台大 chunk 警告，无构建错误。
- 第一次 `pnpm.cmd tools:test`：9 项工具和 61 项 H5 流程通过，契约组因根构建产物为默认 H5 而 37/38；按国际版参数构建 `/global/saidian-mall/` 后重跑，9 项工具、61 项流程、38 项契约/隔离检查全部通过。
- `pnpm.cmd contracts:client:check`：冻结客户端 `fa79aa3610be25762fc4b5e7245de0f1f86245ef` 的 76 条路径/方法均存在，`missing=[]`；不替代字段解析或真机验收。
- `node deploy/global/check.mjs`：176 项结构检查通过；本机没有 Docker Compose，真实容器和 Nginx 由目标服务器发布器验证。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过。

## 上线验收标准

- 超级管理员在会员列表可看到手机号和邮箱的独立真实验证状态，并可在确认提示后人工确认或撤销。
- 无联系方式、非法类型、非布尔状态、过期数据版本、非超级管理员及国内服务均不能修改。
- 操作后只返回脱敏联系方式；审计记录不包含原始手机号或邮箱。
- 发布后公网 `/global/health` revision 等于本轮提交，会员页面真实渲染验证标签和操作入口；验收只打开确认框后取消，不更改生产会员状态。
