# Say Ring 问候发送限流隔离

用户反馈连续发送后其他账号也报失败。基线be3b56a7445cf100841dc5e277213c714c7daa58，从fetch后的origin/main新建codex/say-ring-care-fixes-20261127工作区；原E:/saydian h5脏文件及其他分支保留。阅读AGENTS、handoff及最近实施记录。Start-Change/Publish-Change限定main，当前使用独立功能分支，未借工具更换原main或跳过验证。

- 代码核实：消息发送原使用全局ThrottlerGuard的每IP/每处理器24次每分钟，认证账号不参与计数，同网络账号共享额度。不能据此断言截图中的实际HTTP状态已取得；本轮无生产请求日志。
- 仅消息发送移除共享IP桶，保留原UserAuthGuard。已认证请求在事务中先取账号发送锁，再取原关系锁、重新校验关系，在过去一分钟按authorId计数，24次后返回429和明确说明。包含已删除的发送，不能用删除规避限制；原有authorId索引及表结构不变。
- 相同消息ID的已提交重试在限流之前返回原结果，不重复写入/通知；不同kind仍冲突。原有关系、屏蔽、权限、音频和附件校验保留。其他公开接口和防滥用保护保持原样。
- 新增4项服务/路由测试：账号之间额度独立、限流时幂等重试、删除不恢复额度而一分钟后恢复、只豁免发送IP桶且仍保留认证。

## 验证

- pnpm install --offline --frozen-lockfile通过，无锁文件变化。首次定向测试因新工作区未生成Prisma Client而失败；执行pnpm db:generate后再做typecheck和定向测试，4项通过。没有连接生产数据库或执行迁移。
- pnpm typecheck通过；pnpm test全工作区通过，API部分1719项通过/118项按环境跳过，其他包见专用日志；pnpm build通过；api:docs:check校验642条。
- 首次部署测试错误使用tools/deploy*.test.mjs通配，Node报告0项，不计为通过；改为显式deploy/scripts的六个测试文件后发现本机缺jq。经官方1.8.2发行清单SHA256校验下载Windows jq，再次执行发现Git Bash的/c路径不能直接交给原生jq；使用项目现有SAYDIAN_JQ适配器后，pnpm tools:test完整通过（工具/部署60项、H5流程62项、H5契约38项，均无失败）。未修改部署源码来迎合环境。完整日志位于Git外E:/SayRing-1.0.16-issues-20261127。
- 提交前再次fetch，origin/main仍为be3b56a7445cf100841dc5e277213c714c7daa58；git diff --check通过。独立工作区沿用Publish-Change的显式文件、实施日志、顺序门禁、二次fetch和非强推规则；该工具硬编码main，故保留独立工作区分支而使用等价命令。拟将四个明确文件提交并快进线上main，CI/部署实际状态另记，不能把push当作部署。
- 本地服务替身测试没有执行真实PostgreSQL并发或公网同IP账号联调，不将模拟锁调用当作物理并发验收；生产未发布，后续需核对CI和线上revision。
