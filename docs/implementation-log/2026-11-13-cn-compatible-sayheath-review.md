# 国内发布的既有SayHeath迁移独立验收

用户在本轮Token自动续期发布前明确同意“一并验收后部署”。原续期代码基于c733d26，国内生产仍591b233；两者之间的20261111010000_sayheath尚未在国内运行/登记。本轮不修改原迁移SQL，不开启美国版功能或变更既有授权。

## 静态独立审查

原Git字节SHA-256：80ecbcce1617669b59d395f42e6242e18ea06df447aa315e085c744c0c3e61c9。只创建SayHeathSession/Switch/Grant/Capture/Family五张空表，新增索引及新表引用既有User的外键；不ALTER既有表、不INSERT/UPDATE/DELETE/DROP/TRUNCATE旧数据。开关与双向家庭授权共五个布尔默认均false；国内路由requireUS仍拒绝，未发布美国法律文档、未创建开关或授权行。

## 升级与恢复验收

在既有仅loopback PostgreSQL测试中增加独立UPGRADE_SCOPE=sayheath-cn：精确迁移至生产591b233对应的最后健康大屏迁移，创建合成会员、商品/SKU、已付订单/商品行/支付六行；对全部既有表及列计算行数和逐值摘要，再迁移到当前。要求所有既有值一致、所有约束已验证、五张新表为空、五个布尔默认false。默认礼品升级测试保持原场景。

CI单列该升级步骤，并保留原真实PostgreSQL/备份隔离恢复/类型测试构建流程。只有该候选CI成功后才合并发布。将原SQL精确摘要登记兼容迁移清单，不跳过最新main、镜像身份、生产备份、磁盘预留、迁移历史或原维护开关门禁。生产执行结果仍须核对Actions与双readiness；不以静态审查冒称生产已迁移。

本机没有docker/psql，实际PostgreSQL升级与恢复由CI执行，本机只验证脚本语法和既有工具/H5回归。完整失败/修复及CI/部署回执保存忽略目录artifacts/jst-renew-release-20261113，最终状态按实际回执报告。
