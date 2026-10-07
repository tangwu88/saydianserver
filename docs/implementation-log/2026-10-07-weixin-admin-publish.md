# 2026-10-07 小程序配置入口发布

## 授权与基线

用户反馈后台找不到小程序配置入口，并明确要求“发布一下”。此前代码仅在隔离工作区，未合入发布；本轮发布后台、API 和商城源码兼容实现，不填写真实供应商配置，不开放维护/只读状态或迁移数据库。

阅读 AGENTS、handoff、近期库存同步/占用保护和部署加速记录。原工作区 `E:\saydian h5` 在库存任务分支且有不相关未跟踪法律文档，保留原样。使用干净 main 工作区 `E:\saydian-inventory-sync-20261007`；Start-Change 成功 fetch 并确认 HEAD/origin/main 均为 `26ecb4d4c81c5c3159d83bdce9320957d6402d88`。

## 合入与范围

应用上轮已验证的 50 文件补丁。初次完整检查发现自动生成的 API reference 与新库存路由上下文不同，未写入；排除三个生成目录文件后应用源代码，再运行 pnpm api:docs，重新生成 381 路由。保留最新库存同步及占用保护逻辑，没有重置或覆盖新提交。

范围：后台第三方服务新增“商城微信小程序”卡片（独立加密 AppID/AppSecret、支付开关、域名清单）；API 配置校验、已验证会员微信绑定、小程序能力及容器支付；商城原生图片、Canvas 海报、分享、PNG 图标、显式协议同意和 AppID 构建参数。接口备注、生成 contracts、配置说明、上轮及本轮实施记录一同提交。无 schema、生产密钥或数据库变更。

## 验证及发布基线

本轮初次 tools:test 未设置便携 jq，仍报 Windows shell/jq 失败；定位前轮已校验的 `artifacts/toolchain/jq.exe`，以 SAYDIAN_JQ、Git Bash PATH 重跑，不修改测试和生产脚本。完整门禁由 Publish-Change.ps1 串行执行并追加每项退出码。

发布前公网 `/health/ready` 与 `/global/health/ready` 均 ready，revision 为 `48d493275205a4e755805080494dd5b6fe42c51d`；后台 bundle 为 `index-ByIDZR94.js`。三产品公开下载清单已保存只读快照供发布后比对。GitHub 显示库存 revision 的镜像导出任务进行中及先前发布锁失败；不强行解锁，不取消他人任务，必须等待本次 CI 和部署真实结果。

## 未验收

实际 AppID/AppSecret、商户绑定、合法域名与隐私申报仍由管理员填写，本轮不自动启用登录或支付。当前尚未完成本次提交、CI、双地址版本一致和线上后台 bundle 卡片核验；以之后实际证据为准，不把推送当部署成功。真机、微信审核和真实登录/支付仍需另行验收。

- 2026-10-07T03:05:27.1173362Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-07T03:07:35.0947372Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-07T03:07:56.3798554Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-07T03:08:50.8400122Z：pnpm.cmd test，退出码 0。

- 2026-10-07T03:09:25.9831588Z：pnpm.cmd build，退出码 0。
