# Say Ring 客服设置：保存含区号的纯数字 WhatsApp 号码

- 基线：`83f7d05a361e6563dbd1a7cd7d8f8cb66cc71a55`。管理页提示可填写含区号的号码，保存接口却只接受 `+` 号码或 `https://wa.me/` 链接。输入含国际区号的纯数字会返回 400。
- 调整 `apps/api/src/support/support-content.ts`，接受含国际区号的纯数字，并统一保存为 `https://wa.me/<号码>`。保留号码长度限制、域名校验、产品与角色隔离。无数据迁移，无需更新客户端；代码发布不修改现有客服开关、文章分类或号码配置。
- 在 `apps/api/src/support/online-support.database.test.ts` 通过真实 HTTP 和隔离 PostgreSQL 验证客服配置的三种写法、英文公开配置回读，以及非法链接和未授权角色仍被拒绝。客服、FAQ、实时消息与诊断专项 54 项通过；未向真实号码发送消息。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check`、`pnpm tools:test`、`git diff --check` 通过。首次全量测试的 12 项安装包上传用例因系统临时目录是符号链接未通过；将 TMPDIR 设为独立物理目录后全量通过，未修改上传代码。
- 仅随中国站发布流程上线；发布后核对线上 revision 和现有公开配置。实际账号保存与官方号码可达性另行验证。
