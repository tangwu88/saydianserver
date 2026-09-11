# 售后图片：私有上传、会员引用与后台授权查看

## 范围与接口

- 继续共享工作区，保留原变更，不提交、部署、生成根文档或运行根构建。原 SupportService/S3/FileObject 已存在，但旧公开读取仅支持头像，售后不能直接复用其返回 URL。
- 新增商城认证路由：GET `/storefront/after-sale-images/capabilities`；POST `/storefront/after-sale-images`，multipart 字段 `file`；GET `/storefront/after-sale-images/:id`，私有二进制。仍由 UserAuthGuard 校验真实会员/已验证交易身份，临时手机登记会话不开放。
- 上传回执仅含 id、byteSize、contentType、sha256，不返回公开链接。能力返回 enabled、maxFiles=9、maxBytes=10485760、contentTypes；存储未配置时禁用并说明仍可提交文字，配置检测不宣称真实上传成功。
- 售后新增可选 evidenceFileIds，严格最多 9 个不同 UUID；事务内校验本人 ACTIVE FileObject、专用 commerce_after_sale 用途、大小/类型，存现有 evidenceImages 为 `file:<UUID>`。不新增 schema。global 不接受非空外部 evidenceImages；国内原客户端 legacy evidenceImages 保持原语义，新 IDs 同样严格验证。原空图片请求与已保存幂等请求不改变。
- 后台新增 GET `/api/saydian-app/admin/v1/commerce-after-sales/:saleId/evidence/:fileId`，AdminAuthGuard + 售后 read 权限 + 售后实际关联 + 原订单会员归属，成功读取写 COMMERCE_EVIDENCE_READ 审计。头像公共 reader 仍不能读取该用途。

## 实现

- SupportService 只增售后专用方法，复用原 S3 私有读写，不改变头像/反馈/ECG 上传语义。校验实际 Buffer 长度、10MB 限制、JPG/PNG/WebP MIME 和签名字节，PNG 首尾/IHDR 与尺寸、WebP 容器长度；不引入图像库，不声称执行完整图片解码/病毒扫描。
- 上传 12 次/分钟、单请求 1 文件；图片 reader 返回 private/no-store、nosniff、no-referrer、限制 CSP，不接受外部地址，不公开对象桶。
- H5 选择/上传进度、失败重试和移除、私有预览由新 ImageEvidencePicker/after-sale-images 实现。只有回执成功才能进入 evidenceFileIds；上传中或失败未移除时禁新提交，冻结原请求 IDs 跨刷新/返回不重传、不更换。账号变化取消旧请求、拒绝回包；Blob URL 在移除/卸载时回收。
- 后台 CommerceWorkspace 的售后详情增加 AfterSaleEvidence 私有 viewer；沿用 axios 管理员 Bearer，以 Blob 读取展示，权限不足/格式错误显示可重试失败，不把 token 放 URL。drawer 关闭、售后变更和管理员切换取消并回收。
- 按主任务追加，订单详情状态提示改为面向顾客的待发货/发货/售后等文案，刷新按钮为“刷新订单状态”，付款确认提示精简；未改变支付行为。

## 文件

- API：commerce-evidence.ts/controller/module/test、SupportService、AppModule，CommerceStoreService 仅 afterSaleEvidenceReferences 校验/存储行。
- 后台：AfterSaleEvidence.vue、after-sale-evidence.test.ts，CommerceWorkspace.vue 仅 import 与只读详情挂载。
- H5：after-sale-images.ts、ImageEvidencePicker.vue、after-sale 页/相关测试、realm-config 三条精确路由；子任务记录位于 apps/shop/docs/2026-09-11-after-sale-images.md。

## 验证与失败修复

- API `pnpm.cmd exec vitest run src/commerce/commerce-evidence.test.ts src/commerce/commerce-customer-assets.test.ts src/commerce/commerce-store.test.ts`：47/47，通过图片签名/大小、私有所有权、禁公开读取、引用数量/用途/归属、管理员权限/关联/审计、未配置无伪造，以及现有售后幂等/交易回归。
- 后台 `pnpm.cmd exec vitest run src/after-sale-evidence.test.ts`：4/4，通过规范引用/同源读取、非法图片响应、账号或售后切换、关闭取消及 Blob 回收。
- API tsc、后台 vue-tsc：首轮通过。新增测试后 API tsc 发现无参数 mock 的 calls 元组读取类型错误，补充准确 mock 参数后重验；无运行时业务修改。
- H5 子任务最终上传/售后/导航 42/42、shop 类型和 diff-check 通过，全部合成文件及模拟接口，不上传用户照片，不向真实对象存储发测试文件。已提交售后只读图片同样私有读取，仅接受规范 file:UUID；只读模式没有上传/移除或“待确认锁定”文案。
- API 新测试 mock 参数修复后 tsc 通过；后台新增 viewer 测试后 vue-tsc 再次通过。部署 Nginx 模板现有 client_max_body_size=35m 足以承接 10MB 单图，本子任务未改网关配置。
- 完整最新定向结果由主任务汇总，根回归/生成/构建继续串行。

## 外部边界

- 未检查或修改生产对象存储密钥，也未宣称真实 S3/COS 回执或微信相册真机验收。对象存储配置与实测外部回执单独验收。
- 移除只移除本次申请选择及临时预览，不删除已上传对象；未关联私有对象的保留清理由后续受控策略处理，不能擅自删除既有证据。

## H5 友好提示收尾

- 图片 capability 失败/禁用统一为“暂时无法添加图片，您仍可提交文字说明。”，不把 Cannot GET、接口地址或内部配置原因展示给顾客；真实 API 和后台配置状态未修改。
- 上传、私有预览分别使用固定中文失败提示，保留重试/移除和身份保护。缺图片服务仍允许纯文字售后；失败的已选图片须重试或移除，规则不变。
- 仅修改 after-sale-images.ts、ImageEvidencePicker.vue 和图片测试；`node --test tests/after-sale-images.test.mjs tests/order-after-sale-flow.test.mjs` 31/31 通过，新增原始技术异常/禁用原因/不阻断文字提交回归。scoped diff-check 通过；未跑根检查。
