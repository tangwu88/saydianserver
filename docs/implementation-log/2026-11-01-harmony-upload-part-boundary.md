# 鸿蒙安装包分片边界拒绝

用户在c7b21aa分片功能上线后反馈“上传片段被服务器拒绝，请联系管理员检查上传限制”，对应413。status/remote/fetch、handoff及上轮实施记录已复核，干净隔离工作树HEAD与origin/main均为c7b21aa22acb456d6bac677edad34f65fa8f5919，建立codex/harmony-upload-part-boundary-20261101。原E:/saydian h5脏文档与未采用的灾备超时方案stash保留。Start/Publish仅支持main，本分支手动执行同等门禁、显式文件及实施日志提交。

## 根因与修改

- 无管理员凭据的线上PUT探测：512KiB及1MiB multipart均正常到达鉴权层并返回401，不写会话/文件/配置。本次不把网关限制作为原因、不修改共享网关。
- 本地以Nest生产实际解析器重现：1048575字节通过，1048576字节返回413/LIMIT_FILE_SIZE，1048577字节拒绝。API独立引用Multer为2.3.0，Nest平台内引用为2.2.0；此前本地全链路手工挂载前者，未覆盖生产装饰器的边界语义。新测试从真实控制器装饰器读取并实例化FileInterceptor，经实际本地HTTP multipart验证；修改前精确1MiB的断言失败，另外两项通过，故根因可重现。
- 仅将分片FileInterceptor的排除上限由chunkBytes调至chunkBytes+1；保留业务片段1MiB、总包128MiB、暂存配额、授权和顺序/长度/摘要检查。生产解析器现在允许精确1MiB，超过1字节即拒绝。不升级依赖、不扩大全站/整包上传限制，不更改文件清单或生产开关。
- 回归验证使用控制器实际装饰的Nest拦截器，不复制其参数或另选Multer版本。用户HAP仍只在本地测试，禁止将替身存储验收写成生产上传成功。

## 验证与发布

红灯：pnpm --filter @saydian/app-api exec vitest run src/support/app-package-multipart.test.ts，精确1MiB返回413导致1失败/2通过；修复后3项全通过。

完整串行pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check、pnpm tools:test及git diff --check均通过。API1445通过/67项可选实库跳过，后台275通过，接口目录486路由；部署脚本/工具及H5流程与契约检查通过。无依赖变更。

将Git外实际HAP浏览器夹具改为反射控制器的真实Nest拦截器后，再次验证19067214字节/SHA cd1526fef3ddc8e246c40ba1d8de90a6bf9b5d7e3b9b514b62ade141c1907b17全链路成功，20次请求（19片加1次重试）、每片最大1048576字节；故意丢弃片段和完成响应后恢复，仅一次存储替身写入/一条文件记录、零配置保存、零页面异常。回执artifacts/harmony-boundary-20261101/browser-result.json；不包含真实对象存储或生产管理员上传验收。

云端CI与生产发布仍须按后续实际回执核对，不将本地通过写为已经部署；此前c7b21aa发布记录不代表本次边界修复已上线。
