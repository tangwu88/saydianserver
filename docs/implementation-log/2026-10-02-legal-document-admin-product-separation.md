# 2026-10-02 法律文档后台按 App 隔离

## 范围与原因

- Saydian Health 与 Say Ring 使用不同政策和协议；后台必须将两款 App 的文档分开维护，避免误用或交叉覆盖。
- 沿用现有 `GlobalLegalDocument` 表、文档类型和 API，不新增迁移，不创建或发布任何法律正文。

## 实现

- 后台协议列表固定显示所属 App、文档类型、语言、版本、审核、启用和发布时间；新增文档按 App 限制可选类型。
- 编辑器以现有 `documentType` 推导所属 App：Health 使用 `user_agreement`、`privacy_policy`、`health_ai_analysis`；Say Ring 使用 `say_ring_user_agreement`、`say_ring_privacy_policy`。保存仍调用同一管理 API，但只发送所选文档类型；客户端能力接口已按各自文档类型读取对应版本。
- 切换 App 或协议类型时清空版本、标题和正文，防止将另一款 App 的协议内容复制过去。保存启用状态前要求明确确认，服务器既有的 `reviewed=true` 发布限制保持不变。
- 已审核记录的产品、类型、语言、版本、标题和正文锁定；修订应新建版本。仅保留启停控制。
- 富文本编辑器增加只读模式。本轮没有写入数据库、改动政策内容或部署生产。

## 验证

- Admin 全量测试 155 项通过，Vue 类型检查通过，Vite 构建通过（仅有现存的大 JS chunk 提示）。
- `node tools/generate-api-reference.mjs --check`：368 条路由契约完整且无差异。
- 部署结构检查 10 项、工具测试 32 项、H5 流程测试 61 项通过；`git diff --check` 通过。
- 尝试运行根级 pnpm 检查时，pnpm 自动补齐工作区依赖，Prisma 包下载出现 registry curl error 23；中断重试后未完成。因此根级 `pnpm typecheck`、`pnpm test`、`pnpm build` 及依赖其上的 H5 合同构建未验收。Admin 本地独立检查和既有可直接运行的根级检查已通过。

## 未验收

- 尚未提交或部署；需在后续发布后验证线上后台列表和两款 App 的能力/协议接口。
- 尚无经过法律审核并批准上线的 Say Ring 政策正文；启用前须由业务与法律负责人提供正式内容并完成审核。
