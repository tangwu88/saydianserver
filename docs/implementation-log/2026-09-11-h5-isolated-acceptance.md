# H5 独立数据库验收与可选原服务监听

## 范围与准备

- 任务：使用已有独立 `saydian_h5_demo` 测试库，运行真实 API/数据库购物验收；不访问生产或真实供应商，不修改国内版仓库，不启动 Worker。
- 已完整阅读 AGENTS、handoff、最近实施日志及隔离验收、运行器、种子、profile 和网络限制脚本。fetch 后本地/远端独立分支均为 `0f9c7e0457e9ab554d92b72a913cd706ec63e09f`；保留本轮未提交的京东试导入文件及其他代理工作。
- 原外置 profile 只连接 `127.0.0.1/saydian_h5_demo`，未包含第三方凭据字段。原 profile 保留不变；用现有 `h5-demo-runtime.mjs prepare` 新建 repo 外私有 profile，绑定当前独立源码与重新生成的演示签名材料。
- 新 profile：`F:/xcodeplace/saidianserver-local-runtime/h5-global-review-20260911/.env.h5-demo`。凭据不进入日志或 Git。
- Windows ACL 首次批量设置继承标记后文件不可读（EPERM）；只给该新 profile 显式授予当前用户及 SYSTEM 权限后恢复，未扩大到其他用户或修改原 profile。
- 原测试库已应用 11 项迁移；用户授权独立演示库追加迁移后，完整审阅剩余两项 SQL，均为新增可空字段、新表/索引，无删除或旧值修改。执行 `node tools/h5-demo-runtime.mjs migrate <private-profile>`，成功应用 `20260909120000_global_identity`、`20260909220000_health_source_metadata`。未运行 seed。

## 最小修复

- `tools/h5-isolated-integration.mjs` 不再要求原 8080 API 和 5173 后台必须正在运行；它们若原本存在，仍执行原来的 HTTP 检查。
- 原监听快照改为查询所有 Listen 项后筛选，避免指定空端口引发 PowerShell 错误。始终输出数组，覆盖空集和单一监听；增加 8081 演示 API 的 PID/启动时间保护。
- 不改变业务代码、支付配置、生产开关、测试夹具生成/清理范围或网络限制。脚本不启停既有服务。

## 真实本地执行

- 启动 `node tools/h5-demo-runtime.mjs api <private-profile>`，由现有 TCP/TLS/HTTP/DNS/UNC loopback 限制预加载，再加载当前 API；仅绑定 `127.0.0.1:8081`。没有启动 8080、5173 或 Worker。
- 执行 `RUN_H5_ISOLATED_ACCEPTANCE=1 node tools/h5-isolated-integration.mjs F:/xcodeplace/saydian-server-global <private-profile>`。
- 结果：`239` 个断言、`61` 个 HTTP 请求通过；黑盒购物阶段 `82` 断言，真实 Nest + PostgreSQL 注入适配器阶段 `229` 断言，收尾共 `239`。
- run：`44ba6140-b37a-4f71-b6c9-38b4ce2dbcbf`；`cleanup=true`。只清理本轮随机 marker 会员、商品、订单、售后、支付及相关账本/事件，未清理既有演示数据。
- 覆盖登录/刷新竞争、越权、加购累加、报价/下单幂等、取消返积分/库存、重复支付/退款回调、部分退款尾差、纯积分商品、未知退款状态、退货物流、运费单独审核、最后一件库存并发、评价幂等。
- 注入适配器内存调用：创建支付 `3` 次、退款 `5` 次；非允许出站请求 `0`。不是微信/支付宝真实回执，不对正式渠道作可用声明。
- 8080/5173 原本未监听且始终未启动；8081 PID 与启动时间在测试前后保持一致。按主线程请求保留本轮演示 API，供浏览器继续购物验收。
- 本次为当前共享商城业务的独立 demo 合约验收，不代表国际版正式交易门禁已开放。

## 独立检查

- 新增 `tools/h5-isolated-integration.test.mjs`，覆盖空监听、单一监听、PID/启动时间变化和条件 readiness 检查。
- `node --test tools/h5-isolated-integration.test.mjs tools/h5-demo-network-guard.test.cjs`：11 项通过（4 项新监听防回归、7 项已有网络限制）。
- `node --check tools/h5-isolated-integration.mjs`、`git diff --check` 通过；未并行运行根级构建、契约生成或全量测试。
- 收尾只读核验原演示会员仍为 ACTIVE，6 件 `H5-DEMO-LOCAL-` 商品仍已发布且有库存；未重新生成旧账号密码、未重置原商品库存。已向主线程提供演示 profile 路径与开发验证码登录方式，未输出签名密钥或数据库密码。

## 浏览器专用保留夹具

- 主线程随后明确要求本轮专用会员、两件商品和安全清理清单；新增 `tools/h5-browser-fixture.mjs create|cleanup <private-profile>`。固定演示库/开发 profile/真实渠道未配置，HTTP 仅允许四个已列明的 `127.0.0.1:8081` 端点。
- `create` 先只读确认当前演示库无第三方密钥和已配置集成、API 声明 demo 且真实支付关闭，再用未占用的 NANP 保留虚构号段进行本地开发短信登录；无真实短信发送。会员原来不存在，后续昵称标记本轮随机 marker。
- 已创建 marker `h5-browser-qa:557923e7-1328-4567-a2e1-65dc7d174b6c`；两个 LOCAL 商品，各一个 SKU，测试价格为 1999/999 分，初始库存为 5/2；标题明确 QA，使用页面现有缺图占位，不上传/下载素材。默认地址为合成地址，禁止发货；没有新增优惠券或修改旧示例数据。
- 私有 manifest 为新 profile 同目录的 `browser-fixture-20260911.json`，保留起始时间、随机 marker、创建的会员/商品/SKU/地址 ID，无 token/密码。独占创建清单，重复 create 不覆盖。浏览器测试结束前不调用 cleanup。
- cleanup 必须显式执行，事务内重新核对会员、商品、SKU 的 marker/时间/关联，拒绝跨会员引用、已付款或其他商品订单、退款/进行中外部任务；只删除已核验的本轮未付款测试依赖。manifest 保留为清理凭证，不涉及旧演示数据或生产库。
- `node --check tools/h5-browser-fixture.mjs` 通过；真实 create 已成功，清理尚未执行，不能宣称真实清理验收完成。
- 浏览器取消后只读复核：本轮会员仅 1 个订单，单号 `SD202609110444399817CFD7`，状态 `CANCELLED`、金额 3998 分，A 商品数量 2；库存 A/B 恢复为初始 5/2，差额预占均为 0，购物车为空、地址 2 条、支付单 0。取消前首次检查误用订单行 `salePriceCents` 字段被 Prisma 拒绝；改用真实字段 `unitPriceCents` 后成功，没有取得取消前快照，不将推算视为实测。
- 主线程授权收尾小修复：cleanup 在同一个 Serializable 事务、任何删除之前增加其他会员收藏/评价引用必须为 0 的检查；不以删除引用绕过检查。新增只读源码 guard 回归测试，不导入可执行工具、不连接数据库。仍未由本代理执行清理。

## 报价指纹真实数据库增补与最终复验

- 配合服务端新增可选 `expectedQuote` / `q1:sha256` 契约，在集成脚本自有随机 marker 下追加一个商品、优惠券及领取记录，不触碰保留的浏览器 QA 账号或两件商品。
- 准备场景：preview 后改价，携旧报价提交应 409 `quote_changed`，核对库存、积分账号、券/领取记录、订单、积分流水和支付单完整不变；新报价建单只预占一次；再次改价后，同 key 与原建单报价返回既有订单，金额不变、无重复扣减。故意把同 key 改为另一指纹则属于不同请求，应 409。
- 最后取消本轮指纹订单，验证库存、积分、券释放；与其他集成夹具一起按原清理机制清除。
- 语法与 5 项隔离脚本源码防回归检查通过后，由主线程确认并仅重启本轮演示 API，沿用同私有 profile 和网络限制。未由本代理重启 API 或执行根级构建。
- 在更新后的 `127.0.0.1:8081` API 上重新执行完整命令：`RUN_H5_ISOLATED_ACCEPTANCE=1 node tools/h5-isolated-integration.mjs F:/xcodeplace/saydian-server-global <private-profile>`，进程退出码 0。
- 最终结果：`271` 个断言、`68` 个 HTTP 请求通过；黑盒阶段 82 断言，注入 Nest + 真实 PostgreSQL 阶段累计 261，收尾累计 271。run：`33bcb37f-7af0-493d-905d-4721a368dc56`，`cleanup=true`。
- 本次实测旧指纹改价拒绝、完整资产快照无变更、新指纹建单、再次改价后的原始载荷幂等查回、同 key 不同指纹冲突，以及取消后库存/积分/券归还均通过。指纹场景走实际 8081 HTTP API；仅支付/退款场景注入内存适配器（创建支付 3 次、退款 5 次），无真实供应商调用；原监听与演示 API 的 PID/启动时间未变。
- 集成只清理自己的随机 marker 数据；浏览器 `557923e7` 夹具由主线程另行完成 UI 二次确认检查、退出账号后执行显式 cleanup。本代理随后只读复核 manifest=`cleaned`，其精确会员、2 件商品及订单 ID 均已不存在；原 6 件 `H5-DEMO-LOCAL-` 商品仍在。不把两类清理混作同一次操作。
