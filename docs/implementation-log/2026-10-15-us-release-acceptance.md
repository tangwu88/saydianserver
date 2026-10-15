# 美国服务器更新验收（2026-10-15）

## 发布结果

- 用户要求更新美国服务器，并明确授权更新期间暂停旧项目 Temporal / Elasticsearch，完成后恢复。
- 美国站从 a5198b8692cb1355ab60b4c10e34af79f0242dd9 更新至 eda3c665ba2b21e291ee2386b79f4656abbdbbd2；本轮未修改应用源码、DNS、商户配置或中美数据隔离关系。
- 使用 main CI [38673817472](https://github.com/tangwu88/saydianserver/actions/runs/38673817472) 的成功 verify 产物，release artifact 11945019180；原 ZIP SHA256 为 55196498fdac9ae18cb3a8eed4b94bf17a7da782b8af4e073bce21efbc1ab875。
- 独立 [Deploy US 38678918106](https://github.com/tangwu88/saydianserver/actions/runs/38678918106) 第二次执行成功：resolve 116241629960、deploy 116241628839。应用切换完成于 2026-10-15 04:09:23 UTC（北京时间12:09:23）；两处 readiness 均返回上述 revision。

## 容量、备份与迁移

- 原美国部署因容量门禁停止。现场还存在内存交换与高 I/O 等待；暂停获授权的两个旧服务后继续，保留原配置和镜像。
- 对11个固定、无活动引用的历史代码目录逐文件校验压缩归档后释放解压副本，没有下调5GiB保留空间或执行Docker prune。同机另一清理任务随后按用户要求删除历史压缩包，因此不能将这些历史tar包仍留存或实际还原列为本轮验收结果；当前活动代码未变。
- 本次美国库一致备份保持在美国服务器私有目录。首次隔离恢复数据比对通过，但验收脚本因主机没有jq中止；改用已有Python，另建备份重跑，保留首次回执。
- 最终备份目录：/opt/saydian-us/private/maintenance-20261015-eda3c66/backups/pre-eda3c66-v2。实际隔离恢复与全表摘要比对通过；在恢复副本上验证强制失败完整回滚、原99张表旧列及数据不变、新四表为空、所有约束已验证。压缩包清理后，本次database.dump的SHA256再次核对通过。
- 仅执行已审核的20261015060000_partner_onboarding，SQL SHA256为f717870be3159ca73b418e89b63b679c1bdb128805222c35d6cbbef245dd7ed6。执行前核对镜像内SQL、全部待迁移历史、原始镜像digest及备份恢复回执，并使用原发布锁排他执行。
- 第一次独立US发布拉取全部镜像后按设计停在独立迁移审核门禁，未切换应用。正式迁移成功后重跑同一工作流完成发布，没有重写历史校验值或运行seed。
- 拉取前容量门禁requiredBytes=7263475923、freeBytes=8651284480；最终发布使用已缓存原镜像，requiredBytes=6021971968、freeBytes=7926706176，均通过原门槛。

## 恢复与线上检查

- Temporal和Elasticsearch均已恢复运行且健康，镜像和容器配置摘要与暂停前一致；临时恢复定时器已撤销。
- US API、Admin、PostgreSQL、Redis、MinIO均健康，Worker运行。三项应用镜像与原CI清单一致；runtime.env、infrastructure.env摘要及发布前业务开关保持不变，包括原回调暂停和未启用的外部供应商能力。
- 39项线上HTTP检查通过，覆盖双readiness、伙伴/总后台/H5页面、美国法律/支持/下载页面，以及匿名访问资金、合作申请、订单和会员接口的拒绝。
- 10个前端入口及其JS/CSS文件的线上SHA256与部署镜像内文件一致；浏览器实际打开美国/vip/login，新商城会员进入/合作申请入口可见。
- 未创建生产会员、伙伴、订单或充值记录，未进行真实支付和ERP实交易。本次沿用美国既有数据库、文件、密钥和商户配置，保持原有中美隔离配置。
- 源码main工作区保持干净。此验收记录放在独立文档分支，避免仅为记录再次触发main自动发布。私有备份、凭据、健康数据和本地artifacts不进入Git。
