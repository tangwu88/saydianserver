# Say Ring 睡眠报告千问接入修复

## 原因与实现

- 用户补充确认错误发生在 Say Ring App 睡眠报告。配置千问后，睡眠服务仍只接受旧版说明告知的 BigModel 地址，因此 API 返回“睡眠 AI 服务尚未完成配置”。总后台最近报告混用问题另有同轮修复。
- 允许千问官方当前大陆接口，但必须匹配独立新版睡眠说明 `say-ring-sleep-qwen-2026-10-18-v1`。旧智谱授权不能用于千问，新千问说明也不能向智谱发送；不放宽任意地址、海外端点、HTTP、账号密码、query 或 fragment。
- API 基于已发布说明选择接收方；Worker 在发送前和发布结果前核对同一接收方、有效会员和当前单独同意。说明更换、撤回、账户停用和功能暂停继续中止生成或结果发布。没有代会员同意，也不改变 HealthProfile 的独立授权。
- 千问 Qwen3 非流式结构化请求关闭思考并限制输出 4096 token，保持 JSON 校验、未知值、数据最小化、超时和重试。参考官方：<https://platform.qianwenai.com/docs/developer-guides/text-generation/structured-output>、<https://platform.qianwenai.com/docs/developer-guides/getting-started/latest-model>。
- 用户已审核通过独立千问睡眠说明，并授权配套代码上线后发布。生产正文及实际会员验收材料在忽略的 artifacts 内，不提交会员数据、密钥或授权记录。

## 验证

- 定向 contracts 20 项、API 56 项、worker 54 项通过；均为合成数据，fetch 被拦截，未真实发送健康数据。覆盖新旧供应商/说明交叉拒绝、旧同意失效、重新同意、千问生成、生成中说明变化以及身份字段不外发。
- 串行执行 `pnpm api:docs:check`（0.4 秒）、`pnpm tools:test`（68.3 秒）、`pnpm typecheck`（9.5 秒）、`pnpm test`（21.4 秒）、`pnpm build`（12.9 秒）及 `git diff --check`，全部通过。
- Say Ring 原目录在 `4dee4e6` 先执行过 23 项合成检查；发现远端已更新后保留原目录，在独立只读工作树检出最新 `741d83f4d7e6b6d8f1cfbb8d5e99bc602737a4ce`，重新执行 `flutter pub get --offline --enforce-lockfile` 和 `flutter test --no-pub test/sleep_ai_report_page_test.dart test/sleep_report_input_test.dart`，28 项通过、工作树干净。验证了新版本说明读取、未勾选不上传、旧说明拒绝、撤回、前后台切换与只读轮询；无 App 源码变更，不触发签名、安装或商店发布。
- 生产发布、真实千问调用以及会员在 App 主动同意后的真实睡眠生成仍需分别记录，不能由合成检查推断完成。
