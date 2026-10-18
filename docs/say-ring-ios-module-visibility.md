# Say Ring iOS 健康百科与商城显示

## 范围

复用现有百科与商城页面，只增加两个独立显示开关。所有用户使用同一产品/平台配置；不识别审核身份、账号、批准日期或隐藏时间窗。
仅对明确声明 `product=say-ring&platform=ios` 的新版调用生效。Health、Android、无标识旧请求保持原行为；不是可信产品身份或账号权限替代。

不改变五项生理只读配置、独立手动测量授权、AI、购买/支付上限、上传权限或已发布法律版本。商城显示不代表能购买或付款。
本候选从生产 `aeb9afcb8bbd8b4168c38e489c827790c448bf7a` 独立建立，不包含会员ID邀请或披露态迁移；不部署、不写生产开关。

## 公开 DTO

沿用 GET `/api/saydian-app/v2/support/app-display?product=say-ring&platform=ios`，`/global`别名相同；`Cache-Control: no-store`。
只增加与 `readOnlyHealth` 同级的 `moduleVisibility`，原AI字段和 `readOnlyHealth.metrics` 的五项严格目录不变。

```json
{
  "product": "say-ring",
  "platform": "ios",
  "moduleVisibility": {
    "schemaVersion": 1,
    "validForSeconds": 300,
    "modules": { "health_library": false, "mall": false }
  }
}
```

上例只展示新增字段，不是当前生产回执。`health_library`与`mall`必须均为严格布尔，互相独立；不允许支付、医疗或审核身份等扩展字段。
未配置、未公开、格式无效或模块读取失败时两项均false；模块读取错误不撤销独立的生理指标租约。全接口读取失败由客户端隐藏入口。

客户端独立解析模块对象，旧1116忽略新同级字段；不得把两项加入生理指标解析或让模块解析失败关闭生理/手动租约。
模块授权不持久化，启动/切账号默认隐藏；刷新失败、配置关闭或租约过期隐藏入口及已打开内容，并丢弃旧作用域/迟到响应。

租约最多300秒，用单调时钟计算并扣除请求耗时；过期响应不能重新获得完整租约。回前台刷新，过期前可续读同一公开配置。
租约只控制展示，不新增功能、命令或任何业务写入授权。旧客户端不支持远程新增的显示能力，不宣称后台能控制旧版入口。

## 后台与审计

“客服与更新”增加“Say Ring iOS 百科与商城显示”，独立key `say_ring_ios_module_display`；默认两项隐藏，无自动初始化或种子。
PATCH `/api/saydian-app/admin/v1/settings/say_ring_ios_module_display`：

```json
{
  "value": { "schemaVersion": 1, "modules": { "health_library": false, "mall": false } },
  "public": true,
  "expectedUpdatedAt": null
}
```

首次版本是null；后续使用已读取设置的ISO `updatedAt`。POST同路径 `/rollback` 只需 `expectedUpdatedAt`，恢复上次保存前配置，不触碰其他设置。
仅SUPER_ADMIN/APP_OPERATIONS可写。无身份/非法内容/非公开/缺版本拒绝，陈旧版本409，无历史404。

配置及操作者、前后布尔快照同一事务，共用按固定设置key隔离的数据库锁；审计失败不落配置，时间版本单调递增。
复用既有AppSetting/AuditLog，无schema或迁移。五项只读设置复用同一事务实现，但保留原key、动作、字段和行为，不与模块互相覆盖。

## 有限只读门禁

以下GET带明确 `product=say-ring&platform=ios` 时，以数据库当前配置检查模块；关闭、缺失、无效或模块读取失败均404，不查正文/商品。

- `content/categories`、`content/articles`、`content/articles/:id` 对应 `health_library`。
- `commerce/home`、`commerce/markets`、`commerce/products`、`commerce/products/:id` 对应 `mall`。

所有路径均位于V2基址，canonical/global相同。只放行原有只读业务；cart/order/payment/capabilities、协议与其他API不因开关扩大权限。
调用方能改产品参数，因此不声称这些参数阻止伪造旧请求；登录、归属、实际商品/市场/交易能力校验仍独立有效。

## 发布门槛

本分支只能作为独立候选，不与会员ID迁移绑包。先通过源码、真实HTTP/数据库、实际镜像及客户端租约/已打开页面回归。
生产受控主机入口、容量/实例/数据库/私有备份恢复及回退证据仍需独立核实；不得以CI合成测试替代。当前不部署或打开开关。

满足门槛并安排部署后，首次默认关闭；必须核对线上revision和公开DTO，再决定是否通过后台单独发布显示配置。
关闭仍可通过该设置回滚/保存两项false；回退到没有新字段的兼容服务端时，新客户端按缺失隐藏，旧五项及其他功能不变。
