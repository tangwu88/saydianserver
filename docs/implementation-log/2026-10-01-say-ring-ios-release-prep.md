# 2026-10-01 Say Ring iOS 服务端发布准备

## 发布范围

- 从生产基线 `97eed39` 整理 Say Ring 专属能力、14+ 新账号确认和注销 Worker 修复。
- 候选不包含、不会写入或激活任何未审隐私政策和用户协议正文。
- 默认产品 `saydian-global` 的协议类型、认证入口和已存 OAuth/绑定票据保持不变；新字段均有默认值。

## 安全门槛

- `say-ring` 仅在两份已审、同版本、已到发布时间的专属文档同时存在时开放注册；本候选不创建这些数据库记录。
- 新建 Say Ring 账号必须显式提交 `ageConfirmed: true`；只保留该确认记录，不收集出生日期。
- 注销 Worker 只删除账号名下的精确对象键；对象存储失败时不会把注销写成完成。
- 生产普通终端无权读取 `.env.production`，故没有把未验证的对象存储、备份或日志配置表述为已验证。上线前仍由受限发布器执行备份与迁移检查。

## 验证

- `pnpm api:docs:check`、`pnpm contracts:client:check`、`pnpm tools:test`、`pnpm typecheck`、`pnpm build` 通过。
- 单线程定向回归：API 120 项、Worker 6 项全部通过。
- 默认并发 `pnpm test` 的 API 子任务出现 11 个既有 5 秒密码哈希超时；未修改仓库阈值。完整 API 套件以单线程和 15 秒单项上限复跑为 836 项通过、4 项既有数据库项跳过。合并前仍以 GitHub CI 的 PostgreSQL/Redis、镜像构建和 HTTP 冒烟结果为准。
- 生产 readiness 仍为 `97eed39`；候选尚未合并、部署或执行迁移。

## 后续发布

- CI 通过后，先由受控发布器创建生产备份，再人工启用仅含两列默认值的 Prisma migration。
- 发布完成必须回读 `/health/ready` 的完整 revision，并确认维护状态未被改变。
- iOS 位置轨迹、穿戴 SDK 网络行为、对象存储实际删除、备份及安全日志留存仍需以运行时/供应商证据补齐；在此之前不发布法律文本。
