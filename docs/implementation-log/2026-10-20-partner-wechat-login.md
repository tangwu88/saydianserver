# 品牌伙伴平台微信内登录跳转修复

## 请求、基线与范围

- 用户反馈微信内打开 https://app.saydian.cn/vip/ 会自动进入商城“申请合作伙伴 / 先登录商城会员”，已有合作账号无法停留登录。
- 原工作树 E:/saydian h5 在e22b7f9且有既有未提交文档，完整保留；status/remotes/fetch后origin/main为3ac375e6817baf14985b36fdf5397dbe91629d31。创建隔离工作树 E:/saydian-partner-wechat-login-20261020、分支codex/partner-wechat-login-20261020，初始HEAD与远端一致。
- 已读AGENTS、当前handoff、最近零库存导入/手机结算和伙伴授权交接记录。Start/Publish限定main，而main由其他工作树占用，采用显式文件的独立分支提交与PR/CI；不覆盖旧工作区，不强推。Git使用单次openssl/系统本地代理参数，不改全局配置。
- 仅H5伙伴前端及商城H5返回入口；无后端鉴权/账户绑定/协议/资金改动、迁移、生产数据试写或原生App改动。

## 原因与调整

- Login.vue原onMounted在MicroMessenger环境无条件调用会员桥接（仅password=1可避开），导致/vip/跳/login后立即离开账号密码页面。移除UA自动跳转，保留用户主动选择“商城会员登录 / 申请合作”。
- 主动商城登录使用共用busy保护，避免重复生成PKCE并覆盖当前verifier；存储失败后恢复账号密码入口并提示。
- 商城合作申请/账户状态页增加H5限定的“已有合作账号？使用账号密码登录”，保留白名单next返回路径。
- 会员回调过期/兑换失败时提供重新发起PKCE的member-start入口，以及安全next的账号密码登录入口；继续先清除fragment、一次性消费verifier，不自动循环授权。
- 原商城授权、手机号核验、合作账户明确绑定、启用状态和合作协议门禁继续由既有流程校验。

## 验证与发布安排

- 微信UA只读GET线上/vip/和/vip/login均200且最终URL不变，证实HTTP没有把伙伴页重定向到商城；现网readiness为3ac375e，ready/database ok。web阅读工具无法打开此页面，改用只读HTTP，不模拟真实微信授权、短信、账户或支付。
- 新增行为回归：iPhone/Android微信与桌面打开登录页均不自动跳转、账号密码成功/失败、安全返回、主动商城授权及去重、过期/失败回调的两种恢复、成功回调继续原伙伴页面、商城返回入口拒绝外部/后台next。
- corepack pnpm install --offline --frozen-lockfile及db:generate成功。初次伙伴前端65项通过，随后补充成功回调一项；完整串行typecheck/test/build/api:docs:check/tools:test及diff检查结果续记。
- 发布限中国站（[deploy cn only]）。主分支verify通过后，只在SSH接收步骤尚未开始时停止普通下载路径，再导出同修订原始已验证镜像、HTTPS导入并offline_images发布；不改仓库发布变量或生产维护/只读等开关，不取消已运行接收器。须核对Actions、双readiness及实际伙伴登录/商城H5资源，才确认上线。
- 本地脚本与HTTP验收不等同于手机微信真机登录/真实OAuth验收；发布后用户使用自己的已开通账号核验。
## 本地执行结果

- 串行corepack pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check、pnpm tools:test均退出0；git diff --check通过。API1281通过/36个本地数据库用例跳过，伙伴前端66通过（本轮新增11项），商城181、后台245通过；真实PG与镜像验收交给CI。
- 初步构建资源读取碰到tools:test重建全局H5导致旧hash文件消失；等待所有串行门禁结束后按实际文件解析。Windows不区分大小写的Login-*通配符曾选中login-bridge，改用区分大小写的Login组件文件确认：账号登录说明、主动会员按钮均存在，组件内不含micromessenger自动跳转逻辑；回调恢复和商城返回文案均存在。
- 发布前再次fetch成功，HEAD/origin/main均3ac375e6817baf14985b36fdf5397dbe91629d31；提交仅包含三处H5视图、登录回归测试及本实施日志。构建产物和发布回执保持ignored，不提交密钥或生产资料。
