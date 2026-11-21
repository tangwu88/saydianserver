# 2026-11-21 Saydian赛电独立中文协议上线

用户要求继续前一日工作。af679bd功能分支已完成本地完整检查，本轮先建立PR72（https://github.com/tangwu88/saydianserver/pull/72），Linux CI 44851238069的verify成功后按明确中国发布范围合并，main为513810813eb64f2d27e15beaeb07a33d8b2bcc49，提交标记[deploy cn only]。不改已有工作区或强推。

main CI / 发布44852506326全部成功，美国发布任务跳过。根路径及/global/health/ready均实读新revision、database ok；后台实际JS包含两种CN独立文档类型。发布沿用routine流程保留现有私有compose，没有迁移、seed或维护/worker暂停开关调整。首轮只读健康检查一次/global返回503，重查双入口均为原409857b就绪，发布前已恢复，未据此重启服务。

后台先以active=false、reviewed=false保存两份中文译稿。用户随后明确确认：用户、健康数据及备份实际存储在“中国”。据此在英文等义翻译基础上仅修正两份中文正文的第一方数据地域，并使用实际发布日期2026-11-21，不把英文原有美国地域和10月日期直接用于中文版。定稿为docs/legal/saydian-cn-{terms,privacy}-20261121.zh-Hans.html，原11月20日对照草稿保留作来源记录。

核对原英文已发布版本仍是global-appstore-2026-10-14-r2且正文与昨日快照完全一致后，完成中文正文和用户确认项核对，将CN两份同版本定稿启用。产品saydian-app-cn，版本saydian-cn-zh-2026-11-21-r1，locale zh-Hans。未声称新增律师审查或第三方认证；不将英文中其他产品的启用状态复制到CN。

上线后公开capabilities已实读product=saydian-app-cn、defaultLocale=zh-Hans及上述consentVersion；两个正文引用的类型/版本/语言/审核状态均匹配，本地定稿与公开HTML全文相同，含中国境内且不含美国。写入前后另外16份国际版/Say Ring等法律记录完整JSON摘要一致，无改动。

最终隐私正文SHA256 f4d1a2c95ff76dbb6f1cb3a9340e2222535e61982441b9fa202dbf4eb6cbfc42；用户协议7073bea463e3bc985ef0a5716a7356a0372dafd92a16054d1f6170150e493807。发布回执、草稿回执、其他文档摘要和公开配对验收在本机D:/Codex-CN-LEGAL-20261121，管理员凭据与Token仅在请求进程内使用，未写入文件/Git。

本轮新增仅为定稿HTML与交接记录，运行源码与已通过完整CI的5138108一致；不重复改动或发布运行镜像。定稿归档推送原功能分支，线上数据发布与源码归档区分。客户端独立2b01260的读取与同意版本接入正融合到1050，并与搜索/心电显示修正一并验收；旧1047未宣称已展示新政策。
