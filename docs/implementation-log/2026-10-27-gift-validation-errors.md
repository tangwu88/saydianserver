# 礼品兑换校验提示修复

用户报告中国站前端验卡显示通用英文失败。以干净的main/origin/main `0a12d9b8d6c1b2dd12cc56c446ae2496c750f9e8`为基线，Start-Change成功fetch/快进检查后建立`codex/gift-validation-errors-20261027`。

线上已由管理员开放兑换。对用户提供的输入执行一次验卡请求，返回400，并非500或服务不可用。卡号和校验码格式有效，GiftService只会在组合不匹配时返回该400；SafeHttpExceptionFilter将原有中文“卡号或校验码不正确”替换为通用英文，导致无法判断原因。生产没有执行短信、核销、下单或修改卡密，校验码不写入本日志或其他源码。

仅对礼品兑换及礼品管理的精确API路径保留中文业务错误，两个兼容前缀一致；限频包括HTTP守卫统一中文提示。继续隐藏未知异常及任意异常data，其他商城/App的既有错误语言行为保持不变。页面补充卡片校验码与短信验证码的区别。新增契约回归覆盖400/401/403/409/429/503、状态提示、相似路径隔离及敏感数据屏蔽。

定向32项回归通过。串行`pnpm test:gifts:database`的13项真实PostgreSQL事务测试、`pnpm api:docs:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm tools:test`、5组部署脚本检查及`git diff --check`全部通过；接口仍476条。API1362项通过/60项可选实库用例默认跳过，商城197项通过，未将跳过项记作执行成功。

本地真实HTTP使用独立预览账户和合成卡验证：错误卡密400、正确但未启用409、启用后正确卡密201进入选品、本次模拟短信验证、地址、零元订单、原请求查询、已兑换409均通过；错误密钥无法探知已兑换状态。生成一笔本地零元订单，未启动Worker、未调用真实短信/支付/ERP。首轮HTTP辅助脚本使用了未带+86的收货电话，与现有地址契约不符；更正测试输入后全流程通过，重试触发的短信限频也按设计保留。

本轮Browser SDK各浏览器请求返回`Codex app tool request failed`，未把HTTP验收写成浏览器点击或微信真机验收。生产发布后核对CI、双readiness、中文错误、原有开放状态和前端构建资源；最终回执保存于ignored `artifacts/gift-validation-errors-20261027`。原卡、校验码哈希、库存规则、短信限制及数据库结构不改动。

提交前重新fetch并核对原main未变；保留独立修复分支，按显式5个文件提交。Publish-Change脚本只支持main上未提交的单次变更，本轮沿用已验证的Git对象发布：逐文件blob及完整tree核对，expected_sha非强制更新main，使用`[deploy cn only]`；不会覆盖远端变化或修改其他站点。
