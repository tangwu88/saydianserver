# 2026-09-15 阿里云短信直连接入

## 目标与范围

- 在现有“短信验证码”集成中增加阿里云短信直连，同时保留原短信中转接口。
- 管理后台可填写 AccessKey ID、AccessKey Secret、短信签名名称和验证码模板 Code；实现阶段不录入真实凭据、不发送真实短信，后续按用户指示提交并部署生产。
- 当前直连使用国内短信 `SendSms`，模板参数固定为 `code`，不把国际短信接入与国内模板混用。

## 实现

- 管理后台按接入方式显示对应字段；新配置默认选择“阿里云短信（直连）”。切换接入方式时必须整组替换凭据，并移除另一方式的公开配置，避免旧地址继续生效。
- AccessKey ID 和 AccessKey Secret 只进入现有集成密钥加密存储，不写入 `publicConfig`、页面回显、客户能力接口或错误日志。签名名称和模板 Code 保存在非密钥配置中。
- API 使用阿里云官方 `@alicloud/dysmsapi20170525` 客户端调用固定端点 `dysmsapi.aliyuncs.com`，设置连接和读取超时；仅响应 `Code=OK` 时标记集成已经真实验证，其余异常统一返回通用不可用信息。
- 商城短信能力只在集成启用、两项密钥、签名和合法 `SMS_...` 模板 Code 全部存在时开放；能力检查不向阿里云发请求。
- 环境变量回退改为 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME` 和 `ALIYUN_SMS_TEMPLATE_CODE`。
- 阿里云 SDK 间接依赖的 `ws` 固定为修复版本 `8.21.0`。`@alicloud/openapi-core` 的安装脚本仅为 Node 10/12 安装旧类型依赖；仓库要求 Node 22+ 且包已提供编译产物，因此在 pnpm 允许构建清单中明确禁用该脚本。
- 发布工具测试允许用 `SAYDIAN_BASH` 显式指定 Git Bash；默认路径保持不变。这样没有系统级 Git 安装权限的 Windows 发布机仍会执行真实 Shell 检查，而不是跳过门禁。

## 验证结果

- `pnpm install --frozen-lockfile`：通过，锁文件可复现安装。
- `pnpm db:generate`：通过，Prisma Client 生成成功。
- 短信针对性测试：后台配置 39/39、API 发送与能力 8/8 通过。
- 阿里云 SDK 无网络运行时装载与请求对象构造：通过；未发送真实短信。
- `pnpm api:docs:check`：351 条 API 路由均有描述并通过校验。
- `pnpm typecheck`：8 个工作区项目全部通过。
- `pnpm test`：共 1146 项通过，4 项需要显式数据库验收环境的集成测试按既有规则跳过，没有失败。
- `pnpm test:h5:flows`：61/61 通过；`pnpm test:h5:contracts`：38/38 通过，H5 构建成功。
- `pnpm build`：API、Worker、管理后台、商城、下载页及公共包全部构建成功；仅保留既有 Sass 弃用和后台产物体积提示。
- 首次 `pnpm tools:test`：8/10 通过；当前 Windows 环境没有原固定路径 `C:/Program Files/Git/bin/bash.exe`，两个部署 Shell 测试进程未能启动并返回空状态。随后加入显式 `SAYDIAN_BASH` 路径支持，并使用签名有效的 Git for Windows 2.55.0.3 免安装版重新执行全部门禁。
- `pnpm why ws --filter @saydian/app-api`：阿里云 SDK 链路使用 `ws@8.21.0`。全仓库 `pnpm audit --prod` 仍报告商城旧依赖等既有问题，不把它们误记为本轮已清零。
- `git diff --check`：通过。

## 上线后仍需人工核对

- 使用仅具短信发送必要权限的 RAM 用户，在管理后台录入真实四项资料并启用服务。
- 确认阿里云签名和模板已审核通过，模板变量名准确为 `code`，账户余额、发送权限和频率限制可用。
- 从真实注册或登录流程发一条验证码，确认收到短信且后台状态变为“已通过真实调用”；真实发送会产生阿里云费用。
- 代码、CI 和生产发布已完成；真实阿里云凭据录入与验证码发送仍由管理员执行。

## 发布执行记录

- 第一次受控发布的全部本地门禁通过，但提交前第二次 `git fetch origin` 使用 Codex 精简 Git 时连接 GitHub 超时；脚本在暂存前停止，远端和本地仍为 `4a59cff566ea2973e3ed31651cd886e379777f22`。
- Git for Windows 系统级安装因 UAC 提示停止，未绕过权限；随后从官方发布页下载免安装版 2.55.0.3，SHA256 为 `AB00566336B5472120F9A52D34F2E79C5406535792ACB0548001FFD0BD090E5D`，Authenticode 签名验证有效，只解压到当前用户缓存目录。
- 使用免安装版 Git 重新 `fetch` 两次均成功，远端仍为同一 SHA。再次执行受控发布时，接口文档、工具测试、类型检查、全量测试和构建全部通过；提交因本机未设置 Git 作者身份停止，14 个显式文件保持暂存，没有提交或推送。
- 首个本地提交 `66bd77d` 误沿用了另一个项目的 `saydian88-cmyk` 身份且从未推送。用户明确本项目必须与另一项目分开并固定使用 `tangwu88`；因此只在本仓库改为 `tangwu88 <tangwu88@users.noreply.github.com>` 并重写该未发布提交，不删除或覆盖 `saydian88-cmyk` 的全局凭据。提交、CI、生产 revision 和公网结果待实际完成后追加。
- 正确源码提交 `04ac8b2673c2d61bef029afc26c752c7c1ff2541` 已由本仓库身份 `tangwu88 <tangwu88@users.noreply.github.com>` 推送到 `origin/main`。
- GitHub Actions CI `34924885628` 的 verify、API/Admin/Worker 镜像和自动生产部署均成功。生产机从 GHCR 拉取镜像较慢，deploy Job 用时约 129 分钟；旧版本在切换前持续 `ready`，未发生服务中断。
- 2026-09-15 13:40:58 +08:00 公网 `https://app.saydian.cn/health/ready` 返回 `ready`、`database=ok`，revision 精确为 `04ac8b2673c2d61bef029afc26c752c7c1ff2541`；`/admin/integrations` 返回 HTML 200。
- 本次发布未录入或读取真实阿里云密钥，未发送真实短信；管理员仍需在后台填写四项资料并完成一次会产生费用的真实验证码验收。

- 2026-09-15T02:21:48.6824115Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-15T02:22:20.7521945Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-15T02:22:45.8811553Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-15T02:23:47.8125109Z：pnpm.cmd test，退出码 0。

- 2026-09-15T02:24:24.5484563Z：pnpm.cmd build，退出码 0。

- 2026-09-15T02:28:51.6646367Z：pnpm.cmd api:docs:check，退出码 0。

- 2026-09-15T02:29:24.5372932Z：pnpm.cmd tools:test，退出码 0。

- 2026-09-15T02:29:47.9880438Z：pnpm.cmd typecheck，退出码 0。

- 2026-09-15T02:30:41.7208760Z：pnpm.cmd test，退出码 0。

- 2026-09-15T02:31:15.6611736Z：pnpm.cmd build，退出码 0。
