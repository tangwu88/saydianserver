# Say Ring 高德运动轨迹地图配置（2026-09-29）

## 修改前

- 已读取 `AGENTS.md`、`docs/handoff.md` 与最近的更新配置记录。
- 工作区干净，分支 `codex/say-ring-harmony-download-page`，HEAD/远端分支 `ef2f64323df46ddfe6ffeb415795429d3ed3e37e`；`git fetch origin --prune` 成功。`origin/main` 为 `3dab610c447ad2ce92e63b73ed65c3781580b46b`，与本功能分支存在分叉，因此不快进、不强推。
- 用户选择高德而非 MapTiler，尚无 Key；不得在源码、公开配置或日志中写入真实 Key。

## 原因、范围、预期

- 在国际后台“客服与更新”添加独立的 Say Ring 地图项，可启停并填写高德 Web 服务 Key；Key 进入现有加密集成密钥存储，管理列表和公开状态接口不回显。
- Say Ring App 通过授权的第一方接口提交本次运动的有限 GPS 点；服务端用高德 Web 服务坐标转换和静态地图 API 返回轨迹图片。没有 Key、未公开、非国际环境、坐标无效或供应商失败时均不假装有地图。
- 不改数据库 schema、生产密钥、既有商城/旧 App 设置或健康记录。

## 验证记录

- `pnpm typecheck`：通过。
- `pnpm test`：通过；API 79 个测试文件通过、1 个数据库测试文件按既有条件跳过；API 798 个用例通过、4 个跳过。后台与其他包测试亦通过。
- `pnpm api:docs:check`：首次因新增接口缺说明失败；补 `tools/api-notes.mjs` 并运行 `pnpm api:docs` 生成目录后复测通过，350 个接口均有说明。
- `pnpm tools:test`：通过；包含部署 shell 检查、自动发布保持维护状态、H5 流程与契约测试。
- `pnpm build`：通过；后台 Vite 提示既有大包体积警告，不影响构建。
- `git diff --check`：通过。当前分支与 `origin/main` 分叉，按约定只提交并推送当前分支，不通过 `tools/Publish-Change.ps1` 对 `main` 强推或覆盖。

## 待验收

- 高德真实 Key 尚未填写，供应商真实地图与中国境外服务范围未验收；Key 后续只在后台录入，不在聊天发送。
