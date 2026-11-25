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
