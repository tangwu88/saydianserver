# 礼品卡独立批量查询

独立页面 `/admin/gift-query`（与后台同域，独立查询登录，无后台导航）。总管理员在“商城 → 礼品兑换 → 查询账号与日志”新增账号、重设密码、启用/停用、查看累计统计和逐次快照。最多100账号，无默认账号；名称可改，账号名固定，大小写统一小写。编辑后旧会话全部撤销，启用不会复活旧会话。运营角色、会员、查询账号均不能配置账号或读取后台日志。

输入8开头的8位卡号，例如80100611；支持换行、空格、中英文逗号、分号及顿号。每次去重后1至100张，不接受内部管理编号、数字数组或范围。输入顺序保留，重复卡一次返回；多次查询同卡分别记账。结果为：已兑换及原订单编号、未兑换、卡号不存在。已退款订单不等于未兑换；停用/作废/过期但未兑换的卡仍归未兑换，不承诺它现在可以兑换。

## API

所有接口V2包裹 `{code,message,data,timestamp,requestId}`，no-store。公开路径不携带卡号、密码或Token查询参数。

| 方法/路径 | 身份 | 输入/返回 |
| --- | --- | --- |
| POST `/api/saydian-app/gift-query/v1/login` | 查询账号密码 | `{username,password}` → `{token,expiresAt,username,displayName}` |
| GET `/api/saydian-app/gift-query/v1/me` | 查询Bearer Token | `{username,displayName,expiresAt}` |
| POST `/api/saydian-app/gift-query/v1/logout` | 查询Bearer Token | 空体 → `{loggedOut:true}` |
| POST `/api/saydian-app/gift-query/v1/query` | 查询Bearer Token | `{cardNos:string\|string[]}` → `{items:[{cardNo,status,orderNo}],cardCount,redeemedCount,missingCount,queriedAt}` |
| GET `/api/saydian-app/admin/v1/commerce-gift-query-accounts` | 总管理员 | 账号公开信息、version及累计统计，不含passwordHash |
| POST `/api/saydian-app/admin/v1/commerce-gift-query-accounts` | 总管理员 | `{username,displayName,password,active}` |
| PUT `/api/saydian-app/admin/v1/commerce-gift-query-accounts/:id` | 总管理员 | `{displayName,active,version,password?}`，留空不改密码，旧version返回409 |
| GET `/api/saydian-app/admin/v1/commerce-gift-query-logs` | 总管理员 | `accountId?`、`page?`，每页30，最新在前 |

查询状态枚举 `REDEEMED / NOT_REDEEMED / NOT_FOUND`。订单编号仅在有真实CommerceGiftRedemption关联时返回，除此无会员、手机号、地址、金额、物流或校验码。

密码bcrypt12，至少10字符且最多72UTF8字节，接口不回传；会话随机48字节、8小时，数据库仅SHA256。前端仅查询专用sessionStorage，不复用任何后台/会员Token或拦截器。登录失败通用提示；数据库限流按IP30次/10分钟、账号10次/10分钟；查询60批/账号/10分钟，另有HTTP每IP限制。

查询使用账号/会话行共享锁，配置编辑持有账号排它锁并撤销会话。日志保存当时结果，落库失败不返回查询数据；账号/日志不提供删除接口。累计查询包括已认证但格式无效的接口请求，后者卡数为0；前端本地格式校验未发出请求不计数，未认证和限流拒绝不计数。日志只存合法卡号快照与计数、账号、时间、请求ID及IP哈希，不存非法输入正文、密码、会话Token或个人收货信息。维护/停写仍阻止登录/查询POST，不新增豁免。

## 数据迁移及发布验收

迁移 `20261125090000_gift_query_portal` 只新增3张空表及自身索引/外键，不修改原账号、卡片、订单或兑换关系，无seed。2026-11-26用户明确要求上线后，独立复核SQL摘要与已通过的隔离升级验收，登记生产兼容白名单；合并最新主线后再次执行CI验收。发布时仍必须通过当前生产备份的隔离恢复门禁，不能绕过。

CI执行 `UPGRADE_SCOPE=gift-query pnpm test:gifts:upgrade`：独立随机loopback数据库，从当前迁移前升级，比较所有旧表原列逐行摘要、旧订单/支付不变、新表为空和约束有效。`pnpm test:gifts:database` 在另一随机隔离库执行礼品原逻辑与查询测试，不能用生产库运行。

兼容回退可停止查询入口，保留3表及日志并回退程序；不得删除生产日志/账号表回滚。没有默认查询账号，源码部署不会自动开放查询身份，管理员按需新增。

上线后须核对CI、双readiness revision、页面资源完整性。账号创建及合成卡查询应在隔离验收环境完成；未明确授权不得用真实卡号触发业务操作。上述查询功能不会开启/作废/兑换任何卡。
