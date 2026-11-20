# 2026-11-20 Saydian赛电中文协议隔离

## 原因、基线与计划

用户要求将当前Saydian赛电的用户协议、隐私政策换成最新中文版本。线上只读核对：客户端appProduct=saydian-app-cn、locale=zh-Hans，但capabilities仍选择saydian-global并返回英文global-appstore-2026-10-14-r2；管理接口不存在本产品已发布中文协议。本地旧中文稿含日期占位，已询问用户正文来源，尚不发布/认证法律审核。

从origin/main 409857b新建独立worktree及codex/cn-legal-20261120，保留旧server-cancel-deletion-20261117的未提交实施记录。已读取AGENTS、handoff及最近账户恢复/生产交接，未改原服务、账号数据或维护标志。

新增显式legal product saydian-app-cn、独立saydian_cn_user_agreement / saydian_cn_privacy_policy，只读取已审核、启用、同版本简体中文配对；不回退英文、国际版或Say Ring。现有客户端不传新product参数时维持原契约。后台添加明确所属App及类型，保留审核/不可原地改正文规则。客户端升级使用该product，WeChat配置appProduct继续独立传递。无数据库结构迁移、无自动seed或正文自动激活。

## 验证

进行中。依赖离线安装因缓存缺@types/node tarball失败，已保留日志并改独立worktree联网安装；不改已有工作区依赖。后台登录只用于读取法律记录，未显示或保存管理员凭据/令牌。私有线上快照在D:/Codex-CN-LEGAL-20261120，非Git文件。

独立联网安装与Prisma代码生成完成，根级typecheck通过。首轮根级test因Admin旧文案断言、SFC测试依赖注入未包括新增legalProductLabel而失败；生产Vue类型检查通过，修正为实际新文案并注入真实同一helper，未降低发布确认校验。pnpm遇首个失败中止了API/Worker/VIP子进程，出现Channel closed，不能视为这些模块通过；后续改工作区串行完整重跑，保留失败日志。

## 用户选定英文最新版等义翻译与Git交付

用户随后指定“按现行英文最新版等义翻译成中文”，并要求更新代码到Git。两份完整中文译稿在docs/legal/saydian-cn-{terms,privacy}-20261120.zh-Hans.draft.html；原文版本global-appstore-2026-10-14-r2、生效日期2026-10-14。正文不再混入运营核对占位；来源及存储/渠道等实际适用性问题单独写入saydian-cn-translation-review-20261120.md。保留原文意义，不凭空填写或认证运营事实。

最终本地检查：根级pnpm typecheck通过；Admin定向87项通过；根级pnpm -r --workspace-concurrency=1 --if-present test完整重跑通过，Admin331项、API1640项通过/101项跳过、Worker170项通过/5项跳过（数据库用例缺少隔离库未执行），其余工作区均通过。根级pnpm build通过，api:docs:check核对603路由通过。部署脚本首轮11通过6失败，原因是Windows环境缺jq；下载官方jq 1.8.1并核对官方SHA256后，通过SAYDIAN_JQ指定，17项全部通过，仅运行fixture不操作服务。git diff --check通过。所有原始失败与重跑日志保留在D:/Codex-CN-LEGAL-20261120，未入Git。

未执行生产发布、真实供应商联调或新协议启用；没有数据库迁移、seed、账号/维护标志改动。译稿未标记reviewed/active，不复用英文审核状态，不修改其他产品协议。按用户要求仅推送codex/cn-legal-20261120功能分支；main自动发布流程不触发。
