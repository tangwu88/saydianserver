# 国际会员后台可见与数字编号修复

## 原因、基线和范围

- 用户反馈：国际 App 注册成功，但统一后台会员列表为空；“我的”显示长 UUID。
- 修改前读取 AGENTS、handoff、近期国际部署/免验证码记录；`git fetch origin --prune` 后本地与远端国际分支均为 `4bf44bd9c9d5cc33a775d317cc7227740a249f45`，国内 origin/main 为 `795e66bd69c64295a00c2b3e42c52a290c8f56eb`。国内工作区既有 CRUD 修改保留。
- 根因：国际注册使用独立数据库，后台前端固定请求国内 API；国际 profile 未返回展示编号，现有 App 我的页面读取 promo_code 后回退 UUID。
- 会员号复用现有 unique/autoincrement compatibilityId，不改 UUID、不迁库、不改消费者会话、不更改旧账号。新增规范 memberNo 和现有 App 展示别名 promo_code；不代表推广归属。
- 用户随后明确：此后台只给国际版用，直接使用新数据库。撤销尚未部署的国内/国际选择及管理会话回查，整个后台请求国际管理API、使用国际AdminUser/AdminSession。已有国内工作区和消费者服务保持原状。
- 会员列表补邮箱脱敏、邮箱/数字编号检索、固定列、分页、错误与请求竞态处理。

## 命令与验证

- 首轮 `pnpm typecheck` 发现新增测试 mock 函数缺少参数声明导致 TS2493；补齐 `_query` 后全量类型检查通过。前端测试还修复了可能为空的 mock.calls 访问。
- `pnpm test`：API 409、后台 55、Worker 16、contracts 10、commerce-domain 28、migrator 9、download 10 项通过；4 项依赖独立测试数据库的商城测试按原约定跳过，不能当作通过。
- `pnpm build` 全工作区通过，仅有已有 Sass 弃用/大包警告。随后补空库设置入口，后台包测试增至 59 项，提交前重新执行全量串行检查。
- `pnpm api:docs`、`pnpm api:docs:check`：306 路由生成/验证通过；`pnpm tools:test` 9 项通过；`node deploy/global/check.mjs` 164 项结构通过。本机无 Docker，运行时 Compose/Nginx 留待服务器验证。
- 服务器只读核验国际库已有 5 条会员、0 管理员。仅为当前 `admin` 复制账号名称/显示名/密码哈希/角色至新国际 AdminUser（新 UUID），不复制管理会话或任何消费者数据；目标已有管理员则脚本拒绝覆盖。登录 HTTP 201、会员 HTTP 200/total=5，验证会话已注销。
- 新增独立 global-admin 静态容器（无密钥/业务数据卷，仅 gateway 网络，64 MB）；自动部署升级工具只对已核对 runner 作唯一匹配修改，保留备份并增加后台健康门槛和回滚。发布时只将现有 `/admin/` 路由指向国际静态容器，其他站点路由保持不变。
- `deploy/global/member-admin-smoke.mjs` 需显式 opt-in，使用真实 HTTPS 链路测试一个 example.invalid 临时会员，校验注册→后台→数字编号→分页→健康摘要，并在 finally 按本次唯一邮箱/UUID删除临时数据、注销管理会话；凭据仅 stdin，不写日志。
- 最终源码再次串行 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过：541 项测试通过、4 项数据库测试跳过。全新设置页不会虚构版本号或自动发布；空草稿必须填写真实版本/构建号/发布时间才能保存。
- 发布仅国际 API 与统一后台静态页面；国内 API/Worker 和消费者数据库不更改。
- 线上默认仍为预发布 QA 注册设置，本轮不改短信、邮件、支付、协议或注册验证状态。
