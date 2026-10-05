# Say Ring 当前已发布政策公开页

## 范围与证据

- Say Ring 任务本轮用户请求按苹果审核意见更新构建、说明并提交审核；本服务端配合只修正其公开隐私/协议页面。用户本轮消息已从原任务独立读取，不以网页文字或转发声明代替请求。
- 编辑前安全同步 main，基线 `a9a884a6b74eaf5a3a60d82f4214ef7452f60f92`。双 readiness 为该版本，原 `/say-ring/privacy` 和 `/say-ring/terms` 确为“iOS 本机使用版 v1”，含不提供登录/云同步等过时文字。
- 原公开能力和 JSON 文档读回：Say Ring 当前同意版本 `say-ring-cn-2026-10-02-v2`，`say_ring_privacy_policy` 与 `say_ring_user_agreement` 同版本、reviewed/active=true；已列处理者 Xuewu Tang、kf@saydian.com、游客/账号隔离、共用账号服务、设备/健康云端处理及注销边界。
- `say_ring_sleep_analysis` 的 `say-ring-sleep-ai-2026-10-03-v1` 已核对并发布，明确可选且逐次单独确认，仅发送睡眠汇总，不发送原始逐段时间轴和身份/设备地址；已告知智谱 BigModel、风险、撤回和删除区别。主政策未具体列该功能，因此公开隐私页另展示此已发布独立说明，不擅改或重新批准主政策。
- [苹果 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing) 要求第三方 AI 数据共享明确告知和事先明确许可。这里只展示已发布内容，不代替 App 授权、律师审查或苹果审核通过。

## 实现与安全边界

- 增加只读 HTML 渲染端点。固定产品 Say Ring，优先 zh-Hans；复用 App 相同的已审、激活、到期发布、同版本文档对选择，无有效文档返回 503，不回退 Health/旧本机政策。
- 两个公开地址通过 Admin 内部代理读取实时 HTML，不依赖 JavaScript 或保存第二份正文；JSON 法律接口和账号功能不改。后续后台合法发布将即时反映到公开页，no-store。
- 隐私页把独立睡眠说明放在单独 section，并标明自身类型和版本。只读展示不会接受/撤回同意，不触发生成或第三方传输。
- 使用固定版本 sanitize-html 清除执行内容、脚本/事件/第三方资源及非法链接；安全转义标题/版本，CSP 禁止脚本、表单和嵌套页面。保留已发布正文的文本和合法格式。
- 删除两份静态页中的过时政策正文，保留历史 HTML 文件地址为指向当前页面的精简兼容入口。未修改原始资料、其他产品静态页、下载包/配置、登录开关、schema、账号/健康记录、App Store 或云权限。
- 新渲染依赖要求自己的 PostCSS ^8.5.27，锁定 8.5.28；原应用依赖仍保留原 8.5.26，避免无关应用升级。前三次锁文件 patch 因重复键/上下文顺序失败，未写入。首次撤回既有依赖升级只覆盖单行差异，frozen 检查发现多行快照仍指向新 peer；未提交，pnpm 重新解析修复后按所有 peer/依赖引用统一撤回。最终 frozen-lockfile 退出 0，只新增本轮依赖，不把安全库降至不兼容版本。

## 运动地图披露核查（不操作轨迹、开关或权限）

- 当前已发布 v2 政策只提使用相应功能时取得系统定位权限，没有明确提到服务器转发坐标、高德服务与该第三方的规则。该缺口须由政策内容更新补齐，页面同步本身不能替代补齐，也不新增“位置绝不上云”文字。
- 只读源码链路为带用户鉴权的 `POST /support/sport-route-map` → `parseSportRoute` 校验 2–80 个点 → `renderAmapSportRoute`。经纬度保留到小数点后六位，最多 40 点一批发送至 `https://restapi.amap.com/v3/assistant/coordinate/convert`，转换后轨迹交给 `https://restapi.amap.com/v3/staticmap` 绘制。本链路不是仅在本机画图。
- 第三方请求包含坐标/路线、服务 Key 和服务端网络信息；该函数不传 App 账号 ID、邮箱、手机号、设备 UUID/MAC 或用户会话。没有读取任何真实轨迹、Key 或请求日志。
- 该处理函数只在内存保存坐标、转换结果和图片 Buffer，不写数据库、对象存储或轨迹文件。控制器返回 no-store；这仅是响应缓存限制，不能据此声称所有系统/供应商零留存。
- App bootstrap 为 JSON 请求保留 rawBody 在请求内存中；请求 ID 中间件没有记录 body。此接口未配置专属轨迹审计写入；源码错误消息不打印坐标 URL 或 Key。Nginx 通用访问日志可能保留客户端地址、请求路径、状态等元数据，其实际主机规则/轮替未现场核验；POST body 不在模板自定义日志中。第三方可能在其系统留存处理信息，不作未证实的时间/零留存承诺。
- 已查阅[高德开放平台现行隐私政策](https://lbs.amap.com/pages/privacy/)（页面标注 2026-09-09 更新/2026-09-16 生效），附录确认提供者为北京高德图强科技有限公司。只根据实际 Web 服务链路描述范围，不把 SDK 的全部字段套到该请求。生产/供应商实际留存期限尚未现场核实，不编造固定时间或零留存。

## 验证与发布门禁

- 定向 API 22/22、公开路由 5/5 已通过，覆盖文档缺失/未审/未激活/未来发布/版本不匹配、产品隔离、发布变化、安全渲染、睡眠说明及原 JSON 包裹不变。
- 增加 HTTP 隔离 CI 夹具，验证真实控制器返回无登录 HTML、no-store、独立说明和后台正文更新。脚本仅允许 loopback/test 数据库，finally 只删除本次唯一版本夹具；未对生产运行。
- 全量接口目录、工具、类型、测试和构建由显式发布工具串行检查，结果随后追加。真实数据库/镜像启动与部署以 Actions 回执另验；本地未作 Docker 构建，不将单测冒充线上成功。
- 自动流程：main → CI 构建一次 → 原 GHCR digest → 生产同锁发布；不切换传输方式，不现场编译。上线后核对双 readiness、公开 HTML 与后台正文、独立说明及其他产品路由/清单不变，公开页未真实上线前不宣称完成。
- 新补充的运动地图披露缺口单独核查，未伪造供应商留存承诺或在本次页面展示中激活未审法律文档。

- 2026-10-05T03:23:53.2681110Z：pnpm api:docs:check，退出码 0。

- 2026-10-05T03:24:30.4342690Z：pnpm tools:test，退出码 0。

- 2026-10-05T03:24:41.9000720Z：pnpm typecheck，退出码 0。

- 2026-10-05T03:25:10.2376730Z：pnpm test，退出码 0。

- 2026-10-05T03:25:35.7844230Z：pnpm build，退出码 0。

## 后续授权、配置与未审核草稿（2026-10-05）

- 独立读取原 Say Ring 任务的人类消息：`01a0fceb-6b84-7ba3-bb7d-ab4f46661303` 要求“增加和编写戒指的隐私政策和用户协议”；`01a0f8d7-cf59-7e02-b773-9812f98660cb` 明确允许为审核整改简化不利功能。最新人类消息要求按拒审意见更新构建/说明并重提。其他任务的转发只作为检索线索，不作为新权限或法律审核证明。
- 03:30 与 03:38 UTC 独立公开 GET `support/sport-map-config` 均为 `provider=amap, configured=false`。未配置时在调用第三方之前拒绝，不发送测试坐标、不打开地图配置。新条款按“已配置、主动选择并取得单独授权”描述可选链路，不声称当前已开启。
- 通用 AI 与睡眠分析不是同一上传流程。源码 `ContentService.sendAiMessage` 校验最多 4,000 字符，先读取 AI 配置；已配置时按账号保存会话和本次用户文本，再调用 `/chat/completions`，成功后保存回复。发送给第三方的 messages 只有系统提示和本次提问，不自动附带历史对话或健康库；用户自己输入的身份/健康文字仍会发送，不能说已匿名化。请求失败也可能留下已保存的提问。
- 只读后台 AI 公开配置确认 `https://open.bigmodel.cn/api/paas/v4` 与 `glm-5.3-flash`；未读取或修改加密凭证，未调用第三方，未读取真实对话。智谱政策链接本轮浏览读取超时，沿用已发布独立说明中的官方链接，不据此追加供应商留存/训练保证。
- 通用 AI 控制器与 legacy 入口仅有用户鉴权，没有单独第三方 AI 同意检查或可信产品字段。共享 JWT、UserSession、AuthenticatedUser 均不保存产品身份。不能根据共享会员是否曾使用 Say Ring 或客户端可伪造字段硬拒绝，否则会影响 Health；本轮没有为赶审核修改账号、令牌或 schema。
- 根据已核实的简化授权，03:37:55.530 UTC 在原后台会话仅保存 `say_ring_app_display`：`hideAi=true, sleepAiEnabled=true, public=true`。独立公开接口读回一致。未更改 AI/地图提供者、密钥、另外产品、下载清单；没有删除报告、对话或健康数据。
- App 源码的首页/个人页及通用 AI 页面遵守 hideAi，已打开页面由 AiContentGate 收回，发送入口也拒绝；服务端睡眠 availability 只读取独立 sleepAiEnabled，不受 hideAi 影响。产品显示开关不是服务端安全隔离，离线客户端仍可能保持之前缓存；真机前台刷新和入口/授权验收由 App 任务执行，本服务端没有冒充完成。
- 后台新增中文同版本 `say-ring-cn-2026-10-05-v3` 隐私与用户协议草稿，两个均 `reviewed=false, active=false`，03:35:56.312 与 03:37:09.957 UTC 可见。正文增加已配置可选地图、通用 AI 自由文本和独立睡眠汇总差异；旧已审 v2、旧版本、独立睡眠说明均保留。不得把这些新草稿标为“法律审核完成”，启用前还需事实/法律审核及客户端单独授权验收。
- 草稿正文位于 `docs/legal/say-ring-privacy-20261005.zh-Hans.html` 和 `say-ring-terms-20261005.zh-Hans.html`，只作内容交接，不是 seed/migration，不会随部署激活。浏览器 HTML 粘贴变成文字，未保存错误内容；改用编辑器分段输入，保留全文与官方地址后才保存。后台排版与源片段不同，不把 HTML 字节相同作为验收。
- 原 source 与 ZIP 只读。追加通用 AI 本地 patch 首次漏了每行 + 前缀被拒绝，未写入；修复后文件正常。Element Plus 开关的 setChecked 未改变状态，读取确认后改为可见 AX 开关点击，保存后再次读回双值。
- 定向回归 `support-public-config`、`sleep-reports`、`say-ring-legal-page` 51/51 通过；此前 feature 全量本地门禁及 frozen-lockfile 均通过。实际 Docker/数据库/部署与线上正文结果在下面追加。

## 自动发布阶段核查

- 功能提交 `60178a23a5bfa4ae5f685abc90141967c8492e4e` 已推送；[Actions 37259398854](https://github.com/tangwu88/saydianserver/actions/runs/37259398854) 的 verify 与 auto-deploy/resolve 已成功，实际数据库、HTTP 契约、镜像启动验收由该 CI 完成。03:37:31 UTC 进入生产 receiver。
- 03:45 UTC 从 GitHub 实时可见日志独立读取：03:37:38 完成 registry login 和 preflight，`requiredBytes=7291034697, pending=[]`。取得锁失败会立即报错退出，此处已通过；后续源码步骤为 compose 校验和 `docker pull --quiet`（总预算 3,600 秒），无备份/切换/健康检查输出。由日志和源码定位仍处于切换前静默拉取阶段，未把“in_progress”冒充成功，亦未取消/覆盖正在运行的发布。
- 未完成 job 的完整日志 API 返回 404，改用现有 GitHub 会话读取实时日志；腾讯云页面当前无已认证终端，未绕过登录、请求新权限或读取凭证。没有主机进程/分层下载速率证据，因此不宣称具体拉取百分比或网络故障。新增交接文档暂不推送，以免 main 更新使该发布在切换前被过期检查拒绝。
- 从该 CI 下载不可变 release manifest 并运行 `release-manifest.mjs verify`，退出 0；三个原始镜像 digest 分别为 API `174b823aa4c8e0e0d23abffbdb7b38f63dfabdc58e972536ce245e07b427349b`、Worker `dc790460144dd75067d3deeb9b2562c522b8a56e14b7a1876c160f16610aa808`、Admin `5eff008956b3868a868650a185efcc9f03eb5244beaf7d3f64e1499840202303`，没有改用现场重建或新产物。
- 等待期间以构建后的同一 renderer 和公开正式 JSON 创建仅监听 127.0.0.1 的内存预览。隐私/协议在 375px 宽度下 scrollWidth 均为 375，无横向溢出；隐私包含 v2 和独立睡眠说明两个不同版本，脚本数量 0，截图目视正常。此为本地排版检查，不是公网验收；检查后已恢复浏览器默认尺寸、关闭预览页和临时 HTTP 进程，不写源文件或业务数据。
- 04:05 UTC 刷新并展开实时日志，确认 API 镜像于 03:58:30 UTC 拉取完成，输出 ref 与发布清单的 API digest 完全一致；进入后续镜像步骤，而不是锁等待。静默拉取与未展开的实时日志不支持百分比/速率推断。本轮没有因耗时而取消当前发布、触发并发部署或改用镜像归档。

## 线上验收（2026-10-05）

- 功能提交 `60178a23a5bfa4ae5f685abc90141967c8492e4e` 的 Actions 37259398854 全部成功，生产于 04:29:26 UTC 报告 Unified release verified，约 52 分钟的部署作业在 60 分钟内完成。没有重复触发、归档传输或服务器编译；新主机认证不是本次成功的前提。
- 部署输出确认 21 份迁移已是最新、无待执行迁移；只替换统一 API、Worker、Admin，API Healthy、Worker Started，Nginx 检测/reload 成功，保留既有业务开关。原始生产备份留在 root-only `deploy/unified/backups/20261005T042856Z-60178a23a5bf-31795`，未读出内容、上传或用备份覆盖业务数据。
- 04:30 UTC 独立无凭证 GET `/health/ready`、`/global/health/ready` 均 200/ready/database=ok/revision=上述提交。`/say-ring/privacy`、`/say-ring/terms` 均为 200、`text/html; charset=utf-8`、no-store，无脚本；HTML 与同一公开 JSON 通过构建后 renderer 生成的正文逐字一致，不是只检查标题。
- 主政策/协议实际为 `say-ring-cn-2026-10-02-v2`；隐私页另含 `say-ring-sleep-ai-2026-10-03-v1` 独立 section。隐私 HTML SHA-256 `828c3471876a9c1f3dd2e15d5fee0d56acbacd759616e97c4e2358731870a6a4`，协议 `7d79e84617b876a76f499e2a766b4a3e71f65402731a0f46de5b349fd18f8a8c`。未来后台合法发布会改变正文/哈希，这是预期，不以此历史值取代当前核查。
- `/admin/`、`/down`、`/down2`、`/say-ring`、`/saidian-mall/`、Health 政策/协议及两份旧 HTML 地址全部 200；旧文件包含跳到当前正式页的 meta refresh。保护的三份下载清单、Health 四页和三个旧 `/global/api/` 法律 JSON 共 10 项与切换前快照逐项一致。
- 浏览器实际打开公开页，确认游客本机/账号云端真实边界、共用账号及联系方式；页内隐私/协议链接往返正常，独立睡眠说明及版本可见。截图位于本机临时证据目录，不把后台会话、凭证、真实健康数据或截图二进制提交 Git。
- 新 v3 仍只作未审核、未启用草稿；没有将本轮部署当成法律审核或苹果审核通过。通用 AI 的显示开关不是服务端产品级硬隔离；客户端构建/真机/授权及供应商实测仍须由 App 任务独立验收。
- 交接文档与两份草稿源文件随后通过同一显式发布工具推送。该文档提交仍会触发流水线，接手必须以最新 main、Actions 与双 readiness 核对，不将本节功能验收 SHA 当作永久最新。

- 2026-10-05T04:34:17.8951230Z：pnpm api:docs:check，退出码 0。

- 2026-10-05T04:34:51.3775010Z：pnpm tools:test，退出码 0。

- 2026-10-05T04:34:59.4465150Z：pnpm typecheck，退出码 0。

- 2026-10-05T04:35:16.2138790Z：pnpm test，退出码 0。

- 2026-10-05T04:35:28.6028900Z：pnpm build，退出码 0。
