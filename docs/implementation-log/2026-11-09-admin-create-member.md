# 同步本地及后台手动创建会员账号

用户要求同步最新代码，在会员与健康档案填写手机号、密码创建新账号。用户明确选择管理员代核实手机号，主要用于手表和戒指App连接测试，必须可直接登录App。

## 工作区与边界

已读AGENTS、handoff和11月7日会员资料/商城注册记录，status、remote、fetch完成。原E:/saydian h5位于codex/local-customer-image-fix-20261028，HEAD44054d5302c966646f3b4801f84f042af370c187，落后origin/main的7772037a98301e6db335a92eb160f8ede7cf8b31共22提交；含用户修改实施日志、未跟踪文档/法律资料及SayRing-harmony目录。使用git switch -c codex/admin-member-create-20261109 origin/main同步已跟踪源码，Git原样携带未提交文件、保留旧分支，不reset、强推、stash或合并脏树。新分支起点与远端SHA相同。Start/Publish只接受main，本轮手动执行同等检查和显式文件提交，不纳入用户原有改动。

## 实现

- 新POST /api/saydian-app/admin/v1/members，复用统一用户表/手机号规范化/bcrypt12及现有登录，SUPER_ADMIN在控制器和服务两层验证。只收字符串手机号与密码，8字符至72UTF-8字节，重复规范化手机号返回409，不覆盖、合并或重置旧账号。未知字段拒绝。
- 按用户明确选择写入mobileVerifiedAt，状态ACTIVE；昵称自动为用户加尾号，其他个人资料保持未知。不代替用户创建法律同意，不自动创建设备绑定、健康数据或积分流水。会员创建与脱敏专门审计同一事务，审计只记来源、是否设置密码及管理员核实状态，不保存完整手机号；响应只含必要会员信息，不含密码/哈希。
- 会员与健康档案列表新增“新增会员账号”，仅超级管理员可见。独立两字段弹窗，密码隐藏、提交防重复、错误留在弹窗，成功清空密码并刷新会员列表；关闭/卸载清理，账号切换后丢弃陈旧回执。提示管理员需核实手机号。
- 新账号适用于连接测试的登录凭据；App原有法律确认与设备归属/蓝牙配对规则保持。没有实体设备，不把登录令牌认证或模拟服务验收写成手表/戒指真机蓝牙连接成功。

## 验证

- 首次离线依赖安装因pnpm供应链元数据缓存缺失而失败；改为联网frozen安装，保留安全校验和锁文件，通过1011项策略检查。Prisma generate仅更新本地客户端，没有连接或迁移数据库。
- 初始API16项与前端5项定向通过；继续将App登录测试加强为真实会话/JWT签发与用户鉴权器验证（不再替换issueSession），同时覆盖手表saydian-global、戒指say-ring的App控制器及商城密码登录，环产品法律确认仍必须提供。
- 首次完整pnpm test因本机并发Vitest进程触发Zone Allocation内存不足而失败；未改断言，设置已安装Vitest支持的VITEST_MAX_FORKS/MAX_THREADS=2、MIN=1后重新执行pnpm test通过。workspace concurrency环境项未由pnpm config确认，不将其作为已生效措施。API1533通过/93项可选实库跳过，后台316、商城223、伙伴86、Worker161通过/5跳过。pnpm typecheck、build、api:docs:check（545路由）、tools:test及diff均通过。增加旧版入口断言后再次通过API类型检查及16项创建/登录回归。
- 只读核对本地App代码：手表harmony_latest的/api/v1/site/login发送username/password/group；戒指E:/SayRing的/global/api/saydian-app/v2/auth/login发送手机号密码，地址为app.saydian.cn。覆盖真实LegacySiteController及AuthController，使用真实bcrypt、会话/JWT签发和UserAuthGuard验证；戒指产品的法律确认仍保留，兼容其省略product的手机号登录请求。
- 实际构建后台的本地浏览器验收：两字段创建、列表回显、重复手机号中文提示通过；以新建账号分别从手表/戒指V2路径登录，JWT可调用设备鉴权接口。仅一个会员/一个专门审计，页面异常0。采用数据库替身；截图与browser-receipt.json在忽略目录artifacts/admin-member-create-20261109，未向生产创建账号、改密码或配对硬件。截图初次位于对话框入场动画，等待动画后重新确认布局。
- 为真实数据库验证补充tools/http-contract-smoke.mjs的受限CI回环夹具：实际POST创建、手机号规范化与管理员核实状态、未知资料为空、无健康/法律同意记录、重复409、实际旧版手表multipart登录/戒指V2登录和设备令牌认证。保留NODE_ENV/test/localhost/ALLOW_HTTP_FIXTURES四重限制，语法检查及接口文档检查通过，实库执行由CI核对，不冒称本机已执行。
- 云端CI及线上结果仍按实际回执确认；没有真机蓝牙验收，不把App接口鉴权成功称为设备配对成功。
