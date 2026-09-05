# 接口调用手册

逐条方法、完整路径、参数位置、鉴权、返回及依赖请看 [269 路由目录](api-reference.md)。机器可读目录：[api-catalog.json](api-catalog.json)。缺陷与待联调项：[api-coverage.md](api-coverage.md)。

## 1. 环境与请求约定

| 环境 | 地址 | 用途 |
| --- | --- | --- |
| 本地 | `http://127.0.0.1:8080` | 开发、脱敏数据和契约测试 |
| 新服务器 | `https://app.saydian.cn` | 新后端；维护状态以运维设置为准，不等于已切换旧用户 |
| 原后端 | `https://app.saidian.cc` | 已发布 App 的原服务；此轮未改域名、未迁移数据 |
| 管理后台 | `https://app.saydian.cn/admin/` | 独立管理员会话 |

- V2 前缀 `/api/saydian-app/v2`，商城兼容前缀 `/api/saidian-mall/v1`，管理前缀 `/api/saydian-app/admin/v1`。V1 完整路径保留原样。
- `public` 不需登录；`member` 传 `Authorization: Bearer <accessToken>`；`employee` 传企业微信登录签发的独立员工 Token；`admin` 传独立后台 Token。三种会话不可互换。同一新后端签发的会员 Token 可调用 V1/V2/商城会员接口。原服务器 Token **不能直接用于新后端**，会话兑换桥尚未完成。
- 推荐全部客户端统一 Bearer。旧 `token` 头目前仅兼容 `/api/v1/*`；不可假定其他旧前缀也支持。不要在 URL 放 Token。
- V2 默认 JSON。旧登录/资料/目标/关爱/地址/订单/支付/AI 支持表单；日健康、身体成分、血液成分和 ECG 的嵌套对象请用 JSON。上传文件使用 multipart，字段名 `file`。
- multipart 的 boundary 由 HTTP 库自动生成，不要手写 Content-Type。非文件接口拒绝附带文件。
- 可传 `X-Request-Id` 便于定位（服务端会校验/生成）。时间戳为秒，测量时间采用 ISO8601，明确时区。
- 当前 `/health/ready` 只检测数据库。它不证明短信、支付、企业微信、聚水潭、推送、AI、对象存储和数据迁移已验收。

## 2. 响应与错误

V2/后台成功 `data` 外层：

```json
{"code":200,"message":"OK","data":{},"timestamp":1788480000,"requestId":"example-request-id"}
```

POST 可能使用 HTTP 201，业务成功仍为 `code=200`。V2 错误使用 HTTP 400/401/403/404/409/422/429/500/503 等，并给出普通用户 message；不要把 message 当固定枚举。

V1 成功 `{"code":200,"message":"OK","data":...}`。V1 控制器错误常为 **HTTP 200 + code=400/401/...**，必须同时检查 HTTP 和业务 code。维护中间件可直接返回 HTTP 503，包含 `系统维护中，请稍后再试`。

维护状态下除了健康检查和后台登录外，POST/PUT/PATCH/DELETE 均被拦截，**会员登录、刷新、后台保存也会被拦截**。不能用失败的写接口验收结论去推断数据库没有数据。自动部署不得自动开放写入。

| 状态 | 客户端处理 |
| --- | --- |
| 400 / 422 | 显示校验提示，保留用户输入，不自动重复提交 |
| 401 | 单飞刷新 Token；刷新失败重新登录；不能无限重试 |
| 403 | 权限不足或关爱指标未授权；不回退查询他人数据 |
| 404 | 资源不存在或尚未发布；显示空态/返回 |
| 409 | 幂等冲突/状态改变/历史订单只读；刷新后由用户决定 |
| 429 | 延后重试，禁用连点 |
| 500 / 502 / 503 | 保留输入，普通错误提示；后台记录 requestId，不展示堆栈 |

## 3. 账号、资料和目标

`Session={accessToken,refreshToken,expiresAt,member}`。Access Token 有效期 15 分钟，刷新会轮换两个令牌；多个请求共用一个刷新任务。退出只撤销当前会话；重置密码撤销旧会话。

旧 `LegacySession={access_token,refresh_token,expiration_time:900,member}`。V1 member.id 为数字，V2 member.id 为 UUID，不能交叉作为路由 ID。

`Profile` 输入：nickname 1–40 字符；gender 为 male/female/unspecified（兼容 sex=1/2）；birthday 为过去的日期；heightCm 50–250；weightKg 10–500；avatarUrl 为 HTTP(S) 地址。头像流程：上传 `purpose=avatar` → 保存返回 url → 重新读取资料。

`Goals={steps,distanceMeters,caloriesKcal}`。步数 100–100000、距离 100–200000 米、热量 10–20000 kcal，或 null。保存是完整目标，不是部分 PATCH。V1 字段为 steps/juli/reliang。

短信注册使用 `/auth/register-with-sms`。`/auth/register` 和 V1 无 code 注册保留了旧兼容行为，手机号所有权尚未验证，不能与自动按手机号关联商城身份一起直接开放生产，详见缺陷 P0-02。

## 4. 健康同步、历史与阈值

规范指标：`sleep, steps, distance, calories, heart_rate, blood_oxygen, blood_pressure, blood_glucose, temperature, hrv, ecg, body_composition, blood_composition`。

```json
{
  "records": [{
    "id": "fixture-heart-20260904-001",
    "metric": "heart_rate",
    "observedAt": "2026-09-04T09:00:00+08:00",
    "timezoneOffsetMinutes": 480,
    "values": {"value": 75},
    "unit": "bpm",
    "quality": "unknown",
    "source": {"platform":"android","model":"test-model","firmware":"test-firmware"}
  }]
}
```

以上数字仅为测试夹具，不是用户记录或医学建议。不要发送到生产用户。

- id 稳定且最长 160 字符，重试保持原 id；同一用户下唯一，不能把不同测量复用一个 id。
- observedAt 不可超过当前时间 10 分钟；timezoneOffsetMinutes 为 -840…840 的整数，中国为 480。
- values 为非空标量对象（number/string/boolean/null）。未知为 null，不补 0，不发送 NaN/Infinity/嵌套数组。
- quality 为 unknown/valid/suspect/invalid。source.platform 为 android/ios/mini_program/migration；deviceId 若传入应为本人绑定记录 ID。
- 常用 values：心率/血氧/血糖/体温/HRV/活动为 `{value}`；血压 `{systolic,diastolic}`；睡眠 `{value,deepMinutes,lightMinutes,wakeCount}`；单位由调用端如实携带。
- 一批 1–200 条，`Idempotency-Key` 8–160 字符，同一重试批次不变。返回 acceptedIds、rejected 和 nextCursor。只从待传队列移除 acceptedIds；修正拒绝记录后用新批次 key 重传。
- V2 list 的 `before` 当前是时间游标；同时间戳超过一页时存在遗漏风险，尚未关闭缺陷 P1-03，不应宣称全量导出可靠。旧预览已改为范围查询，最多 20000 条，超过时要求缩小范围。
- V1 dailyDate.date 不带时区时按北京时间解析；可用 ISO 或秒/毫秒时间戳。旧查询日期窗口为左闭右开。V1 `jrjk` 缺少采集时间，只保存接收日快照，不能补历史。
- 身体/血液成分旧上传无日期时不要以“值相同”去重；新联调必须提供 data.date 或显式幂等头。
- 阈值保存 `{rules:[{metric,enabled,lowThreshold,highThreshold,secondaryHighThreshold,shareWithCare}]}`，低值须小于高值。只做用户阈值提醒；`shareWithCare` 持久化了，但关爱转发尚未接通，不能向用户承诺已转发。

### V1 日数据字段

| 原字段 | 规范字段 |
| --- | --- |
| heartReat / pulseReat[0] | heart_rate.values.value |
| bloodPressure.bloodPressureHigh / bloodPressureLow | blood_pressure.values.systolic / diastolic |
| bloodOxygen.oxygens[0] | blood_oxygen.values.value |
| bloodGlucose | blood_glucose.values.value |
| bodyTemperature.bodyTemperature | temperature.values.value |
| HRVData[0] | hrv.values.value |
| sleepData.allSleepTime/deepSleepTime/lowSleepTime/wakeCount | sleep 的总分钟/深睡/浅睡/醒来次数 |

旧数组只映射首值，不能把这些接口当作原始高频波形或多样本无损同步；高频多样本应拆为 V2 稳定记录。同小时不再覆盖已有行。

ECG：multipart 上传 gzip + 压缩文件 sha256，取得 uploadObjectKey，再提交 record.ecgArtifact `{uploadObjectKey,sha256,sampleRateHz,sampleCount}`。旧 totalArray 路径可压缩存储。当前历史仅返回摘要；授权波形下载和客户端回放仍待实现。

## 5. 关爱、消息与推送

流程：A 发出邀请 → B 接受 → B 单独选择共享指标 → A 按指标查询。接受不等于全量授权。撤销后读取返回 403，不借用别人的 Token。

关系状态：pending/active/rejected/revoked/expired。到期权限由查询时即时校验；完整到期任务及竞态验收见缺陷清单。

旧共享名称映射：steps→steps、reliang→calories、juli→distance、bloodPressure→blood_pressure、bloodGlucose→blood_glucose、bloodOxygen→blood_oxygen、bodyTemperature→temperature、heartReat→heart_rate、HRV→hrv、bodycomposition→body_composition、bloodcomposition→blood_composition；sleep/ecg 原名保留。未知名称会被拒绝，不会被当成空数组清空授权。

V1 消息详情 GET 为兼容原客户端会标记已读；不要预取或缓存。V2 详情 GET 不修改已读，使用 POST `/:id/read`。未读数是当前账号的数据库结果。

PushInstallation 必填 installationId、registrationId、platform(android/ios)；provider=jpush/apns/disabled；appVersion/buildNumber/locale 可选。兼容 installation_id、registration_id、app_version、build_number/build。换账号须撤销旧安装再登记。登记接口成功不证明供应商投递成功，真实后台/杀进程推送尚待联调。

## 6. 健康档案、详细报告与权益

- `GET /health/profile` 聚合最近 30 天有效健康记录、设备、预警数和 AI 分析同意状态，不复制原始测量。未知、`INVALID`、明显占位值不会变成 `0` 或进入报告证据。
- `GET /health/reports/eligibility` 先检查至少 3 个不同自然日的有效记录。数据不足只说明缺少内容，不创建报告或支付单。
- AI 分析须先调用 `POST /health/profile/analysis-consent`，提交 `{granted:true,version:"<当前同意版本>"}`；撤回提交 `{granted:false}`。报告生成只接收去标识化汇总和证据索引。
- `POST /health/reports` 创建预览。已有权益时扣 1 次并进入串行队列；没有权益时返回 `needsPayment=true`，再从 `/billing/offers` 选择服务端有效方案创建支付单。
- 单次报告 1 次权益；健康会员默认规则为 30 天 4 次，实际价格、次数、期限、平台和 StoreKit 商品 ID 均来自后台版本化方案。未用次数到期不结转；生成失败会返还本次权益。
- `GET /health/reports/:id` 读取免费概览和状态；只有本人且已解锁可读 `/:id/full` 与 `/:id/export`。PDF 内存生成后直接下载，不长期保存第二份文件。
- 报告是“AI 生成的健康管理参考”，包含数据区间、证据、局限和版本，不是诊断、处方或治疗建议；健康异常提醒始终免费。

## 7. 商城、支付与售后

商品、购物车、地址、新订单、物流、售后、评价、优惠券和员工推广已进入主系统。聚水潭继续作为 SKU、库存和履约权威来源；总后台只能修改展示与营销字段，不能直接覆盖权威库存。

- App V1、原 H5/小程序 `/api/saidian-mall/v1/*` 和 V2 商城入口都落到同一主库会员、商品和订单，不再通过第二套商城服务创建订单。旧数字 ID 由兼容映射处理，新接口使用 UUID。
- 创建订单一次提交完整 `items` 数组，只生成一个主库订单。每次新购买使用新幂等键，同一次网络重试才复用；服务端重新计算 SKU 价格、优惠、运费和应付金额。
- `PaymentIntent` 同时支持 `commerce_order`、`health_report`、`health_membership`。客户端只提交业务 ID、方案、渠道、平台和幂等键，不能提交可信金额。
- 返回微信/支付宝/StoreKit 唤起参数只代表支付单已创建。只有经过签名校验、金额/商品/账号匹配和事件去重的供应商回调才发货或发放权益；客户端“支付成功”页面不是到账证据。
- Android/H5 数字报告可用已配置的微信/支付宝；iOS 数字报告必须使用 StoreKit。iOS 实体商城订单仍可使用微信/支付宝。
- 退款先生成退款单，供应商成功回调后才更新订单/售后；健康报告退款撤销对应报告，会员退款撤销剩余次数和由该会员次数生成的报告。重复回调不重复扣款、发货或发权益。
- 地址兼容 `realname/name`、`address_details/detail`、`is_default/isDefault`；请同时提供省市区名称与可用地区码。
- 旧订单 `source=legacy,readOnly=true`，仅展示。支付、确认收货、修改售后不重放至支付、库存或 ERP。历史物流未完整迁移时不能把空数组解释为“没有物流”。
- 企业微信员工入口只接受允许域名上的 HTTPS 回调，签发独立员工会话；推广链接、业绩、奖金和赠券可用，历史提现仅只读，不恢复充值/提现交易功能。赠券原始令牌只在创建时返回一次，数据库只保存哈希。

## 8. 后台角色、内容、反馈、接口与集成

角色：SUPER_ADMIN、APP_OPERATIONS、COMMERCE_OPERATIONS、FINANCE、CONTENT_EDITOR、CUSTOMER_SERVICE、HEALTH_AUDITOR、INTEGRATION_ADMIN、API_DOC_EDITOR、READ_ONLY。高风险写接口同时由服务端角色守卫限制，前端隐藏按钮不能代替服务端鉴权。

原始健康数据仅 SUPER_ADMIN/HEALTH_AUDITOR 可看并记录审计。后台不把敏感健康值混入普通会员列表。编辑资料和发布内容均通过独立后台 Token。

文章/分类 PATCH 目前是完整保存，缺省字段会被重置；编辑页应先读后提交完整对象。原单页文章 ID 与新协议类型尚未建立映射；后台新建文章 UUID 对旧 Flutter 数字 ID 的兼容仍待补齐。

反馈：content 5–2000 字符，contact 最多 100，attachments 最多 6 个本人已上传文件 ID。当前私有反馈附件缺少后台授权下载入口；不是上传失败。

`settings/support` 与 `settings/app_update` 接受 `{value:{...},public:true}` 并原样提供 JSON；目前没有强 DTO 或统一 App 消费协议，不要随意添加字段后就宣称生效。

“集成中心”只显示公开配置和 `hasSecret`，敏感字段通过 `secrets` 写入后由 `INTEGRATION_MASTER_KEY` 以 AES-256-GCM 加密；列表、详情、日志和接口响应均不回显明文。选择“启用”只允许服务尝试调用，界面仍显示“尚未通过真实调用”；只有短信、AI、支付、企业微信、推送、聚水潭或文件服务获得真实成功响应后才记录检测时间。修改公开配置或密钥会清除原检测状态。轮换主密钥前必须先设计解密/重加密迁移，不能直接替换。

“接口中心”的方法、路径、鉴权和签名由代码目录生成，后台只能编辑中文说明、示例、错误处理、标签及弃用信息。流程为草稿 → 提交审核 → 超级管理员发布；可回滚到与当前路由签名一致的历史版本。代码改变路由后旧说明会标记过期，`pnpm api:docs:check` 会阻止缺少说明的提交。

## 9. 可复制调用示例

以下 curl 示例只指向本地；替换占位符即可，不把真实凭据写进 Git。Windows 使用 `curl.exe`。

```bash
# V2 密码登录（用户名/密码从本地测试环境安全输入）
curl -sS http://127.0.0.1:8080/api/saydian-app/v2/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"mobile":"<测试手机号>","password":"<测试密码>"}'

# V1 multipart 登录
curl -sS http://127.0.0.1:8080/api/v1/site/login \
  -F 'username=<测试手机号>' -F 'password=<测试密码>'

# 读取本人资料/消息分类未读数
curl -sS http://127.0.0.1:8080/api/v1/member/member/my \
  -H 'Authorization: Bearer <会员Token>'
curl -sS http://127.0.0.1:8080/api/v1/member/notify/statistics \
  -H 'Authorization: Bearer <会员Token>'

# 同步 JSON 文件中的脱敏测试批次
curl -sS http://127.0.0.1:8080/api/saydian-app/v2/health/records/batch \
  -H 'Authorization: Bearer <会员Token>' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-health-batch-001' --data-binary @health-batch.json

# 关爱对象授权心率（使用被关爱人的 Token）
curl -sS http://127.0.0.1:8080/api/saydian-app/v2/care/relationships/<关系UUID>/permissions \
  -H 'Authorization: Bearer <被关爱人Token>' -H 'Content-Type: application/json' \
  --data '{"metrics":["heart_rate"]}'

# 先检查是否具备生成详细报告的数据，不会在此步骤收费
curl -sS http://127.0.0.1:8080/api/saydian-app/v2/health/reports/eligibility \
  -H 'Authorization: Bearer <会员Token>'

# 商城 H5 读取主系统商品
curl -sS 'http://127.0.0.1:8080/api/saidian-mall/v1/storefront/products?page=1&pageSize=20'

# 后台会员分页，不能使用会员 Token
curl -sS 'http://127.0.0.1:8080/api/saydian-app/admin/v1/members?page=1&pageSize=30' \
  -H 'Authorization: Bearer <后台Token>'
```

## 10. 文档维护与验收层级

更新控制器后修改 `tools/api-notes.mjs` 并运行 `pnpm api:docs`；CI 执行 `pnpm api:docs:check`，缺说明/多余说明/文档未生成都会失败。该目录不是伪装成完整 DTO 的 OpenAPI；参数边界以调用手册、校验器和可重复测试共同确认。

单元测试证明映射逻辑；本地/CI HTTP 测试证明真实路由和中间件；生产只读探测证明端点响应；真实账号、支付沙箱、双人授权、供应商投递和旧数据迁移需各自独立证据。
