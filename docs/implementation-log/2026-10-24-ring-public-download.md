# 赛电戒指下载页正式下载文案

- 用户确认赛电戒指已正式上线，要求 /down2 页面不再出现测试提示。干净 main 经 Start-Change 核对 HEAD/origin/main 均 eca857da1755d8e115cafdb90634276f5889a888，独立 codex/ring-public-download-20261024 分支。
- 只读核对公开戒指清单：Android 1.0.6（1137）为 available/direct，iPhone 1.0.4（1130）为 available/app_store，实际地址为 App Store 的 Say Ring 页面。界面“内部测试下载”“内部测试版”与“测试人员”来自共用静态模板，与当前渠道无关。
- 通用页眉改为“官方下载”，底部改为“安装提示”及客服联系文案；Android/HarmonyOS 签名或安装失败说明改为联系客服。iPhone 初始化占位不再预设 TestFlight，实际渠道继续由已发布清单决定。保留签名不一致不要卸载旧版的提示及健康资料说明。
- 本轮只改 HTML 文案，不修改公开清单、历史兼容 audience 字段、安装包、版本、SHA、下载地址、上架状态或其他后台配置；国际旧 QA 包的专属说明仍由原逻辑按真实版本显示，不将未发布渠道改成可用。导航三 App 的原始目的地址不变。
- 不为低影响文案新增逐字断言，沿用现有功能测试；运行仓库要求的全量文档/工具/类型/测试/构建/diff 门禁，另用真实公开戒指清单检查本地及线上桌面/手机页面、安装说明和下载链接。中国站发布标题保留 [deploy cn only]；CI、双地址 readiness 和实际 HTML/JS/CSS/可见文案分别验收，结果续记。
- 本地实际浏览器使用当前公开戒指清单验收通过：/down2 的1214桌面、390手机及 /say-ring 390手机。展开全部可见安装说明后无“测试”字样，无横向溢出、页面异常或失败请求；Android仍为原APK地址、iPhone仍为同一App Store链接。截图与清单副本留在 ignored artifacts/ring-public-download-20261024，不将安装包或生产配置写入Git。
- 最终串行门禁全部通过：文档0.36秒、工具62.42秒、类型8.48秒、测试19.09秒、构建9.61秒、diff0.01秒。本地手机/桌面实际浏览器通过后，发布前重新fetch并核对基线；Publish-Change限定main，按当前独立分支惯例显式提交HTML与本记录两个文件，GitHub blob/完整tree与本地提交逐一比对，再合并并等待主线CI及真实上线验收。
