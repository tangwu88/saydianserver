# 统一服务端与一次构建发布

## 发布结构

`main → CI 检查 → API / Worker / Admin 各构建一次 → 实际镜像启动验收 → GHCR → digest 清单 → 受限 receiver → 数据验收`

仓库为 `tangwu88/saydianserver`。生产使用原 `saydian-global` 数据库、Redis、对象存储和密钥；保留 Compose 项目、服务与卷的物理名称，避免误建空库。名称中的 `global` 不再选择账号系统。

主入口为 `/admin/`、`/api/saydian-app/v2`、`/api/saydian-app/admin/v1`、`/api/saidian-mall/v1`。旧 `/global/api/*` 请求在同一 API 内部归一，不重定向 POST、不分流数据库。JWT issuer/audience 与签名密钥保持原值。

下载产品配置仍独立：`app_update`、`global_app_update`、`say_ring_app_update`。旧下载接口默认保留原产品身份；显式 `product=say-ring` 不变。客服使用当前生效的 `global_support`，后台显示统一运营界面。

原生微信统一走 `/api/saydian-app/v2/auth/wechat-login`，沿用现有供应商开关。此前未启用的旧小程序/旧原生登录不因合并自动打开，分别需要独立的 `WECHAT_MINI_LOGIN_ENABLED` / `LEGACY_WECHAT_APP_LOGIN_ENABLED=true`，本次不设置这些开关。

## 日常发布与失败重试

CI 验收成功后上传 `release-<完整 SHA>`，包含三个镜像的 registry digest、runtime image ID、大小和全部迁移 SQL 的 SHA-256。CI、导出和生产统一使用 containerd image store；单平台 manifest ID 必须等于 registry digest，禁止把 classic store 的 config ID 当作生产 ID。部署任务只下载该清单，不编译源码。

重试使用 `Deploy production`，填写同一最新 main SHA。它查找该提交成功的 CI `verify` job 并复用原 artifact。不要为了重试部署而重跑镜像构建任务。

receiver 与首次切换共用 `/opt/saydianapp-server/deploy/.ci-release.lock`。Actions 不取消正在执行的生产切换；预拉取总预算为 20 分钟。拉取失败或提交过期时不重启应用。

只允许 `deploy/compatible-migrations.json` 中逐份 SQL 校验值已审阅的新增迁移自动执行。任何历史 SQL 校验值变化、未完成迁移或未审核待执行迁移均阻止发布。Prisma 单独以已有数据库 owner 执行；应用始终用原 app 用户启动，不运行 seed。

若 GHCR 网络失败，可使用 `Export runtime images` 导出同一 CI 清单的镜像，勾选 `upload_to_server` 后通过既有受限 receiver 分块传输。传输与发布共用锁；每块、完整压缩包、原清单及导入后的 image ID/revision 均验证，不重启应用。随后同 SHA 手动部署勾选 `offline_images`（首次切换仍需 `first_cutover`）。不能用重新构建的同名 tag 代替。

离线传输单块不超过 8 MiB，保留 receiver 的 10 MiB 上限；服务器需满足暂存包、镜像及额外 5 GiB 的容量门槛。成功导入后仅清理本次传输产生的包和分块，在 root-only `deploy/unified/offline/<SHA>/<archive hash>` 保留清单、校验值和导入记录。可从 GHCR 或原导出 artifact 重新取得镜像；原业务文件、数据库备份和旧镜像不自动清理。

仓库变量 `PRODUCTION_IMAGE_TRANSPORT=ssh` 可让日常自动发布在 Actions 中拉取原 digest，经受限 receiver 预装后再执行同一部署脚本，预装总超时 20 分钟。缺省 `ghcr` 则由服务器直接拉取；非法取值停止发布。两种传输不改变构建产物、迁移/最新提交检查或首次切换门禁。尚未完成首次验收时保持 `AUTO_DEPLOY_ENABLED=false`。

安装包与链接通过后台编辑和上传；旧 `package_only` 源码发布入口已删除，已有只读版本化安装包继续保留。

## 首次切换

只有手动 `Deploy production` 的 `first_cutover=true` 能初始化；普通自动发布在缺少验收状态时停止，不自动启动迁移窗口。

1. 确认旧分支定时发布及当前发布进程已停止；检查实际运行配置、保留密钥、原数据库和共享网关。
2. 磁盘门槛包含三个新镜像、数据库恢复/备份、现存对象/头像文件估算及额外 5 GiB。只检查，不清理业务文件或扩容。
3. 两库分别用同一个导出快照生成备份和全表摘要；恢复到无网络、无端口的临时 PostgreSQL 容器，核对所有表记录数/内容摘要及外键。记录演练耗时，结束删除的仅为本次创建的临时容器及匿名卷。
4. 网关临时冻结全部业务 API（包括可能创建兼容编号的 GET），仅放行健康检查、静态页和已验签支付回调；停止旧 Worker 并暂停业务写入。原生 App 新回调在旧镜像维护期间若返回 503，不能当作已接收，供应商需重试；新镜像支持其持久接收。禁止默认启动命令中的旧 seed；确认旧国内业务库仍为空，无执行中的 Outbox/ERP 任务，账号联系方式已归一。
5. 冻结后再次完成一致备份/恢复校验，保存对象存储和头像归档及 SHA-256。只向统一库导入缺失的下载/客服配置，同名值以统一库为准，差异保存在 root-only 备份目录。
6. 应用兼容迁移，以停写状态启动三个已验收镜像，备份并修改本域名的托管网关块。Nginx 语法校验后 reload；其他域名不变。
7. 检查双地址 revision、页面、容器 image ID、切换前后数据摘要。会员、密码哈希、设备、健康、订单金额、角色与供应商配置不得改变；已有回调 ID 不得丢失。
8. 明确标记恢复写入边界，再恢复切换前原有开关。验收成功写入 `deploy/unified/accepted.json`；停止旧应用容器，保留旧数据库、Redis、卷、原配置及全部备份。

`deploy/unified/compose.json` 是解析过的保留生产配置，包含敏感值，只能留在服务器 root-only 目录，不能上传 Git、工单或聊天。备份也不得打入交接包。

回调未持久化成功时不得返回成功确认。支付宝会重发未收到 `success` 的异步通知，见[官方说明](https://global.alipay.com/developer/helpcenter/detail?_route=sg&categoryId=67617&knowId=201602452303&sceneCode=AC_DEV)；切换后仍应核对待确认支付与回调记录，不能仅凭重试机制宣称没有丢单。

## 回退边界

恢复写入前失败：恢复原镜像、原路由与原开关；兼容新增列不删除，不用备份覆盖现库。网关失败也按原文件恢复并重新检测/reload。

首次重试仍使用 `first_cutover=true`；脚本支持回退容器指向的已验证私有配置快照，必须与当前 image 一致。公网双健康地址在热重载后有最多 15 次、60 秒预算的收敛检查，持续错误仍失败回退，并记录失败路径与脚本行号。

首次恢复写入后失败：脚本不再返回原国内路由，也不恢复数据库。`writes-opened.json` 标记边界；需向前修复或在同一统一库上部署兼容镜像。

后续日常发布失败：仅回到已记录的旧 image ID 和原配置，不回滚数据。自动回退后仍必须检查健康状态；不能把“已尝试回退”写成“回退已验收”。

## 验收与当前状态

本次实施从 main `61510db9d1ce4c4c2ff0dea5b909bf2c20c119a1` 合并国际分支 `6ea9dd9de91c3f27a452efc1a23ad2f77e88a1b5`，保留设备连接、原始上报、会员设备、健康日汇总和 Say Ring 法律/支付配置。

本文件记录实现方式，不是上线证明。上线完成必须同时具备 Actions 成功、两条生产 health 的相同 revision、实际功能验收和服务器私有验收记录。实施进展见本轮日志；未满足前保持“待验收”。
