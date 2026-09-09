# 2026-09-07 本地管理后台调试记录

## 目标与边界

- 在 Codex 内部浏览器启动本地管理后台，完成登录与总览页联调。
- 仅修复 Vite 开发模式的共享 contracts 加载和 API 开发模式的 NestJS 依赖注入；不改变 API/Worker 生产 CommonJS 构建格式。
- 本机没有 Docker；使用仅绑定 `127.0.0.1` 的便携 PostgreSQL 和脱敏本地数据，不连接生产环境。
- Redis、Worker、MinIO 和外部短信、AI、推送、支付、企业微信、聚水潭保持未配置/未验收。

## 发现与修复

- `pnpm install --frozen-lockfile`：成功，安装 8 个 workspace 的锁定依赖。
- `pnpm --filter @saydian/app-contracts build`：成功，生成共享 contracts。
- 首次打开 `http://localhost:5173/admin/`：HTML 返回 200，但页面白屏。
- 内部浏览器控制台：`@saydian/app-contracts/download` 没有向 ESM 开发加载器提供 `downloadPlatforms` 命名导出。
- 原因：contracts 按 CommonJS 构建，生产构建已配置 `commonjsOptions`，但 Vite 开发模式未预打包该 workspace 依赖。
- 修复：在 `apps/admin-web/vite.config.ts` 的 `optimizeDeps.include` 显式加入 `@saydian/app-contracts/download`。

## 本地数据库与 API

- PostgreSQL 官方 Windows 下载页指向 EDB `postgresql-16.15-3-windows-x64-binaries.zip`，本地下载文件为 333,048,048 字节，SHA-256 为 `5E8AFFFE67DAF949AEEB03B74951F1EC2324E1888F73FBD036AB0E567AB004D9`；`postgres --version` 回读 16.15。
- 首次 `initdb` 使用中文路径时失败：`invalid byte sequence for encoding "UTF8": 0xb9`，失败目录由 `initdb` 自动清理。改用全英文 `F:\xcodeplace\saidianserver-local-runtime` 保存二进制、数据和日志后初始化成功。
- 首次 `pg_ctl` 启动因 Windows 参数多一层引号失败：`invalid list syntax in parameter "listen_addresses"`；修正 `-o '-h 127.0.0.1 -p 5432'` 后启动成功。
- `pnpm db:generate`、`pnpm db:deploy`、`pnpm db:seed` 成功；4 个 Prisma migration 全部应用，创建独立本地管理员和脱敏预览数据。
- 本地配置保存在 Git 忽略的 `apps/api/.env`，只含回环数据库、本地测试密钥和禁用的外部集成；未使用生产凭据。

## API 开发脚本修复

- 原 `tsx watch src/main.ts` 能启动 HTTP 服务，但没有产生 NestJS 依赖注入需要的装饰器元数据；健康探针捕获到 `Cannot read properties of undefined (reading '$queryRaw')`，管理员登录同样返回 500。
- 用 `tsc -p tsconfig.build.json` 编译后运行 `node dist/main.js`，健康探针、登录和 dashboard 均返回 200，确认数据库与业务逻辑正常。
- 曾验证 `tsc-watch` 能保留元数据并热启动，但其引入一组老旧流处理依赖，已在本轮移除，未留在最终 lockfile。
- 最终将 `apps/api` 的 `dev` 脚本改为 `node --watch -r ts-node/register/transpile-only src/main.ts`，固定 `ts-node@10.9.2`；既使用 TypeScript 生成的装饰器元数据，又保留 Node 24 源码监听重启。

## 验证结果

- Vite 重启后 `http://localhost:5173/admin/` 跳转到 `/admin/login`，Codex 内部浏览器已真实渲染账号、密码和登录按钮，白屏消失。
- `pnpm --filter @saydian/app-admin-web test`：通过，2 个测试文件、6 个用例全部通过。
- `pnpm --filter @saydian/app-admin-web typecheck`：通过。
- `pnpm --filter @saydian/app-admin-web build`：通过，1689 个模块完成转换；仅保留现有超过 500 kB 的 chunk 警告。
- 修复后 `pnpm --filter @saydian/app-api dev` 成功启动 NestJS；`/health/ready` 返回 `ready/database=ok`，登录接口与携带本地 token 的 dashboard 都返回 200。
- Codex 内部浏览器使用本地管理员登录成功，已进入 `/admin/` 运行概览页；原“网络不可用”提示消失。
- `pnpm api:docs:check`：通过，271 条路由完整。
- `pnpm tools:test`：通过，5 项工具/发布检查通过。
- `pnpm typecheck`：全 workspace 通过。
- `pnpm test`：全 workspace 通过；其中 API 19 个测试文件、75 个用例通过，管理后台 6 个用例通过。
- `pnpm build`：全 workspace 通过；保留现有 Sass legacy API 和管理后台 chunk 大小警告。
- 改用 `ts-node` 后再次通过 API 定向 typecheck、75 个测试、build 与运行时冒烟。
- `pnpm peers check`：保留原有商城 `pinia@2.3.1` 要求 Vue `^3.5.11`、当前商城使用 Vue `3.4.21` 的告警；与本轮 API 依赖变更无关，未越界修改商城版本。
- `git diff --check`：通过。
- 当前变更仅包含管理后台 Vite 配置、API 开发脚本/开发依赖、lockfile 和本实施记录。

## 未验收事项

- 本地 API、PostgreSQL、管理员登录和 dashboard 已验收；运行概览中计数为 `0` 是脱敏本地空库，不代表生产数据。
- Redis、Worker、MinIO/文件上传、真实支付、推送、短信、AI、企业微信、聚水潭联调未验收，必须继续标记“未配置”。
- 便携 PostgreSQL 二进制目录与数据目录均不进入 Git；未使用生产凭据或生产数据。
