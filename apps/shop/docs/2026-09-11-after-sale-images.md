# H5 售后私有证据图片

本轮在共享工作区续作，已读根 AGENTS、handoff 和最新售后/恢复记录；按主任务协调不重复 fetch、提交、部署或根构建。仅修改 apps/shop。

## 修改

- after-sale-images.ts 固定同源接口与 Bearer 请求头，限制 JPG/PNG/WebP、10MB、9 张、UUID 唯一编号；拒绝任意来源地址和临时未验证交易身份。上传成功校验回执；401 提示重登录，不自行刷新或清理登录态。
- ImageEvidencePicker.vue 支持图片选择、逐图进度、失败重试/移除、能力未配置禁选、成功私有预览、已传编号恢复。账号/会话变化会取消进行中的请求，迟到回包不回填；图片读取不跟随重定向，使用私有 Blob URL，移除/卸载时释放 URL。
- 售后页面在上传中或失败未移除时阻止新提交；只在上传成功后引用 evidenceFileIds。首次提交前持久化原编号和原幂等 payload，跨刷新恢复不修改原请求；冻结后禁选/重传/移除。旧空 evidenceImages 草稿仍按原 payload 回放，不擅自改写。
- 国际 H5 白名单仅补充此用途的 POST 上传、GET capabilities、GET UUID 私有读取路由，不开放任意文件或员工 API。

## 检查

- node --test tests/after-sale-images.test.mjs tests/order-after-sale-flow.test.mjs：27/27 通过，全部使用合成文件与模拟请求，无真实上传。覆盖大小/格式/数量、回执、401、私有预览、重定向限制、会话切换、进度、失败重试/移除、未配置、冻结回放与既有订单售后流程。
- pnpm --filter @saydian/app-shop typecheck：通过。首次发现 exactOptionalPropertyTypes 不允许直接把 file 设 undefined，改为上传成功后 delete row.file 后通过。
- git diff --check（上述文件）：通过。

真实对象存储、微信浏览器相册/相机、私有权限及已部署 API 联调仍由主任务统一验收；本记录不代表生产已开通。

## 已提交售后图片查看补记

- ImageEvidencePicker 增加 readonly 展示，仅读取原 ID，不请求 capabilities，不显示添加/移除/未决申请文案；所有变更方法同步拒绝只读调用。
- order-detail 只解析 canonical file:UUID 引用并去重，挂载私有图片查看；任意外部 URL 不渲染、不请求。
- 售后、图片、商品导航三组定向测试 42/42 通过，shop 类型检查及差异检查通过。
