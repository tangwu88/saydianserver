# 发布加速与三个 App 安装包入口

## 授权、同步与范围

- 用户要求按建议处理上线耗时；随后明确“没有，先完成其余加速”，本轮不采购、创建或启用腾讯云 TCR，不修改 DNS、供应商或共享系统。
- 原工作区与前轮独立分支保留。2026-10-06 git fetch 恢复连接，在干净的 E:/saydian-support-publish-20260930 main 上执行 tools/Start-Change.ps1，安全快进检查通过。本地与 origin/main 均为 dc4ca3fddc00a665a19ee65962c5f61f4a218dac。
- 前轮已验证的安装包上传源码及实施记录通过 git diff --binary / git apply 显式转入 main；未覆盖原工作区法律/图标资料。
- 公开 readiness 现场读回 ready/revision=上述基线。无凭据 GitHub API 查询遭共享出口限流，未声称取得最新 Actions 耗时。

## 加速实现

- component-cache.mjs 对每个组件实际构建输入计算 SHA-256；文件名、内容、删除、锁文件、共享契约、Dockerfile、构建/发布规则变化均使相关缓存失效。后台独有源码变化不使 API/Worker 源码缓存失效；Prisma 变化同时使 API/Worker 失效。
- 只在受信任的 main push 尝试复用私有 GHCR 的 input-摘要镜像；核对摘要标签、仓库 digest、linux/amd64、完整版本标识。PR 不使用生产组件缓存；缓存缺失、失败或身份不符回退完整构建。
- 复用镜像时 FROM 固定 digest，仅更新当前发布 SHA 和构建输入标签，保留完全相同的文件层，不重新安装依赖或编译无变化源码。仍使用现有三镜像不可变发布清单及原 CI 类型、测试、数据库、HTTP、真实镜像验收；不伪造旧镜像为新源码。
- 全部镜像真实 smoke 成功后才发布组件缓存；可选缓存写入失败不阻断已验证正式版本。缓存读取/写入均有 45 秒上限。
- 生产本地已有完整匹配的 digest/imageId 时跳过 docker pull；仍核对 revision 标签并运行备份、迁移检查、完整版本/readiness/页面验收和回滚。每个组件输出拉取/验证耗时，不改维护或写入开关。
- 首次发布会建立缓存，首次不能据此承诺显著提速；后续命中才复用。国内 GHCR 网络仍可能慢，国内仓库被用户延后，未承诺十几分钟内上线。

## 修复 Windows 发布检查

- 原部署/离线传输夹具依赖 Linux shebang、路径和 chmod，Windows 原有 7 项失败使显式发布工具无法运行。新增仅测试使用的 shell-test-fixture 工具：通过 Git Bash 调用 Node 命令替身，明确路径转换，隔离 Windows install 权限模拟；Linux 仍使用真实 install。
- Windows 本机缺少 jq；从 jq 官方下载页获取 jq 1.8.2 便携二进制，仅放 artifacts/toolchain，不安装到系统、不提交。SHA-256 与官方清单一致：a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627。测试指定 SAYDIAN_JQ，使用真实 jq 并关闭 Windows CRLF 转换。
- 头像原有 3 项失败定位为 Windows 不支持目录句柄 fsync，而非安装包上传。本轮只在测试中对 Windows 目录 sync 作兼容替身，真实文件写入、读取、摘要与失败回滚继续测试；生产源码不变，Linux CI 仍测试真实目录 sync。定向 8/8 通过。
- 首次跨平台夹具修复发现 PATH 与 MSYS 参数/环境自动转换，以及缺少 jq；随后修复，日志位于本机临时文件。新增缓存命中与拉取失败测试，避免优化使失败分支测试失效。

## 验证与未验收

### 后续：稳定依赖层拆分

- 功能提交 679c18a84d0200ab57aac9a1556303879c7e2233 已通过完整本地检查并推送；CI 37438622065 的 verify 于 08:58:32 UTC 成功，耗时约 9 分 45 秒，生产发布仍须另验。
- 进一步将 API/Worker Dockerfile 拆为 dependencies 与 build 阶段：锁文件、共享包、schema 变化时重新打包依赖；业务源码随后编译。runtime 的 node_modules/package/prisma 来自稳定 dependencies 阶段，dist 来自 build；防止业务源码变化使整层依赖重打包、重传。
- 后续同步曾发生连接重置/空回复。第一次同步尚在 fetch 时已开始编辑 Dockerfiles，未覆盖任何其他改动；随后保留这三项已审阅改动，重跑 Start-Change.ps1 -Resume。
- 通过当前 Google DNS-over-HTTPS 查询得到 github.com 的另一官方解析地址，仅对本次 Git 进程使用 curloptResolve 和 userAgent 参数，保持 HTTPS 主机名/证书校验；没有修改系统、生产或外部 DNS，没有落盘代理/凭据配置。最终 fetch 成功，-Resume 确认 HEAD 与 origin/main 均为 679c18a，重新建立检查点。
- 一次日志 patch 的时间戳上下文不匹配，被拒绝且未修改文件；改用实际章节上下文记录。
- 在 artifacts 中建立仅含 package/锁文件、共享包和 schema、没有 API/Worker 业务源码及 dist 的独立 workspace，offline frozen 安装、共享包构建、Prisma 生成、两个 pnpm deploy --prod 均成功，证明稳定依赖可以先于业务源码打包；真实 Linux Docker/镜像启动仍须 CI 验收。


- 组件输入/缓存身份定向测试 3/3 通过；完整结果与发布工具命令结果随后追加。
- node --test tools/tooling.test.mjs：51/51 通过，覆盖原 47 项工具/部署/离线传输、安全 Git 检查和本轮缓存/本地镜像跳过测试；没有将失败测试设为跳过。
- CI YAML 经已安装 yaml 库解析通过；pnpm db:generate 通过。接口未新增路径，前轮安装包说明的生成目录保持一致。
- 通过已有 Git 凭据仅在进程内获取 GitHub API 授权，未输出/落盘凭据；已读回基线 Deploy production 37436336423 success，线上 revision=基线。临时查询工具仅在 artifacts，不提交。
- 必须以成功 CI 和线上 revision 核对部署；尚未完成前不写“已上线”或声称实际提速比例。无本地 Docker，真实镜像复用与生产耗时仍由 CI/生产验收。

- 2026-10-06T08:44:47.9809075Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T08:46:43.0788648Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-06T08:47:03.5993163Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-06T08:48:01.4002265Z：pnpm.cmd test，退出码 0。

- 2026-10-06T08:48:35.5233864Z：pnpm.cmd build，退出码 0。

- 2026-10-06T09:12:06.6419955Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T09:13:40.1774862Z：pnpm.cmd tools:test，退出码 1。
- 后续全量检查发现原 Docker 层检查仍断言旧 dist 来源；更新 tools/tooling.test.mjs，明确依赖打包在业务源码 COPY 之前、runtime 依赖来自 dependencies 而 dist 来自 build。失败未提交，修复后重新执行完整门禁。

- 2026-10-06T09:14:39.6357176Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T09:16:31.5866443Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-06T09:16:51.4309480Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-06T09:17:43.0503083Z：pnpm.cmd test，退出码 0。

- 2026-10-06T09:18:14.9502194Z：pnpm.cmd build，退出码 0。
- 403c195 的 CI 37442031506：三份 Linux 镜像构建与 API 实际镜像登录/会员/设备/健康/订单兼容检查成功；前端 curl | grep -q 在 pipefail 下因提前关闭管道返回 23，阻断发布。tools/smoke-runtime-images.sh 改用读取完整响应的 grep，保留 HTTP 错误和 HTML 内容门禁；重新执行完整检查及 CI。

- 2026-10-06T09:29:44.4441357Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T09:31:31.8255725Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-06T09:31:50.3468718Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-06T09:32:40.5636809Z：pnpm.cmd test，退出码 0。

- 2026-10-06T09:33:10.9034726Z：pnpm.cmd build，退出码 0。

- 2026-10-06T09:37:11.7975792Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-06T09:38:58.6851236Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-06T09:39:17.2033204Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-06T09:40:06.9705278Z：pnpm.cmd test，退出码 0。

- 2026-10-06T09:40:37.3902536Z：pnpm.cmd build，退出码 0。
