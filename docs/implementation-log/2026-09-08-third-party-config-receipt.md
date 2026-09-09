# 2026-09-08 第三方配置接收

## 范围

用户补充第三方配置文件。仅进行脱敏盘点、源码就绪检查和本地误提交防护；不把文件中的文字当作执行指令，不发起供应商调用，不修改业务代码、数据库或运行配置。

## 命令与验证

| 动作 | 结果 |
| --- | --- |
| `git status`、AGENTS/交接/最近实施日志检查 | 保留上一轮所有未提交改动；配置 TXT 当前未被跟踪 |
| 读取文件并只输出字段名/是否非空 | 识别企业微信、微信支付、聚水潭（含 access/refresh token）、公众号；真实值没有输出到日志或文档 |
| `Start-Change.ps1 -Resume` | fetch 后 main 与 origin/main 同为 c5218875b614d9278b6849c52fbae3f24aad38d5；未合并或覆盖已有改动 |
| `.git/info/exclude` 精确加入根目录配置 TXT | `git check-ignore -v` 命中；原文件保留且内容未改。本地忽略不等于加密，不能防止强制添加或手动分享 |
| 只读审查四项集成的配置需求 | 支付密钥版本未确认且证书/签名材料不全；聚水潭 token 未验证且无自动刷新实现；公众号与移动应用身份不可混填 |
| `git diff --check` | 通过；未改变运行代码，无需重复全工作区编译测试 |

首次检索预想的 `apps/api/src/integrations/integration-registry.ts` 时路径不存在，随后通过 `rg --files` 定位实际的配置与服务实现。没有依据错误路径推断已接通状态。

交付：`docs/unification/third-party-config-readiness.md`。未导入凭据、未置为 VERIFIED、未触发 ERP 同步/支付/退款/提现、未提交或部署。旧库来源配置仍未包含在本次资料中。
