# Say Ring 固件型号及文件校验

2026-11-25。后台从 `057f824` 接续。用户确认 QRing R21 固件给 R8、R21，CoolWear HR05 固件给 R7 Pro、R7 Ultra（R7u），CoolWear HR01 固件给 R7、R7y。

- 使用共享契约驱动后台设备型号选择和服务端校验。暂存接口核对 `packageModel` 与型号、通道的配对。签名清单包含该字段，查询请求也需带对应字段。旧 App 未传此字段时返回无可用包。此前不在范围内的草稿仍可查看和暂停。
- 发布清单 `SAY_RING_VERIFIED_FIRMWARE_UPGRADES` 的项目格式为 `platform:transport:model:hardware:fromVersion:version:packageModel:sha256`。新格式同时确认准确升级路径和实际文件。旧条目缺少这些字段时不能分发。不同商品型号或平台须独立通过验证和登记。下载仍核对数据库中的真实字节数和 SHA-256。
- 沿用既有表、分项开关和签名配置。本轮不需要新的数据库迁移。

## 验证

- `pnpm api:docs` 与 `pnpm api:docs:check` 核对 633 条接口。首轮类型检查因测试元组推断过宽失败，声明固定元组后复验通过。
- `pnpm typecheck`、`pnpm test`（2,525 项通过，116 项按环境条件跳过）、`pnpm build`、48 项部署脚本检查均通过。增加旧客户端无包型的规则后，重新检查类型与接口文档、重建 API。
- 独立 loopback PostgreSQL 完整迁移后，本轮 7 项联测通过，覆盖六款型号映射、暂存防错、旧请求、签名及同版本替换文件、分发暂停。便携 PostgreSQL 未附 `createdb` 且现场未装 `pg` Node 包，改用独立实例的 `postgres --single` 创建合成测试库。测试进程退出后实例已关闭。
- 现有附件为 SDK 与示例，尚无可核验的 R21 正式固件。发布、实物刷写和恢复未验收。
