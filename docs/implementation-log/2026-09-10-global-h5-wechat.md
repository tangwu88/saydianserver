# 国际版 H5 与认证公众号登录

## 授权、基线与边界

- 用户要求公众号/H5 使用“赛电智能”，随后明确继续补齐并上线独立国际版 H5 登录。AppID 为 `wx7e7ce80930fa40f4`；原始 ID 仅作资料识别，不用于 OAuth。AppSecret 上轮通过后台加密保存，本轮不在源码、日志、前端或命令输出中写入。
- 用户已确认公众号“网页授权域名”`app.saydian.cn`设置并保存。平台开发者控制台受浏览器安全策略限制，没有绕过策略代操作；用户确认和真实手机授权回执分别记录。
- 修改前阅读 AGENTS、handoff 和最近健康/国际部署记录；`git status --short --branch`干净，`git fetch origin --prune`成功，国际分支本地与远端均为 `eafae65114a15447f90546dae996392d32bb5300`。
- 目标仍为独立国际数据库/API。国内 App、商城、数据库、微信 App/小程序、企微及支付配置不变。不迁移旧账号，不自动合并身份或资产，不把微信授权当作邮箱/手机号已验证。
- 服务端保留真实 verified gate：密码绑定限已验证的现有国际账号；新用户/未验证账号走独立用途的验证码核验。短信/邮件供应商缺失时显示未配置，不伪造验证码、验证时间或登录成功。

## 实现与发布路径

- 复用现有 `global-admin` 只读静态镜像发布独立 H5 树 `/global/saidian-mall/`，不新增容器/宿主端口/私网权限。商城构建单次注入国际 realm、base 和 `/global/api/saidian-mall/v1`；后台构建保持原样。
- 回调固定 `/global/saidian-mall/oauth/callback`，不使用 hash 回调、国内商城路径或 API URL。网关/静态回调关闭 access log、缓存和 Referer，前端处理一次性 state/verifier 并清理地址栏授权参数。
- 网关新增路由使用显式、幂等、有恢复副本的 `install-h5-route.mjs`；只添加国际 H5 路由，其他地址继续原处理，未发布国际路径继续404。脚本本身不重载Nginx；目标机检查通过后才 reload。
- 新 `GLOBAL_WECHAT_H5_ENABLED` 默认关闭；运行开启和 `wechat_official`资料启用独立于真实验证状态。Worker/回调处理/支付等原关闭开关继续保留。

## 命令与结果（持续补记）

- 只读服务器核对：已部署 revision 为 `eafae651...`，自动更新服务 `Result=success, ActiveState=inactive`，根盘40GB、剩余6.5GB；未执行清理。
- `node --test deploy/global/h5-deployment.test.mjs`：4/4通过，覆盖增量路由、国内/API字节保留、幂等、异常目标拒绝和独立运行开关。
- 初次 `node deploy/global/check.mjs` 因既有环境变量扫描正则不接受名称中的数字，将 H5 截断为 H 而失败；修正变量名称规则后173条通过。本机无Docker，真实Compose/Nginx解析留待目标机。
- API 定向105项通过；已有账号验证码绑定必须同时证明原密码，正确验证码配错误密码也计入5次封锁。首次核验撤销旧会话；国际商城未验证账号登录/刷新统一403，刷新前拒绝、不旋转旧App会话。国内行为不变。
- 前端15项测试通过；修正实际退出端点默认HTTP201与V2成功包裹的识别。国际/国内H5分别构建成功，核对资源和routerBase分别为`/global/saidian-mall/`、`/saidian-mall/`，国内购物车仍在。
- 根级串行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm api:docs:check`通过：805项测试通过，4项原有数据库集成测试因无测试数据库跳过，不能冒充已运行。312条路由契约重新生成并一致。构建仅既有Sass弃用与后台大chunk警告。
- `pnpm tools:test`9/9、部署结构检查173项、部署补丁测试4/4和`git diff --check`通过。再次fetch后远端仍为基线，没有覆盖或合并其他修改。
- 上线前复核、合成HTTP/浏览器验证、提交与线上版本：待完成，不能将本记录视为已发布或真实微信登录已通过。

## 明确未验收

- 微信手机内真实code兑换/登录回执；只有供应商真实成功调用才更新“已验证”。不对无效code发起伪造验证。
- 国际短信/邮件真实送达；当前供应商保持未配置，不因本轮开启公众号而同时启用。
- 交易、支付、退款、员工企微、真实健康AI报告及其他不属于本轮登录任务的外部能力。
