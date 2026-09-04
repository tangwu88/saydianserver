# 交接说明

## 接手第一步

```powershell
pwsh -NoProfile -File tools/Start-Change.ps1
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

1. 阅读 [旧功能缺陷清单](api-coverage.md)，优先处理手机号注册验证、真实迁移和生产写入验收；不能把后台可打开当成全部功能已对接。
2. 新服务为 `https://app.saydian.cn`，旧 `app.saidian.cc` 未切换；当前保持维护只读，附件暂存服务器。每次接手重新核对线上状态。
3. 获取旧库只读账号后完成真实盘点，补齐会员、关爱、消息、内容、AI、地址、旧订单、附件及旧会话映射。
4. 按 [调用指南](api-guide.md)、[接口目录](api-reference.md) 为 Flutter 和原小程序联调；供应商缺凭据的项目不能标记通过。
5. 本机无 Docker；使用 CI 验证数据库/HTTP 契约和镜像，手机与供应商业务仍需单独验收。
6. 按 [持续部署说明](continuous-deployment.md) 更新、显式提交和核对线上 SHA；实际配置/测试/发布结果见本轮实施日志。自动发布不得打开维护状态或修改旧库。
