# 2026-09-08 Flutter 消费契约兼容补齐

## 基线与范围

- 本轮由根任务运行 `tools/Start-Change.ps1 -Resume`，服务端 HEAD 与 origin/main 均为 `c5218875b614d9278b6849c52fbae3f24aad38d5`。保留原工作区和并行任务改动，不提交、不发布、不触碰生产数据。
- Flutter 仓库实际 checkout 为 `赛电APP-最新完整交接-20260811/01-项目源码`，HEAD `fa79aa3610be25762fc4b5e7245de0f1f86245ef`；`saidian-app-import-20260811` 为访问入口。已有 AppController 和报告测试改动只读保留。
- 校核 `api_client.dart`、更新服务及相关 UI 解析。74 个源码路径字面量归一后为 **72 个路径、76 个 method+path 消费契约**；不能再将 74 称为接口总数。静态清单位于 `apps/api/src/legacy/fixtures/flutter-fa79aa3-consumers.json`，每条含调用源行号及客户端 SHA。

## 实施

1. 增加购物车 index/create/update-num/delete-ids、健康预警 preview/save、feedback、site/version 共 8 条旧路径；新路由在 LegacyModule 注册并由反射测试核验。
2. 购物车按旧数值 ID 输出，新增使用领域原子 increment，更新使用 set；删除的 sku_ids 转为当前用户购物车行 ID。cart 结算 CSV 必须全部属于当前用户且有效，拒绝外人、失效商品、非法数量；继续支持 buy_now。
3. 售后按真实 Flutter `refund_type/refund_require_money/refund_reason` 转为领域类型、精确整数分和订单明细 ID。积分保留 `point` 元值给领域账本精确处理，会员 `money1` 从核验积分账户读取；无账户返回 null，不能虚构可消费余额。
4. 健康预警保存保留旧 UI 未展示的阈值和关爱分享权限；空配置的开关全部关闭。未配置阈值不能凭空启用血糖预警。反馈交给真实 SupportService，错误向上传递。
5. 睡眠、身体和血液成分字段双向归一，并让历史旧键参与报告证据聚合；未知不补零。睡眠同步保留原 clientRecordId 指纹，避免升级后重复导入。
6. 会员及关爱关系优先使用原正整数 ID；资源映射显式指定 `legacy_app` 来源，不混用独立商城 `legacy_mall`。原 ID 与新分配号冲突时拒绝并要求核验，禁止误指向其他会员/资源。维护只读期间无现成 CompatibilityId 时返回 503，禁止 GET 暗写。
7. 正式升级配置独立为 `legacy_app_update`，不把内部 QA DownloadManifest 当生产强更；校验平台、build/minBuild、HTTPS、iOS 商店域名和 Android 直装 SHA256。未配置 404、配置错误 503、无新版本 null。后台配置由商城任务接线。

## 命令、失败与复验

- `pnpm --filter @saydian/app-api typecheck`：初次碰到并行 AdminService groupBy / Billing 新符号未齐的临时错误；后续包级检查通过。
- `pnpm --filter @saydian/app-api exec vitest run src/legacy/legacy-flutter-contract.test.ts src/legacy/legacy-commerce-mapper.test.ts src/legacy/legacy-contract.test.ts src/legacy/legacy-health-mapper.test.ts`：首次 25/26；测试不应假定 Promise.all 分配 ID 顺序，改为校验正整数及可逆映射后通过。
- `pnpm --filter @saydian/app-api exec vitest run src/legacy src/health/health-evidence.test.ts`：首次 35 例通过，另一 suite 因并行新增 commerce-domain 包未构建无法加载；根任务安装构建后恢复。
- `pnpm --filter @saydian/app-api exec vitest run src/legacy/legacy-flutter-contract.test.ts src/legacy/legacy-identity.test.ts`：15/15 通过（后续增加积分缺失测试）。
- 包级完整 test 曾因订单领域开始优先查已迁入 canonical 订单，旧 fixture 缺 canonical 查询模型而失败；补只读空映射 fixture 并更新未核验订单的真实拒绝信息，保留“不能创建支付”断言。
- 最终 `pnpm --filter @saydian/app-api test`：**26 个文件 / 123 个测试通过**（含并行任务新增测试），2026-09-08 本地 09:50 执行。
- `git diff --check -- apps/api/src/legacy apps/api/src/health/health-evidence.ts`：通过。共享生成器和根级串行门禁由根任务统一执行。

## 未验收与边界

- 静态覆盖不等于真机/生产合同验收；仍需实际旧响应样本、迁移快照、登录态导入及双端设备回归。未修改 Flutter 源码、旧后台、DNS 或供应商。
- 只改 base URL 仍依赖旧 ID/会话、绝对图片 URL 或保留旧资源域名、生产更新配置及外部支付/推送 App 身份配置同时正确。客户端更新服务可另设 URL override，切换时必须核对。
- 自动生成数值号与旧号冲突当前为失败关闭，迁移预检必须先消除冲突；不能用猜测号段来悄悄重绑定用户。
- 旧在途订单需完整迁入并核验资金/库存所有权才可操作；未验收的只读投影不会开放支付。本测试不代表旧订单已迁入。
