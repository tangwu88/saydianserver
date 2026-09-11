# 共享网关国际路由保留修复

## 范围

- 生产发布后发现国内 `app.saydian.cn` 网关模板重建成功，但同时移除了同一 TLS server block 内独立部署的 `/global/*` 路由。
- 本轮只修复共享网关重建时的国际路由保留逻辑和已确认的网关容器缺省名称，不改业务 API、数据库资料或供应商开关。

## 实现

- `configure-shared-gateway.sh` 在重建国内 HTTP/HTTPS 管理块前，先提取且校验唯一的 `SAYDIAN GLOBAL ROUTES` 标记块，再通过模板占位符放回同一 HTTPS server block。
- 未安装国际路由的环境保持空占位，不会自动创建国际服务入口。
- 网关容器缺省名称统一为生产实际名称 `saydian-gateway-1`，避免未显式配置时访问不存在的容器。
- 生产恢复操作必须先生成独立备份，执行 `nginx -t` 后才 reload；失败时恢复原文件。

## 验收

- GitHub Actions `34637031267` 第三次发布成功，目标业务版本 `82617ed092f6928201a81b9ba5ab2b413eb9439d` 已切换。
- 生产网关恢复前创建 `/opt/saydian/config/gateway-nginx.conf.before-global-restore-20260912T035600Z`；恢复后 `nginx -t` 与 reload 成功。
- 公网 `/health/ready` 和 `/global/health` 均返回 `ready`、`database=ok`、revision `82617ed092f6928201a81b9ba5ab2b413eb9439d`；`/admin/` 与 `/global/saidian-mall/` 均返回 HTML 200。
- `pnpm tools:test` 通过：10 项工具测试、61 项 H5 流程测试、38 项 H5/接口契约测试；其中新增夹具实际重建网关文件，验证标记块只保留一次且调用正确容器执行检查和 reload。
- 本日志随防复发提交一起再次进入 CI；最终以对应 Actions 结果和两个公网 readiness revision 为准。
