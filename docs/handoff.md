# 交接说明

## 接手第一步

```powershell
git status --short --branch
git fetch origin --prune
git merge --ff-only origin/main
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
```

若工作区有未提交修改，先确认归属，不要覆盖。每轮修改前复查 `docs/implementation-log/`，每轮命令、失败和修复继续新建日志并随源码提交。

## 关键规则

- Flutter App 合约第一；V1 兼容层不可把历史拼写带入数据库/V2。
- 健康未知值不得补 0；不得输出诊断、治疗或准确性承诺。
- BLE 留在手机；服务端只存设备状态。
- 新商城订单只进入现有商城；旧订单投影不可支付、不可重放 ERP。
- 外部集成没有真实凭据和验收证据时保持 `UNCONFIGURED`。
- 生产停写、DNS 切换、旧库清理必须重新取得明确授权。

## 当前优先级

1. 在有 Docker 的机器或 CI 完成 PostgreSQL/Redis/MinIO/API/Worker/Admin 冒烟。
2. 获取旧库只读账号后完成真实结构盘点，补齐关爱、消息、内容、AI、地址、旧订单和附件映射。
3. 为 Flutter App 增加 V2 健康批量、反馈、预警和商城错误契约的灰度/回退联调。
4. 配置测试环境商城内部令牌，验证多商品单订单、APP 支付沙箱、物流和售后。
5. 新服务器和各供应商资料到位后，先 dry-run，再只读发布，最后独立审批开放写入。
