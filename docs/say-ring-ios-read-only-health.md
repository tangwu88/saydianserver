# Say Ring iOS 只读健康指标

## 客户端契约

公开 GET `/global/api/saydian-app/v2/support/app-display?product=say-ring&platform=ios`（规范 `/api/` 地址同样支持）：

```json
{
  "product": "say-ring",
  "platform": "ios",
  "hideAi": true,
  "sleepAiEnabled": true,
  "readOnlyHealth": {
    "schemaVersion": 1,
    "validForSeconds": 300,
    "metrics": {
      "heart_rate": false,
      "hrv": false,
      "blood_oxygen": false,
      "body_temperature": false,
      "stress": false
    }
  }
}
```

上例 AI 值仅为既有字段示意，不由本功能设置。五项指标默认关闭，公开配置缺失、非公开或内容无效时全关；数据库故障返回错误，不伪装成功。未知字段不会公开。

客户端启动、回到前台与租约到期重新读取，不持久缓存；失败、身份切换或租约到期立即关闭附加展示。仅展示设备确有的真实记录，未知值不补零；固定客户端功能上限仍须保留。

登录 GET `health/records` 带相同 `product=say-ring&platform=ios`，按数据库当前配置在 SQL 分页前筛选本人活动、睡眠及启用的生理指标。`body_temperature` 映射现有云端 `metric=temperature`；`stress` 尚无云指标，不新增 schema 或接口。关闭指标查询返回空列表，不删除原记录；未带标识、Android、Health 和旧客户端保持原行为。

产品/平台是调用方声明，不是可信客户端身份；`/global` 也不是产品边界。账号所有权仍由登录令牌校验，不能声称这些标识阻止伪造旧请求。此功能不是权限系统替代品。

## 后台与回滚

“客服与更新”增加 **Say Ring iOS 只读健康指标**，独立保存 `say_ring_ios_health_display`，不会覆盖 `say_ring_app_display`、其他产品或 AI 配置。

- PATCH `/api/saydian-app/admin/v1/settings/say_ring_ios_health_display`：`{value:{schemaVersion:1,metrics:五项严格布尔},public:true,expectedUpdatedAt:当前ISO时间或首次null}`。
- POST 同路径 `/rollback`：`{expectedUpdatedAt:当前ISO时间}`，恢复最近一次保存之前的五项配置。再次回滚会恢复上一次回滚之前状态，均保留历史。
- 仅超级管理员/App运营可写。缺少身份、非法/扩展字段、隐藏发布会被拒绝；版本冲突409，无历史404。
- 写入与操作者/前后布尔快照同一事务；共用数据库锁及单调更新时间，审计失败不落配置。审计不保存健康值、设备标识或密钥。

上线先部署默认关闭代码，确认 revision 后再通过后台单独开启已实现的心率、HRV、血氧。皮肤温度/压力先保持关闭。无需数据迁移或初始化。

## 不改变的边界

本轮 iOS 新生理记录只保存在本机，可按配置读取本人云端已有记录；**不新增生理数据云上传**。上传约束由客户端独立保留，不将显示开关当作上传授权。服务端 batch 上传、关爱、预警、手动测量与 AI 既有接口均不变。

所有用户适用同一规则，无审核员识别或审核后隐藏功能模式。不修改商店审核。构建1110起公开版本说明与真实只读范围对应，不改数据库中正式协议正文/同意版本、其他产品或 Android 政策。

睡眠 AI 继续受独立授权和真实服务可用性控制。本轮不运行供应商探针、真实报告重试或付款。

自动部署仍使用 main→CI→同一产物→生产验收。保留 `saydian_default` 与 `saidian_default` 两个网络；不清理生产数据库、卷、备份或镜像。
