# 2026-09-08 文章富文本编辑器

## 范围与原因

- 用户在本地内部浏览器的“内容”编辑弹窗中指出，正文不应使用纯 `textarea`，需要可视编辑器。
- 保留现有 `contentHtml` 字段和保存 API，不引入第三方编辑器依赖，不修改数据库或 API 合同。

## 变更

- 新增 `apps/admin-web/src/components/RichTextEditor.vue`：基于 `contenteditable` 的 HTML 编辑区，提供正文、二/三级标题、粗体、斜体、下划线、有序/无序列表、引用、链接和清除格式。
- 编辑器保留仅需的格式标签，移除脚本、事件属性和不安全链接；链接只允许 `https/http`、站内路径、锚点、`mailto` 或 `tel`。
- 在 `ResourceView.vue` 的“内容”编辑表单中接入该编辑器，状态、标题、摘要和现有保存流程保持不变。

## 检查与验收

- `pnpm --filter @saydian/app-admin-web typecheck`：通过。
- `pnpm --filter @saydian/app-admin-web test`：通过，6/6。
- `pnpm --filter @saydian/app-admin-web build`：通过。仅保留现有的单 chunk 超过 500 kB 提示，本轮未扩展到拆包。
- 内部浏览器已打开现有文章的编辑弹窗：原有 HTML 正文已正确回显，工具栏、编辑区、安全说明和保存按钮均已可见。本次没有点击保存，未改写现有文章。
