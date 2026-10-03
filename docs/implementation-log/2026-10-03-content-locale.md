# 健康百科后台语言修复 — 2026-10-03

## 范围与基线

- 用户批准 Say Ring 六项修复方案，其中包含中文健康百科发布与后台语言修复。服务端只处理该项，不修改 App Store、账号、设备、健康记录或 AI 状态。
- 修改前 status、remote、fetch；远端主线为 `36197ef7e3b17a2ddbe91d8679280f4e7d4ba8d2`。以此建立独立 `codex/content-locale-20261003` 工作区，保留其他分支和脏文件。修正类型错误前再次 fetch，主线未变化。
- Start/Publish wrapper 限定 main，本轮独立分支使用相同串行检查、显式暂存和远端一致性门禁，经 PR 安全合入主线，使用既有单路 Actions 自动发布。

## 原因与实现

- 公开 `/global/api/saydian-app/v2/content/articles?locale=zh-Hans` 返回 0；`locale=en` 返回 3 篇已发布中文文章。分类及文章实际标记 en，并非请求失败。
- 后台未提供文章/分类语言编辑；服务端缺省 locale 调用 globalLocale，导致编辑时也重置 en。
- 新增默认 zh-Hans；编辑缺省或 null 输入保留原语言（包括历史 null），显式输入校验支持的语言，兼容 zh-CN、zh_CN 等旧别名。不改 public API 缺省语言，不作英文兜底。
- 文章须与分类同语言，子分类须与父分类同语言；分类改语言时检查已有文章及子分类，包括 null。两条保存路径使用同一个事务锁，避免并发保存造成分类语言不一致；缺失编辑目标返回 404，不重新创建。
- ResourceView 共用一份八语言选择列表，新增默认简体中文，编辑沿用原值；列表明确语言，只提供同语言关联选项，切换语言清除不匹配的关联。不复制编辑器、删除旧分类或改原文。
- 接口语义及生成的目录同步更新；无 schema、migration、seed、供应商或部署工作流变更。

## 验证与修复

- frozen install、Prisma generate、contracts / commerce-domain build 通过。
- 新 API 回归先出现 12 项预期失败；修复后 API 专项 30 项、实际 SFC 逻辑专项 66 项通过。复用已有测试 harness，没有新增浏览器测试依赖。
- 首轮 typecheck 捕获可选 id 不符合 exactOptionalPropertyTypes；改用已查到的 previous.id 后全量 typecheck 通过。
- `TMPDIR=/private/tmp pnpm test` 全量通过；API 958 项通过，7 项仅真实数据库用例本地跳过。根级检查串行执行，避免 contracts 生成竞争。
- `pnpm build`、`pnpm api:docs:check`（374 条）、`TMPDIR=/private/tmp pnpm tools:test`（36 + 61 + 38）、`node deploy/global/check.mjs`（12）、`node --check tools/http-contract-smoke.mjs`、`git diff --check` 通过。
- 构建保留原有 Sass 弃用与 bundle 体积提示，不修改无关功能。运行逻辑去掉原来多余的花括号及 locale 展开；没有引入第二份规范化器。
- HTTP smoke 新增本地/测试库限定的真实 PostgreSQL 验收：新增中文、缺省编辑保留、旧 zh-CN 列表、双入口详情、英文不可读中文、副作用前校验、并发分类改语言与文章创建只能成功一方。实际 HTTP、镜像和 Linux CI 尚需对本次提交验收，不能由本地 mock 代替。

## 公开原文快照与发布边界

下列原条目和 en 入口保留；代码上线后才补充中文分类和发布副本。重试前先回读中文列表并比较原文散列，不重复创建相同版本，不覆盖原条目。

| 原文章 ID | 正文 SHA-256 |
| --- | --- |
| c5fd0a89-db78-4bd6-956e-24dd5dc02ccf | b73f81a25f15f8a83e67ebbd3eee255967019daa02ce09f129bedc9fdd99d576 |
| 900a424f-4e23-453a-b9f0-37823c73635a | fbf7da98d37f19648c58ceb1b00c45481911169d75d273a9f2ce4910afd3d2b2 |
| dc85bc34-256c-4d9f-bc64-ab75f211010c | cf43f8290972c5ef8bad590195c57472c4f15e62499f5e6cbd0d88d0594cea56 |

- 原分类 `fb4ff2cf-f1c5-4ae3-b3fb-85de596c4a87`；三篇原文均无封面、无 img 元素，不能编造图片验收。
- 本轮只读确认线上为 36197ef、自动发布 true、transport ssh。后台已回到登录页，已请用户自行登录；不索取或公开密码、验证码，不绕过后台鉴权发布。
- 上线后核对主线 SHA、Actions、双 readiness revision、实际容器镜像及公开路由；保留原业务开关，不解除部署锁、不启动并发发布、不重编生产镜像。
- 内容发布和 App 实机回读尚未完成；Say Ring 任务负责 App 分页、分类失败隔离及真机验收。不能把代码提交等同于中文内容或手机已更新。
