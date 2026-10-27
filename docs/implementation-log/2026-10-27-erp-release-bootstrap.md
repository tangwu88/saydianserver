# ERP订单同步发布的干净环境构建修复

用户明确继续提交Git并发布中国站。已核对main=51d9335f805567be03f8f1579781334ee512ef4e，前一轮礼品错误提示发布40517472032在GHCR镜像拉取阶段满一小时后取消；服务器发布锁和下载进程已退出，旧服务保持健康。最新订单同步源码33个blob、完整tree与本地3275a9e逐一匹配后，以expected_sha非强制推进main，CI40529373792进入验证。

CI发现本地现存contracts/dist掩盖了全新checkout缺失共享模块的问题：tools:test先于根typecheck执行，独立H5构建无法解析新commerce-erp子入口。流水线在验证阶段停止，未部署。仅在商城H5/微信小程序构建入口显式先生成工作区contracts，再调用原uni构建器；不调整发布门禁、业务实现、生产配置或美国站。保留原提交及分支。

验证将移开已有contracts/dist和商城构建输出，运行实际tools:test作为回归，确保独立构建能自行生成依赖；再串行运行类型检查、测试、构建、接口目录、部署脚本及差异检查。命令结果、失败和发布回执保存在ignored artifacts/erp-member-order-sync-20261027；未验收的真实ERP和浏览器结果与构建分开记录。

实际验证完成：将packages/contracts/dist和apps/shop/dist移至本次ignored备份目录后，pnpm tools:test从空共享输出完成H5构建及全部工具/HTTP契约检查。随后串行pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check（478条）、runtime artifact、deploy/us节点、capacity、bootstrap、image layers、git diff --check全部为0。原业务源码未变；bootstrap-gates.json保留命令和用时。

已核对用户截图指定的礼品订单，旧版列表仍显示待发货/ERP已取消；实际订单标识仅保留在ignored验收回执，新版上线后只读同步验收，不进行退款或恢复卡片。
