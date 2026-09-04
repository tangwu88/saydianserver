# API 逐路由目录

本文件由控制器和人工复核说明生成，共 **156 条 HTTP 路由**。这代表源码覆盖，不代表生产业务全部可用。

调用前先读 [接口调用手册](api-guide.md)；上线缺口见 [旧后台对接与缺陷清单](api-coverage.md)。

生成：`pnpm api:docs`；校验：`pnpm api:docs:check`。每次新增、删除或修改参数，须同步 tools/api-notes.mjs。

## 健康检查（2）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `GET /health/live` | 进程存活 | public | 无请求体 | {status,service,revision} | 核心服务 |
| `GET /health/ready` | 数据库就绪 | public | 无请求体 | {status,database,revision}；失败 HTTP 503；不证明供应商可用 | 核心服务 |

## V1 兼容接口（61）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/v1/site/login` | 旧版密码登录 | public | 表单 username/mobile、password | LegacySession | 核心服务 |
| `POST /api/v1/site/register` | 旧版注册 | public | 表单 mobile/username、password、nickname?、consent_version?、code?；无 code 路径的上线限制见缺陷清单 | LegacySession | 核心服务 |
| `POST /api/v1/site/sms-code` | 旧版短信验证码 | public | 表单 mobile、usage=register/reset/forgot/up-pwd/reset_password | 发送状态 | 短信供应商 |
| `POST /api/v1/site/up-pwd` | 旧版重置密码 | public | 表单 mobile、code、password | LegacySession | 短信供应商 |
| `POST /api/v1/site/refresh` | 旧版刷新 | public | 表单 refresh_token | LegacySession | 核心服务 |
| `POST /api/v1/site/logout` | 旧版退出 | member | 无请求体 | {logged_out:true} | 核心服务 |
| `GET /api/v1/member/member/my` | 旧版本人资料 | member | 无请求体 | LegacyProfile：数字 id、uuid、mobile、nickname、head_portrait 等 | 核心服务 |
| `POST /api/v1/member/member/save` | 旧版修改资料 | member | Profile：nickname、head_portrait/avatarUrl、sex/gender、birthday、height/heightCm、weight/weightKg；仅提交需修改字段 | LegacyProfile | 核心服务 |
| `GET /api/v1/member/member-mubiao/preview` | 旧版活动目标 | member | 无请求体 | {steps,juli,reliang} | 核心服务 |
| `POST /api/v1/member/member-mubiao` | 旧版保存目标 | member | 表单 steps、juli(米)、reliang(kcal) | 规范目标对象；以重新读取为准 | 核心服务 |
| `POST /api/v1/member/health-records/batch` | 旧前缀批量健康同步 | member | HealthBatch：JSON {records:[...]}，1–200 条；Idempotency-Key 8–160 字符必填；详细记录结构见调用手册；V1 缺少幂等头时使用请求摘要 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `POST /api/v1/member/jrjk` | 旧版当日活动快照 | member | {steps_num,reliang_num,juli_num}；无采集日期，仅作接收当日快照，不能回填过去日期 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `POST /api/v1/member/daily-date` | 旧版日健康同步 | member | JSON {dailyDate:[{date,heartReat?,pulseReat?,bloodPressure?,bloodOxygen?,...}]}；1–2000 行，展开后分批；见调用手册 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收；任意拒绝时业务 400，不伪报全部成功 | 核心服务 |
| `GET /api/v1/member/daily-date/preview` | 旧版健康预览 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | LegacyDaily[]；同一小时多条记录保留；最多 20000 条，超出要求缩小范围 | 核心服务 |
| `GET /api/v1/member/daily-date` | 小程序健康历史列表 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | LegacyDaily[]；按 30 条规范记录分页，无日期时查历史 | 核心服务 |
| `GET /api/v1/member/bloodcomposition` | 小程序血液成分历史 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | [{id,date,...指标}]，每页 30 条 | 核心服务 |
| `POST /api/v1/member/bodycomposition` | 旧版身体成分同步 | member | header:idempotency-key?；JSON {data:{date?,...指标标量}}；建议提供采集时间和 Idempotency-Key；无二者不能保证重试去重 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `GET /api/v1/member/bodycomposition/preview` | 旧版身体成分预览 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | [{id,date,...指标}] | 核心服务 |
| `POST /api/v1/member/bloodcomposition` | 旧版血液成分同步 | member | header:idempotency-key?；JSON {data:{date?,...指标标量}}；建议提供采集时间和 Idempotency-Key；无二者不能保证重试去重 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `GET /api/v1/member/bloodcomposition/preview` | 旧版血液成分预览 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | [{id,date,...指标}] | 核心服务 |
| `POST /api/v1/member/e-c-g` | 旧版 ECG 同步 | member | JSON {data:{date,sampleFrequency?,...摘要},totalArray:采样数组}；先压缩存储再写摘要 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 对象存储 |
| `GET /api/v1/member/e-c-g/preview` | 旧版 ECG 摘要历史 | member | query:*；date/day=YYYY-MM-DD 或时间戳；selectmember/selectMemberId=被关爱人的数字 ID（缺省自己）；page 从 1 开始；type 见调用手册 | [{id,date,...摘要,ecgArtifact?}]；波形下载尚未闭环 | 核心服务 |
| `GET /api/v1/member/bodycomposition/:id` | 小程序身体成分单条 | member | path:id；id=本人 clientRecordId 或 UUID | {id,date,...指标}；非本人 404 | 核心服务 |
| `GET /api/v1/member/care` | 旧版关爱关系 | member | 无请求体 | LegacyCare[]：数字关系及成员 ID、examine_status、setting | 核心服务 |
| `GET /api/v1/member/care/my` | 旧版已关爱成员 | member | 无请求体 | 本人发出的已生效 LegacyCare[] | 核心服务 |
| `POST /api/v1/member/care` | 旧版发出邀请 | member | {mobile} | 规范 CareRelationship；旧页面随后刷新列表获取数字 ID | 核心服务 |
| `POST /api/v1/member/care/save` | 旧版处理邀请 | member | {id:数字关系ID,examine_status:1接受/其他拒绝} | CareRelationship | 核心服务 |
| `GET /api/v1/member/care-setting/preview` | 旧版读取共享范围 | member | query:to_member_id；to_member_id=另一方数字成员 ID | {setting:JSON字符串}；值使用 heartReat/bloodPressure 等旧拼写 | 核心服务 |
| `POST /api/v1/member/care-setting` | 旧版保存共享范围 | member | {to_member_id,setting:数组或JSON字符串}；仅数据本人可修改；未知指标拒绝 | CareRelationship | 核心服务 |
| `GET /api/v1/member/care/preview` | 旧版关爱汇总 | member | query:*；id=数字关系 ID；date/day 可选 | {daily:LegacyDaily[],jrjk:{steps_num,juli_num,reliang_num}}；未授权指标不返回，未知 null | 核心服务 |
| `GET /api/v1/member/notify` | 旧版消息列表 | member | query:page?；page 默认 1，每页 30 | LegacyNotification[] | 核心服务 |
| `GET /api/v1/member/notify/unread-count` | 旧版消息未读数 | member | 无请求体 | {unread_count} | 核心服务 |
| `GET /api/v1/member/notify/statistics` | 旧版消息分类未读数 | member | 无请求体 | {announce_count,remind_count,unread_count} | 核心服务 |
| `GET /api/v1/member/notify/:id` | 旧版消息详情并标已读 | member | path:id；id=数字 ID/UUID/eventId | LegacyNotification；GET 有兼容副作用，不适合缓存或预取 | 核心服务 |
| `POST /api/v1/member/notify/:id/read` | 旧版标记已读 | member | path:id；id=数字 ID/UUID/eventId | 已读结果 | 核心服务 |
| `POST /api/v1/member/push-devices` | 旧版登记推送安装 | member | PushInstallation：installationId、platform、registrationId、appVersion、buildNumber；字段别名见调用手册 | 安装记录 | 推送供应商（登记可独立使用） |
| `DELETE /api/v1/member/push-devices/:installationId` | 旧版撤销安装 | member | path:installationId；installationId | 撤销结果 | 核心服务 |
| `POST /api/v1/member/account/delete` | 旧版提交注销 | member | 无请求体 | 注销任务 | 核心服务 |
| `GET /api/rf-article/article-cate/index` | 旧版文章分类 | public | query:pid?；pid=旧分类 ID/UUID | [{id,pid,title,name,sort}]；新增分类数字 ID 兼容缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/article/index` | 旧版文章列表 | public | query:cate_id?，query:page?；cate_id=旧分类 ID/UUID；page 默认 1，每页 20 | LegacyArticle[]；新增文章 ID 兼容缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/article/view` | 旧版文章详情 | public | query:id；id=迁移旧文章 ID/UUID | LegacyArticle | 核心服务 |
| `GET /api/rf-article/article-single/view` | 旧版单页文章/协议 | public | query:id；id=原单页文章 ID；当前查询 Article，尚未映射 LegalDocument | LegacyArticle；协议映射缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/chat/index` | 旧版 AI 历史 | member | query:session_id?；session_id 可选 | [{id,session_id,role,message,content,created_at}] | 核心服务 |
| `POST /api/rf-article/chat/create` | 旧版 AI 提问 | member | JSON/表单 message、session_id? | {id,session_id,role,message,content,created_at} | AI 供应商 |
| `GET /api/v1/pages` | 旧版商城首页结构 | public | query:code?；code 可选 | {code,items}；swiper/tabs 商品结构 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/inv-shop/v1/product/product/view` | 旧版商品详情 | public | query:id；id=首页返回的数字商品 ID | LegacyProduct（数字 SKU、价格元、库存） | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/inv-shop/v1/member/order/index` | 旧版订单列表 | member | query:synthesize_status?；synthesize_status=0待付/1待发/2待收/3完成/4取消/-1售后/-3退款，可选 | LegacyOrder[]；read_only 标明历史订单 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/inv-shop/v1/member/order/view` | 旧版订单详情 | member | query:id；id=数字订单 ID | LegacyOrder | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/inv-shop/v1/order/order/preview` | 旧版下单预览 | member | query:*；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key；GET 查询参数 | {address,products,...金额} | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/inv-shop/v1/order/order/create` | 旧版创建订单 | member | header:idempotency-key?；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | LegacyOrder；响应不是支付成功 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/inv-shop/v1/order/order/create-batch` | 旧版多商品单订单 | member | header:idempotency-key?；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | 单个 LegacyOrder，非逐商品拆单 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/inv-shop/v1/member/order/take-delivery` | 旧版确认收货 | member | 表单 id=数字订单 ID | 确认结果；历史订单拒绝 409 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/inv-shop/v1/member/order-product/refund-apply` | 旧版申请售后 | member | 表单 id=数字订单项ID，type、reason 等按商城约定 | 售后结果 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/inv-shop/v1/member/order-product-express/details` | 旧版物流详情 | member | query:order_id；order_id=数字订单ID | {data:物流轨迹数组} | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/v1/member/address` | 旧版地址列表 | member | 无请求体 | LegacyAddress[] | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/v1/member/address/:id` | 旧版地址详情 | member | path:id；id=数字地址 ID | LegacyAddress | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/v1/member/address` | 旧版新增地址 | member | Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | LegacyAddress | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `PUT /api/v1/member/address/:id` | 旧版更新地址 | member | path:id；Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | LegacyAddress | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `DELETE /api/v1/member/address/:id` | 旧版删除地址 | member | path:id；id=数字地址 ID | 删除结果 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/v1/pay` | 旧版生成支付参数 | member | multipart pay_type=1微信/2支付宝（兼容100/101）、trade_type=app、order_group=order、data=JSON字符串含order_id；不相信客户端金额 | {payment_no,channel,config}；订单状态以服务端回查为准 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/v1/file/images` | 旧版上传头像 | member | file:file；multipart file，JPEG/PNG/WebP，最大 10 MiB | {id,url,path,...}；path 与 url 相同 | 对象存储 |

## V2 App 接口（63）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/saydian-app/v2/auth/register` | 兼容无短信注册 | public | {mobile,password,nickname?,consentVersion}；上线前必须解决手机号所有权验证，见缺陷清单 | Session | 核心服务 |
| `POST /api/saydian-app/v2/auth/login` | 密码登录 | public | {mobile/username,password} | Session | 核心服务 |
| `POST /api/saydian-app/v2/auth/sms-code` | 发送验证码 | public | {mobile,usage:register/reset_password} | 发送状态；不返回验证码 | 短信供应商 |
| `POST /api/saydian-app/v2/auth/register-with-sms` | 短信注册 | public | {mobile,code,password,nickname?,consentVersion} | Session | 短信供应商 |
| `POST /api/saydian-app/v2/auth/reset-password` | 短信重置密码 | public | {mobile,code,password/newPassword} | Session；旧会话失效 | 短信供应商 |
| `POST /api/saydian-app/v2/auth/refresh` | 轮换刷新令牌 | public | {refreshToken}；客户端必须串行刷新并替换旧令牌 | Session | 核心服务 |
| `POST /api/saydian-app/v2/auth/logout` | 退出当前会话 | member | 无请求体 | {loggedOut:true} | 核心服务 |
| `POST /api/saydian-app/v2/auth/delete-account` | 提交账号注销申请 | member | 无请求体 | 注销任务；并非立即删除全部数据 | 核心服务 |
| `GET /api/saydian-app/v2/members/me` | 本人资料 | member | 无请求体 | Profile；V2 id 为 UUID，不是 V1 数字会员 ID | 核心服务 |
| `PUT /api/saydian-app/v2/members/me` | 修改本人资料 | member | Profile：nickname、head_portrait/avatarUrl、sex/gender、birthday、height/heightCm、weight/weightKg；仅提交需修改字段 | Profile | 核心服务 |
| `GET /api/saydian-app/v2/members/me/goals` | 活动目标 | member | 无请求体 | {steps,distanceMeters,caloriesKcal}；未知为 null | 核心服务 |
| `PUT /api/saydian-app/v2/members/me/goals` | 保存活动目标 | member | {steps,distanceMeters,caloriesKcal}；缺省字段置 null，客户端应提交完整目标 | 活动目标 | 核心服务 |
| `POST /api/saydian-app/v2/health/records/batch` | 健康批量同步 | member | header:idempotency-key；HealthBatch：JSON {records:[...]}，1–200 条；Idempotency-Key 8–160 字符必填；详细记录结构见调用手册 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `GET /api/saydian-app/v2/health/records` | 本人健康历史 | member | query:metric?，query:limit?，query:before?；metric=规范指标；limit 默认 50 最大 200；before=上页 nextCursor | {items,nextCursor}；同时间戳分页限制见缺陷清单 | 核心服务 |
| `GET /api/saydian-app/v2/health/warning-rules` | 读取阈值提醒 | member | 无请求体 | 规则数组；未获取阈值为 null | 核心服务 |
| `GET /api/saydian-app/v2/health/warnings` | 读取提醒事件 | member | query:limit?；limit 默认 50 | 提醒数组；仅阈值提醒，不是诊断 | 核心服务 |
| `POST /api/saydian-app/v2/health/warning-rules` | 保存阈值提醒 | member | {rules:[{metric,enabled,lowThreshold?,highThreshold?,secondaryHighThreshold?,shareWithCare?}]}；目前仅本人的提醒闭环 | 保存后的规则数组 | 核心服务 |
| `GET /api/saydian-app/v2/devices` | 已绑定设备 | member | 无请求体 | Device[]；只含未解绑设备 | 核心服务 |
| `POST /api/saydian-app/v2/devices` | 绑定设备快照 | member | {deviceId/hardwareId,vendor,model,displayName/name,firmware?,capabilities?:string[],syncCursor?} | Device；不是服务端蓝牙连接 | 核心服务 |
| `PATCH /api/saydian-app/v2/devices/:id/capabilities` | 更新设备能力及游标 | member | path:id；{capabilities:string[],firmware?,syncCursor?}；id=绑定记录 UUID | Device | 核心服务 |
| `DELETE /api/saydian-app/v2/devices/:id` | 解绑设备 | member | path:id；id=绑定记录 UUID | {unbound:true}；保留历史健康数据 | 核心服务 |
| `GET /api/saydian-app/v2/care/relationships` | 关爱关系列表 | member | 无请求体 | CareRelationship[]，含 direction、双方昵称、授权指标 | 核心服务 |
| `POST /api/saydian-app/v2/care/invitations` | 邀请查看对方健康数据 | member | {mobile}；不能自邀；已生效返回 409；待处理重复请求不重复发通知 | CareRelationship | 核心服务 |
| `POST /api/saydian-app/v2/care/relationships/:id/respond` | 接受或拒绝邀请 | member | path:id；id=关系 UUID；{accepted:boolean}；仅收件人可操作 | CareRelationship；接受后仍需逐指标授权 | 核心服务 |
| `POST /api/saydian-app/v2/care/relationships/:id/permissions` | 共享本人指标 | member | path:id；id=关系 UUID；{metrics:规范指标数组,expiresAt?:ISO8601}；仅数据所属人；[] 撤销全部指标 | CareRelationship | 核心服务 |
| `DELETE /api/saydian-app/v2/care/relationships/:id` | 撤销关爱关系 | member | path:id；id=关系 UUID；任一参与方可撤销 | CareRelationship；撤销后不能查询 | 核心服务 |
| `GET /api/saydian-app/v2/care/relationships/:id/health` | 按授权查看健康数据 | member | path:id，query:metric，query:from，query:to；id=关系 UUID；metric 必填；from/to=ISO8601；缺省近 7 天；左闭右开 | HealthRecord[]；逐指标授权并记录审计，拒绝 403 | 核心服务 |
| `GET /api/saydian-app/v2/notifications` | 消息列表 | member | query:page?，query:pageSize?；page 默认 1；pageSize 默认 30 | 分页消息 | 核心服务 |
| `GET /api/saydian-app/v2/notifications/unread-count` | 未读数 | member | 无请求体 | {count} | 核心服务 |
| `GET /api/saydian-app/v2/notifications/:id` | 消息详情 | member | path:id；id=消息 UUID | Notification；V2 GET 不标记已读 | 核心服务 |
| `POST /api/saydian-app/v2/notifications/:id/read` | 标记消息已读 | member | path:id；id=消息 UUID/eventId | {read:true}；仅本人消息 | 核心服务 |
| `POST /api/saydian-app/v2/notifications/push-installations` | 登记推送安装 | member | PushInstallation：installationId、platform、registrationId、appVersion、buildNumber；字段别名见调用手册 | 安装记录；登记不等于推送成功 | 推送供应商（登记可独立使用） |
| `DELETE /api/saydian-app/v2/notifications/push-installations/:installationId` | 撤销本人推送安装 | member | path:installationId；installationId=安装标识 | 撤销结果 | 核心服务 |
| `GET /api/saydian-app/v2/content/categories` | 文章分类 | public | query:parentId?；parentId 可选 UUID；缺省顶级 | ArticleCategory[] | 核心服务 |
| `GET /api/saydian-app/v2/content/articles` | 已发布文章 | public | query:categoryId?，query:page?，query:pageSize?；categoryId 可选 UUID；page 默认 1；pageSize 默认 20 最大 50 | {items,total,page,pageSize} | 核心服务 |
| `GET /api/saydian-app/v2/content/articles/:id` | 文章详情 | public | path:id；id=UUID 或迁移的旧文章 ID | Article；未发布/未来发布 404 | 核心服务 |
| `GET /api/saydian-app/v2/content/legal/:type` | 协议文档 | public | path:type，query:version?；type=文档类型；version 可选，不传取当前激活版本 | LegalDocument；未发布 404 | 核心服务 |
| `GET /api/saydian-app/v2/ai/messages` | 本人 AI 历史 | member | query:sessionId?；sessionId 可选客户端会话标识 | 最近 20 个会话及消息 | 核心服务 |
| `POST /api/saydian-app/v2/ai/messages` | AI 提问 | member | {content/message,sessionId?}；正文 1–4000 字符 | {id,conversationId,role,content,createdAt} | AI 供应商；未配置返回 503 |
| `GET /api/saydian-app/v2/support/config` | 客服配置 | public | 无请求体 | 客服配置或未配置状态 | 核心服务 |
| `GET /api/saydian-app/v2/support/app-update` | App 更新配置 | public | 无请求体 | 更新清单或未配置状态 | 核心服务 |
| `POST /api/saydian-app/v2/support/feedback` | 提交反馈 | member | {content:5–2000字符,category?,contact?:最多100字符,attachments?:本人文件ID数组最多6项} | {id,status} | 核心服务 |
| `POST /api/saydian-app/v2/files` | 上传图片 | member | file:file，query:purpose?；multipart file；purpose=avatar/feedback；最大 10 MiB；JPEG/PNG/WebP | {id,url,...} | 私有对象存储 |
| `POST /api/saydian-app/v2/files/ecg` | 上传 ECG 压缩文件 | member | file:file；multipart file + sha256；最大 25 MiB；gzip；先上传再提交 HealthBatch 引用 | ECG 对象键和摘要；原始波形非公开 | 私有对象存储 |
| `GET /api/saydian-app/v2/files/:id` | 获取公开头像 | public | path:id；id=文件 UUID；仅 ACTIVE 且 purpose=avatar 的文件 | 原始文件流，不包裹 JSON；反馈/ECG 不可经此接口下载 | 对象存储 |
| `GET /api/saydian-app/v2/commerce/home` | 商城首页 | public | 无请求体 | 现商城 bootstrap | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/products` | 商城商品列表 | public | query:*；page、pageSize、keyword 等查询参数透传商城 | 现商城商品分页 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/products/:id` | 商城商品详情 | public | path:id；id=现商城商品 ID | 现商城商品及 SKU | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/cart` | 购物车 | member | 无请求体 | 现商城购物车 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/cart/items` | 更新购物车项 | member | {skuId,quantity,selected?} | 现商城购物车 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `DELETE /api/saydian-app/v2/commerce/cart/items/:id` | 删除购物车项 | member | path:id；id=购物车项 ID | 商城删除结果 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/addresses` | 地址列表 | member | 无请求体 | Address[] | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/addresses/:id` | 地址详情 | member | path:id；id=商城地址 ID | Address | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/addresses` | 新增地址 | member | Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | Address | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `PATCH /api/saydian-app/v2/commerce/addresses/:id` | 更新地址 | member | path:id；Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | Address | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `DELETE /api/saydian-app/v2/commerce/addresses/:id` | 删除地址 | member | path:id；id=商城地址 ID | {deleted:true} | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders` | 当前订单与历史投影 | member | query:status?；status=商城订单枚举，可选 | Order[]；source=mall/legacy，readOnly=true 的订单只读；商城故障时降级限制见缺陷清单 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders/:id` | 订单详情 | member | path:id；id=现商城 ID 或旧投影/旧订单 ID | Order | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders` | 多商品创建单个商城订单 | member | header:idempotency-key；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | Order；不重放旧订单 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/:id/receipt` | 确认收货 | member | path:id；id=现商城订单 ID | {received:true}；旧订单拒绝 409 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/:id/after-sales` | 申请售后 | member | path:id；id=现商城订单 ID；{type,reason,...} 按商城售后契约 | 现商城售后结果；旧订单拒绝 409 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders/:id/logistics` | 订单物流 | member | path:id；id=现商城订单 ID | 物流轨迹数组 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/payments` | 生成 App 支付参数 | member | header:idempotency-key；{orderId,channel:wechat_app/alipay_app}；金额以商城订单为准；幂等头透传 | {paymentNo,channel,invoke}；不等于付款成功 | 商城服务及内部身份凭据；支付还依赖支付渠道配置 |

## 管理后台接口（30）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/saydian-app/admin/v1/auth/login` | 后台登录 | public | JSON {username,password} | AdminSession；不能与 App Token 混用 | 核心服务 |
| `POST /api/saydian-app/admin/v1/auth/logout` | 后台退出 | admin | 无请求体 | {loggedOut:true} | 核心服务 |
| `GET /api/saydian-app/admin/v1/dashboard` | 运营概览 | admin | 无请求体 | 会员/健康/关爱/预警/反馈/积压数量 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members` | 会员查询 | admin | query:search?，query:page?，query:pageSize?；search 查昵称/手机号/旧会员ID；page 默认1；pageSize 默认30 最大100 | {items,total,page,pageSize}；手机号遮蔽 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members/:id/health-summary` | 会员健康数量摘要 | admin | path:id；id=会员 UUID | 按指标数量与首末采集时间 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members/:id/health-records` | 授权查看原始健康记录 | admin: SUPER_ADMIN, HEALTH_AUDITOR | path:id，query:limit?；id=会员 UUID；limit 默认100 最大500 | HealthRecord[]；留下专门读取审计 | 核心服务 |
| `GET /api/saydian-app/admin/v1/care` | 后台关爱关系 | admin | 无请求体 | 最多500条，双方昵称和指标权限；尚无分页 | 核心服务 |
| `GET /api/saydian-app/admin/v1/devices` | 后台设备快照 | admin | 无请求体 | 最多500条；尚无分页 | 核心服务 |
| `GET /api/saydian-app/admin/v1/feedback` | 反馈工单 | admin | query:status?；status=OPEN/IN_PROGRESS/RESOLVED/CLOSED，可选 | 最多500条 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/feedback/:id` | 更新反馈处理状态 | admin: SUPER_ADMIN, APP_OPERATIONS, CUSTOMER_SERVICE | path:id；{status,assignedTo?} | 反馈记录 | 核心服务 |
| `GET /api/saydian-app/admin/v1/articles` | 后台文章含草稿 | admin | 无请求体 | 最多500条，含分类 | 核心服务 |
| `GET /api/saydian-app/admin/v1/article-categories` | 后台文章分类 | admin | 无请求体 | 分类数组 | 核心服务 |
| `POST /api/saydian-app/admin/v1/article-categories` | 新增分类 | admin: SUPER_ADMIN, CONTENT_EDITOR | {name,parentId?,sort?,enabled?}；parentId 使用分类 UUID | 分类记录 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/article-categories/:id` | 编辑分类 | admin: SUPER_ADMIN, CONTENT_EDITOR | path:id；{name,parentId?,sort?,enabled?}；parentId 使用分类 UUID | 分类记录；当前为完整字段保存 | 核心服务 |
| `POST /api/saydian-app/admin/v1/articles` | 新增文章 | admin: SUPER_ADMIN, CONTENT_EDITOR | {title,contentHtml,summary?,coverUrl?,categoryId?,status?:DRAFT/PUBLISHED/ARCHIVED,publishedAt?}；categoryId 为 UUID | Article | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/articles/:id` | 编辑文章 | admin: SUPER_ADMIN, CONTENT_EDITOR | path:id；{title,contentHtml,summary?,coverUrl?,categoryId?,status?:DRAFT/PUBLISHED/ARCHIVED,publishedAt?}；categoryId 为 UUID | Article；当前为完整字段保存 | 核心服务 |
| `GET /api/saydian-app/admin/v1/integrations` | 集成登记状态 | admin | 无请求体 | 公开配置、登记状态和检查时间；不等同实时连通结果 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/integrations/:key` | 维护集成登记 | admin: SUPER_ADMIN | path:key；{state:UNCONFIGURED/CONFIGURED/DISABLED/ERROR,publicConfig?,secretRef?}；不得填密钥，配置不直接注入进程环境 | 公开集成登记 | 核心服务 |
| `GET /api/saydian-app/admin/v1/audit-logs` | 审计记录 | admin: SUPER_ADMIN, HEALTH_AUDITOR, READ_ONLY | query:page?；page 默认1，每页100 | AuditLog[] | 核心服务 |
| `GET /api/saydian-app/admin/v1/warnings` | 后台预警摘要 | admin | query:page?；page 默认1，每页100 | 摘要数组，不含健康值 | 核心服务 |
| `GET /api/saydian-app/admin/v1/notifications` | 后台通知 | admin | query:page?；page 默认1，每页100 | 通知列表；非主动群发接口 | 核心服务 |
| `GET /api/saydian-app/admin/v1/legal-documents` | 协议版本列表 | admin | 无请求体 | LegalDocument[] | 核心服务 |
| `POST /api/saydian-app/admin/v1/legal-documents` | 新增协议版本 | admin: SUPER_ADMIN, CONTENT_EDITOR | {documentType,version,title,contentHtml,active,publishedAt?}；同类型仅一个激活版本 | LegalDocument | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/legal-documents/:id` | 编辑协议版本 | admin: SUPER_ADMIN, CONTENT_EDITOR | path:id；{documentType,version,title,contentHtml,active,publishedAt?}；同类型仅一个激活版本 | LegalDocument | 核心服务 |
| `GET /api/saydian-app/admin/v1/admin-users` | 后台账号列表 | admin: SUPER_ADMIN | 无请求体 | 账号、角色、状态，不返回密码散列 | 核心服务 |
| `POST /api/saydian-app/admin/v1/admin-users` | 新建后台账号 | admin: SUPER_ADMIN | {username,displayName,password:至少12字符,role}；角色见调用手册 | 无密码账号信息 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/admin-users/:id` | 编辑后台账号 | admin: SUPER_ADMIN | path:id；{displayName?,role?,active?}；当前不支持修改密码 | 无密码账号信息 | 核心服务 |
| `GET /api/saydian-app/admin/v1/account-deletions` | 注销任务列表 | admin: SUPER_ADMIN, CUSTOMER_SERVICE | 无请求体 | 注销任务及遮蔽会员资料；非手动执行删除接口 | 核心服务 |
| `GET /api/saydian-app/admin/v1/settings` | 客服与更新设置 | admin | 无请求体 | key=support/app_update 的设置数组 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/settings/:key` | 保存客服或更新设置 | admin: SUPER_ADMIN, APP_OPERATIONS | path:key；key=support/app_update；{value:非空JSON对象,public?:boolean} | 设置对象；结构约定见调用手册 | 核心服务 |
