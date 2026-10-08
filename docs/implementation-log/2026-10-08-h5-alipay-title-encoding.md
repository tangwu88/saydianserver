# H5 支付宝收银台中文标题编码修复

## 基线与原因

- 已阅读 AGENTS.md、docs/handoff.md 与最近实施记录；在干净 main 工作树执行 tools/Start-Change.ps1，fetch 成功，本地与 origin/main 均为 89fe54d7a02bbcd31d81cb9ea367a31958029302。
- 用户截图中标题乱码；支付标题实际为服务端生成的「赛电商城订单 + 订单号」。Node TextDecoder('gb18030') 解码该标题的 UTF-8 字节可复现「璧涚數鍟嗗煄璁㈠崟」，支持网关解析编码不一致这一定位。
- 原 H5 将 charset 与所有参数一起放在 POST 表单正文，action 不含编码声明，form 未显式设置 acceptCharset。支付宝官方 Node SDK 的 formatUrl/pageExecute 将 charset 等公共参数放在 action 查询串，业务参数留在表单正文。参考 https://github.com/alipay/alipay-sdk-nodejs-all/blob/master/src/alipay.ts 。

## 修改

- apps/shop/src/payments.ts：仅 H5 FORM 提交分支，对已受信任的支付宝网关按官方公共参数列表构造 action 查询串，明确 form.acceptCharset 为 UTF-8。中文 biz_content 保留原始字符串，由浏览器编码一次；所有已签名参数逻辑值不变。网关 URL 校验在创建 DOM 前完成。
- apps/shop/tests/global-h5.test.mjs：验证国内/全球商城、正式/沙箱网关，中文及特殊字符单次编码往返、charset 查询声明、旧错误查询值覆盖、签名参数完整、原对象不变与不受信任地址拒绝。保留跳转标记回归验证。
- 无 APP/小程序支付分支、支付金额、签名生成、回调、数据库、生产开关或商品资料变更；兼容已缓存的 FORM 支付参数。

## 命令与结果

- 修改前 git status --short --branch、git remote -v、git fetch origin --prune、Start-Change 检查通过；用户原工作树中的未跟踪文档已保留。
- 定向测试与完整门禁结果记录在下方。发布使用 Publish-Change 显式文件清单；仅为测试进程加入既有 jq 工具路径。

## 未验收事项

- 需核对 CI、生产 readiness revision 与 H5 构建资源；推送本身不等于上线。
- 未创建真实支付或扣款；手机支付宝收银台标题需上线后用户重新发起支付验收，已打开的旧收银台不会自动刷新。
- node --test --test-name-pattern=Alipay apps/shop/tests/global-h5.test.mjs：3 项通过，无失败。

- 2026-10-08T01:49:08.4388998Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-10-08T01:51:39.4262043Z：pnpm.cmd tools:test，退出码 0。

- 2026-10-08T01:52:07.2832408Z：pnpm.cmd typecheck，退出码 0。

- 2026-10-08T01:53:28.4061776Z：pnpm.cmd test，退出码 0。

- 2026-10-08T01:54:09.6307471Z：pnpm.cmd build，退出码 0。
