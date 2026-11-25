# 独立礼品卡批量查询页面、账号与查询统计

## 请求与基线

用户要求单独的账号密码页面，按卡号批量查是否兑换，已兑换显示订单编号；商城/礼品兑换配置查询账号并统计账号查询。明确仅查询，不修改卡片/订单，不使用后台或会员账号登录。

已读AGENTS、handoff、最近礼品发布和11月25日首次读取记录。原E:/saydian h5有用户改动并非main，status/remote/fetch后保留；E:/saydian-gift-release-20261124保留本轮前的上线日志补记，Start-Change -Resume因远端前进而按规则停止，未覆盖或合并脏目录。独立worktree E:/saydian-gift-query-20261125，分支codex/gift-query-20261125，HEAD=origin/main=62bf80e（完整SHA以git rev-parse核实）。Start/Publish工具要求main，不更改工具或占用其他worktree的main；本分支执行等价检查，未推送main。

## 实现与边界

- 独立页面/admin/gift-query，仅查询专用账号会话；账号配置与日志入口在商城/礼品兑换的“查询账号与日志”。账号不可接管后台/会员权限；后台管理仅总管理员。
- 卡号8开头8位字符串、分隔粘贴、去重最多100张；输出卡号、REDEEMED/NOT_REDEEMED/NOT_FOUND和订单编号，按兑换记录判断；不返回校验码、会员、地址或物流。卡片关闭/过期不影响历史兑换查询。
- bcrypt12密码，至少10字符最多72UTF8字节；随机独立Token仅数据库SHA256，8小时会话。编辑/停用/重设立即撤销旧会话，账号版本冲突检查；禁用及查询事务共用行锁。前端独立sessionStorage命名，未使用admin拦截器，退出/失效清空结果。
- 每个成功查询的结果快照与计数事务落库成功后才返回；接口无效卡号请求记无效次数，不保留非法原始内容；日志按账号/分页30条，累计统计按每次查询去重卡数累加。限流拒绝与未认证请求不计查卡次数。
- 登录IP/账号、查询账号使用现有CommerceGiftThrottle的独立哈希域进行跨实例原子限流；不调整维护/停写边界。结果及账号/日志no-store。
- 新增3张空表GiftQueryAccount/Session/Log及索引/外键；无旧表ALTER、UPDATE、DELETE、seed；未配置默认账号。迁移上线仍需独立验收和授权，未加入生产兼容迁移白名单。

## 验证

基线完整SHA为62bf80e5acdb94acd74bb795ccf461c355124c27。pnpm install --frozen-lockfile、db:generate和prisma format完成。

API查询定向25项、后台交互定向10项通过；异常过滤范围加入查询接口后API/过滤器合计42项通过。首次类型检查发现Prisma groupBy在transaction数组中的类型扩散及exactOptionalPropertyTypes的undefined，改为交互事务局部推导并明确null；数据库夹具会员快照字段改为现有compatibilityId。密码审计显式白名单，不依赖数据库select的对象展开。未放宽测试断言。

首轮根级typecheck/test/build、接口目录和tools检查通过，API1710通过、114项依赖真实数据库按原规则跳过（含新增7项），不把跳过称为数据库验收。新增HTTP错误过滤保留中文格式/登录提示，429和鉴权失败也no-store，最终全量检查另记如下。

Edge本地构建+全部API拦截合成数据测试7场景通过：独立登录、去重/订单查询、桌面/手机宽度、会话失效清空、创建账号、统计/日志明细、运营不能配置。初轮浏览器脚本使用英文对话框关闭标签与中文组件不符，改为本地组件关闭按钮后通过；没有修改生产断言或访问真实账号。视觉复核发现窄屏订单需要横滑，改为手机卡片列表并保留桌面表格，最终重验待后记。

SQL SHA256=07da199efd14ae747df7939d32ad5f2ce3f8638fb066bf78979c4b87cff483bb。新迁移不登记自动兼容白名单；CI新增当前结构升级试验，对旧订单/支付以及原礼品卡/兑换记录逐表原列摘要比较，核对3个新表为空。数据库事务测试加入既有隔离gift runner，覆盖卡号/管理编号碰撞、退款仍已兑、无效请求、分账号分页计数、多会话重设、禁用并发和跨实例限流。待实际云端运行结果，不将测试代码存在算作通过。

未操作生产账号、兑换卡、订单、开关或schema；本地实现不等于线上部署。完整结果在忽略目录artifacts/gift-query/。

- 2026-11-25T10:12:18.2566013Z pnpm api:docs:check exit=0

- 2026-11-25T10:14:56.7228278Z pnpm tools:test exit=0

- 2026-11-25T10:15:25.1651574Z pnpm typecheck exit=0

- 2026-11-25T10:17:16.9070981Z pnpm test exit=0

- 2026-11-25T10:17:53.1017612Z pnpm build exit=0

最终本地检查全部通过：api:docs:check 611路由、tools:test、typecheck、test（API1712通过/114依赖数据库跳过）、build、git diff --check。改版后Edge 7场景重验通过，手机订单完整展示，浏览器无页面异常；图片与报告仅在忽略artifacts目录。远端重新fetch后仍为62bf80e5acdb94acd74bb795ccf461c355124c27。

源码在独立分支提交并建立草稿PR进行隔离数据库CI；未将新迁移放入生产自动验收白名单，未推main、未部署。Publish-Change仅支持main，本次按同等串行检查、远端双核对、显式文件暂存及日志随源码提交，保留原工作区全部改动。

草稿PR #73，bcdf4d0的CI run 45594210916：根级检查、迁移部署、原订单/退款/伙伴数据库用例与两轮既有升级演练通过；新查询7项数据库用例均在新建账号的咨询锁语句失败，P2010为Prisma无法反序列化PostgreSQL void类型。改用项目既有GiftService同样的SELECT 1 AS locked FROM pg_advisory_xact_lock投影，保留事务锁及100账号限额语义。模拟测试不能暴露驱动类型问题，继续以真实隔离库重跑验证；尚未部署。

22d6f0b的CI run 45596649281：原礼品数据库24项通过，新查询7项中6项通过（分页统计、身份/过期、禁用启用、全会话密码重设、并发禁用、跨实例限流）。剩余卡号映射用例的测试夹具allowedSkuIds为空，违反旧gift_card_skus_check；补建真实合成SKU并绑定该ID，不修改/停用数据库约束，不改变业务查询实现。升级演练夹具已绑定现有合成SKU，无相同遗漏；继续跑完整检查和隔离库。

- 2026-11-25T10:30:45.3004857Z fix pnpm api:docs:check exit=0

- 2026-11-25T10:33:18.2790677Z fix pnpm tools:test exit=0

- 2026-11-25T10:33:46.7773131Z fix pnpm typecheck exit=0

- 2026-11-25T10:35:37.3447936Z fix pnpm test exit=0

- 2026-11-25T10:36:11.6916912Z fix pnpm build exit=0

- 2026-11-25T10:45:17.4742755Z fixture pnpm api:docs:check exit=0

- 2026-11-25T10:47:50.8097220Z fixture pnpm tools:test exit=0

- 2026-11-25T10:48:20.8326899Z fixture pnpm typecheck exit=0

- 2026-11-25T10:50:13.2039681Z fixture pnpm test exit=0

- 2026-11-25T10:50:50.3719396Z fixture pnpm build exit=0
