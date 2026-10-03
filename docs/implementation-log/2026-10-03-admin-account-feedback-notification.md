# 后台账号创建与会员反馈回复通知 — 2026-10-03

## 范围、基线和成功标准

- 用户报告后台账号新增只出现通用英文错误，并要求后台回复反馈后向该会员的 App 发送通知。
- 修改前检查 status、remote、GitHub identity 并 fetch。最新主线为 `d67a2320207b571688f02badeb16aa7a5f3dfb6a`，远端属于 `tangwu88`。原主工作区落后 96 个提交，保留其三个未跟踪文件；新建独立分支和工作区，不覆盖同事的工作。
- 既有 Start/Publish wrapper 限定 main；本轮独立分支执行相同的串行验证和显式文件暂存，经 PR 检查合入后使用现有自动发布。禁止强推或重复启动生产发布。
- 成功标准：有效账号可创建并登录；非法字段和重复账号给出明确错误且不泄露密码/数据库细节；新回复在同一事务创建归属会员的站内通知及推送任务，重复保存不重复通知；V1/V2 App 通知接口、已读/未读与跨会员隔离可验证。

## 证据与改动

- 线上新增账号表单的只读检查确认没有提示密码要求。现有服务器要求至少 12 位，但把名称/密码合并为一个中文错误；无 errorKey 的中文错误被既有异常过滤器替换为通用英文信息。无法仅凭截图确认原提交是哪一个字段失败，不把推测记为原事件的确定原因。
- `AdminService.createAdmin` 分离字段校验，返回稳定 errorKey 和中文说明；保留 12 位密码规则、bcrypt、角色权限、只允许超级管理员创建等安全约束。唯一索引冲突返回 409，按用户选择保存 active。不修改通用异常过滤器、数据库或其他权限。
- 管理表单增加字段规则提示、保存前校验、显式载荷字段与重复提交保护。不代用户创建生产账号、不设置真实密码。
- `updateFeedback` 使用按反馈串行的事务锁，比较原回复；新回复与 SYSTEM 通知和 Outbox 一起保存。重复相同回复保留原回复时间和已读状态，不发新通知；仅改状态或匿名反馈不会通知其他会员。新回复正文只保留在鉴权后的站内通知，不进入锁屏推送或 Outbox payload。
- Outbox 复用已有 system 类型和 `/notifications` 路由，现有 App system 通知进入通知中心。仅对反馈任务在发送时检查 transactionalEnabled；推送未配置时保留既有重试，不声称手机已收到。不打开厂商通道或更改通知偏好。
- 更新反馈管理提示与接口说明；不批量补发历史回复，不改 App 源码、健康功能、供应商配置或 schema。

## 本地验证记录

- `pnpm install --frozen-lockfile`、`pnpm db:generate`、contracts/commerce-domain build：通过。
- 初次 API 专项测试缺少新工作区 commerce-domain 构建产物而未收集测试；构建该包后重试通过。Worker 测试先捕获“禁用事务通知仍推送”的预期失败，修复后通过。
- API 账号及反馈专项 14 项、Worker 推送专项 3 项、管理界面专项 60 项通过。
- `pnpm typecheck`：通过。
- `pnpm test`：API 935 项通过、7 项数据库用例未启用，另有 3 项原有头像测试在 Windows 失败；其余应用测试通过。只读诊断确认 Windows 打开/同步目录报 EPERM，与未修改的头像目录 fsync 路径一致。不跨范围改头像功能；完整 Linux CI 必须重新通过。
- 新增仅限 loopback/test 数据库的 HTTP 验证：短密码和重复账号错误、客服账号创建与登录、客服无权创建后台账号、并发相同回复只创建一条通知和 Outbox、V1/V2 读取、未读与标记已读、跨会员拒绝及重复回复不复活未读。
- `pnpm build`：所有应用通过，仅既有 Sass 弃用和 bundle 体积提示。
- `pnpm api:docs:check`：374 条接口完整且生成文件一致；`node --check tools/http-contract-smoke.mjs`、`git diff --check` 通过。
- `pnpm tools:test`：工具 27/36 通过，9 项 Linux shell/权限模拟在 Windows 失败，导致该聚合命令未继续 H5 两组。未修改部署脚本；这些模拟必须在 Linux CI 通过。`node deploy/global/check.mjs`：12/12 通过。
- 单独执行 `pnpm test:h5:flows` 与 `pnpm test:h5:contracts`：61/61 与 38/38 通过。完整 Linux CI 和实际 PostgreSQL HTTP 用例须在合入前通过。

## 验收边界

- 未操作生产会员反馈或真实账号；未在真实手机上验收通知弹窗。站内通知写入、Worker 请求与厂商/手机最终送达是独立状态。
- 发布时核对目标主线 SHA、完整 CI、原始镜像、双入口线上 revision。保留现有维护/业务停写/Worker/回调开关；不删除发布锁、不停止其他任务、不清理镜像、不恢复或 seed 生产库。
