# H5 商城：隔离本地演示

本轮复用 `apps/shop` 与统一 API，覆盖顾客购物、会员积分与售后、员工推广工作台。以下为本地交付说明；末节区分已执行结果与待验收项，不以源码覆盖代替实际联调。

## 运行边界

| 服务 | 隔离演示 | 保留不动 |
| --- | --- | --- |
| API | `http://127.0.0.1:8081` | 8080 |
| H5 | `http://127.0.0.1:5174/saidian-mall/#/pages/home/index` | 既有商城 |
| 管理后台 | `http://127.0.0.1:5175/admin/` | 5173 |
| PostgreSQL | 回环主机的 `saydian_h5_demo` | 原有业务数据库 |

配置文件位于仓库外：`F:/xcodeplace/saidianserver-local-runtime/h5-demo/.env.h5-demo`。它含本地随机凭据，禁止提交 Git、粘贴聊天或写进文档。启动器不加载原 API `.env`，校验库名、回环地址、端口与显式演示开关，子进程使用环境变量白名单。

`NODE_ENV=development`、`H5_DEMO_ENABLED=true`、`ALLOW_TEST_OTP=true`；ERP/其他外呼任务暂停、供应商回调处理暂停；真实短信、微信、支付宝、企业微信及自动打款不启用。不得向演示库导入生产密钥。图片浏览可能加载品牌官网公开资源；“无真实外部验收”不意味着浏览器完全离线。

## 启动与账号入口

在仓库根运行；以下使用已有私有 profile，不重建或轮换密钥。端口已占用时 `--strictPort` 拒绝启动，不要终止原8080/5173进程。

```powershell
$demoProfile = 'F:/xcodeplace/saidianserver-local-runtime/h5-demo/.env.h5-demo'
node tools/h5-demo-runtime.mjs api $demoProfile
# 另开两个终端，分别运行：
node tools/h5-demo-runtime.mjs admin $demoProfile
node tools/h5-demo-runtime.mjs shop $demoProfile
```

首次新建专用环境时，由本地操作者私下设置 `H5_DEMO_DATABASE_URL`（仅回环 `saydian_h5_demo`）；再依次执行 `prepare`、`init-db`、`migrate`、`seed`，每条命令格式均为 `node tools/h5-demo-runtime.mjs <动作> $demoProfile`。`prepare` 独占创建，已有配置不覆盖；`seed` 固定合成主键幂等写入，不清库。迁移前按仓库统一步骤安装依赖、构建共享包、生成匹配的 Prisma Client；不要对运行中的原 API 擅自 regenerate 或重启。

- 顾客：H5「我的 / 登录」使用隔离种子手机号 `19900000001`，先点“获取验证码”，再输入演示码 `123456`。仅本地显式测试 OTP 模式可用。该号码是合成演示账号，禁止对真实短信渠道使用。初始余额为 `5000 pointCents`（¥50 抵扣金额），仅种子首次记账，不定义旧系统积分换算或赠送政策。种子会员未预设密码；密码兼容用隔离集成测试动态创建的测试账号验证。
- 管理员：5175后台，用户名 `h5-demo-admin`，密码由本地 profile 私下提供；不是原后台账号。
- 员工：`/saidian-mall/#/pages/employee/index`，演示入口粘贴私有运行目录 `employee-session.json` 的本地员工测试会话。会话2小时过期；受控重跑 `seed` 仅刷新测试会话并保留既有合成数据，不自动续期正式企业微信身份。不要复制会话到文档或截图。
- 普通会员与员工令牌分开保存，`User.id` 用于统一手机会员身份，员工权限独立验证；不能拿会员token进入员工工作台。

## 接口与合成 curl 联调

商城兼容接口前缀 `/api/saidian-mall/v1`，成功响应是 raw JSON；直接读 `token`、`user`、`quote`，不加 `data` 包裹。管理接口 `/api/saydian-app/admin/v1` 仍用 v2 包裹。字段与非空示例由 `tools/h5-field-contracts.mjs` 合并进接口中心；`pnpm api:docs` / `pnpm api:docs:check` 由统一集成阶段运行。

以下 PowerShell + `curl.exe` 仅针对上述隔离环境，实际执行会给演示会员新增地址并创建/取消一个合成订单。不调用付款、不发真实短信；测试商品为本地演示库存。需要完整自动清理/竞争验收时优先运行下一节的随机夹具脚本，不在原库运行这些命令。

```powershell
$base = 'http://127.0.0.1:8081/api/saidian-mall/v1'
$cap = curl.exe --fail-with-body --silent "$base/storefront/capabilities" | ConvertFrom-Json
if (-not $cap.demo) { throw '只允许隔离演示' }
$otp = '{"mobile":"19900000001","usage":"login"}' |
  curl.exe --fail-with-body --silent "$base/auth/sms/request" -H 'Content-Type: application/json' --data-binary '@-' |
  ConvertFrom-Json
$session = @{mobile='19900000001';code=$otp.devCode;consentVersion='commerce-legal-v1'} | ConvertTo-Json -Compress |
  curl.exe --fail-with-body --silent "$base/auth/sms/login" -H 'Content-Type: application/json' --data-binary '@-' |
  ConvertFrom-Json
$auth = 'Authorization: Bearer ' + $session.token
$boot = curl.exe --fail-with-body --silent "$base/storefront/bootstrap" | ConvertFrom-Json
$address = '{"name":"H5-CONTRACT合成收件人","mobile":"19900000001","province":"测试省","city":"测试市","district":"测试区","detail":"仅限本地演示1号","isDefault":false}' |
  curl.exe --fail-with-body --silent "$base/storefront/addresses" -H $auth -H 'Content-Type: application/json' --data-binary '@-' |
  ConvertFrom-Json
$body = @{addressId=$address.id;items=@(@{skuId=$boot.featured[0].defaultSku.id;quantity=1});pointCents=0;buyerRemark='H5-CONTRACT-curl'} | ConvertTo-Json -Depth 5 -Compress
$quote = $body | curl.exe --fail-with-body --silent "$base/storefront/orders/preview" -H $auth -H 'Content-Type: application/json' --data-binary '@-' | ConvertFrom-Json
$key = 'H5-CONTRACT-curl-' + [guid]::NewGuid().ToString('N')
$order = $body | curl.exe --fail-with-body --silent "$base/storefront/orders" -H $auth -H "Idempotency-Key: $key" -H 'Content-Type: application/json' --data-binary '@-' | ConvertFrom-Json
# 网络重试必须保留相同$key与$body；不要每次请求重新生成键。
curl.exe --fail-with-body --silent "$base/storefront/orders/$($order.id)" -H $auth
curl.exe --fail-with-body --silent -X POST "$base/storefront/orders/$($order.id)/cancel" -H $auth
curl.exe --fail-with-body --silent -X DELETE "$base/storefront/addresses/$($address.id)" -H $auth
```

取消成功退回库存、积分/券；历史演示订单保留审计，不删除旧行。遇错误停止人工示例并按返回状态核查，不猜测取消或退款成功。请勿把token/refreshToken打印到共享日志。

关键验收口径：

- 报价所有 `*Cents` 都是人民币整数分。`preview.product_money/shipping_money/payable_money` 和商品 `price` 仅为旧接口元单位展示。订单现金＝商品金额－优惠券－积分抵扣＋运费；积分不抵运费，现金至少1分。
- 未核验积分 `balanceCents/availablePointCents=null`、未获取钱包/趋势 `null` 显示“未获取”，不能变成0。订单行现金＋积分＋券分摊＝该行总价；分次退款按累计数量差值，不独立四舍五入造成尾差。
- 过期登录仅保留带 `checkout-owner` 的结算草稿；原用户重新登录可继续，不同用户清除旧草稿。刷新单飞且检测会话代次，旧请求不得覆盖新账号数据。
- 客户售后先预览再申请，传 `orderVersion`；`APPLIED` 不是到账。登记退货物流只能用于本人 `WAITING_RETURN` 售后，不自动确认商家收货或退款。纯积分行审核后本地记账；现金退款未知时继续占用且不得重复发起。
- 分次退完商品不自动补退运费。财务用 `shipping-refunds/preview` 和 `shipping-refunds` 单独申请 `SHIPPING_ONLY`，经有权限管理员审核后才能执行退款，分别记录申请人与审核人；未完成原运费申请返回409占用。未知历史分摊、独立退款或未接管支付关系均阻断。
- 微信公众号授权需真实配置才能启用；授权 state/绑定票据一次性，手机验证码区分用途，绑定冲突不合并账号。微信内 JSAPI 必须使用当前公众号的绑定身份；普通浏览器只展示匹配能力。支付回跳、二维码出现、前端成功提示都不是到账依据。

## 六款商品图来源

图片URL沿用 `tools/seed-h5-demo.mjs` 中逐项核对的品牌官网来源；不复制功效断言。六款商品的价格、库存、分类、优惠券和积分均为本地合成数据，不是官网报价或运营政策。

| 合成演示商品 | 官网公开图片来源 |
| --- | --- |
| FF2100 | [原图](https://www.saidian.cc/d/file/p/2026/06-04/58b4b79f8dc6dc47b94b41280b7ecc4c.png) |
| R7青春版 | [原图](https://www.saidian.cc/d/file/p/2026/05-09/3ff0af773292f7f1f617c31894ee4dc3.png) |
| R7 | [原图](https://www.saidian.cc/d/file/p/2026/05-09/d32064b98ec2f945b687a5413aa7e6a5.png) |
| W8 Ultra-R | [原图](https://www.saidian.cc/d/file/p/2026/05-09/0d71386418353d04bdf709c558be1418.png) |
| W8 Ultra | [原图](https://www.saidian.cc/d/file/p/2026/03-10/04a6610c8d8339941444376fa055b1c4.png) |
| W8S | [原图](https://www.saidian.cc/d/file/p/2026/03-10/7911a686806de8fd1b8580dd899a55be.png) |

## 验收命令与真实边界

```powershell
pnpm typecheck
pnpm test
pnpm build
node --test tools/h5-frontend.test.mjs tools/h5-checkout-recovery.test.mjs tools/h5-demo-network-guard.test.cjs tools/h5-demo-profile.test.mjs tools/h5-field-contracts.test.mjs
pnpm tools:test
pnpm api:docs:check
pnpm contracts:client:check
pnpm --filter @saydian/app-shop build:mp-weixin
# 先由集成人统一完成依赖/共享包/Prisma及API版本匹配，8081运行后：
$env:RUN_H5_ISOLATED_ACCEPTANCE = '1'
node tools/h5-isolated-integration.mjs (Get-Location).Path $demoProfile
Remove-Item Env:RUN_H5_ISOLATED_ACCEPTANCE
# 需要5174、5175同时运行，且私有员工会话未过期：
$env:RUN_H5_ADMIN_EMPLOYEE_ACCEPTANCE = '1'
node tools/h5-admin-employee-integration.mjs (Get-Location).Path $demoProfile
Remove-Item Env:RUN_H5_ADMIN_EMPLOYEE_ACCEPTANCE
```

随机夹具测试校验原8080/5173监听进程未变化；8081真实HTTP、真实隔离库的登录/购物/权限；独立Nest注入fake provider、限制出站以验证回调、退款、积分与库存竞争。它只按本轮随机用户、订单、商品、售后标识清理夹具，不清空库；`finally` 同时清理本轮订单/售后集成任务，报告清理结果。测试专用适配器不是生产可达的免鉴权或伪支付接口。

后台/员工验收脚本通过5175/5174真实代理登录，只对种子商品价格、库存、轮播、优惠券进行临时修改；结束时比较当前值与本轮写入值再恢复，若被其他人同时修改则拒绝覆盖并报告。赠券、归因、日期筛选和分页使用本轮独立标识，清理结果及不含凭据的运行记录留在仓库外的私有目录。已有浏览器演示订单和审计不删除。

演示 API 的 Node 预加载门禁覆盖 TCP/TLS/HTTP/fetch、DNS 与 UNC 文件路径，只允许回环连接；它是应用进程防护，不是操作系统沙箱，不承诺限制另行启动的本机程序或任意原生插件。隔离注入测试使用进程内假适配器，不请求任何真实供应商。

| 实际执行结果（2026-09-08，根集成执行） | 结果 |
| --- | --- |
| 类型检查、全库测试、构建 | `pnpm typecheck`、`pnpm build`通过；`pnpm test`共309通过，4项默认跳过的数据库并发测试另在专用演示库单独执行，4项全部通过 |
| 前端会话、结算恢复、隔离门禁、字段示例与工具 | Node附加测试40通过（前端10、结算恢复8、网络门禁7、私有配置9、字段示例6）；`pnpm tools:test` 7通过；`git diff --check`通过 |
| 接口与小程序回归 | 300条路由文档检查通过；Flutter `fa79aa3` 基线76处调用无缺失路由，仅证明路径覆盖，不代表真机字段解析验收；小程序构建通过 |
| 隔离真实库HTTP＋注入适配器验收 | 245断言、63次HTTP、cleanup=true；fake create 3次、refund 5次；覆盖积分多次部分退款、尾差、纯积分商品、单独运费退款、重复回调、最后库存竞争、退货物流权限/幂等、评价重复保护 |
| 后台与员工真实代理联动 | 211断言、37次HTTP、cleanupErrors=[]；后台价格/库存/轮播/优惠券变更可见，推广二维码为真实PNG，赠券/领取/归因/业绩日期与分页、顾客员工权限隔离、未配置提现拒绝且钱包不变 |
| 内部浏览器响应式 | 实际检查390×844、768×1024、1280×900视口，手机/平板双列商品、桌面分类侧栏与三列商品，无横向溢出；截图在本轮工具记录中，未另存文件 |
| 内部浏览器购物与账号 | 两次加购累计2件；新增合成地址；398元商品－10元券－50元积分＝338元现金；提交、刷新保持同订单；取消后积分一次返还。退出后第二合成账号购物车为空；收藏触发登录后返回原商品；员工入口要求独立会话。真实员工OAuth未验证 |
| 原8080/5173保持 | 同次脚本确认原监听PID及进程开始时间前后不变；数据库操作限定回环saydian_h5_demo，未对原库执行迁移或清理 |

交付时 `http://localhost:5174/saidian-mall/`、`http://localhost:5175/admin/` 及8081/8080的就绪接口均返回200。运行中的演示端口为5174/5175/8081；原5173/8080仍由原进程持有。详细命令、失败修复与边界见 [实施记录](implementation-log/2026-09-08-h5-storefront.md)。构建存在Sass旧API、既有后台大包与uni-app/router弃用提示，不影响本轮构建成功，未为消除提示扩展到依赖升级。

真实公众号/企业微信授权、短信送达、微信/支付宝扣款退款、支付渠道主动查单、ERP写单、真实提现与生产切流**未由本地fake测试验收**。渠道继续显示未配置，接入后须单独做真实沙箱/授权验收与支付对账，不能宣称仅改域名即上线。

2026-09-09 更新：新增同源 Web Locks 会话刷新/结算互斥、账号变更主动同步和迟到响应身份校验，内部浏览器已实际验证跨标签退出与切换账号后清除旧个人页面。并发结算的时序检查由自动化测试覆盖，不等于所有浏览器与多设备验收；旧版无 Web Locks 的 H5 浏览器会阻止新登录/刷新/下单并明确提示。只读旧单缺少商品明细时继续显示“未获取”，不推断数量、金额或开放未接管操作。本轮新增的三会员、十后台角色、模拟履约与健康场景及剩余缺口见 [全系统模拟验收](system-qa.md)。
