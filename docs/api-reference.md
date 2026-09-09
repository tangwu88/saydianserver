# API 逐路由目录

本文件由控制器和人工复核说明生成，共 **306 条 HTTP 路由**。这代表源码覆盖，不代表生产业务全部可用。

调用前先读 [接口调用手册](api-guide.md)；上线缺口见 [旧后台对接与缺陷清单](api-coverage.md)。

生成：`pnpm api:docs`；校验：`pnpm api:docs:check`。每次新增、删除或修改参数，须同步 tools/api-notes.mjs。

## 健康检查（2）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `GET /health/live` | 进程存活 | public | 无请求体 | {status,service,revision} | 核心服务 |
| `GET /health/ready` | 数据库就绪 | public | 无请求体 | {status,database,revision}；失败 HTTP 503；不证明供应商可用 | 核心服务 |

## V1 兼容接口（70）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/v1/pages` | 旧版商城首页结构 | public | query:code?；code 可选 | {code,items}；swiper/tabs 商品结构 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/product/product/view` | 旧版商品详情 | public | query:id；id=首页返回的数字商品 ID | LegacyProduct（数字 SKU、价格元、库存） | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/member/order/index` | 旧版订单列表 | member | query:synthesize_status?；synthesize_status=0待付/1待发/2待收/3完成/4取消/-1售后/-3退款，可选 | LegacyOrder[]；read_only 标明历史订单 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/member/order/view` | 旧版订单详情 | member | query:id；id=数字订单 ID | LegacyOrder | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/order/order/preview` | 旧版下单预览 | member | query:*；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key；GET 查询参数 | {address,products,...金额} | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/order/order/create` | 旧版创建订单 | member | header:idempotency-key?；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | LegacyOrder；响应不是支付成功 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/order/order/create-batch` | 旧版多商品单订单 | member | header:idempotency-key?；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | 单个 LegacyOrder，非逐商品拆单 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/member/order/take-delivery` | 旧版确认收货 | member | 表单 id=数字订单 ID | 确认结果；历史订单拒绝 409 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/member/order-product/refund-apply` | 旧版申请售后 | member | 表单 id=数字订单项ID，type、reason 等按商城约定 | 售后结果 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/member/order-product-express/details` | 旧版物流详情 | member | query:order_id；order_id=数字订单ID | {data:物流轨迹数组} | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/inv-shop/v1/member/cart-item/index` | 旧App购物车列表 | member | 无请求体 | 数组：整数id/cart_item_id/sku_id/product_id、num/quantity、元单位price、available | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/member/cart-item/create` | 旧App加入购物车 | member | multipart sku_id、num正整数；同会员SKU原子累加 | 剩余购物车旧结构数组 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/member/cart-item/update-num` | 旧App修改购物车数量 | member | multipart sku_id、num正整数；只更新当前会员已存在项 | 购物车旧结构数组 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/inv-shop/v1/member/cart-item/delete-ids` | 旧App批量删除购物车 | member | multipart sku_ids=SKU整数ID逗号串；限定当前会员 | 剩余购物车旧结构数组 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/v1/member/address` | 旧版地址列表 | member | 无请求体 | LegacyAddress[] | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/v1/member/address/:id` | 旧版地址详情 | member | path:id；id=数字地址 ID | LegacyAddress | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/v1/member/address` | 旧版新增地址 | member | Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | LegacyAddress | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `PUT /api/v1/member/address/:id` | 旧版更新地址 | member | path:id；Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | LegacyAddress | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `DELETE /api/v1/member/address/:id` | 旧版删除地址 | member | path:id；id=数字地址 ID | 删除结果 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/v1/pay` | 旧版生成支付参数 | member | multipart pay_type=1微信/2支付宝（兼容100/101）、trade_type=app、order_group=order、data=JSON字符串含order_id；不相信客户端金额 | {payment_no,channel,config}；订单状态以服务端回查为准 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/rf-article/article-cate/index` | 旧版文章分类 | public | query:pid?；pid=旧分类 ID/UUID | [{id,pid,title,name,sort}]；新增分类数字 ID 兼容缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/article/index` | 旧版文章列表 | public | query:cate_id?，query:page?；cate_id=旧分类 ID/UUID；page 默认 1，每页 20 | LegacyArticle[]；新增文章 ID 兼容缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/article/view` | 旧版文章详情 | public | query:id；id=迁移旧文章 ID/UUID | LegacyArticle | 核心服务 |
| `GET /api/rf-article/article-single/view` | 旧版单页文章/协议 | public | query:id；id=原单页文章 ID；当前查询 Article，尚未映射 LegalDocument | LegacyArticle；协议映射缺口见缺陷清单 | 核心服务 |
| `GET /api/rf-article/chat/index` | 旧版 AI 历史 | member | query:session_id?；session_id 可选 | [{id,session_id,role,message,content,created_at}] | 核心服务 |
| `POST /api/rf-article/chat/create` | 旧版 AI 提问 | member | JSON/表单 message、session_id? | {id,session_id,role,message,content,created_at} | AI 供应商 |
| `POST /api/v1/file/images` | 旧版上传头像 | member | file:file；multipart file，JPEG/PNG/WebP，最大 10 MiB | {id,url,path,...}；path 与 url 相同 | 对象存储 |
| `GET /api/v1/member/member/my` | 旧版本人资料 | member | 无请求体 | LegacyProfile：数字 id、uuid、mobile、nickname、head_portrait 等 | 核心服务 |
| `POST /api/v1/member/member/save` | 旧版修改资料 | member | Profile：nickname、head_portrait/avatarUrl、sex/gender、birthday、height/heightCm、weight/weightKg；仅提交需修改字段 | LegacyProfile | 核心服务 |
| `GET /api/v1/member/member-mubiao/preview` | 旧版活动目标 | member | 无请求体 | {steps,juli,reliang} | 核心服务 |
| `POST /api/v1/member/member-mubiao` | 旧版保存目标 | member | 表单 steps、juli(米)、reliang(kcal) | 规范目标对象；以重新读取为准 | 核心服务 |
| `POST /api/v1/member/health-records/batch` | 旧前缀批量健康同步 | member | HealthBatch：JSON {records:[...]}，1–200 条；Idempotency-Key 8–160 字符必填；source可选origin/measurementSource/rawVersion原样独立存储，不填不推断；详细记录结构见调用手册；V1 缺少幂等头时使用请求摘要 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `GET /api/v1/member/health-warning/preview` | 旧App预警开关与阈值 | member | 无请求体 | heart_auto/heart_num/blood_pressure_auto/blood_glucose_auto/body_temperature_auto；不提供诊断 | 核心服务 |
| `POST /api/v1/member/health-warning` | 保存旧App预警配置 | member | multipart旧开关与heart_num；保留未暴露的阈值和共享配置；未配置阈值不得开启 | 旧预警配置 | 核心服务 |
| `POST /api/v1/member/feedback` | 旧App意见反馈 | member | multipart type/content/contact/attachments；附件需本人所有 | {id,status} | 核心服务 |
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
| `GET /api/v1/site/version` | 旧App正式版本更新 | public | query:platform，query:v?；platform=android\|ios；v=当前构建号 | version/version_code/lowwer/force/status/android_type/android\|ios/sha256；无新版null；未配置404、坏配置503 | 后台legacy_app_update正式发布配置 |
| `POST /api/v1/site/login` | 旧版密码登录 | public | 表单 username/mobile、password | LegacySession | 核心服务 |
| `POST /api/v1/site/wechat-login` | 旧版 App 原生微信授权登录 | public | 表单 code、state、platform=android/ios/harmony、group=app、consent_accepted=1、consent_version；不接收 AppSecret | LegacySession | 微信开放平台移动应用 |
| `POST /api/v1/site/register` | 旧版注册 | public | 表单 mobile/username、password、nickname?、consent_version?、code?；无 code 路径的上线限制见缺陷清单 | LegacySession | 核心服务 |
| `POST /api/v1/site/sms-code` | 旧版短信验证码 | public | 表单 mobile、usage=register/reset/forgot/up-pwd/reset_password | 发送状态 | 短信供应商 |
| `POST /api/v1/site/up-pwd` | 旧版重置密码 | public | 表单 mobile、code、password | LegacySession | 短信供应商 |
| `POST /api/v1/site/refresh` | 旧版刷新 | public | 表单 refresh_token | LegacySession | 核心服务 |
| `POST /api/v1/site/logout` | 旧版退出 | member | 无请求体 | {logged_out:true} | 核心服务 |

## 商城 H5/小程序兼容接口（49）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/saidian-mall/v1/auth/password/login` | 商城App账号密码登录 | public | {mobile,password,referralCode?} | 原商城raw会话{token,refreshToken,expiresAt,user}；复用App账号验证 | 核心服务 |
| `POST /api/saidian-mall/v1/auth/wechat/h5/authorize-url` | 公众号网页授权地址 | public | {returnTo,codeChallenge:SHA256十六进制,referralCode?} | {authorizeUrl,state,expiresIn}；一次状态与固定同源回调 | 独立公众号配置；不复用小程序身份 |
| `POST /api/saidian-mall/v1/auth/wechat/h5/login` | 兑换公众号授权码 | public | {code,state,codeVerifier,consentVersion} | 已验证手机返回raw会话；否则返回一次bindTicket而非顾客会话 | 微信公众号；身份冲突不合并资产 |
| `POST /api/saidian-mall/v1/auth/wechat/h5/bind-mobile` | 验证手机号并绑定公众号身份 | public | {bindTicket,mobile,code,consentVersion}；短信usage=bind_mobile | raw会话、requiresMobileBinding=false、returnTo | 短信+appId/OpenID范围身份 |
| `GET /api/saidian-mall/v1/storefront/capabilities` | 商城公开能力与维护状态 | public | 无请求体 | 登录、支付、积分和维护状态及不可用原因；不返回任何密钥 | 仅表示配置就绪，不代表已取得供应商回执 |
| `GET /api/saidian-mall/v1/payments/:id` | 查询本人支付状态 | member | path:id；id=支付单UUID | raw支付记录；只有服务端确认成功才算付款完成 | 核心服务 |
| `POST /api/saidian-mall/v1/auth/sms/request` | 商城短信登录验证码 | public | {mobile,usage?:login\|bind_mobile} | 发送状态；只有非生产ALLOW_TEST_OTP显式启用时返回开发验证码 | 短信供应商或隔离开发测试 |
| `POST /api/saidian-mall/v1/auth/sms/login` | 商城短信登录 | public | {mobile,code,consentVersion,referralCode?} | 商城兼容会话；会员身份与主系统统一 | 短信供应商 |
| `POST /api/saidian-mall/v1/auth/wechat/mini` | 商城小程序微信登录 | public | {code,consentVersion,referralCode?} | 商城兼容会话；未验证配置时返回暂不可用 | 微信小程序 |
| `POST /api/saidian-mall/v1/auth/refresh` | 轮换商城刷新令牌 | public | {refreshToken} | 新商城兼容会话 | 核心服务 |
| `POST /api/saidian-mall/v1/auth/referral` | 锁定商城推荐关系 | member | {referralCode} | 推荐关系；已有关系不覆盖 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/bootstrap` | 商城首页初始化 | public | query:ref?；ref=员工推荐号，可选 | 轮播、分类、精选商品、公开客服配置与capabilities | 主库商城 |
| `GET /api/saidian-mall/v1/storefront/products` | 商城商品列表 | public | query:*；page、pageSize、keyword、categoryId | 可售商品分页 | 主库商城 |
| `GET /api/saidian-mall/v1/storefront/products/:id` | 商城商品详情 | public | path:id；id=商品UUID | 商品、SKU和展示资料 | 主库商城/聚水潭库存快照 |
| `GET /api/saidian-mall/v1/storefront/cart` | 商城购物车 | member | 无请求体 | 本人购物车 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/cart/items` | 更新商城购物车 | member | {skuId,quantity,selected?,mode?:set\|increment} | 本人购物车；increment累计，默认set保留已有兼容性 | 核心服务 |
| `DELETE /api/saidian-mall/v1/storefront/cart/items/:id` | 删除购物车项 | member | path:id；id=购物车项UUID | 空响应 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/addresses` | 商城收货地址 | member | 无请求体 | 本人地址列表 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/addresses` | 新增或兼容更新地址 | member | Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | 收货地址 | 核心服务 |
| `PATCH /api/saidian-mall/v1/storefront/addresses/:id` | 更新收货地址 | member | path:id；id=地址UUID；Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | 收货地址 | 核心服务 |
| `DELETE /api/saidian-mall/v1/storefront/addresses/:id` | 删除收货地址 | member | path:id；id=地址UUID | 空响应 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/preview` | 商城统一订单报价 | member | Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key；couponClaimId、pointCents、buyerRemark、invoice可选 | 兼容products/preview加整数分quote；券后分摊积分，不抵运费；现金至少1分 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders` | 商城创建订单 | member | header:idempotency-key；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | 单个真实主库订单；Idempotency-Key 防重复 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/orders` | 商城订单列表 | member | query:status?；status可选 | 当前订单与旧订单只读投影 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/orders/:id` | 商城订单详情 | member | path:id；id=订单UUID或旧订单映射 | 订单详情；旧投影只读 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/:id/cancel` | 取消待付款订单 | member | path:id；id=订单UUID | {ok:true} | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/:id/receipt` | 确认收货 | member | path:id；id=订单UUID | {ok:true} | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/:id/after-sales` | 提交商城商品售后 | member | path:id；id=订单UUID；{type,reason,items:[{orderItemId,quantity}],orderVersion?,requestedCents?,description?,evidenceImages?} | 售后记录占用可退数量；积分订单金额不能任意修改，现金确认后按行返积分；纯积分行审核后内部结算 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/:id/after-sales/:saleId/return-logistics` | 登记本人售后寄回物流 | member | path:id，path:saleId；logisticsCompany、trackingNo、version；仅WAITING_RETURN退货退款或换货 | 保存单号但保持待寄回状态；归属、版本校验，相同内容可幂等重试 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/orders/:id/after-sales/preview` | 商品售后资金预览 | member | path:id；id=订单UUID；{type,items:[{orderItemId,quantity}]} | 订单版本、商品现金退款、单列运费退款、积分返还；按原分摊累计数量差额 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/points` | 本人积分抵扣余额与流水 | member | query:page?；page从1开始，每页20条 | balanceCents未知为null，verified、items、pagination；不换算旧积分单位 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/orders/:id/logistics` | 商城订单物流 | member | path:id；id=订单UUID | 物流公司、单号和轨迹 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/favorites` | 商城收藏列表 | member | 无请求体 | 本人收藏商品 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/favorites/:productId` | 收藏或取消商品 | member | path:productId；productId=商品UUID；{enabled:boolean} | 保存结果 | 核心服务 |
| `GET /api/saidian-mall/v1/storefront/coupons` | 商城优惠券 | member | 无请求体 | 本人可用及历史券 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/coupons/:id/claim` | 领取优惠券 | member | path:id；id=优惠券UUID | 领取记录；重复领取幂等 | 核心服务 |
| `POST /api/saidian-mall/v1/storefront/reviews` | 商城商品评价 | member | {orderItemId,rating,content,images?} | 评价记录 | 核心服务 |
| `POST /api/saidian-mall/v1/payments/create` | 商城创建统一支付单 | member | {orderId,channel,idempotencyKey?} | 支付单及渠道调用参数；不等于支付成功 | 微信支付/支付宝；未配置返回503 |
| `POST /api/saidian-mall/v1/payments/wechat/notify` | 兼容微信支付回调 | public | header:*；微信支付签名头和密文通知 | 微信约定确认响应 | 微信支付 |
| `POST /api/saidian-mall/v1/payments/wechat/refund-notify` | 兼容微信退款回调 | public | header:*；微信支付签名头和密文通知 | 微信约定确认响应 | 微信支付 |
| `POST /api/saidian-mall/v1/payments/alipay/notify` | 兼容支付宝回调 | public | 支付宝表单参数 | success/failure文本 | 支付宝 |
| `GET /api/saidian-mall/v1/wecom/authorize-url` | 生成企业微信员工登录地址 | public | query:redirectUri；redirectUri必须是后台允许的HTTPS域名 | 企业微信OAuth地址；不代表已登录 | 企业微信；未配置返回503 |
| `POST /api/saidian-mall/v1/wecom/oauth` | 企业微信员工登录 | public | {code}；仅接受企业微信返回的一次性登录码 | 独立员工会话和脱敏员工摘要 | 企业微信；未配置返回503 |
| `GET /api/saidian-mall/v1/wecom/me/dashboard` | 员工推广业绩 | employee | query:*；range=today\|7d\|30d\|month\|custom；from/to为YYYY-MM-DD；page/pageSize | 服务端日期统计与订单分页，奖金冻结/可用/提现中分列，未取得钱包为null；时间口径独立标注 | 主库商城 |
| `GET /api/saidian-mall/v1/wecom/me/promotion` | 生成员工推广素材 | employee | query:productId?；productId可选商品UUID | 推荐链接、二维码和海报；链接不改变顾客或员工身份 | COMMERCE_STOREFRONT_URL商城地址配置 |
| `GET /api/saidian-mall/v1/wecom/me/coupons` | 员工可分发优惠券 | employee | 无请求体 | 可领取额度、赠券码和状态；历史链接不回显 | 主库商城 |
| `POST /api/saidian-mall/v1/wecom/me/coupons/:id/claim` | 领取员工赠券码 | employee | path:id；id=优惠券UUID；{quantity?}受批次和员工限额约束 | 一次性返回赠券链接与二维码；原始令牌不落库 | 主库商城 |
| `GET /api/saidian-mall/v1/storefront/coupon-gifts/:token` | 查看员工赠送的优惠券 | public | path:token；token=高熵一次性赠券令牌 | 优惠券、员工摘要和领取状态；不返回会员信息 | 主库商城 |
| `POST /api/saidian-mall/v1/storefront/coupon-gifts/:token/claim` | 会员领取员工赠券 | member | path:token；token=赠券令牌；需会员登录 | 本人优惠券领取记录；并发领取只成功一次 | 主库商城 |

## V2 App 接口（95）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/saydian-app/v2/auth/capabilities` | 国际账号可用能力 | public | query:locale?；locale可选；仅APP_REALM=global | {realm,defaultLocale,supportedLocales,registration:{email,sms,verificationRequired},recovery:{email,sms},smsCountries,verification,consentVersion,legal}；verificationRequired=false只表示当前注册暂免验证码；recovery仍要求已验收渠道且不在写入维护期 | 国际独立数据库、已审协议及显式注册开关 |
| `POST /api/saydian-app/v2/auth/verification-code` | 国际邮箱/手机号验证码 | public | {channel:email\|sms,identifier,purpose:register\|reset_password,locale?}；sms必须E.164 | {challengeId,expiresIn:300,retryAfter:60,maskedIdentifier}；不返回验证码 | 独立email_otp/sms_global webhook |
| `POST /api/saydian-app/v2/auth/register-with-code` | 国际已验证账号注册 | public | {challengeId,code,password,nickname?,consentVersion,locale?}；consentVersion必须来自当前已审协议 | Session；国际UUID账号，与国内账号不互通 | 已送达未消费的国际验证码与已发布协议 |
| `POST /api/saydian-app/v2/auth/register` | 账号注册 | public | 国内环境仍阻止裸密码注册；国际环境仅在GLOBAL_UNVERIFIED_REGISTRATION_ENABLED=true时接受{channel,identifier,password,nickname?,consentVersion,locale?} | 国际环境签发Session，但联系方式保持未验证；关闭临时开关后未验证会话不可续期 | 国际独立数据库、已审协议与显式临时开关；需验证联系方式的商城能力仍阻断 |
| `POST /api/saydian-app/v2/auth/login` | 密码登录 | public | 国内{mobile/username,password}；国际{channel:email\|sms,identifier,password} | Session；国际member含emailMasked/phoneMasked/locale可选字段 | 核心服务 |
| `POST /api/saydian-app/v2/auth/wechat-login` | 原生微信授权登录 | public | {code,state,platform:android/ios/harmony,consentAccepted:true,consentVersion}；只提交一次性 code，密钥仅在服务端 | Session；手机号仍未验证时不得映射商城身份 | 微信开放平台移动应用 |
| `POST /api/saydian-app/v2/auth/sms-code` | 发送验证码 | public | {mobile,usage:register/reset_password} | 发送状态；不返回验证码 | 短信供应商 |
| `POST /api/saydian-app/v2/auth/register-with-sms` | 短信注册 | public | {mobile,code,password,nickname?,consentVersion} | Session | 短信供应商 |
| `POST /api/saydian-app/v2/auth/reset-password` | 验证码重置密码 | public | 国内{mobile,code,password/newPassword}；国际{challengeId,code,password} | Session；旧会话失效 | 对应部署的验证码供应商 |
| `POST /api/saydian-app/v2/auth/refresh` | 轮换刷新令牌 | public | {refreshToken}；客户端必须串行刷新并替换旧令牌 | Session | 核心服务 |
| `POST /api/saydian-app/v2/auth/logout` | 退出当前会话 | member | 无请求体 | {loggedOut:true} | 核心服务 |
| `POST /api/saydian-app/v2/auth/delete-account` | 提交账号注销申请 | member | 无请求体 | 注销任务；并非立即删除全部数据 | 核心服务 |
| `GET /api/saydian-app/v2/billing/offers` | 健康报告购买方案 | public | query:platform?；platform=android/ios/h5/mini_program/web，可选 | 后台启用且当前有效的版本化价格方案 | 核心服务 |
| `POST /api/saydian-app/v2/billing/payments/wechat/refund-notify` | 微信退款结果回调 | public | header:*；微信支付API v3加密通知；必须校验平台签名并解密 | SUCCESS确认；处理中、关闭或异常不伪报退款成功 | 微信支付 |
| `GET /api/saydian-app/v2/billing/entitlements` | 健康报告权益 | member | 无请求体 | 可用次数及30天会员到期时间 | 核心服务 |
| `POST /api/saydian-app/v2/billing/payments` | 创建统一支付单 | member | {businessType,businessId,offerId?,channel,platform,idempotencyKey}；金额和权益由服务端确定 | PaymentIntent及渠道调用参数；不等于付款成功 | 微信支付/支付宝/StoreKit；未配置返回503 |
| `GET /api/saydian-app/v2/billing/payments/:id` | 查询支付结果 | member | path:id；id=PaymentIntent UUID | 本人支付状态；客户端应以服务端状态为准 | 核心服务 |
| `POST /api/saydian-app/v2/billing/apple/transactions/verify` | 验证StoreKit交易 | member | {paymentIntentId,signedTransactionInfo} | 验证成功后的支付与权益 | Apple App Store Server；未配置返回503 |
| `POST /api/saydian-app/v2/billing/apple/notifications` | 接收App Store Server Notifications V2 | public | {signedPayload}；外层和内层JWS均须通过Apple证书链验证 | {received:true}；退款或撤销会收回对应报告权益 | Apple App Store Server |
| `POST /api/saydian-app/v2/billing/payments/wechat/notify` | 微信支付验签通知 | public | header:*；微信支付V3原始JSON及Wechatpay签名头 | 微信要求的SUCCESS响应；事件幂等 | 微信支付V3 |
| `POST /api/saydian-app/v2/billing/payments/alipay/notify` | 支付宝验签通知 | public | 支付宝form通知字段 | 支付宝要求的success文本；事件幂等 | 支付宝开放平台 |
| `GET /api/saydian-app/v2/care/relationships` | 关爱关系列表 | member | 无请求体 | CareRelationship[]，含 direction、双方昵称、授权指标 | 核心服务 |
| `POST /api/saydian-app/v2/care/invitations` | 邀请查看对方健康数据 | member | 国内{mobile}；国际{identifier:email/E.164}；仅同部署账号域；不能自邀；已生效返回 409 | CareRelationship；UUID；逐指标授权不变 | 核心服务 |
| `POST /api/saydian-app/v2/care/relationships/:id/respond` | 接受或拒绝邀请 | member | path:id；id=关系 UUID；{accepted:boolean}；仅收件人可操作 | CareRelationship；接受后仍需逐指标授权 | 核心服务 |
| `POST /api/saydian-app/v2/care/relationships/:id/permissions` | 共享本人指标 | member | path:id；id=关系 UUID；{metrics:规范指标数组,expiresAt?:ISO8601}；仅数据所属人；[] 撤销全部指标 | CareRelationship | 核心服务 |
| `DELETE /api/saydian-app/v2/care/relationships/:id` | 撤销关爱关系 | member | path:id；id=关系 UUID；任一参与方可撤销 | CareRelationship；撤销后不能查询 | 核心服务 |
| `GET /api/saydian-app/v2/care/relationships/:id/health` | 按授权查看健康数据 | member | path:id，query:metric，query:from，query:to；id=关系 UUID；metric 必填；from/to=ISO8601；缺省近 7 天；左闭右开 | HealthRecord[]；逐指标授权并记录审计，拒绝 403 | 核心服务 |
| `GET /api/saydian-app/v2/commerce/markets` | 国际市场可用状态 | public | 无请求体 | {markets:[{countryCode,currency,currencyExponent,commerceEnabled:false,paymentChannels:[]}]}；未配置空列表 | global.markets；国际价目表和支付尚未验收，不开放结算 |
| `GET /api/saydian-app/v2/commerce/home` | 商城首页 | public | 无请求体 | 主库商城首页数据 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/products` | 商城商品列表 | public | query:*；page、pageSize、keyword、categoryId、sort | 主库商品分页 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/products/:id` | 商城商品详情 | public | path:id；id=商品UUID | 主库商品及SKU | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/cart` | 购物车 | member | 无请求体 | 本人主库购物车 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/cart/items` | 更新购物车项 | member | {skuId,quantity,selected?} | 本人主库购物车 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `DELETE /api/saydian-app/v2/commerce/cart/items/:id` | 删除购物车项 | member | path:id；id=购物车项UUID | 删除结果 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/addresses` | 地址列表 | member | 无请求体 | Address[] | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/addresses/:id` | 地址详情 | member | path:id；id=商城地址 ID | Address | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/addresses` | 新增地址 | member | Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | Address | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `PATCH /api/saydian-app/v2/commerce/addresses/:id` | 更新地址 | member | path:id；Address：name/realname、mobile、province/city/district、detail/address_details、isDefault/is_default；旧地区码字段见调用手册 | Address | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `DELETE /api/saydian-app/v2/commerce/addresses/:id` | 删除地址 | member | path:id；id=商城地址 ID | {deleted:true} | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders` | 当前订单与历史投影 | member | query:status?；status=商城订单枚举，可选 | Order[]；主库订单可操作，readOnly=true 的迁移历史只读 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/preview` | 预览商城订单 | member | Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | 收货地址、商品和服务端金额；不创建订单 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders/:id` | 订单详情 | member | path:id；id=主库订单UUID或旧投影ID | Order | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders` | 多商品创建单个商城订单 | member | header:idempotency-key；Order：addressId/address_id、items:[{skuId/sku_id,quantity/num}]；旧单品可用 data=JSON 字符串；每次新购买使用新的 Idempotency-Key | Order；不重放旧订单 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/:id/receipt` | 确认收货 | member | path:id；id=主库订单UUID | {received:true}；旧订单拒绝409 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/:id/cancel` | 取消待付款订单 | member | path:id；id=商城订单UUID | 取消结果并恢复本地库存占用；旧订单拒绝409 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/orders/:id/after-sales` | 申请售后 | member | path:id；id=主库订单UUID；{type,reason,requestedCents?,description?,evidenceImages?} | 主库售后记录；旧订单拒绝409 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/orders/:id/logistics` | 订单物流 | member | path:id；id=主库订单UUID | 物流轨迹数组 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/v2/commerce/payments` | 生成 App 支付参数 | member | header:idempotency-key；{orderId,channel:wechat_app/alipay_app}；金额以商城订单为准；幂等头透传 | {paymentNo,channel,invoke}；不等于付款成功 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/v2/commerce/favorites` | 收藏商品列表 | member | 无请求体 | 当前可售商品卡片数组 | 主库商城 |
| `PUT /api/saydian-app/v2/commerce/products/:id/favorite` | 收藏或取消收藏 | member | path:id；id=商品UUID；{enabled:boolean} | 保存结果 | 主库商城 |
| `GET /api/saydian-app/v2/commerce/coupons` | 本人优惠券 | member | 无请求体 | 优惠券领取与使用状态 | 主库商城 |
| `POST /api/saydian-app/v2/commerce/coupons/:id/claim` | 领取优惠券 | member | path:id；id=优惠券UUID | 领取记录；重复领取幂等 | 主库商城 |
| `POST /api/saydian-app/v2/commerce/reviews` | 评价已收货商品 | member | {orderItemId,rating,content,images?} | 评价记录 | 主库商城 |
| `GET /api/saydian-app/v2/content/categories` | 文章分类 | public | query:parentId?，query:locale?，header:accept-language?；parentId 可选 UUID；缺省顶级；国际按locale/Accept-Language精确匹配，默认en | ArticleCategory[]；未翻译不返回其他语言替代 | 核心服务 |
| `GET /api/saydian-app/v2/content/articles` | 已发布文章 | public | query:categoryId?，query:page?，query:pageSize?，query:locale?，header:accept-language?；categoryId 可选 UUID；page 默认 1；pageSize 默认 20 最大 50；国际locale/Accept-Language | {items,total,page,pageSize}；国际仅已发布的对应语言 | 核心服务 |
| `GET /api/saydian-app/v2/content/articles/:id` | 文章详情 | public | path:id，query:locale?，header:accept-language?；id=UUID 或迁移的旧文章 ID；国际locale/Accept-Language | Article；未发布/未来发布/国际语言不匹配 404 | 核心服务 |
| `GET /api/saydian-app/v2/content/legal/:type` | 协议文档 | public | path:type，query:version?，query:locale?；type=文档类型；version可选；国际locale必选当前capabilities法律文档locale | 国内LegalDocument；国际GlobalLegalDocument（reviewed+active+published）；未发布404 | 核心服务 |
| `GET /api/saydian-app/v2/ai/messages` | 本人 AI 历史 | member | query:sessionId?；sessionId 可选客户端会话标识 | 最近 20 个会话及消息 | 核心服务 |
| `POST /api/saydian-app/v2/ai/messages` | AI 提问 | member | {content/message,sessionId?,locale?}；正文 1–4000 字符；国际8语默认使用会话/账号语言或en | {id,conversationId,role,content,createdAt} | AI 供应商；未配置返回 503；语言指令不改变健康安全边界 |
| `GET /api/saydian-app/v2/devices` | 已绑定设备 | member | 无请求体 | Device[]；只含未解绑设备 | 核心服务 |
| `POST /api/saydian-app/v2/devices` | 绑定设备快照 | member | {deviceId/hardwareId,vendor,model,displayName/name,firmware?,capabilities?:string[],syncCursor?} | Device；不是服务端蓝牙连接 | 核心服务 |
| `PATCH /api/saydian-app/v2/devices/:id/capabilities` | 更新设备能力及游标 | member | path:id；{capabilities:string[],firmware?,syncCursor?}；id=绑定记录 UUID | Device | 核心服务 |
| `DELETE /api/saydian-app/v2/devices/:id` | 解绑设备 | member | path:id；id=绑定记录 UUID | {unbound:true}；保留历史健康数据 | 核心服务 |
| `POST /api/saydian-app/v2/health/records/batch` | 健康批量同步 | member | header:idempotency-key；HealthBatch：JSON {records:[...]}，1–200 条；Idempotency-Key 8–160 字符必填；source可选origin/measurementSource/rawVersion原样独立存储，不填不推断；详细记录结构见调用手册 | {acceptedIds,rejected:[{id,code,message}],nextCursor}；HTTP 成功不代表全部记录接收 | 核心服务 |
| `GET /api/saydian-app/v2/health/records` | 本人健康历史 | member | query:metric?，query:limit?，query:before?；metric=规范指标；limit 正整数默认50最大200；before=上页nextCursor（不透明复合游标）；继续接受旧ISO时间 | {items,nextCursor}；按采集时间和UUID稳定分页，相同采集时间记录不丢页 | 核心服务 |
| `GET /api/saydian-app/v2/health/warning-rules` | 读取阈值提醒 | member | 无请求体 | 规则数组；未获取阈值为 null | 核心服务 |
| `GET /api/saydian-app/v2/health/warnings` | 读取提醒事件 | member | query:limit?；limit 默认 50 | 提醒数组；仅阈值提醒，不是诊断 | 核心服务 |
| `POST /api/saydian-app/v2/health/warning-rules` | 保存阈值提醒 | member | {rules:[{metric,enabled,lowThreshold?,highThreshold?,secondaryHighThreshold?,shareWithCare?}]}；目前仅本人的提醒闭环 | 保存后的规则数组 | 核心服务 |
| `GET /api/saydian-app/v2/members/me` | 本人资料 | member | 无请求体 | Profile；id仍为UUID；国际版memberNo为稳定数字展示编号，promo_code是现有App我的页面的同值展示别名，不用于鉴权或推广归属 | 核心服务 |
| `PUT /api/saydian-app/v2/members/me` | 修改本人资料 | member | Profile：nickname、head_portrait/avatarUrl、sex/gender、birthday、height/heightCm、weight/weightKg；仅提交需修改字段 | Profile | 核心服务 |
| `GET /api/saydian-app/v2/members/me/goals` | 活动目标 | member | 无请求体 | {steps,distanceMeters,caloriesKcal}；未知为 null | 核心服务 |
| `PUT /api/saydian-app/v2/members/me/goals` | 保存活动目标 | member | {steps,distanceMeters,caloriesKcal}；缺省字段置 null，客户端应提交完整目标 | 活动目标 | 核心服务 |
| `GET /api/saydian-app/v2/notifications` | 消息列表 | member | query:page?，query:pageSize?；page 默认 1；pageSize 默认 30 | 分页消息 | 核心服务 |
| `GET /api/saydian-app/v2/notifications/unread-count` | 未读数 | member | 无请求体 | {count} | 核心服务 |
| `GET /api/saydian-app/v2/notifications/preferences` | 读取通知偏好 | member | 无请求体 | {transactionalEnabled,marketingEnabled,updatedAt}；营销通知默认关闭 | 核心服务 |
| `PATCH /api/saydian-app/v2/notifications/preferences` | 修改通知偏好 | member | {transactionalEnabled?,marketingEnabled?}；至少提交一项 | 保存后的通知偏好；业务必要通知与营销通知分开 | 核心服务 |
| `GET /api/saydian-app/v2/notifications/:id` | 消息详情 | member | path:id；id=消息 UUID | Notification；V2 GET 不标记已读 | 核心服务 |
| `POST /api/saydian-app/v2/notifications/:id/read` | 标记消息已读 | member | path:id；id=消息 UUID/eventId | {read:true}；仅本人消息 | 核心服务 |
| `POST /api/saydian-app/v2/notifications/push-installations` | 登记推送安装 | member | PushInstallation：installationId、platform、registrationId、appVersion、buildNumber；字段别名见调用手册 | 安装记录；登记不等于推送成功 | 推送供应商（登记可独立使用） |
| `DELETE /api/saydian-app/v2/notifications/push-installations/:installationId` | 撤销本人推送安装 | member | path:installationId；installationId=安装标识 | 撤销结果 | 核心服务 |
| `GET /api/saydian-app/v2/health/profile` | 会员健康档案 | member | 无请求体；默认汇总近30天有效记录 | 健康数据完整度、指标摘要、设备、预警数和分析同意状态；国际analysisConsent含availableVersion/document，均可为null | 核心服务 |
| `POST /api/saydian-app/v2/health/profile/analysis-consent` | 设置健康AI分析单独同意 | member | {granted:boolean,version:string,locale?}；国际version必须匹配当前已审health_ai_analysis文档；撤回时granted=false | 同意或撤回状态；缺文档不授予，撤回后不能新生成AI报告 | 核心服务 |
| `GET /api/saydian-app/v2/health/reports/eligibility` | 检查详细报告生成条件 | member | 无请求体；默认近30天 | 至少3个自然日的有效记录、缺失说明、可用次数和同意要求 | 核心服务 |
| `GET /api/saydian-app/v2/health/reports` | 健康报告历史 | member | 无请求体 | 本人最多100份报告；已生成报告可重复查看 | 核心服务 |
| `POST /api/saydian-app/v2/health/reports` | 创建健康报告请求 | member | 无请求体；数据不足时不创建支付单 | 报告预览及needsPayment；有次数时进入队列 | 核心服务 |
| `GET /api/saydian-app/v2/health/reports/:id` | 健康报告状态与免费概览 | member | path:id；id=报告UUID | 报告状态、数据区间和免费概览；不含付费正文 | 核心服务 |
| `GET /api/saydian-app/v2/health/reports/:id/full` | 查看已解锁详细健康报告 | member | path:id；id=报告UUID | AI标识、证据索引、局限及详细内容；非诊断 | 核心服务 |
| `GET /api/saydian-app/v2/health/reports/:id/export` | 按需导出详细健康报告 | member | path:id；id=已解锁且生成完成的报告UUID | application/pdf文件流；不长期重复保存PDF | 报告字体服务 |
| `POST /api/saydian-app/v2/health/reports/:id/retry` | 重试失败的报告 | member | path:id；id=报告UUID；国际必须仍同意当前已审health_ai_analysis版本 | 重新排队后的报告；撤回授权/文档未发布/版本过期拒绝入队；生成失败时次数已返还 | AI供应商 |
| `GET /api/saydian-app/v2/support/config` | 客服配置 | public | 无请求体 | 客服配置或未配置状态 | 核心服务 |
| `GET /api/saydian-app/v2/support/app-update` | App 下载与更新配置 | public | 无请求体 | DownloadManifest v1；Android/iPhone/HarmonyOS 各一项，待开放项无下载地址；国际仅global_app_update，强制realm=global及逐项独立packageId，直包仅/global/down/files/；无配置404 | 核心服务 |
| `POST /api/saydian-app/v2/support/feedback` | 提交反馈 | member | {content:5–2000字符,category?,contact?:最多100字符,attachments?:本人文件ID数组最多6项} | {id,status} | 核心服务 |
| `POST /api/saydian-app/v2/files` | 上传图片 | member | file:file，query:purpose?；multipart file；purpose=avatar/feedback；最大 10 MiB；JPEG/PNG/WebP | {id,url,...} | 私有对象存储 |
| `POST /api/saydian-app/v2/files/ecg` | 上传 ECG 压缩文件 | member | file:file；multipart file + sha256；最大 25 MiB；gzip；先上传再提交 HealthBatch 引用 | ECG 对象键和摘要；原始波形非公开 | 私有对象存储 |
| `GET /api/saydian-app/v2/files/:id` | 获取公开头像 | public | path:id；id=文件 UUID；仅 ACTIVE 且 purpose=avatar 的文件 | 原始文件流，不包裹 JSON；反馈/ECG 不可经此接口下载 | 对象存储 |

## 管理后台接口（88）

| 方法与路径 | 用途 | 鉴权/角色 | 参数与请求 | data / 返回 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/saydian-app/admin/v1/auth/login` | 后台登录 | public | JSON {username,password} | AdminSession；不能与 App Token 混用 | 核心服务 |
| `POST /api/saydian-app/admin/v1/auth/logout` | 后台退出 | admin | 无请求体 | {loggedOut:true} | 核心服务 |
| `GET /api/saydian-app/admin/v1/auth/me` | 当前后台身份和多角色 | admin | 无请求体 | {id,role,roles}；服务端每次请求检查实时角色，前端菜单仅权限提示 | 核心服务 |
| `GET /api/saydian-app/admin/v1/dashboard` | 运营概览 | admin | 无请求体 | 会员/健康/关爱/预警/反馈/积压数量 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members` | 会员查询 | admin | query:search?，query:page?，query:pageSize?；search 查昵称/手机号/旧会员ID/数字memberNo，国际版另支持邮箱；page默认1；pageSize默认30最大100；国际后台直接查询国际新库 | {items,total,page,pageSize}；包含数字memberNo、脱敏手机号，国际版另含emailMasked；使用对应服务的管理员会话与角色权限 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members/:id/health-summary` | 会员健康数量摘要 | admin | path:id；id=会员 UUID | 按指标数量与首末采集时间 | 核心服务 |
| `GET /api/saydian-app/admin/v1/members/:id/health-records` | 授权查看原始健康记录 | admin: SUPER_ADMIN, HEALTH_AUDITOR | path:id，query:limit?，query:reason?；id=会员 UUID；reason=5–300字业务原因必填；limit 默认100 最大500 | HealthRecord[]；原因、操作者和请求编号进入专门读取审计 | 核心服务 |
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
| `GET /api/saydian-app/admin/v1/integrations` | 集成登记状态 | admin | 无请求体 | 公开配置、是否已安全保存密钥、登记状态和检查时间；密钥永不回显，登记不等同实时连通 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/integrations/:key` | 维护集成登记和密钥 | admin: SUPER_ADMIN, INTEGRATION_ADMIN | path:key；{state:UNCONFIGURED/CONFIGURED/DISABLED/ERROR,publicConfig?,secrets?:对象,clearSecrets?:boolean}；secrets使用主机外置主密钥加密且只写不回显 | 公开配置和hasSecret；不返回密钥内容 | 核心服务 |
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
| `PATCH /api/saydian-app/admin/v1/settings/:key` | 保存客服或更新设置 | admin: SUPER_ADMIN, APP_OPERATIONS | path:key；key=support/app_update；{value:非空JSON对象,public?:boolean}；app_update 必须通过 DownloadManifest v1 校验 | 设置对象；结构约定见调用手册 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-products` | 总后台商品列表 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, CUSTOMER_SERVICE, READ_ONLY | query:search?，query:page?，query:status?；search可查商品名或ERP编号；page默认1 | 主库商品、SKU及ERP库存快照；不直接改权威库存 | 主库商城/聚水潭 |
| `POST /api/saydian-app/admin/v1/commerce-products` | 拒绝手工新增ERP商品 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | 请先通过聚水潭商品同步建立商品和SKU | HTTP 400；不会创建第二套库存 | 聚水潭 |
| `POST /api/saydian-app/admin/v1/commerce-products/batch` | 商品批量上下架与归档 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | {ids:商品UUID数组,action:PUBLISH/DISABLE/ARCHIVE}；ERP和自建商品保留各自库存权威 | 批量处理结果 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `PATCH /api/saydian-app/admin/v1/commerce-products/:id` | 编辑商品展示资料 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；id=商品UUID；{displayName?,subtitle?,brand?,categoryId?,coverImage?,gallery?,detailHtml?,tags?,status?,featured?,sort?,localArchived?} | 展示资料；ERP编号、内部名称、SKU和库存不会被覆盖 | 主库商城/聚水潭 |
| `GET /api/saydian-app/admin/v1/commerce-categories` | 商城分类 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, CUSTOMER_SERVICE, READ_ONLY | 无请求体 | 分类树平铺数据 | 核心服务 |
| `POST /api/saydian-app/admin/v1/commerce-categories` | 新增商城分类 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | {name,parentId?,iconUrl?,sort?,enabled?} | 分类 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-categories/:id` | 编辑商城分类 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；id=分类UUID；字段同新增 | 分类 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-banners` | 商城首页轮播 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, READ_ONLY | 无请求体 | 按排序返回的轮播图 | 核心服务 |
| `POST /api/saydian-app/admin/v1/commerce-banners` | 新增商城轮播 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | {title,imageUrl,targetUrl?,sort?,enabled?} | 轮播图 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-banners/:id` | 编辑商城轮播 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；id=轮播UUID；字段同新增 | 轮播图 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-business-configs` | 商城业务设置 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, READ_ONLY | 无请求体 | 运费、客服等非密钥商城配置 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-business-configs/:key` | 保存商城业务设置 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:key；key=配置键；{label?,value?,enabled?} | 商城配置；支付、ERP等密钥仍由集成中心管理 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-reviews` | 商城评价管理 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, CUSTOMER_SERVICE, READ_ONLY | 无请求体 | 真实订单评价、脱敏会员和商品摘要 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-reviews/:id` | 设置评价展示状态 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, CUSTOMER_SERVICE | path:id；id=评价UUID；{published:boolean} | 评价；不能改写评分或正文 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-orders` | 总后台订单 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, CUSTOMER_SERVICE, READ_ONLY | query:status?，query:page?，query:search?；status可选；page默认1 | 会员已脱敏的订单、明细、支付、物流和售后 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-orders/:id` | 维护订单备注 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；id=订单UUID；{adminRemark?}；订单状态不能手工改写 | 订单 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-orders/:id/fulfillment-preview` | 本地订单可发货数量 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；订单UUID路径参数；限超级管理员/商城运营 | {orderId,version,status,items:[{orderItemId,name,quantity,shippedQuantity,refundedQuantity,afterSaleReservedQuantity,remainingQuantity}],shipments,unavailableReason?}；旧包裹或售后归属不明时阻断 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `POST /api/saydian-app/admin/v1/commerce-orders/:id/shipments` | 登记本地商品分包发货 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；{version,logisticsCompany,trackingNo,items:[{orderItemId,quantity}]}；仅已接管的新LOCAL已付款订单；运单号3–100位字母数字._- | 发货预览结构及shipmentId/replayed；同订单同运单同内容重试幂等，异参/超量/过期版本409；不生成承运轨迹 | 主库商城；支付操作还依赖已验收的支付渠道配置 |
| `GET /api/saydian-app/admin/v1/commerce-orders/:id/shipping-refunds/preview` | 核验独立退运费额度 | admin: SUPER_ADMIN, FINANCE | path:id；已支付订单ID；仅财务或超级管理员 | 返回剩余运费、剩余现金、maximumCents与orderVersion；未知历史或进行中申请阻断 | 核心服务 |
| `POST /api/saydian-app/admin/v1/commerce-orders/:id/shipping-refunds` | 申请独立退运费 | admin: SUPER_ADMIN, FINANCE | path:id；amountCents、reason、requestKey、orderVersion；仅财务或超级管理员 | 创建待审核SHIPPING_ONLY售后；审核后退款，不返积分、不冲商品佣金 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-after-sales` | 总后台售后 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, CUSTOMER_SERVICE, READ_ONLY | query:status?；status可选 | 售后、退款及订单摘要 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-after-sales/:id` | 审核售后 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, CUSTOMER_SERVICE, FINANCE | path:id；id=售后UUID；{status,returnLogisticsCompany?,returnTrackingNo?} | 售后；退款成功状态只能由真实回调完成 | 支付/聚水潭 |
| `GET /api/saydian-app/admin/v1/commerce-coupons` | 优惠券 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, CUSTOMER_SERVICE, READ_ONLY | 无请求体 | 优惠券及领取数量 | 核心服务 |
| `POST /api/saydian-app/admin/v1/commerce-coupons` | 新增优惠券 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | {name,value,minimumSpendCents,totalQuantity?,validFrom,validUntil,status?,employeeDistributable?,perEmployeeLimit?} | 优惠券；金额单位分 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-coupons/:id` | 编辑优惠券 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS | path:id；id=优惠券UUID；字段同新增 | 优惠券 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-employees` | 员工推广 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, READ_ONLY | 无请求体 | 推广员工和钱包摘要；手机号遮蔽 | 核心服务 |
| `GET /api/saydian-app/admin/v1/commerce-commissions` | 奖金明细 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, FINANCE, READ_ONLY | 无请求体 | 奖金规则、计提和历史只读流水 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/commerce-commissions/plan` | 保存佣金及提现规则 | admin: SUPER_ADMIN, FINANCE | {enabled,rateBps,settlementDays,withdrawalEnabled,minimumWithdrawCents,dailyWithdrawLimitCents,reviewRequired:true}；新规则不追改已计提快照 | 佣金计划与提现规则 | 财务人工审批 |
| `GET /api/saydian-app/admin/v1/commerce-jobs` | 商城集成任务 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, INTEGRATION_ADMIN, READ_ONLY | query:status?；status可选 | 聚水潭等任务状态；未配置不伪报成功 | 核心服务 |
| `POST /api/saydian-app/admin/v1/commerce-jobs/:id/retry` | 重试商城集成任务 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, INTEGRATION_ADMIN | path:id；id=失败或死信任务UUID | 重新排队任务 | 聚水潭 |
| `POST /api/saydian-app/admin/v1/commerce-jobs/product-sync` | 安排聚水潭商品同步 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, INTEGRATION_ADMIN | {modifiedBegin?,modifiedEnd?}；缺省最近24小时，最长31天 | 幂等同步任务；任务成功才更新ERP商品与库存快照 | 聚水潭 |
| `POST /api/saydian-app/admin/v1/commerce-jobs/fulfillment-sync` | 安排聚水潭物流同步 | admin: SUPER_ADMIN, COMMERCE_OPERATIONS, INTEGRATION_ADMIN | 无请求体；同一小时幂等 | 物流同步任务；任务成功才更新发货状态 | 聚水潭 |
| `GET /api/saydian-app/admin/v1/payments` | 统一支付流水 | admin: SUPER_ADMIN, FINANCE, COMMERCE_OPERATIONS, READ_ONLY | query:status?，query:page?；status可选；page默认1 | 商城订单、健康报告和健康会员支付单 | 核心服务 |
| `GET /api/saydian-app/admin/v1/health-reports` | 健康报告任务 | admin: SUPER_ADMIN, HEALTH_AUDITOR, CUSTOMER_SERVICE, READ_ONLY | query:status?；status可选 | 报告任务、数据范围、生成版本和失败原因；不直接返回敏感原始数据 | 核心服务 |
| `POST /api/saydian-app/admin/v1/health-reports/:id/retry` | 重试失败健康报告 | admin: SUPER_ADMIN, HEALTH_AUDITOR | path:id；id=失败报告UUID | 重新排队且不重复扣次数 | AI供应商 |
| `GET /api/saydian-app/admin/v1/health-report-offers` | 健康报告价格方案 | admin | 无请求体 | 全部历史版本及启用状态 | 核心服务 |
| `POST /api/saydian-app/admin/v1/health-report-offers` | 新增健康报告价格版本 | admin: SUPER_ADMIN, FINANCE | {offerKey,title,description,entitlement,priceCents,creditCount,durationDays?,platforms,appleProductId?,active?,effectiveFrom?,effectiveUntil?} | 不可变的新价格版本；金额单位分 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/health-report-offers/:id` | 发布价格方案新版本 | admin: SUPER_ADMIN, FINANCE | path:id；id=旧版本UUID；字段同新增 | 停用旧版本并创建新版本，不原地改写历史价格 | 核心服务 |
| `GET /api/saydian-app/admin/v1/notification-campaigns` | 营销通知任务 | admin | 无请求体 | 草稿、计划、发送结果和失败数 | 核心服务 |
| `POST /api/saydian-app/admin/v1/notification-campaigns` | 创建营销通知草稿 | admin: SUPER_ADMIN, APP_OPERATIONS | {name,type,title,body,deepLink?,audience:{allActive:true\|userIds:[]},scheduledAt?} | 营销通知草稿；不会发送给未同意营销通知的会员 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/notification-campaigns/:id` | 编辑营销通知草稿 | admin: SUPER_ADMIN, APP_OPERATIONS | path:id；id=草稿UUID；字段同新增 | 营销通知草稿 | 核心服务 |
| `POST /api/saydian-app/admin/v1/notification-campaigns/:id/schedule` | 安排营销通知 | admin: SUPER_ADMIN, APP_OPERATIONS | path:id；id=草稿UUID | 计划任务；实际发送由Worker完成并逐用户记录 | 推送供应商 |
| `GET /api/saydian-app/admin/v1/api-docs` | 接口中心路由与说明 | admin | 无请求体 | 代码生成的方法/路径/鉴权/参数与可编辑业务说明；标记过期项 | 核心服务 |
| `PATCH /api/saydian-app/admin/v1/api-docs/:routeKey` | 编辑接口业务说明 | admin: SUPER_ADMIN, API_DOC_EDITOR | path:routeKey；routeKey=控制器方法键；{title,summary,businessExample?,errorGuidance?,tags?,deprecated?,deprecationNote?}；不能修改方法和路径 | 接口说明草稿 | 代码生成路由目录 |
| `GET /api/saydian-app/admin/v1/api-docs/releases/list` | 接口文档版本 | admin | 无请求体 | 最近100个草稿、审核、已发布和归档版本 | 核心服务 |
| `POST /api/saydian-app/admin/v1/api-docs/releases` | 创建接口文档发布草稿 | admin: SUPER_ADMIN, API_DOC_EDITOR | {changeNote}；存在过期说明时拒绝 | 冻结的脱敏文档快照 | 核心服务 |
| `POST /api/saydian-app/admin/v1/api-docs/releases/:id/submit` | 提交接口文档审核 | admin: SUPER_ADMIN, API_DOC_EDITOR | path:id；id=文档版本UUID | IN_REVIEW版本 | 核心服务 |
| `POST /api/saydian-app/admin/v1/api-docs/releases/:id/publish` | 发布接口文档 | admin: SUPER_ADMIN | path:id；id=审核中文档版本UUID | PUBLISHED版本；仅超级管理员 | 核心服务 |
| `POST /api/saydian-app/admin/v1/api-docs/releases/:id/rollback` | 恢复历史接口文档 | admin: SUPER_ADMIN | path:id；id=历史版本UUID；{changeNote?} | 新的已发布版本；路由签名不同时拒绝 | 核心服务 |
| `GET /api/saydian-app/admin/v1/api-docs/export/file` | 导出脱敏接口文档 | admin | query:format?；format=markdown/openapi | Markdown文本或OpenAPI 3.1对象；Token、手机号和IP示例脱敏 | 核心服务 |
| `POST /api/saydian-app/admin/v1/provider-events/replay` | 回放已验签支付回调 | admin: SUPER_ADMIN, FINANCE | {limit?:1–100}；先解除回调处理暂停；只回放已持久化且verifiedAt不空的事件 | {items:[{id,processed,error?}],remaining}；失败不算完成 | 支付回调Inbox |
| `POST /api/saydian-app/admin/v1/commerce-after-sales/:id/refund` | 按已审核售后发起退款 | admin: SUPER_ADMIN, FINANCE | path:id；id=售后UUID；{reason?}；退款金额由售后单确定 | 退款记录；渠道受理不等于成功，最终以验签回调或已验签同步结果为准 | 微信支付/支付宝 |
| `POST /api/saydian-app/admin/v1/payments/:id/refunds` | 财务发起指定支付退款 | admin: SUPER_ADMIN, FINANCE | path:id；id=支付UUID；{amountCents,reason,afterSaleId?,idempotencyKey}；金额单位分 | 幂等退款记录；Apple购买退款需由App Store处理 | 微信支付/支付宝 |
| `GET /api/saydian-app/admin/v1/commerce/withdrawals` | 提现审核分页列表 | admin: SUPER_ADMIN, FINANCE | query:*；page/pageSize/status | {items,total,page,pageSize}；收款标识脱敏 | 主库资金账本 |
| `POST /api/saydian-app/admin/v1/commerce/withdrawals/:id/review` | 审批提现申请 | admin: SUPER_ADMIN, FINANCE | path:id；{version,idempotencyKey,decision:APPROVE/REJECT,note}；拒绝同事务释放冻结 | 提现记录；重复同键幂等，异参或旧版本409 | 主库资金账本 |
| `POST /api/saydian-app/admin/v1/commerce/withdrawals/:id/manual-receipt` | 登记真实人工转账回执 | admin: SUPER_ADMIN, FINANCE | path:id；{version,idempotencyKey,providerTransferId,amountCents,recipientOpenId,receiptReference,evidence,completedAt,confirmedExternalResult:true}；核验金额及收款身份 | 提现记录；仅登记已完成的真实转账，不发起任何第三方付款 | 财务人工核验凭证 |
| `POST /api/saydian-app/admin/v1/commerce/withdrawals/:id/verify-original-transfer` | 核验迁入在途原转账结果 | admin: SUPER_ADMIN, FINANCE | path:id；回执字段同manual-receipt，另result=SUCCEEDED/FAILED；必须原转账号一致、已接管且PROCESSING/WAIT_USER_CONFIRM | 成功结账或失败释放冻结；不得创建新转账单 | 原渠道回执 |
