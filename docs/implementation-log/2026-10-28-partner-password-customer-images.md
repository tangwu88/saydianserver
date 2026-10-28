# 品牌伙伴首次改密与客户资料图片

## 范围与基线

用户要求后台新建伙伴账号首次登录提示修改密码，登录页说明忘记密码联系管理员重置，并在总后台伙伴资料增加客户资料多图上传保存入口，验证后发布中国站。

已读AGENTS、handoff及最近实施记录，检查status/remote并fetch成功。原目录含用户未提交文档，保持原样；从最新origin/main a5994ee建立独立工作区 E:/saydian-partner-first-password-20261028 和 codex/partner-first-password-20261028，按显式文件提交、非强制推送和PR验收流程发布。Start-Change/Publish-Change仅接受main，因此本候选分支执行对应的fetch、检查与显式文件门禁，不伪造main或覆盖其他工作区。

## 实现

- BrandPartner新增mustChangePassword，旧账户默认false；后台新建及管理员重置密码显式置true。不批量修改旧密码或现有伙伴状态。
- 登录和me返回该标记。服务端拦截未改密业务访问，仅开放me/logout/change-password。前端在合作协议及业务页面前显示不可跳过的改密表单；忘记密码联系管理员重置。
- 修改密码验证旧密码与确认、新密码长度和bcrypt字节限制，拒绝同旧密码；同事务锁伙伴、更新密码、撤销旧会话、生成新会话并写不含密码或token的审计。管理员并发重置与改密按同一伙伴锁串行。
- 总后台新增客户资料入口，批量选择JPG/PNG/WebP，每批20张、单张10MB、伙伴总数200张，逐张保存及反馈，失败后仅重试失败项。列表分页10张，预览并发2个，关闭撤销私有blob。
- 复用FileObject和现有私有存储，purpose按伙伴隔离；仅SUPER_ADMIN可列表/上传/查看，读取审计、no-store，无公开URL；原公开文件接口不能读取该用途。不会把客户资料暴露给伙伴或商城会员。

## 验证进展与修复

- 新工作区依赖使用pnpm11.25.0离线锁文件安装，未更新依赖版本。首次API定向测试因共享contracts未构建无法加载；按根命令顺序先构建contracts和commerce-domain后复验。前端改密4项与批量图片3项动作测试通过。
- 后续完整检查、真实库并发及兼容迁移演练、CI、生产版本与静态资源读回据实追加。未操作真实伙伴密码、客户图片、资金或采购订单。

- 本地串行pnpm typecheck、pnpm test、pnpm build、api:docs:check均退出0。全量API1396通过/67项实库默认跳过，后台265、伙伴端81、商城208项通过。新增API定向复验24项通过（包含200张上限提前拒绝），前端共7项通过。
- pnpm tools:test首次因Git Bash缺少jq退出127；核对既有便携jq为官方校验文件对应SHA256 a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627，仅在进程PATH/SAYDIAN_JQ接入后完整重跑成功。部署Node、runtime artifact、容量和镜像层Python检查通过。
- Windows的python3是无输出别名；改用现有Python3.12.14运行部署测试。US bootstrap测试3项中1项因其子进程仍调用Windows python3别名而失败（预期合成stderr为空），没有改动测试或生产US脚本；该项须以Linux CI真实Python复验结果为准。
- 增加真实PostgreSQL新建/首次改密、双请求竞争、旧会话/旧密码失效、管理员重置再次要求改密及临时旧表新增列事务回滚演练。当前无本地PostgreSQL监听，不把默认跳过写成实库通过；这些测试已接入现有CI实库步骤，兼容迁移登记等待该验收。
- HTTP兼容验收合成伙伴先验证业务403、完成初始改密并验证旧token401，再继续原健康/证书/资金边界。无真实账号或供应商数据操作。
