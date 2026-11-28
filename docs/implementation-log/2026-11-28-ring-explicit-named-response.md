# 分享回应先匿名后署名仍匿名

## 复现与范围

- 用户1337已安装；关联后勾选署名仍看到“有位朋友”。用户确认同一条分享在关联前已匿名回应，账号使用系统默认昵称。代码核实UI仅在name为空时显示“有位朋友”；服务端按shareId/visitor唯一去重，第二次createMany(skipDuplicates)返回0但仍报成功，没有更新名字。
- 当前global注册会实际保存默认昵称Saydian user，可用作明确选择的署名；不以手机号/邮箱/ID填补昵称，不自动将已关联成员的旧匿名回应署名。
- 修改前已读AGENTS、handoff、最近关爱及CN来源隔离日志，status/remote/fetch成功。原E:/saydian h5脏工作区和旧功能分支保留；从origin/main=39e8f6a280d86e8b87b5bfe46ff4954022e3a3e9创建独立codex/ring-response-name-20261128工作树，HEAD与main一致。Start-Change/Publish-Change硬编码main，不能在独立分支直接用，沿用显式文件/日志、完整顺序门禁、二次fetch和非强推发布规则。
- P2：同一会员先匿名回应→建立有效关爱关联→勾选署名重新提交。预期本次明确选择可应用到自己的该条回应；实际接口成功但旧name仍null。
- 计划只改服务端react中该重复分支及专项/实库回归。保留唯一回应、初次内容和时间、原通知数量、有效关系/屏蔽/本人/分享有效期及来源产品校验。只在本人明确named=true且昵称有效时修复自己该条匿名回应，不批量回填、不改健康/客户账号，不做数据库迁移；已署名快照及匿名访客记录保留。

## 排查与准备

- 首次尝试使用旧功能分支编译产物复现前，主动比较react源码，因新版加入product隔离而断言失败，故没有把旧产物模拟当当前版本证据；随后新工作树使用当前main源码。几次读取猜测文件名不存在，改用rg实际定位；未覆盖原文件。
- pnpm install --offline --frozen-lockfile通过（20.2秒），无锁文件变化；pnpm db:generate及contracts build通过。产物/详细日志保留Git外E:/SayRing-response-name-20261128-artifacts。
- 将先运行新增专项验证旧实现可复现，再修改并执行完整串行门禁。当前仅本地合成数据，没有发送真实回应或修改生产数据。线上只读ready为39e8f6a280d86e8b87b5bfe46ff4954022e3a3e9。

## 修复与回归

- 新增ring-share-name.test.ts专项，修改前5项中3项失败、2项通过：可真实执行当前服务方法，复现两个产品的先匿名后署名仍为null，以及只能修复自己的匿名记录场景。targeted-before.log完整保留；没有把这些预期红测记为通过。
- react的原初次插入/通知不改。仅重复且actorId存在、named严格true、当前有效关系检查已通过、publicName有效时，updateMany精确限制shareId+visitor+memberId+原name=null，写入本次服务端真实昵称。已署名快照不改，旧客户端默认匿名重试不降级历史署名；保持一条回应语义，没有新增“修改原回应内容”功能。
- 新增隔离HTTP+PostgreSQL用例，覆盖匿名→未关联署名403→接受邀请→并发重复署名200、默认昵称读回、原时间/内容不变、只保留一条回应/通知。需独立ringlab库，Windows本机无Docker，不预称已通过；现有CI专用容器会执行该用例。没有新接口/迁移，已安装1337可以使用同一协议，无需因这次服务端修复重新打APK。
- 修复后专项5项通过。首轮完整typecheck发现新增测试产品数组推断为string[]，与RingProduct窄类型不符；补as const保留两种合法来源，未放宽生产类型。失败typecheck.log保留，随后重做完整顺序门禁，最终日志使用final前缀。

## 本地最终门禁

- 串行`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check`、`pnpm tools:test`全部通过，`git diff --check`通过。API1730项成功、121项按数据库环境跳过，Worker174成功/5跳过；其他工作区均成功。接口目录643条描述完整。工具/部署60、H5流程62、H5契约38通过；Git Bash和既有SAYDIAN_JQ适配器仅用于Windows工具测试，不改生产脚本。最终日志均在Git外专用目录。
- 本轮不改App源码和安装包，1337原正式证书/覆盖安装证据沿用App仓库记录；不把本机服务替身通过当作独立数据库或线上客户回归成功。
- 再次fetch成功，origin/main仍39e8f6a280d86e8b87b5bfe46ff4954022e3a3e9。仅提交服务、两个测试和本日志四文件，非强推快进中国main触发既有CI/发布；不触发美国部署，不改生产密钥/配置/数据库或维护状态。后续需核实CI独立PostgreSQL用例及线上revision，不能把推送当成已生效。
