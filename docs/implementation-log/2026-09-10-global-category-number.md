# 国际后台内容分类数字编号

## 范围与基线

- 用户要求内容分类列表显示简单 ID。只修改国际后台内容分类展示和对应选择操作，不改 App、旧服务或数据库主键。
- 阅读 AGENTS、handoff、上一轮实施记录；`git status --short --branch`、`git remote -v`、`git fetch origin --prune` 后工作区干净，国际功能分支本地/远端均为 `7164cfdea43e6e804ec578310be695fea97623f6`。main-only 工具不用于此已存在的国际功能分支。
- 分类没有现成整数列，复用既有 `CompatibilityId` 自增表，使用独立 `global_article_category` 命名空间；不引入迁移、不调用旧版兼容服务、不读写 legacyId。
- `categoryNo` 是只读数字字符串，UUID 的 id、parentId、Article.categoryId 不变。列表首次批量补齐缺失的技术编号，并发通过唯一约束/skipDuplicates 后回读，后续读取不再写映射；新增/编辑分类与分配编号同事务。编号可有空号，不随排序、改名、停用而变化，不回收复用。
- 分类固定中文列；关联分类按名称与编号选择，提交仍为 UUID。未修改生产业务配置或既有分类内容。

## 命令和验收

- `pnpm --filter @saydian/app-api exec vitest run src/admin/article-category-number.test.ts`：7 项通过，覆盖已有/缺失编号、并发重读、排序稳定、命名空间隔离和事务保存忽略伪造编号。
- 前端新增 7 项实际 SFC 逻辑测试，后台合计 66 项通过。首轮根 `pnpm typecheck` 在前端测试编辑期间发现 2 处隐式 any；补充调用参数类型后重跑全量退出 0。
- `pnpm test`：555 项通过，4 项依赖独立测试数据库的既有商城用例跳过。`pnpm build` 全部通过，保留原有 Sass 弃用及后台大包警告。
- `pnpm api:docs` 与 `pnpm api:docs:check`：306 路由生成/核对；`pnpm tools:test`：9 项通过；`node deploy/global/check.mjs`：164 项结构通过；`node --check deploy/global/category-number-smoke.mjs`、`git diff --check` 通过。本机没有 Docker，不将结构检查当成线上验收。
- 独立代码审查未发现编号分配/保存事务阻断点；补上烟测临时内容完全清理的断言。烟测仅创建本轮随机标记的停用分类与草稿文章，按精确标记删除自己产生的内容；保留技术编号墓碑避免回收。
- 线上发布前核验：国际部署版本仍为 `7164cfde...`，API/admin 健康、Worker 运行、自动更新 timer active；磁盘剩余约 9.1 GB。未改维护/供应商开关、旧域名或旧服务。
- 提交前再次 fetch，国际远端与修改基线相同。线上验收待发布后补录。

## 线上验收

- 通过已授权国际自动部署发布源码 `f9530985b8aaab9d319283e865e840adb55415c0`；公网 `/global/health` 返回 ready/database=ok/revision 对应源码。没有 Prisma schema 变化或新 migration。
- `category-number-smoke.mjs --synthetic-content` 在国际 API 容器执行，管理员凭据仅由既有环境经 stdin 传入；25 项 HTTPS 检查通过，`syntheticRemoved=true`。覆盖已有/新增/同名分类数字编号、并行刷新、改名排序、伪造编号不生效、父子 UUID 关系、草稿文章关联与回读。只删除本次随机标记的 2 条停用分类和 1 条草稿；保留分配过的技术编号，不回收号码。
- 内部浏览器实际验证原有“健康百科”分类为编号 `1`；刷新和页面返回后仍为 `1`。编辑编号只读，上级分类为选择框；新增文章默认草稿，分类下拉显示“健康百科（编号 1）”，选择成功后取消未保存表单。原有文章/分类内容没有更改；无浏览器控制台 error。
- 编号变化范围仅国际管理 API 与后台显示；App UUID 接口、国内服务和原数据保持不变。真实第三方服务及其他业务不在本次验收范围。
