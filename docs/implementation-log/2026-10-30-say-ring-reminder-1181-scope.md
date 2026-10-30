# Say Ring 1181 手动测量与个人提醒范围说明

用户本会话此前明确允许发布Say Ring版本适用说明并继续送审，约束为仅版本说明、不改协议正文/同意版本/其他产品或用户数据；最新要求加入HRV疲劳参考、温度偏高提醒并更新下载页和提交审核。本轮仅补充该产品新iOS构建适用说明，沿用此已授权范围，不创建或启用法律文档。

已读AGENTS、handoff、手机号登录及H5下载最新记录。原main干净，fetch/ff-only至09d8b0f4c885e737ec529669314a2bc1d732986a；root/global生产readiness均为该SHA。创建独立codex/say-ring-reminder-scope-1181-20261030工作树，保留原工作区与H5同事改动。

唯一运行文件为say-ring-legal-page.ts，追加1181版本说明：真实能力与独立原生手动ACK、个人设备/固件参考、默认关闭、历史/缓存/预览排除、本机加密记录/普通系统通知/声音及单次振动、HRV与皮温局限、不新增iOS生理上传。旧构建说明、当前数据库文档正文及版本、睡眠单独说明、登录同意、系统配置和其他产品不变。

新增合成测试验证中英文范围、文档对象/正文/版本未改和无同意写入；全量串行检查、CI、生产revision、公开渲染与登录配置分别续记。只使用[deploy cn only]，不部署美国环境，不迁移或seed，不开放业务写入。

独立工作树offline/frozen/ignore-scripts安装与Prisma本地生成通过。首次定向测试因共享contracts尚未构建而无法解析包入口；保留原失败日志，按根级typecheck先构建依赖后重跑通过，不放宽断言。串行typecheck、18项法律页定向、全工作区test、build、482路由文档与工具/部署检查通过；API1422通过/67项实库选项本机跳过，Admin267、Worker152、VIP81、下载41、迁移11、contracts87、commerce28通过。日志保存在ignored artifacts；未运行真实短信、支付、数据库迁移或业务写入。
