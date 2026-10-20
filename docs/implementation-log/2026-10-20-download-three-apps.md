# 下载页三个 App 入口

- 用户要求去掉“原赛电 App”，统一为赛电中文、赛电国际、赛电戒指。安全 Start-Change 后基线 main 24e39eecfe76ce14d4c3ec5eff39450279fdf074，独立分支 codex/download-three-apps-20261020。
- 用户补充默认就是赛电中文 App。/down、/global/down 默认显示赛电中文（保留/down/cn别名），只读 product=saydian-app-cn 对应 cn_app_update；随后明确赛电国际导航指向 https://us.saydian.com/down/ ，只更新本站链接，不修改美国站内容/服务。兼容独立 /down/global 仍读取 saydian-global，戒指版 /down2 保留 say-ring；戒指页同样可以切换。标题、二维码、canonical 与所选 App 对应。旧下载直链与旧页面兼容保留，不作为第四个导航入口，不删除安装包或更改已发布版本。
- 中文版校验产品标识、各平台 packageId、独立文件名前缀；缺失或错误配置关闭下载，不回退旧版或国际版。沿用服务端当前仅发布中文版 Android 的限制；不凭空开放 iPhone/鸿蒙或借用其他产品安装包。不修改后台配置、数据、API和部署路由。
- 公开只读 GET 已核对三个独立产品配置均200。当前公开中文Android1016，iOS/鸿蒙待开放；不把配置状态等同于安装验收。新增中文版渲染、缺失配置、错误包身份/产品/文件及导航切换回归。
- 首轮rg命令因zsh未匹配的通配符中止，改用rg --files及明确目录继续；未修改系统或安装依赖。全量检查结果续记。
- 用户指定赛电戒指为 https://app.saydian.cn/down2 ，导航使用完整绝对地址；国际导航同样使用指定美国站完整地址。
- 串行全量检查全部退出0：api:docs:check 0.4秒、tools:test 61.6秒、typecheck 7.8秒、test 18.0秒、build 9.6秒、git diff --check。下载页41项、商城181项、伙伴66项通过；API1281通过/36个数据库用例本地跳过，真实数据库及镜像由CI验收。构建导航逐项核对三个地址，默认中文版二维码/canonical及产品隔离测试通过。国际目标真实GET为200。
- 当前无可用的内置浏览器操作入口，本轮验证是实际页面构建、处理函数测试及公开HTTP；未冒认真机安装或真实App版本更新。发布范围仅中国站，保留[deploy cn only]；不更改美国站网站或服务。
- PR49 合并 f715e9ca685c00b288dd7253c6678dcd1493e4a7，CI39373250092 verify/resolve/deploy均成功，US skipped；双readiness返回该revision。线上/global/down、/down、/down/cn、/down2均200。随后完整地址复核发现未在导航使用的/down/global兼容地址与已有静态global目录冲突（301后403），保留原失败结果，不将全验收写成通过。改为/down/international以避开目录，导航仍为用户指定美国站地址；无需改nginx、美国站或生产配置。修复后重跑全量检查与发布。
- 真实API下载配置经新manifest解析器逐项验证三个产品均通过；这只证明配置兼容，不等同于真机安装。
- 兼容路径补修后串行api:docs:check/tools:test/typecheck/test/build/diff再次全部通过（0.4/60.7/6.9/16.5/7.8秒）；公开GET /down/international为200，无目录跳转。保留first-release-acceptance.json及两轮检查输出，不隐藏初次兼容地址验收失败。
- PR50补修合并 aa647e90e2474e20cdb05c260c87a3e0bf3e0256；CI39374460933 verify/resolve/China deploy全部成功、US skipped。双readiness均ready/database ok、revision精确等于aa647e9。/global/down、/down、/down/cn、/down/international、/down2实际GET均200/no-store，逐项解析导航为中文/global/down、国际https://us.saydian.com/down/、戒指https://app.saydian.cn/down2；无旧版导航，入口脚本均为index-D_ZZGEEY.js。JS/CSS实际下载SHA256与本地构建相同，资源max-age=31536000；未宣称未返回的gzip。验收存于ignored artifacts/download-three-apps-20261020/production-acceptance.json。
- 最终fetch确认本地与origin/main均aa647e9且干净；本条回执以纯文档skip-ci提交，避免再部署相同源码。真机安装、App商店状态和安装包版本不在本轮修改/验收范围内。
