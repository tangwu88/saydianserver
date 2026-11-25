# Say Ring 新账号首次读取摘要 V3

## 原因、授权与范围

- 用户明确选择“维持原规则，仅增强新账号首次摘要”。没有为会员780、764或其他旧账号开放补采；原首次报告不可改写，重连、解绑、重新安装均不能重新取得采集资格。仅允许失败时补传同一份冻结内容。
- Android1317客户首次摘要仅能证明首轮读取0条，无法追溯逐指标回包、解码过滤和校时观察。本轮增强未来新账号首连证据，不宣称客户持续无数据已修复。
- 新字段只含固定枚举、限幅计数和真实读过的监测开关；没有健康数值、测量时间、原始蓝牙包、地址、记录ID、凭据或任意错误文字。报告仍限制4096字节，不新增数据库结构或诊断消费端入口。

## 基线及工作区

- 原 E:/saydian h5 工作区有用户未提交改动且不在main，完整保留。status/remote/fetch 后 origin/main 为9e9efcac7f0b05bbf6c4d9340a713875c6e9daed。
- 阅读AGENTS.md、docs/handoff.md及最近实施记录；从相同基线创建独立worktree E:/say-ring-first-read-evidence-20261125、codex/first-read-evidence-20261125。
- Start-Change/Publish-Change要求当前分支名main；main已由其他worktree占用。本轮保留原目录和分支，手动执行等价的基线、串行检查、重新fetch、明确文件暂存及日志门禁，不改工具、不覆盖用户改动、不强推。

## 修改

- API保留V1/V2，明确协商acceptedSchemaVersions=[1,2,3]；仅V3 first_connection可带readEvidence，严格递归拒绝未知字段、重复指标、越界计数和伪造校时成功。预约、首次资格、不可变存储、去重、账号隔离均沿用原实现。
- 分项信息为请求次数、数据包次数、包声明条目数、已观察解码条目数、映射记录数、映射过滤数与范围状态。计数可能包含重复；没有观察映射的指标在后台显示“未观察”，不解释成0或戒指没有历史。
- 校时只展示收到时间格式、待发送/已尝试/过期等已有状态；无读回核验时明确未核验，发送不是ACK。没有额外戒指指令。
- 后台会员首次连接对话框新增中文分项表格、校时说明和已读监测设置，旧摘要照常展示。
- 同步API指南、生成接口目录与共享contracts；没有迁移、seed、会员健康写入或配置开关调整。

## 命令与结果

- pnpm install --offline --frozen-lockfile、pnpm db:generate：成功。
- API定向65项通过；后台定向12项通过（重复最终8项亦通过）。
- 串行pnpm api:docs:check、pnpm typecheck、pnpm test、pnpm build：全部通过。API全量1685通过、107项实际数据库依赖用例在本机按原规则跳过；不将跳过称为数据库验收。
- pnpm tools:test：最终部署工具59项、H5流程62项、H5契约38项均通过。前三次保留失败：Windows Git Bash路径自动转换、缺少jq、MSYS_NO_PATHCONV导致jq文件参数未转换。仅修复本机测试环境，未改部署脚本或测试断言。
- 从jqlang/jq官方jq-1.8.1下载Windows工具，并核对官方sha256sum；放Git外输出目录。最终SAYDIAN_JQ指向该工具，Git usr/bin在PATH，移除MSYS_NO_PATHCONV；由现有测试夹具处理路径转换。
- git diff --check通过。日志及原始测试结果在Git外E:/SayRing-first-read-evidence-1321-20261125/server-*.log。

## 未验收和发布边界

- 本机无客户手机/同型号故障实体复现；未重新初始化戒指、换号、触发测量或读取客户健康数值。原客户旧摘要不会因升级重新采集，未来合资格新账号的实际首连需客户端升级且服务端已支持V3。
- 尚未在本记录初稿时核对CI与线上revision；源码推送不是部署完成，后续按实际流水线及双readiness结果记录。
- 存储V3后不得盲目回滚到只识别V1/V2的服务端；兼容回滚应保留V3解析和旧报告可读性。原报告及业务健康数据不删除。

- 提交前首次fetch因本机schannel TLS握手中断失败，未暂存或提交；改用单次命令OpenSSL后fetch成功，远端仍为原基线。未关闭证书校验。

## 生产恢复过程（2026-11-25续）

- 源码62bf80e5acdb94acd74bb795ccf461c355124c27已推送main与本功能分支；CI45546796847的verify成功，原自动部署停在API原始digest下载。只读SSH核对：进程3602588对应本次API镜像9ec7ead94b15e0ff1d9758bf1ea61b1eeed735052621298db3b0b31784fe1042，约14分钟仍下载；磁盘约9GiB可用，原业务容器健康、双readiness仍为9e9efca。
- 仅准备备用材料时调用Export runtime images45549802634，upload_to_server=false，不重建、不写服务器。导出成功，artifact14992228848，372,850,930字节，官方ZIP SHA256为503e8f2aa6d2a71fc6726c0ffe5f4bc5da4e3a7fc15545db579627875f13fefb，绑定同一个成功CI和62bf80e。
- 本机可选全文件下载速度很慢；直连1MiB样本24.2秒成功，整包未完成，已停止这两个本机下载进程、保留部分文件。不把它们当作本机整包校验成功；后续服务器恢复通道必须核对完整artifact大小/SHA、ZIP、归档、每片摘要、OCI镜像ID及版本标签后才导入。
- 13:33用户明确允许终止指定下载并按同版原镜像恢复发布。此前只读SSH已闲置30分钟自动结束，未借用其他SSH会话、未保存密码。原CI已接近60分钟门槛，未再次索取密码或改变服务器配置；原部署在13:36左右达到门槛被取消，verify仍成功。没有手动终止其他进程或停止业务容器。
- 13:34再次核对main、artifact名称/大小/官方摘要未变，提交已有受限恢复工作流45554514395，existing_artifact_id=14992228848、artifact_action=import。它与原发布共用生产锁；原任务结束后进入HTTPS恢复，使用原有5GiB保留空间和完整校验门禁，不改客户数据、不运行seed、不打开原关闭能力。
- 本机部分GitHub日志读取遇到TLS临时断开，私有日志读取失败没有改成跳过证书校验；GitHub鉴权通过已有凭据帮助程序仅在进程内使用，token不进脚本/日志/Git。公开readiness使用正常证书验证的Windows curl回查。
- 已准备在导入工作流成功且main仍匹配62bf80e后，调用原Deploy production工作流、offline_images=true、first_cutover=false。导入失败或main变化时停止下一步；不会改版本或重建镜像绕过门禁。最终发布及回查结果另附，不将当前导入中称为已上线。
## 实际恢复与上线回执

- 云端完整原ZIP于14:28到齐，372,850,930字节及官方SHA256匹配；原verify-runtime-artifact.py再次确认ZIP、release-manifest与内层压缩归档。恢复工作流45554514395随后明确报错“Insufficient disk for offline import and 5 GiB reserve.”并失败；它不是成功导入记录，也没有切换业务。
- 本机32路有界Range副本同样完整校验：逐段206/Content-Range/大小、整包SHA256、ZIP CRC、版本均通过。原本拟用SCP备用，但服务器实测云端已约267MB而SCP仅约26MB，故只停止本任务自己的SCP进程19892，优先已有传输；其40,976,384字节不完整备用文件经精确路径、非符号链接、普通文件与大小校验后删除。未删除其他上传、业务目录或历史备份。
- SSH恢复复用本次已认证会话。手动续接仍是CI原始镜像；首先核对四个执行控制脚本的Git原blob SHA256、artifact ID/大小/官方摘要以及release版本，并持有原生产FD9发布锁。原Python校验器重新校验与解出归档，原Node validateTransfer校验绑定清单。
- 空间恢复仅移除本次已验证的重复临时分片与重复归档，改为从校验后的归档按偏移逐片生成8MiB数据。原receive-offline-images.sh的4倍归档预算、5GiB余量、每片摘要、合并摘要及OCI-ID/版本标签门禁全部原样保留，没有降低阈值。该临时操作方案在本机合成数据上用3种不同偏移生成分片，交给原Node验证器全部通过；篡改字节被原验证器拒绝，bash -n通过。此处只验证传输接续，不当作实体戒指测试。
- 14:40确认三镜像导入成功，手动命令退出0；所有镜像ID与62bf80e标签一致，导入阶段未重启应用。操作脚本和私有原始输出保留在Git外E:/SayRing-first-read-evidence-1321-20261125；不提交构建产物或服务器私有日志。
- 随后重新核对main仍是62bf80e，提交Deploy production 45562491212，offline_images=true、first_cutover=false。工作流最终全部成功，复用原CI45546796847的verify和原镜像，不重新构建、不运行seed。
- 14:44独立HTTPS回查：/health/ready与/global/health/ready均ready、database ok、revision=62bf80e5acdb94acd74bb795ccf461c355124c27。14:48服务器独立核对：API/Admin均running healthy，Worker为running（没有把缺少单独healthcheck写成healthy）；三个真实容器版本均62bf80e。可用空间8,134,508,544字节，仍高于5GiB。
- 后台实际静态入口/admin/assets/index-DmRHrJTj.js共2,340,038字节完整取得，包含readEvidence、mappingObserved、wireRows、decodedRows、filteredRecords等新显示字段。该项证明静态资源已交付，不代替真实新账号首次上报验收。
- 没有新建诊断账号、再次采集780/764或其他旧账号、初始化/重置戒指、触发客户测量或上传健康数值；已有首次报告保持不可变。当前普通正式Android1321对应App源码895519c，后台可接收其V3；原有V1/V2继续兼容。
- 本轮只是补记已完成发布的证据，无功能源码变化，沿用同一源码已通过的完整检查和生产CI；git diff --check再次通过。实施回执仅推送本功能分支，不为文档重复触发main自动部署；生产源码SHA保持62bf80e。

发布链接：[原CI](https://github.com/tangwu88/saydianserver/actions/runs/45546796847)、[原镜像导出](https://github.com/tangwu88/saydianserver/actions/runs/45549802634)、[自动恢复失败记录](https://github.com/tangwu88/saydianserver/actions/runs/45554514395)、[正式恢复发布成功](https://github.com/tangwu88/saydianserver/actions/runs/45562491212)。
- 发布、容器与静态资源核验完成后，已通过exit正常关闭本轮SSH，核对没有存活的SSH子进程，并移除本地陈旧ready标记，防止后续误判会话可用。
