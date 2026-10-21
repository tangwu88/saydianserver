# 三处商品目录分类筛选与分页

## 范围与基线

- 用户要求主后台“商城 → 商品”“品牌伙伴 → 等级合作价”及品牌伙伴 H5 商品采购增加分类筛选、默认每页10条及可选页容量，并发布中国站。只修改相关管理端/H5/API，不修改原生 App、支付库存规则或生产配置。
- 已读 AGENTS.md、docs/handoff.md 及最新图片性能/比例实施记录。原 E:/saydian h5 工作树存在前轮改动，完整保留；从真实 fetch 后的 origin/main c0f46f1287e86fbc9c7441822633d252bb80ea64 创建隔离工作树 E:/saydian-catalog-pagination-20261021、分支 codex/catalog-filters-pagination-20261021。
- Start-Change/Publish-Change 仅接受 main；沿用隔离分支显式文件提交、PR完整CI及核对main后合并方式，不覆盖原工作树、不强推。发布前重新 fetch 发现新主线 c344af852b5738affdca87853c15dc3905dd1fac（首页/分类图片优化），停止直接提交发布，保存本轮改动至具名stash后在干净分支rebase同步，再apply完整恢复，无冲突；stash保留作为恢复点。最终门禁以新主线重跑。

## 实现

- commerce/product-list-query.ts 统一商品分页参数：默认10，上限100，非法值回退、小数取整、页号有界；分类来自原 CommerceCategory，返回层级label。支持全部、未分类、具体分类及其所有后代；按精确分类ID，旧分类循环不会死循环。
- AdminService.commerceProducts、PartnerAdminService.groupedPrices、PartnerCommerceService.products 将分类条件与原搜索/状态/权限条件组合后查询列表和总数，支持pageSize/categoryId。按商品分页后取其全部相关规格，不截断SKU组；商城增加ID稳定排序。旧合作价SKU平铺兼容接口保持原行为。
- ResourceView/CommerceWorkspace、PartnersView、vip Products 增加分类选择与每页10/20/50/100条控制；即使只有一页也能改页容量。筛选或页容量变化回第一页；采购保留跨页已选数量与原结算校验，合作价切页清除批量选择，防止误删隐藏规格。迟到响应不能覆盖新筛选结果，失败清除陈旧列表，保留重试入口。
- 查阅本地已安装Element Plus实现发现仅监听change不能满足受控分页组件的监听要求，改用current-change/size-change及重复值保护；API契约说明与三份生成目录同步更新。无SQL/迁移、新依赖或生产数据写入。

## 验证、失败与修复

- corepack pnpm install --offline --frozen-lockfile、pnpm db:generate完成；首次定向测试缺共享contracts/domain构建，运行根typecheck生成后通过。系统python为无效Windows别名且py指向失效I盘，停止使用，改用本地Node编辑，不修改系统Python。
- 新6项服务端测试覆盖参数界限、分类子树/同名隔离/未分类/循环、三个查询的筛选与总数一致及采购权限保留。原分组测试更新默认10，继续覆盖35规格完整保留及不同商品ID不合并。
- 增加后台筛选/分页网络参数、页号重置/异步竞态/批量选择清理，采购跨页数量小计保留/迟到响应与错误回归。补充真实PostgreSQL用例：13个独立商品及各2个规格、12个下级分类商品10+2分页不重不漏、20条容量与未分类；只在隔离本地/CI数据库运行。
- 首次typecheck发现新测试误用数组envelope夹具，修正后通过；原删除商品测试补充新查询参数。Node生成实库测试的辅助脚本一次语法错误，未写入任何该脚本目标文件，后改显式patch成功。
- 首轮全量test退出0：API1312通过/38本地实库跳过、后台260、伙伴74、商城190、下载41、Worker141。build、api:docs:check、tools:test、diff检查退出0；最终主线重验结果续记。
- node_repl浏览器运行时初始化两次均报模块默认导出错误；普通本地无头Edge启动被自动审批明确策略拒绝，未重试规避。隔离本地HTTP夹具未接生产、已停止；没有采用浏览器截图或声称微信真机/浏览器视觉验收。交互以组件行为回归及编译校验为依据，真实PG由CI验收。

## 发布边界

- 中国站合并使用[deploy cn only]，保持现有维护/停写/worker/回调值，沿用CI单次构建清单与受限发布。提交或推送不等于上线；必须确认PR CI、main CI/生产发布及双readiness实际revision、后台和VIP实际JS资源。线上账号下的真实筛选与手机微信效果另验，不创建生产商品、账户或订单夹具。

- 同步c344af8后的最终串行门禁全部退出0：corepack pnpm typecheck、pnpm test、pnpm build、pnpm api:docs:check、pnpm tools:test、git diff --check。API1312通过/38仅本地跳过，后台260、伙伴74、商城193、下载41、Worker141、contracts58、commerce-domain28、migrator11通过；API目录459路由。工具检查58项、H5流程62项、H5契约38项通过。真实PG新增分页验收等待PR CI，不视为本地已运行。
- 2026-10-21 09:54发布前重新fetch/prune确认HEAD与origin/main均c344af852b5738affdca87853c15dc3905dd1fac；仅显式提交本轮23个源码/测试/契约/实施记录文件，无生成产物、密钥、服务器备份。CI及线上回执保留ignored artifacts/release，未取得实际发布成功前不称已上线。
