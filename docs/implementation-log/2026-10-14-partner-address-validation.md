# 采购地址撤销后的校验提示修复

- 630d511版本上线实际验收中发现：粘贴地址识别后撤销，空字段会出现 `recipientName is required` 等英文提示。新增测试发现仅模拟Form API的旧流程测试没有覆盖Element Plus真正合成的校验规则。
- 在独立 `codex/partner-address-validation-fix` 分支修复；修改前fetch确认origin/main为630d51184fe8ad1f9c4bc8e53ff4adbad35ed158，保留用户未跟踪的本地管理后台预览记录。此前功能发布的完整验收记录一并提交。
- 自定义地址规则显式设置required，让FormItem复用同一条中文blur校验，避免其额外拼接缺少中文消息和触发条件的默认规则。保留必填星号、付款前校验、电话格式和长度限制，地址识别及采购接口不变。
- 回归测试通过Vue自定义测试渲染器挂载真实Element Plus Form/FormItem；验证识别后撤销不会触发默认change报错，主动blur时五个必填项均使用中文提示。未引入浏览器控制替代工具或新依赖。Node测试使用Element Plus正式CommonJS入口以避免直接ESM导入其CommonJS校验器的互操作问题，并提供测试ID注入。
- 已真实执行红绿验证：移除required时新测试因change校验拒绝而失败；恢复修复后伙伴端40项测试通过。串行根级api:docs:check（428路由）、tools:test（含部署校验）、typecheck、test（1754项通过）和build、git diff --check全部退出0。代码仅涉及伙伴页面和该表单回归测试；原23项实库专项在上一轮已单独通过，本轮CI仍会验证。
- 本地新建独立浏览器页使用合成账号操作，识别后撤销恢复空表单，没有validation alert和英文required提示；保留用户原本打开的充值页。正式发布及修复后的线上验收待完成后补充。
- 上一个完整功能版本630d511已上线且17项公开检查通过；本修复尚未发布时不将其描述为线上已修复。真实支付、ERP和生产资金变更未执行。
