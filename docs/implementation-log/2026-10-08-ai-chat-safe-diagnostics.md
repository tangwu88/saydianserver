# AI 对话脱敏诊断与明确失败提示

- 用户授权只增加错误码/耗时诊断、修正 APP 提示、发布后手机复测。真机 1014 发送简单文字在约 3 秒内失败；不是此次 60 秒超时，原来失败气泡统一声称网络问题，global client 抹掉原始提示。
- 服务端基线 fetch 成功为 f037228d74885c3f0d21d5560ab616fadaee9246；原 E:\saydian h5 的同事未跟踪法律文档保留，使用独立 codex/ai-chat-diagnostics-20261008 工作树。Start/Publish 要求 main，本轮避免占用另一任务 main，使用等价串行检查与显式文件提交；发布前重新 fetch，远端变化则停止。
- 修改仅通用 AI 对话供应商错误分类、固定日志和配置未启用错误码。不更换 Key/模型，不修改 60 秒预算、提示词、历史/账号、睡眠报告、数据库或业务开关。
- 日志固定 event/errorKey、HTTP 状态、仅 3–6 位数字的供应商 error.code、耗时。不得包含原始响应、异常文本、用户提问、回复、模型地址、密钥、手机号或健康数据。HTTP 402/429 只归类额度/限流，不断言余额已不足。
- App 基线 5946b581f473aff9f1b169e6e2850d76177907ac，原主目录文档改动保持。缺少服务器日志连接；上线后通过类型化错误和真机提示核对，不把当前猜测写成根因或修复成功。
- 待记录测试、失败修复、CI/部署回读及真机情况；测试不调用真实供应商。无 iOS 本机编译能力。

- 固定诊断另以严格白名单 data 返回客户端，以便没有服务器终端权限时从真机确认 HTTP 状态和数字服务代码；错误过滤器不转发其它任意 data。新增正向/伪造值和 V1 兼容测试。
- pnpm install --frozen-lockfile、db:generate 成功；定向供应商/语言/过滤器 26/26 通过。首次 typecheck 因新 mock 的空参数元组报 TS2493，给 status mock 标注 number 入参后重跑。与业务代码无关。
- 本轮错误读取命令误用 App 路径于服务端、重复创建已有分支，均未造成覆盖；改用各自真实工作树。没有提交这些临时操作或凭据。
- 根级门禁串行完成：pnpm api:docs:check、pnpm tools:test、pnpm typecheck、pnpm test、pnpm build；API 1090 通过/7 数据库依赖项跳过，未宣称真实数据库验收。python -B deploy/scripts/verify-runtime-artifact.test.py 3/3；git diff --check 通过。构建仅已有体积告警。
- tools:test 首次因 Git Bash 不在 PATH 失败，加入已验证的 Git bin/usr/bin 和本机 jq 后单项 3/3；第二次已有部署测试清理目录报 ENOTEMPTY，保留日志，第三次使用独立 TEMP/TMP 全部通过。没有修改测试、部署脚本或放宽生产校验。
- 发布前重新 fetch origin，远端仍为基线 f037228d74885c3f0d21d5560ab616fadaee9246；仅显式列出的源码、测试、接口说明与本日志提交。CI/线上版本和手机诊断仍待回读，不把提交当作已部署。
