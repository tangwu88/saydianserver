# 2026-09-29 国际版“客服与更新”保存修复同步

## 原因与版本

- 用户截图所在国际后台的脚本已提供 Android 市场链接及 HarmonyOS 编辑表单；只读公网 `/global/health` 仍显示 API revision `a134be05e02fb7c48063345a4d87ef06362caa81`，该 API 的旧下载契约不支持 `market`。
- 修改前 `origin/codex/global-api-foundation=a134be05e02fb7c48063345a4d87ef06362caa81`，经 `git merge-base --is-ancestor` 确认它是已验收下载功能分支 `13d5b86c95892dc2973b097ee8a0c6b49fcf5068` 的祖先，可正常快进。国内 `main` 的同一修复已推送为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`。
- 在干净的国际功能分支上 cherry-pick 该修复，得到 `616362b`。范围仅包含已开发的 Say Ring 安装包/市场链接能力、本次保存提示与错误码；没有 Prisma migration、真实安装包、密钥或用户数据改动。

## 验证命令与结果

- `pnpm api:docs:check`：348 条路由均有说明并与生成文件一致。
- `pnpm tools:test`：工具 10/10、H5 流程 61/61、H5 契约 38/38，通过。
- `pnpm typecheck`：全部工作区通过。
- `pnpm test`：后台 137、API 794（另 4 项数据库环境测试跳过）、其他工作区执行项通过。
- `pnpm build`：API、Worker、后台、商城 H5、下载页及共享包构建通过；仅保留既有 Sass 弃用和大分包提示。
- `node deploy/global/check.mjs`：187 项结构检查通过；本机无 Docker Compose，运行时容器校验由国际部署器完成。
- `node --test deploy/global/h5-deployment.test.mjs deploy/global/phone-test-deployment.test.mjs`：8/8 通过。
- `git diff --check`：通过；与旧国际分支的差异未包含 Prisma migration 或密钥文件。

## 发布与回读

- 将本文件与已验证修复提交后，仅以正常快进方式把目标 SHA 推送至 `codex/global-api-foundation`；不强推、不更改国内分支历史。
- 国际部署由既有独立发布器处理。推送后需核对 `/global/health` 的 revision、后台新提示和实际管理员保存回读；在此之前不声称线上已修复。
- 不通过测试写入生产配置；现有公开状态、维护状态与真实下载链接由管理员继续控制。
