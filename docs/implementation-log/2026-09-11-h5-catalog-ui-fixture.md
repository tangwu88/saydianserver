# 国际 H5 本地目录 UI 夹具

## 范围与原因

- 为模拟手机微信布局、分类回跳、搜索分页与网络失败提供可重复的本地目录数据；不开放国际交易。
- 仅新增 `tools/h5-catalog-ui-fixture.mjs`、其独立测试与本记录。不修改商城源码、现有 phone fixture、数据库或生产配置。
- 30 个明显标记的合成商品：A 手表 27 件、B 配件 3 件。当前仓库 static 只有品牌图片和商品占位 SVG，没有真实产品照片，因此复用本地占位图，不引用外网或声称真实商品。
- 只监听 `127.0.0.1:5189`，必须显式 `--local-fixture`；校验 Host、路径遍历/真实路径边界，控制操作仅本地带一次控制令牌的表单 POST。CSP 限同源，禁止浏览器加载外部图片/API；服务不包含网络客户端、数据库或供应商调用。
- `/fixture/` 提供可见控制页：分别让下一次商品列表或首页初始化返回 503；`/fixture/evidence` 只记录公开查询、分页编号、商品 ID 和计数，不记录账号令牌。
- `checkout.enabled=false`、支付渠道为空，拒绝所有交易和登录写入；仅用于目录展示，不能代替真实微信或支付验收。

## 命令与基线

- `git status --short --branch`：保留主线程修改及既有 ERP 未跟踪文件。
- `git remote -v`、`git fetch origin --prune`、`git rev-parse HEAD origin/codex/global-api-foundation`：当前与远端均 `0f9c7e0457e9ab554d92b72a913cd706ec63e09f`。
- 检查 `apps/shop/dist/build/h5/index.html`：资源前缀为 `/global/saidian-mall/`，已有国际构建；主线程后续可串行重建，夹具按每次请求读取产物。
- 定向检查：`node --test tools/h5-catalog-ui-fixture.test.mjs`。
- 启动：`node tools/h5-catalog-ui-fixture.mjs --local-fixture`。

## 待验收

- `node --test tools/h5-catalog-ui-fixture.test.mjs`：最终 2 项通过，覆盖 A/B 分页、分类、商品详情、故障只消费一次、同源 CSP、错误 Host、路径遍历、控制表单保护、交易写入拒绝及控制页提交处理成功/失败展示；无数据库或外部网络。
- `node tools/h5-catalog-ui-fixture.mjs --local-fixture`：已启动 `http://127.0.0.1:5189/fixture/`，仅回环监听。浏览器交互证据由主线程合并至本轮 UI 调试记录。
- 不连接或修改当前本地/线上数据库，不宣称国际下单、真实微信 SDK、短信或支付已经通过。

## 本地控制页反馈修正

- 主线程 CUA 点击原生故障控制表单后状态未变化；服务端当时没有控制 POST 计数，不能断言是浏览器未提交还是被校验拒绝。原 HTTP 表单测试通过，故未放宽安全限制。
- 控制页增加显式 submit、受同一 CSRF/Origin 保护的同源 fetch，以及“正在提交/已生效/未生效”可见状态，避免依赖宿主浏览器原生表单导航。
- 证据新增控制收到/成功计数与最多 20 条拒绝原因代号；不记录来源 URL、表单内容、CSRF 值或任何账号凭据。
- 原目录测试进程 PID 54516 经命令行和回环监听所有权核验后停止，仅重启自身 5189 夹具；旧内存计数重置，浏览器须刷新控制页获取本次 CSRF。此前已观测 A 第 2 页只返回 3 件 A 商品、B 第 1 页只返回 3 件 B 商品。
