# 采购地址撤销后的校验提示修复

- 630d511版本上线实际验收中发现：粘贴地址识别后撤销，空字段会出现 `recipientName is required` 等英文提示。新增测试发现仅模拟Form API的旧流程测试没有覆盖Element Plus真正合成的校验规则。
- 在独立 `codex/partner-address-validation-fix` 分支修复；修改前fetch确认origin/main为630d51184fe8ad1f9c4bc8e53ff4adbad35ed158，保留用户未跟踪的本地管理后台预览记录。此前功能发布的完整验收记录一并提交。
- 自定义地址规则显式设置required，让FormItem复用同一条中文blur校验，避免其额外拼接缺少中文消息和触发条件的默认规则。保留必填星号、付款前校验、电话格式和长度限制，地址识别及采购接口不变。
- 回归测试通过Vue自定义测试渲染器挂载真实Element Plus Form/FormItem；验证识别后撤销不会触发默认change报错，主动blur时五个必填项均使用中文提示。未引入浏览器控制替代工具或新依赖。Node测试使用Element Plus正式CommonJS入口以避免直接ESM导入其CommonJS校验器的互操作问题，并提供测试ID注入。
- 已真实执行红绿验证：移除required时新测试因change校验拒绝而失败；恢复修复后伙伴端40项测试通过。串行根级api:docs:check（428路由）、tools:test（含部署校验）、typecheck、test（1754项通过）和build、git diff --check全部退出0。代码仅涉及伙伴页面和该表单回归测试；原23项实库专项在上一轮已单独通过，本轮CI仍会验证。
- 本地新建独立浏览器页使用合成账号操作，识别后撤销恢复空表单，没有validation alert和英文required提示；保留用户原本打开的充值页。
- 本地验证提交95bf11a75d5a71855468fe75a9ca69e442c0d4a5，远端发布提交1fa02eb95b1fc4a5fcd8cc1e0c33f14ec6bad82a，两者树均为5d68d2b084bc78c2db992951b555a42aa395d6fa。GitHub CI及自动部署 `38435573985` 全部成功，真实HTTP169项、镜像兼容性及原镜像离线导入演练通过。
- 本次正常GHCR增量发布成功：API和worker各4秒、admin15秒核验完成，无待执行迁移；2026-10-13 17:12:20 UTC统一发布完成。备份目录 `/opt/saydianapp-server/deploy/unified/backups/20261013T171150Z-1fa02eb95b1f-20532`。切换期间一次独立健康探针遇到502，部署完成后国内/国际双入口均恢复ready并返回精确1fa02eb，17项公开验收再次全部通过。
- 线上实际页面验证整段地址填写、撤销不产生多余错误、空收货人失焦显示“请填写收货人”，无英文required提示。示例输入已撤销清空，保留原1件商品选择，没有提交订单或入账。忽略目录保存 `production-ui-acceptance-1fa02eb.json` 和 `23-production-chinese-validation.png`。
- 先前完整功能版本630d511的发布记录见2026-10-13-partner-ux-production-acceptance.md。本补丁与真实功能均已上线；真实支付商户和ERP联调、生产资金变更未在本轮执行。此最终回执在独立验收分支更新，避免文档提交重复发布。
- 2026-10-14用户要求更新提交Git：重新fetch确认main仍为1fa02eb，最终验收及此前未提交的本地管理后台预览记录同步到 `codex/partner-address-fix-acceptance`。首次原生HTTPS推送因本机无Git用户名凭据退出，随后使用已连接GitHub工具发布同一文件树；保留本地原提交历史，远端分支与本地文件树须核对一致。仅同步文档，不触发main生产发布，不提交本地环境、凭据、截图或构建产物。
