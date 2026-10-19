# 商品编辑支持修改规格名称

## 原因与范围

- 用户要求商城后台商品编辑中的“规格”可修改，并更新线上。当前 ERP 商品规格为只读，保存接口仅接收图片调整。
- 独立工作树 E:/saydian-product-specification-20261019，分支 codex/product-specification-edit-20261019；基线 HEAD/origin/main 均为 0049c72e8a5f3bb7525e61b14ea80009851a4edb。原目录用户文档与发布回执保留。Start/Publish 脚本限定 main，而 main 已由其他任务占用，因此沿用显式文件提交、PR/CI流程，不覆盖工作树。
- 首次 Git fetch 因 Schannel 连接重置失败；单次 http.sslBackend=openssl fetch 成功，未修改全局 Git/TLS 配置；GitHub API 独立核对 main 与本地远端引用一致。

## 实现

- ResourceView 的商品规格改为多行输入框，ERP 和本地商品均可修改；SKU 编码继续沿用原绑定。编辑与 ERP 导入初始化原名称，ERP 保存仅提交改过的规格名称/图片，不回传价格、库存或未变化图片。
- 商品保存增加 skuDetails 白名单，只允许 id/updatedAt/specification/image；校验归属、重复 ID、版本和文本类型，事务内 CAS 更新。旧 skuImages 缓存客户端继续兼容，禁止新旧请求混用；省略的字段不会清空。
- 使用现有 specification 列，无数据库迁移、供应商写入或生产数据批改。手工名称立即用于商城后续查询；ERP 商品资料再次同步可能覆盖，编辑页有明确说明。伙伴等级自定义规格别名与已生成订单快照继续使用原有数据规则。
- 新增规格名称单独修改、原编码保留、未变化图片省略、外部 SKU/重复/无效版本/额外权威字段拒绝及过期版本回滚的回归检查；原图片请求兼容用例保留。

## 验证与发布

- 默认运行环境 pnpm 11.25.0 安装出现离线元数据缺失及在线 registry 错误，停止该安装后改用仓库固定 corepack pnpm 11.19.0；安装/生成及串行全量门禁结果待补记。
- 发布仅针对本次中国站后台及配套服务，沿用单次 [deploy cn only] 提交标记和原部署开关；不变更原生 APP。PR CI、main CI、原镜像发布与线上版本需独立核对，未上线前不称已部署。

- corepack pnpm 11.19.0 frozen/offline 安装成功，Prisma generate 成功。pnpm typecheck、pnpm test、pnpm api:docs:check、pnpm tools:test 均退出0；API 1258项、后台236项通过，实库类本地跳过，交由CI真实PostgreSQL验收。tools:test包含部署脚本、离线镜像及H5契约检查；jq 1.8.2从官方release下载并按官方asset digest核验，仅留ignored artifacts。
- api-notes补充skuDetails及兼容/冲突行为，使用原生成器更新454路由目录；无新增路由或SQL。源码diff检查通过。构建及CI发布回执续记。
- pnpm build退出0，后台实际构建含可编辑规格多行输入及skuDetails差量请求。提交前重新fetch后origin/main仍为0049c72；采用显式文件提交。生产真实商品改名尚未执行，不用发布替代真实业务验收。
