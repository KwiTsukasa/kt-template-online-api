# QQBot NapCat WebUI Gateway 设计

## 背景

QQBot 当前已经由 API 管理 NapCat 容器、WebUI token、登录 session、运行态证据和账号拆分状态。Admin 可以使用定制过的登录弹窗完成扫码、验证码和新设备流程，但还不能从某个 QQBot 账号定点打开原版 NapCat WebUI。

本次目标是在 Admin 中打开指定账号对应的原版 NapCat WebUI，并允许完整操作，同时不把 NapCat 容器端口、WebUI token、Credential 或 NAS 拓扑暴露给浏览器。

## 目标

- 在 QQBot 账号列表的账号连接列或操作区增加 WebUI 入口。
- 点击入口后进入二级路由页面，而不是抽屉。
- 使用独立 `kt-napcat-webui-gateway` 微服务承载 NapCat WebUI 代理。
- Gateway session 跟随二级页面生命周期创建、心跳和销毁。
- iframe 内允许 NapCat WebUI 完整操作。
- 浏览器侧不暴露 NapCat token、Credential、容器 IP、宿主端口或 NAS 内网信息。
- 记录 session 创建、激活、心跳、撤销、过期和代理失败审计证据。

## 非目标

- 不把 NapCat WebUI 重写成 Admin 原生组件。
- 第一版不做只读限制。
- 不直接公开 NapCat 容器端口。
- 不允许浏览器通过 Gateway 任意代理外部 URL。
- 不把该 Gateway 合并到现有 NapCat 登录 SSE 状态机。

## 页面形态

Admin 新增二级路由：

```text
/qqbot/account/:accountId/napcat-webui
```

QQBot 账号列表的 WebUI 按钮跳转到该路由。页面是远程控制台，而不是抽屉。页面结构：

- 顶部是 Admin 自己的轻量控制栏：返回账号列表、账号信息、容器状态、session 状态、刷新 session、关闭 session。
- 主体是全高 iframe，加载 Gateway 返回的 NapCat WebUI URL。
- 未授权、无容器、WebUI 离线、session 过期、Gateway 不可用时显示明确错误态。
- 页面高度遵循 Vben Layout 内容区，不额外制造 body 滚动。

刷新页面会创建新 session；旧 session 通过主动 revoke 或 heartbeat 超时清理。重复从账号列表打开同一账号时创建新 session，不复用旧 session。

## 总体架构

```text
Admin 账号列表
  -> Admin 二级路由 /qqbot/account/:accountId/napcat-webui
  -> API 创建 route-bound Gateway session
  -> Gateway 保存活跃 session 与 NapCat 目标信息
  -> Admin iframe 打开 Gateway bootstrap URL
  -> Gateway 反代 NapCat WebUI HTML、静态资源、API 和 WebSocket
  -> NapCat WebUI 容器
```

API 是 Admin 鉴权和 QQBot 账号绑定的权威。Gateway 是 WebUI 代理 session 和 NapCat WebUI Credential 交换的权威。

## 服务边界

### API 服务

API 负责 Admin 侧鉴权和账号解析：

- 校验 Admin JWT 与 QQBot 账号权限。
- 根据账号解析 selfId、主 NapCat 绑定、容器 ID/名称、WebUI base URL 和 WebUI token。
- 在创建 Gateway session 前拒绝无容器、容器离线、WebUI 不可用或无权限的请求。
- 使用服务间密钥调用 Gateway 内部接口。
- 只把 `sessionId`、`iframeUrl` 和安全展示字段返回给 Admin。
- 代理 Admin 发来的 heartbeat/revoke 到 Gateway 内部接口。
- 写入或转发审计事件。

API 不返回 `webuiToken`、NapCat Credential、容器 IP、宿主端口、Docker 网络或 NAS SSH 信息。

### Gateway 服务

`kt-napcat-webui-gateway` 独立进程、独立镜像、独立 K8s Deployment。它负责：

- 活跃 session 存储与 TTL 管理。
- 一次性 iframe bootstrap ticket。
- 按 NapCat 现有契约使用 `sha256(token + ".napcat")` 登录 WebUI 并换取 Credential。
- 反代 HTTP 方法、静态资源、WebUI API、重定向、Cookie 和 WebSocket upgrade。
- session heartbeat、revoke、expire 和清理。
- Gateway 侧审计和结构化日志。

Gateway 只代理 session 内已绑定的目标容器，不接受浏览器传入的 upstream URL。

### Admin 前端

Admin 负责路由页面和生命周期：

- 账号列表 WebUI 按钮跳转到二级路由。
- 页面 mounted 时创建 session。
- session 创建成功后再加载 iframe。
- 页面 mounted 期间持续 heartbeat。
- 路由离开、显式关闭、组件 unmount、浏览器卸载时尽量 revoke。
- session 过期或失败时展示可读错误态，避免 iframe 白屏。

## Gateway Session 生命周期

session 是页面生命周期租约：

```text
created -> active -> revoked
created -> expired
active -> expired
created/active -> failed
```

创建流程：

1. Admin 二级页面 mounted，调用 `POST /qqbot/napcat/webui/session`。
2. API 校验当前 Admin 用户并解析目标账号的 NapCat 容器。
3. API 调用 Gateway 内部 `POST /internal/sessions`，传入安全账号元数据和服务端目标凭据。
4. Gateway 创建带 TTL 的 session，并生成一次性 bootstrap ticket。
5. API 返回公开 iframe bootstrap URL。
6. iframe 打开 bootstrap URL，Gateway 兑换一次性 ticket，设置 HttpOnly、路径隔离的 gateway cookie，并跳转到 session WebUI 根路径。
7. Gateway 在第一次成功代理 WebUI 响应后将 session 标记为 active。

心跳和清理：

- Admin 页面 mounted 时每 15 到 30 秒发送 heartbeat。
- Gateway 更新 `lastSeenAt`。
- 60 到 90 秒无 heartbeat 时 Gateway 自动 expire。
- 路由离开、显式关闭、组件 unmount 时主动 revoke。
- `beforeunload` 使用 sendBeacon 尽量 revoke；正确性仍依赖 TTL，因为浏览器卸载不保证执行。

并发策略：

- 同一个 Admin 用户对同一个 QQBot 账号只允许一个活跃 WebUI session。
- 创建新 session 时撤销旧 session。
- 不同 Admin 用户需要各自鉴权并创建独立 session。

revoked 或 expired 后，Gateway 对 iframe/proxy 请求返回 410，并展示“会话已关闭，请重新打开”的轻量错误页。

## 接口契约

### API Admin 接口

```text
POST /qqbot/napcat/webui/session
Body: { accountId: string }
Result: {
  sessionId: string;
  iframeUrl: string;
  expiresAt: number;
  account: { id: string; selfId: string; nickname?: string };
  container: { id: string; name: string; webuiStatus: string };
}

POST /qqbot/napcat/webui/session/:sessionId/heartbeat
Result: { sessionId: string; expiresAt: number; status: "active" }

POST /qqbot/napcat/webui/session/:sessionId/revoke
Result: true
```

这些接口只返回展示安全字段。

### Gateway 公开接口

```text
GET /napcat-webui/session/:sessionId/bootstrap?ticket=...
GET /napcat-webui/session/:sessionId/webui/*
POST /napcat-webui/session/:sessionId/webui/*
WS  /napcat-webui/session/:sessionId/webui/*
```

bootstrap ticket 短期有效且只能使用一次。ticket 兑换后，浏览器只依赖路径隔离的 gateway cookie，不在地址栏长期保留 bearer token。

### Gateway 内部接口

```text
POST /internal/sessions
POST /internal/sessions/:sessionId/heartbeat
POST /internal/sessions/:sessionId/revoke
GET  /internal/health
```

内部接口需要服务间密钥或等价的集群内边界，不通过公开 Admin 域暴露。

## 代理行为

Gateway 必须支持：

- NapCat WebUI 使用的全部 HTTP 方法。
- JSON 和二进制 payload。
- 静态资源。
- `Location` 重写到 Gateway session 前缀下。
- Cookie path 改写到当前 session，避免跨账号串用。
- WebSocket upgrade。
- 敏感响应使用 `Cache-Control: no-store`。
- 处理或替换会阻止 Admin iframe 的 upstream frame header，同时保留 Gateway 自身安全 CSP。

如果 NapCat WebUI 输出绝对 `/api` 或 `/webui` 路径，Gateway 需要重写 HTML 和响应头，让浏览器请求始终留在：

```text
/napcat-webui/session/:sessionId/webui/
```

Gateway 必须拒绝路径穿越、编码 URL 注入和任何逃逸当前 session 前缀的请求。

## 安全模型

iframe 内允许 NapCat WebUI 完整操作。因此权限语义必须直接明确：能进入该账号 NapCat WebUI 二级页面的 Admin 用户，就拥有该账号 NapCat WebUI 的完整操作权。

安全控制：

- API 创建 session 前校验 Admin JWT。
- Gateway session 绑定 Admin 用户 ID、账号 ID、selfId、容器 ID、客户端信息和页面租约。
- NapCat WebUI token 与 Credential 只存在服务端。
- 浏览器可见 URL 最多包含一次性 bootstrap ticket。
- Gateway cookie 使用 HttpOnly、Secure、SameSite，并按 session path 隔离。
- 公开 Gateway 请求不能选择 upstream host 或 port。
- API 到 Gateway 的内部调用必须鉴权。
- 审计记录用户、账号、selfId、容器、session、事件类型、IP、UA、时间和安全错误摘要。

## 数据模型

活跃 session 使用 Redis 保存，便于 Gateway 多副本共享：

```text
napcat:webui:session:{sessionId}
  status
  adminUserId
  accountId
  selfId
  containerId
  containerName
  upstreamBaseUrl
  encryptedWebuiToken or encrypted credential material
  createdAt
  activeAt
  lastSeenAt
  expiresAt
  revokedAt
```

审计历史持久化到 MySQL，可由 API 写入，也可以由 Gateway 通过 API 仓库管理的表写入：

```text
qqbot_napcat_webui_gateway_audit
  id
  session_id
  admin_user_id
  account_id
  self_id
  container_id
  event_type
  client_ip
  user_agent
  detail_json
  create_time
```

审计表不保存 WebUI token、NapCat Credential、QQ 密码、验证码 ticket、二维码内容或原始代理响应。

## 部署

第一版源码放在 API 仓库，但作为独立服务构建和部署：

- 独立 `kt-napcat-webui-gateway` app entry。
- 独立 Dockerfile 或 Docker build target。
- Jenkins 构建并推送 Gateway 镜像。
- K8s 独立 Deployment 和 Service。
- Caddy/Admin 域增加路由，例如：

```text
https://admin.kwitsukasa.top/napcat-webui/*
```

该路由指向 Gateway 服务，现有 API 继续位于 `/api/*`。本地开发需要等价 Vite 或 Caddy proxy，避免为了 iframe 调试而暴露 NapCat 容器端口。

## 错误处理

- 账号不存在或无有效 NapCat 绑定：页面显示空状态并提供返回账号列表入口。
- 容器离线或 WebUI 不可用：session 创建前失败，并展示 API 返回的运行态证据。
- Gateway 无法登录 NapCat WebUI：session failed，展示脱敏错误并写审计。
- session 过期或撤销：iframe 收到 410，Admin 页面提供重新打开按钮。
- Gateway 代理目标超时：显示错误覆盖层，保留页面顶部控制栏。
- API/Gateway 不只依赖本机时钟判断正确性，清理以 Redis TTL 和 heartbeat 时间戳为准。

## 验证策略

API：

- 单测账号权限和 session 创建 DTO。
- 单测 Admin 响应不包含敏感字段。
- 集成测试 API 通过 mock Gateway client 创建、心跳和撤销 session。
- 审计测试覆盖 create、active、heartbeat、revoke、expire、proxy failure。

Gateway：

- 单测 bootstrap ticket 兑换和一次性使用。
- 单测 session TTL、heartbeat、revoke 和同用户同账号并发 session 撤销。
- 代理测试覆盖路径重写、Cookie 隔离、重定向重写、禁止 upstream URL 注入。
- 如果 NapCat WebUI 使用 WebSocket，则增加 WebSocket upgrade smoke。

Admin：

- 账号行 WebUI 按钮路由跳转测试。
- 页面生命周期测试：mounted 创建 session、heartbeat、unmount revoke。
- 暗色主题和 Layout 高度测试。
- Playwright smoke：打开二级路由、等待 iframe shell 加载、离开路由、确认 revoke 被调用。

线上：

- Jenkins/K8s 部署 API 和 Gateway。
- 验证 Gateway health 与 Admin 域 `/napcat-webui/*` 路由。
- 打开账号 `1914728559` 的 WebUI 页面。
- 确认 iframe 加载原版 NapCat WebUI，浏览器 URL 不暴露 token、Credential、容器端口。
- 执行一个安全 WebUI 操作，例如读取登录状态或打开设置页。
- 离开路由后确认 session revoke 或 heartbeat 超时回收。

## 完成标准

- Admin 支持按 QQBot 账号打开二级 NapCat WebUI 页面。
- Gateway 独立部署且可观测。
- iframe 中完整 NapCat WebUI 操作可用。
- 浏览器侧不暴露 NapCat token、Credential、容器 IP、宿主端口、NAS SSH 路由或 QQ 密码。
- session 生命周期跟随 Admin 二级页面，路由离开或 heartbeat 超时后会清理。
- API、Gateway、Admin 测试和线上 smoke 证据齐全后才算完成。
