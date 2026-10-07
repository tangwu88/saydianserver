# 2026-10-07 微信登录和商品详情联调

用户反馈小程序微信登录报错及详情图片尺寸过大，截图显示 POST auth/wechat/mini 返回 401 和通用 Please sign in again。用户确认后台 AppID/AppSecret 属于导入配置的同一小程序；不读取或输出密钥。

在 codex/weixin-wxss-debug-20261007 保留上一轮样式修复，status/remote/fetch 成功，HEAD/origin/main 均为 0f3500102b6a85a3129f40842fa4564c784f8b25。已阅读 AGENTS、handoff、近期小程序和聚水潭诊断记录，无不相关改动纳入本轮。发布只更新本项目代码，不修改供应商配置、生产数据、维护状态或账号关联。

## 登录

开发工具真实登录页的协议复选框已由用户勾选。以 wx.login 获取新 code 并调用原接口复现 401，安全结果仅保存 status/message/requestId，不输出 code、会话或身份。requestId 为 bead6537-1fcf-490c-981c-0feb79a81fc5。没有绕过验证码、代用户创建或合并账号。服务端凭证交换错误原本不含 errorKey，被通用异常过滤器转为英文，具体原因不可见；尚不能断言是 AppSecret、AppID 或 code 错误。

新增 wechat-mini-error.ts，将一次性凭证失效/重复使用保留 401，其他供应商配置/服务错误归为 503；只返回稳定 errorKey、整数错误码和安全中文提示，不返回微信原始 errmsg、AppSecret、URL、OpenID、session_key。前端登录错误持续显示，兼容旧服务器英文通用错误，不让授权失败看起来像已有会员会话过期。实际根因须上线后按微信错误码再核验。

## 商品详情

原 H5 .detail :deep(img) 无法约束小程序 rich-text 内部图片。新增 product-rich-text.ts，对已由服务器清洗的 HTML 图片设置内联 width/max-width 100%、height auto，覆盖宽高和固定内联样式，保留 src、alt 与文案。不承担 HTML 安全清洗；服务器清洗仍保持。H5 的深层选择器仅编译到 H5。交付 miniprogram 原路径重新构建，保留用户两份 project 配置；独立 uniapp-source 同步同样源码。

## 验证

新增原生富文本图片尺寸/引号/文本回归测试，shop 142/142 通过。初次类型检查遇到正则捕获数组可能 undefined，补显式检查后 shop typecheck 通过。小程序构建通过。新增微信错误经真实 SafeHttpExceptionFilter 仍显示安全错误码的六条测试，与现有微信账号状态测试合计 35/35 通过。没有削弱账号状态、协议、绑定或支付限制。完整提交门禁及线上结果继续核对。

## 未验收

实际微信供应商失败原因待新错误上线后复测，首次会员绑定、短信和真实支付没有验收；不把新增错误提示当作登录成功。前轮下载域名读取仍失败，用户微信平台已保存，需工具和真机再次核对。后台凭证/平台域名只能由管理员修改，本轮不代填。
