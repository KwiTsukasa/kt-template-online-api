# API 使用约定

本地默认服务：`http://127.0.0.1:48085`。字段、参数和响应 Schema 以当前运行版本生成的 OpenAPI 为准：

| 入口 | 内容 |
| --- | --- |
| `/api` / `/api-json` | 全量 Swagger / OpenAPI JSON |
| `/api/admin` | Admin |
| `/api/bot` | Bot 与适配器 |
| `/api/plugin-platform` | 插件平台 |
| `/api/basic` | 基础能力 |

## 认证和响应

管理接口使用 `Authorization: Bearer <accessToken>` 或登录返回的 HttpOnly `admin_access_token` Cookie；公开范围以 Controller 的 `@Public()` 为准。生产登录、刷新、退出及密码操作要求可信 TLS 入口；不要把客户端提供的转发头当作可信代理证明。

普通成功响应为 `{ "code": 200, "msg": "操作成功", "data": {} }`；错误响应中的 `err` 是字符串。文件、SSE、WebSocket 使用各自协议，不能按普通 JSON 包装解析。

- Snowflake/BIGINT 身份以字符串传输，避免 JavaScript 精度丢失。
- 时间默认格式为 `YYYY-MM-DD HH:mm:ss`，具体字段以 DTO 为准。
- `POST */save` 默认忽略请求体 `id`；更新应使用对应更新接口。
- Token 刷新会轮换凭据，旧 refresh token 不可重复使用；登出撤销当前登录 family。

## 媒体与任务协调

媒体刮削校验和下载/治理是两个独立模块。目录身份遵循 `Series -> Work -> Season/Episode -> Task`；调用方不能通过根 Task 创建或猜测作品身份。正式下载/治理依赖可用的执行器，缺少配置时返回失败，不模拟成功。

`GET /codex-remote/coordination` 提供跨任务协调快照，`GET /codex-remote/coordination/events` 提供 SSE。两者要求后台登录及 super 权限；上游不可用应展示不可用状态。文件占用、冲突与过期声明的语义见 [详细合同](../../docs/projects/api/contracts.md)。

详细业务约定集中于 [API 合同参考](../../docs/projects/api/contracts.md)，不在本文件复制所有路由或操作日志。
