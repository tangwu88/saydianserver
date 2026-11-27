# 赛电SayDian分享、关爱与推送独立适配

用户明确要求同时适配并发布共享后台，随后要求客户端/服务端改动更新Git。服务端独立工作树codex/cn-ring-links-20261127，基线0b01cd23c551d5e2d888aa23eef51624babb33fd；status/remote/fetch确认干净，原main及SayRing用户工作树未改。已读AGENTS、handoff、统一发布手册及最近关爱限流/分享实施记录。双地址线上ready同为此版本；管理员只读核查目前仅say_ring_push已配置，CN没有独立极光凭据，不复制该App密钥。已请用户发布后在新CN配置填写凭据，未配置时不声称手机收到推送。

计划及影响范围：保留现有global账号/健康授权和Say Ring默认协议，为RingShare/RingCareInvite/RingCareMessage增加默认say-ring的来源产品列及索引，旧记录和唯一标识不改。仅增列/索引的兼容SQL单独登记校验，CI及独立数据库审核后发布，不运行seed或覆盖历史。CN分享、邀请、消息按来源查询，原公共关爱关系/健康权限、屏蔽和用户通知偏好保持同一账号的现有规则。

新增CN专属H5路径/global/saydian-cn/ring，明确cc.saidian.app/赛电SayDian，保留原Say Ring路径、品牌和包名。客户端1058采用新路径、CN推送注册产品及版本标记cn-ring-v1；旧1057没有标记，不能因后台升级误开未适配入口。固件/远程轻振范围不扩大。分享/关爱队列保存来源产品，Worker只选对应产品provider，CN新增独立saydian_cn_push后台配置，未配置保持可重试，不借Say Ring密钥发送。

需要串行完成pnpm typecheck/test/build、api:docs:check、tools:test，产品隔离/失效/分页/通知路由及H5浏览器合成回归，迁移升级/回滚边界审核，客户端静态/全量/原生/正式构建；发布仅中国环境，保留现有维护和Worker暂停状态，核对Actions与双ready实际revision。Windows不声称iOS/Harmony原生或真实手机/供应商投递通过。逐次失败、修正及最终结果后附。

## 实现及兼容边界

产品列保留原值默认say-ring；分享/邀请/消息的读写、分页游标、语音及消息处理均携带产品，分享token不能跨产品重用。原始账号、健康授权、屏蔽、静音、通知偏好和共同散步进度保持原来的全局关爱关系规则；没有复制会员或健康数据。新增CN通知使用cn-ring-*事件命名，列表/详情/未读/已读过滤另一产品的戒指事件，普通健康/会员消息不隐藏。队列保存product，Worker只选择jpush_saydian_cn；旧无产品事件按say-ring兼容，未知产品拒绝，不回落其他通道。

用户随后明确“先发布功能，系统推送暂不启用”。CN通知仍保存站内消息，只有独立saydian_cn_push被管理员配置为CONFIGURED时才创建系统投递任务；本轮不配置凭据、不发送测试推送，不借用Say Ring通道。后台新增独立配置入口和分享/关爱运营页的App选择，切换时拒收旧请求结果。

迁移20261127110000_cn_ring_product只增三列、检查约束及索引，原有表/字段/索引/标识保留，事务内设置5秒锁预算；登记SHA256 edd413bedc60f64f4ec19f6a7096973400068e32037e9927c17f9b775d43a41a。迁移后旧版本仍可写默认Say Ring数据；但CN开始写入后，人工回退须保留产品识别能力或向前修复，不能回退0b旧应用后宣称跨产品列表仍隔离，更不能回删列或恢复旧库覆盖数据。新增Linux CI独立ringqa/ringlab容器，重跑完整Ring HTTP、升级前后行内容不变及两产品路由，URL护栏仍仅允许独立本机库；本机Windows无Docker，不把本地跳过视为真实数据库通过。CI门禁成功前不切换线上服务。

CN网页仅使用/global/saydian-cn/ring，标题强制简体中文，静态模板替换品牌但不替换用户昵称/留言；无有效CN下载配置时不展示Say Ring下载入口。Android使用新路径及显式包名的打开按钮，内置浏览器受限时给出浏览器重试说明；不声称所有微信内置浏览器或真机已验收。没有给cc.saidian.app新增全域assetlinks：旧1057宣告了Say Ring路径，贸然关联会让旧包抢占它们。原安卓关联和其他域名不改；iOS AASA仅在原CC应用项加入CN专属两条路径，原WeChat及Say Ring路径保留。

## 本地验证及纠正

- pnpm install --offline --frozen-lockfile、db:generate、prisma format通过，锁文件未改；本机Node24.14.1/pnpm11.25.0，CI仍用仓库既有24/11.19.0。
- 首轮专项12项通过。随后类型检查发现新增通知测试mock的参数元组/严格索引写法不符，修正测试替身签名及调用断言；客户端首轮缺新协议常量import，补齐后71项专项通过。一次补丁前缀上下文不足、一次测试补丁次序错误均原子拒绝，未覆盖原文件。
- 服务端第二轮全量因配置入口总数仍断言18而失败，改成实际19并保留CN独立字段断言。最终pnpm typecheck、全工作区pnpm test及pnpm build通过：2801项成功、125项按数据库环境跳过（API1725成功/120跳过、Worker174成功/5跳过、Admin356成功，其他包详见Git外日志）。Windows跳过的独立库用例由新增CI步骤执行。
- api:docs及api:docs:check通过，643条接口均描述，生成目录随源码提交。tools:test初轮59/60通过，新增网关路由使旧测试的AI固定下标断言检查了错误路由；改为按实际路由名断言，保留原AI超时/日志关闭/幂等检查。第二轮工具/部署60、H5流程62、H5契约38全部通过，使用既有Git Bash及SAYDIAN_JQ适配器，未修改生产工具来迎合Windows。
- 额外YAML检查因未安装PyYAML、误选不存在yaml@2分别失败，未改工作流回避校验；改用仓库已安装yaml@1.10.3解析通过，所有步骤都有执行命令。数据库容器等待检查显式使用TCP，避免初始化临时Unix服务造成假就绪。
- 独立Edge无头窗口使用本地合成数据，390px下CN分享/邀请与原Say Ring分享三页无横向溢出，中文可读；实际JS选择包名分别为cc.saidian.app/cn.saydian.ring，CN访客回应请求携带本产品，不含其他App下载入口。截图及receipt在D:/Codex-CN-SAYRING-SYNC-20261127/web-previews，均为合成记录；未打开真实联系人链接或发送消息，未拿浏览器目标检查冒充手持手机跳转验收。
- 客户端1058完整分析/1795 Flutter/433 UTC、Android Debug/160原生/Release和正式验包均通过，详情随客户端Git记录，尚未安装。正式包/源代码保留中文、+86、原签名及独立微信/更新/显示配置。

发布前再次fetch，origin/main仍0b01cd23c551d5e2d888aa23eef51624babb33fd；diff检查通过。Publish-Change硬编码main，当前独立功能工作树采用等价的显式文件/日志、完整门禁、二次fetch、非强推规则提交，并仅快进中国main触发既有CI/自动发布；后续须单独记录CI真实数据库结果及线上revision，不把push当发布成功。

首次提交因该仓库没有作者身份而停止，暂存及补丁均保留、尚未推送；改用仅本次命令的Codex代理作者，不修改用户全局Git身份，再继续同一显式提交/发布流程。
