# KT Template Online API

本文是当前 API 的人工索引。字段细节、Swagger 示例和 DTO 以运行态 Swagger/Knife4j 为准：

- 全量 Swagger：`/api`
- OpenAPI JSON：`/api-json`
- Admin 分组：`/api/admin`
- Bot 分组：`/api/bot`
- Plugin Platform 分组：`/api/plugin-platform`
- 基础能力分组：`/api/basic`

## 通用约定

后端固定监听 `48085`。根路径 `GET /` 重定向到 `/api#/`。

除文件下载、SSE、反向 WebSocket 等特殊接口外，业务接口统一返回：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {}
}
```

错误响应统一把 `err` 输出为字符串：

```json
{
  "code": 400,
  "msg": "操作失败",
  "err": "错误原因"
}
```

### 认证

Admin、Component、Dict、MinIO、Blog、Bot、Bot Adapter 和 Plugin Platform 管理接口默认需要后台登录态。

支持两种 access token 传递方式：

- `Authorization: Bearer <accessToken>`
- 登录接口写入的 httpOnly `admin_access_token` cookie

公开接口包括 `/auth/login`、`/auth/refresh`、`/auth/logout`、部分 Blog public 接口和根路径。具体以 Controller 上的 `@Public()` 为准。

公网入口通过精确 `PUBLIC_SECURITY_TRUSTED_PROXY_IPS` 归一化客户端 IP 和公开 Origin；客户端自行提交的 XFF、X-Forwarded-Proto、Origin 或 Referer 不能扩展信任。`POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout` 必须先通过公开 Origin 的 TLS 门禁，再执行 token 或 Cookie 副作用；接收明文密码的 `POST /system/user`、`PUT /system/user/:id`、`PUT /system/user/:id/password` 也在用户服务、密码哈希和持久化前经过同一门禁。生产 HTTP 固定返回 403，`ADMIN_AUTH_ALLOW_INSECURE_LOCAL=true` 只在非生产 loopback 本地开发生效。登录请求体为 `username` + `password`，不再提供 `/auth/password-public-key`。access/refresh Cookie 固定 `HttpOnly`、`SameSite=Lax`、`Path=/`、无 `Domain`，生产始终 `Secure`；退出清理当前 Cookie 在 `/`、`/api/auth`、`/auth` 三种 Path 的历史残留。每次登录创建独立随机 `sid` 的 Redis refresh-token family；每个 refresh token 带独立 `jti`，刷新通过原子操作消费旧 `jti` 并在相同 `sid` 下签发新 token，并发或后续重放旧 token 返回 403。退出把整个 family 标记为已吊销，因此同 family 的新旧 refresh token 均不能再刷新；不同登录设备使用不同 family，互不影响。登录在一次 Redis Lua 调用中计数 IP 5 次/分钟、规范化用户名 SHA-256 10 次/15 分钟和全局 100 次/分钟，任一超限统一返回 429。真实认证成功后、签发 token 前只清理用户名 bucket，不清 IP 或全局；限流或 family 状态 Redis 失败返回 503。刷新和退出保留 IP/全局额度；签名校验成功的 refresh token 额外按 subject SHA-256 限制为刷新 30 次/分钟、退出 10 次/分钟，缺失、伪造或不含 `sid/jti` 的旧 token 不读取未验证 payload。普通公开读取 Redis 故障时 fail open 并限频告警。

密码持久化格式固定为
`$pbkdf2-sha256$v=1$i=600000$<salt-base64url>$<digest-base64url>`。旧明文迁移
使用编译后的 `pnpm admin-passwords:migrate -- <参数>`，依次执行
`--dry-run`、带数据库身份/维护确认/已有备份/`.kt-workspace` manifest 的
`--execute` 和 `--verify`，并用 `sql/admin-password-hash-verify.sql`
复核。哈希落库后禁止回滚到明文比较版本。

Blog 公开列表将 `pageSize` 限制为最大 100，不改变已认证管理列表的分页语义。Live2D 公开流每 IP 默认最多 8 条跨副本 Redis 并发租约；Lua acquire 先从 ZSET 清理过期成员，再以唯一 token 写入本次流，超限时精确移除该 token 并返回 429。活动流按半个 TTL 周期续租；HTTP `finish`、`close`、`error` 只幂等移除自身 token，过期旧流的 release 不会影响新一代租约，120 秒 TTL 继续兜底断连。Live2D Redis 故障遵循公开读 fail open。上述阈值、Redis 连接、可信代理和 Swagger 管理来源都出现在 required runtime config checks；生产 Jenkins 在发布前强制检查两个安全来源列表。

### ID 与时间

- 后台主键使用 Snowflake 数字 ID，接口按字符串返回，避免 JavaScript 长整型精度丢失。
- 后端格式化时间字段统一使用 `KtDateTime extends Date`：Entity 通过 `@KtDateTimeColumn(format)`、`@KtCreateDateColumn(format)`、`@KtUpdateDateColumn(format)` 在 TypeORM hydrate 边界转换；DTO/外部数据源通过 `@KtDateTimeField(format)` + `transformKtDateTimeFields()` 转换。默认输出 `YYYY-MM-DD HH:mm:ss`，可在装饰器中传入格式字符串；Create/Update 列显式配置 `precision` 时自动生成同精度 `CURRENT_TIMESTAMP(n)`，调用方显式 `default/onUpdate` 保持优先；响应包装不做递归遍历。
- `POST */save` 默认会删除请求体里的 `id`，防止新增接口误用前端主键。

## Runtime Health

| 方法  | 路径              | 认证 | 说明                         |
| ----- | ----------------- | ---- | ---------------------------- |
| `GET` | `/health/runtime` | 否   | API 运行时健康和配置检查状态 |

该接口返回 plain JSON，不使用 Vben 响应包装，供本地 smoke、Jenkins/K8s 和 ktWorkflow 观测脚本直接读取。接口位于 Swagger 基础能力分组 `/api/basic`。

顶层字段：

| 字段        | 说明                                     |
| ----------- | ---------------------------------------- |
| `service`   | 固定为 `kt-template-online-api`          |
| `checkedAt` | ISO 时间字符串                           |
| `status`    | `live`、`ready`、`degraded` 或 `blocked` |
| `checks`    | 进程和配置检查列表                       |

公开响应不返回数据库、Loki、NapCat SSH 等运行拓扑配置快照；配置检查只暴露 key 级别、是否存在和缺失说明。

状态含义：

- `live`：NestJS 进程能响应健康请求。
- `ready`：关键配置存在，当前检查未发现缺失项。
- `degraded`：可选运行时配置缺失，核心 API 可继续工作。
- `blocked`：关键运行时配置缺失，不能声明部署或运行态成功。

## Admin Environment Dashboard

| 方法   | 路径                                | 认证  | 说明                                              |
| ------ | ----------------------------------- | ----- | ------------------------------------------------- |
| `GET`  | `/system/environment/dashboard`     | 是    | 返回 Windows PC、NAS、R4SE 三设备权威环境快照     |
| `POST` | `/system/environment/self-check`    | 是    | 触发只读自检并返回最新环境快照                    |
| `GET`  | `/system/environment/events/stream` | 是    | SSE 推送后端环境事件，支持 `lastEventId` 查询参数 |
| `GET`  | `/system/mobile-home/bootstrap`     | super | 返回 KwiCore 环境与站内信只读聚合快照             |
| `GET`  | `/system/mobile-home/home`          | super | 返回 HA 区域、实体、场景、活动与能源快照          |
| `POST` | `/system/mobile-home/home/service`  | super | 执行幂等且白名单化的 HA 实体或场景动作            |
| `POST` | `/system/mobile-home/home/assist`   | super | 调用 HA Conversation 并返回脱敏 Assist 回应       |
| `GET`  | `/system/mobile-home/game`          | super | 返回 Sunshine 目录、GameStream 端口和 ViGEm 状态  |
| `POST` | `/system/mobile-home/game/pin`      | super | 提交内嵌 Moonlight 发起的四位临时配对码           |

环境总览接口使用 `Site -> Node -> Service -> Signal` 模型聚合状态，`unwired` 表示只读观测尚未配置，`unknown` 表示已知入口但缺少新鲜证据。Admin 首次加载通过 HTTP 获取快照，后续通过 API SSE 接收 local/MQTT 事件；前端不直接连接 MQTT，也不使用定时轮询。

当前版本只提供观测和只读自检。重启 Pod、触发 Jenkins 部署、执行迁移、重建 NapCat 容器、启停插件、立即执行插件任务、切换 OpenClash 或修改 WireGuard 等高风险能力只会以禁用动作展示，后端不提供通用写动作入口。

KwiCore Mobile Home 聚合接口返回 `data.environment` 与 `data.notices.items/total/unreadCount`，响应带 `Cache-Control: no-store`。通知仅投影移动端展示白名单并用 `KtDateTimeField` 格式化 `createTime/lastSeenAt`；环境与站内信权威读取并行执行，任一失败时接口整体失败。Remote 节点、短期 session、relay 和设置本机状态不进入该聚合合同。

Home 快照并行读取 HA REST 与 WebSocket registry，只保留移动端 domain 和 attributes 白名单；能源实体只返回真实 24 小时历史点。常见英文区域及 HA 内置备份/太阳历实体按稳定 ID 返回中文 name，未知用户自定义名称不猜译，entityId 与原始 state 仍保持协议值。实体动作必须携带合法 `requestId/domain/entityId/service`，服务与 data key 同时通过 allowlist 后才执行。Game 快照的 Sunshine Web UI 端口仅用于服务端 Basic 管理请求，Android 使用响应中的 `streamPort/httpsPort` 直连固定 WireGuard 主机；`virtualGamepadReady` 只在 Sunshine 同时确认 ViGEm 已安装且版本兼容时为真。PIN 接口不创建会话、不接收证书，也不代替 Moonlight 的原生挑战握手。

环境快照固定为七个稳定服务：Windows PC 的 `sunshine` 使用 Basic `GET /api/apps`、`codex-app-server` 使用 `GET /readyz`；NAS 的 `nas-api` 使用进程健康检查、`home-assistant` 使用 Bearer `GET /api/` 且要求 `message="API running."`、`bot-core` 使用 QQBot 在线摘要；R4SE 的 `r4se-wireguard` 读取固定隧道地址、`r4se-mihomo` 使用 Bearer 读取 `version/configs/proxies`。外部服务缺配置为 `unwired`，401/403 或超时为脱敏 `degraded`，任何响应都不返回凭据或服务正文；共享 client 默认严格 TLS，只有固定 WireGuard Sunshine HTTPS 请求显式允许自签证书。

## System 网络管理

| 方法     | 路径                                                | 认证    | 说明                                      |
| -------- | --------------------------------------------------- | ------- | ----------------------------------------- |
| `GET`    | `/system/network/port-forward/list`                 | `super` | 分页查询期望、同步、Keeper 与端点租约状态 |
| `POST`   | `/system/network/port-forward`                      | `super` | 新增 TCP/UDP 期望记录                     |
| `PUT`    | `/system/network/port-forward/:id`                  | `super` | 修改名称、协议和端口期望                  |
| `DELETE` | `/system/network/port-forward/:id`                  | `super` | 写入 absent tombstone，等待 Agent 确认    |
| `POST`   | `/system/network/port-forward/:id/retry`            | `super` | 提升 revision 并重试协调                  |
| `POST`   | `/system/network/port-forward/:id/keeper/enable`    | `super` | 启用同源端口 UDP Keeper 并立即探测        |
| `POST`   | `/system/network/port-forward/:id/keeper/disable`   | `super` | 停用 UDP Keeper 并撤下当前端点            |
| `POST`   | `/system/network/port-forward/:id/probe`            | `super` | 为已启用 Keeper 生成新 probeRequestId     |
| `GET`    | `/system/network/port-forward/:id/endpoint-history` | `super` | 查询端点状态变化历史                      |
| `GET`    | `/system/network/agent/status`                      | `super` | 查询 Agent、revision 与 TCP 发布模式      |
| `GET`    | `/system/network/events/stream`                     | `super` | SSE 推送已提交的 MQTT 状态变化            |
| `GET`    | `/system/network/ddns/list`                         | `super` | 分页查询双栈自动 DDNS 绑定                |
| `GET`    | `/system/network/ddns/source-options`               | `super` | 查询 A/AAAA 的安全地址来源选项            |
| `GET`    | `/system/network/ddns/provider-status`              | `super` | 查询腾讯云云解析 DNS 配置状态，不返回凭据 |
| `POST`   | `/system/network/ddns`                              | `super` | 新增本地 DDNS 自动更新绑定                |
| `PUT`    | `/system/network/ddns/:id`                          | `super` | 修改并按需立即协调 DDNS 绑定              |
| `DELETE` | `/system/network/ddns/:id`                          | `super` | 删除本地绑定，不删除云端 DNS 记录         |
| `POST`   | `/system/network/ddns/:id/retry`                    | `super` | 手动重试一条已启用 DDNS 绑定              |

同一模块提供只供腾讯云稳定入口调用的 NATMap 启动重定向：

| 方法   | 内部路径                             | 认证/来源边界                                  | 说明                          |
| ------ | ------------------------------------ | ---------------------------------------------- | ----------------------------- |
| `GET`  | `/network/open-redirect/:serviceKey` | `@Public()`；Host 必须为 `open.kwitsukasa.top` | 返回空 body 的临时 `302`      |
| `HEAD` | `/network/open-redirect/:serviceKey` | 同上；Traefik 另限 `ClientIP=10.66.66.1/32`    | 返回与 GET 相同的状态和响应头 |

Traefik 外部路径为 `/api/network/open-redirect/:serviceKey`，去掉 `/api` 后才
进入 Controller。`serviceKey` 是代码内固定白名单
`nas/admin/blog/api/portfolio/jenkins/kestra/mcsm/mcd/minio/alist/fnos/s3/voice/voiceios`；
接口不接受 URL、scheme、Host、端口、路径后缀或 redirect query，入口查询串
不会进入 `Location`。服务在一个 `REPEATABLE READ` 只读解析事务中同时核验
`tcp:10443` 通道、逻辑组、`a:nas4.kwitsukasa.top` DDNS 和配置的 Agent：
只有 desired/reported revision 已收敛、NATMap active、lease 未过期、Agent
在线且 DDNS source/applied IPv4 与 current 完全相同时才返回 `302`。未知键
返回 `404`；离线、过期、状态不一致或解析异常返回无 `Location` 的 `503` 与
`Retry-After: 30`。所有响应均禁止缓存、referrer 与索引。该接口只完成首跳，
浏览器后续页面、API、上传、SSE 与 WebSocket 均直连带动态端口的统一网关。
`voice` 固定跳到 `https://voice.nas4.kwitsukasa.top:{动态端口}/`，`voiceios`
固定跳到同一 Host 的 `/auth/ios-login`；两者只承担 Voice Archive 的 Web 与
iOS Admin SSO bootstrap，不在腾讯云 Caddy 新建独立 Voice 站点。
成功响应还从同一事务快照发布三个单值头：`X-KT-Endpoint-IPv4` 为与 DDNS
一致的规范公网 IPv4，`X-KT-Endpoint-Generation` 为当前 64 位小写十六进制
端点身份，`X-KT-Endpoint-Valid-Until` 为当前租约 UTC 时间。私网、CGNAT、
保留/文档 IPv4、非法 generation 或已过期租约统一降级为无 `Location`、无上述
三项头的 `503`，供 Android KernelSU 客户端把同一权威 IPv4 绑定到 `/32` hook。

逻辑组接口用于当前 Admin；同一逻辑组可包含相同端口的 TCP、UDP 或双协议通道：

| 方法     | 路径                                                                              | 认证    | 说明                                      |
| -------- | --------------------------------------------------------------------------------- | ------- | ----------------------------------------- |
| `GET`    | `/system/network/port-forward-group/list`                                         | `super` | 分页查询逻辑组和两个协议通道              |
| `POST`   | `/system/network/port-forward-group`                                              | `super` | 新增 `tcp / udp / tcp_udp` 逻辑组         |
| `PUT`    | `/system/network/port-forward-group/:groupId`                                     | `super` | 原子修改组字段和协议模式                  |
| `DELETE` | `/system/network/port-forward-group/:groupId`                                     | `super` | 为组内全部通道写入 absent tombstone       |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/:protocol/retry`            | `super` | 重试指定协议通道                          |
| `GET`    | `/system/network/port-forward-group/:groupId/channels/:protocol/endpoint-history` | `super` | 查询指定协议和 mechanism 的端点历史       |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/tcp/natmap/enable`          | `super` | 启用 TCP NATMap，可携带 revision 前置条件 |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/tcp/natmap/disable`         | `super` | 停用 TCP NATMap，可携带 revision 前置条件 |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/udp/keeper/enable`          | `super` | 启用 UDP Keeper                           |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/udp/keeper/disable`         | `super` | 停用 UDP Keeper                           |
| `POST`   | `/system/network/port-forward-group/:groupId/channels/udp/keeper/probe`           | `super` | 立即请求一次 UDP 探测                     |

旧 `/port-forward` 路由保留平面通道兼容语义；多通道组必须使用逻辑组接口。新增和修改请求只接受各 DTO 白名单字段，目标 NAS IPv4 固定来自 `NETWORK_AGENT_TARGET_IPV4`，未知字段返回 400。Snowflake ID 与 revision 在 HTTP JSON 中保留为字符串。所有动态响应设置 `Cache-Control: no-store`。

端点历史行使用 `portForwardId` 关联端口转发，撤下原因返回为 `withdrawalReason`。Agent 状态同时返回统一的 `lastErrorCode/lastErrorMessage`（reconciliation 优先于 MQTT）、细分错误字段和当前生效的 `tcpReleaseMode`，便于 Admin 展示、诊断并在退役前证明 TCP NATMap 可以恢复。

TCP NATMap 启停请求可选携带
`{"expectedDesiredRevision":"<canonical decimal>"}`。服务在同一数据库事务和悲观锁内、任何状态 no-op 判断之前比较该值；通道 revision 已变化时返回 `409` 且不推进全局 revision、不发布 MQTT。普通 Admin 交互可省略该字段，受控维护执行器必须使用它绑定已审查的 preflight。

API 数据库是唯一事实源。每次合法期望变更在同一事务中锁定 `network_agent_state`、全局 revision 只增加一次并保存稳定 `desiredIssuedAt`；事务提交后再向当前 owner 的 `kt/network/v1|v2/agents/{agentId}/desired` 发布 QoS 1 retained 完整快照。PUBACK 只推进 `publishedRevision`，Agent 的完整 `reported` 才推进 `appliedRevision` 和逐通道实际状态。Agent 声明 v2 capability 且 release policy 允许后，API 清除旧 retained owner、切换到 v2，并忽略此后迟到的 v1 reported/events。MQTT 或 Agent 离线不回滚已接受的期望状态。

Wire contract 同时保留 schema-v1 兼容路径和严格 schema-v2。v2 外层使用 snapshot revision/digest，逐通道使用独立 desired revision/digest；错误的外层 identity 整包拒绝，单通道 identity/digest 冲突只隔离该通道，不阻断合法 sibling。合法外层 snapshot 完成一次协调处理后推进 applied revision 与独立 applied schema 水位；该值不代表全部通道成功。通道保存原始 RFC3339Nano report 水位，阻止同 revision、同毫秒内乱序的旧 report 回退运行态与错误。Agent 首次接受 v2 后会耐久锁存 owner；在实现 Agent 可确认的显式降级握手前，API-only downgrade 固定返回拒绝，v1 reported/events 也不能越过已持久化的 v2 applied schema 水位。

TCP current 必须同时满足 present、NATMap intent、synced、Router、互斥数据面证据、NATMap active、非空 generation、candidate/current/last-observed 同 tuple，以及接收时仍新鲜且未倒退的 lease；否则只保留候选/最近观测并撤下 current。旧版数据面要求 `dnatPresent=true` 且 TCP `routePresent` 缺失或 false；小米直达数据面要求 `dnatPresent=false` 且 `routePresent=true`。两项同时 true 或同时未就绪均不可发布，TCP tombstone 也必须确认可选 route 已不为 true 才能删除。candidate、current、last-observed、last-published、静态错误、Keeper 错误和 NATMap 错误分别持久化。事件按 `eventId` 幂等追加并记录 `udp_stun|tcp_natmap` mechanism。

v2 endpoint event 与 matching reported 是两条独立 MQTT 消息。event、report 和 ownership 切换统一按 Agent state、channel、history 顺序加锁。正常 event-first 路径先提交 history，不提前创建会被 5 秒扫描器消费的 Outbox；history 耐久保存来源 revision 和由 mechanism、tuple、observed/validated/valid-until 原始值生成的完整 lease identity，matching reported 只有在 revision、组/协议/mechanism、tuple 和未被 JS `Date` 截断的 lease 身份完全相同时，才在 current 同一事务中以原 `eventId` stage 对应事件，提交后 wake。report-first 使用同一精确关联门禁。UDP 对直接 `changed` 以及跨 `withdrawn` 后恢复到不同端口的 `restored` 使用既有 `network.stun.mapping-port-changed`；恢复事件以前一条非 `withdrawn` 有效历史为基线，同端口恢复不 stage。TCP 对直接 `changed` 以及紧邻 `withdrawn` 后的 `restored` 使用独立 `network.tcp.natmap-endpoint-changed`；恢复事件同样以前一条非 `withdrawn` 有效 TCP 历史为基线，公网 IPv4 或端口任一变化才 stage。首次发布、同 tuple 续租、撤下和同 tuple 恢复不 stage TCP 事件。组删除只有所有通道分别确认 exact absent 后才完成；先完成的通道单独软删除并清空活动键，仍有通道的组继续保留。v1 单 UDP 组继续使用 helper/router/route/Keeper/current 的原有 exact-absence 门禁。

Admin 首次进入网络管理页通过 HTTP 读取快照，随后使用 `/system/network/events/stream` 接收 `network-state-changed`。API 只在 `reported`、`status`、`events` 对应事务提交且语义状态实际变化后发出事件；MQTT QoS 1 重投、仅推进 `lastHeartbeatAt` 的状态心跳，以及相同 tuple 只推进 `validatedAt/validUntil` 的续租继续持久化，但不触发 history、SSE、DDNS 或消息 Outbox。公网 IP/端口、candidate/last-observed tuple、Keeper/NATMap/同步/错误/删除状态或 Agent 在线会话变化仍发布事件。一个入站消息不论改变多少通道都最多产生一次提交后 SSE。SSE 心跳只维持连接并复用最近一次真实状态事件 ID，尚无状态事件时显式发送空 ID；浏览器重连通过 `Last-Event-ID` 或 `lastEventId` 重放有限窗口，游标失效时收到一次 `snapshot-required` 并重新读取 HTTP 快照。前端不直接订阅 MQTT，也不使用定时轮询。

TCP 通道使用独立 NATMap 开关，UDP 通道使用独立 Keeper 开关；TCP 不提供 STUN，UDP 只有 `externalPort === internalPort` 时可启用 Keeper。`NETWORK_TCP_NATMAP_RELEASE_MODE=off|draining|canary|on` 控制 TCP 变更范围，canary 端口来自 `NETWORK_TCP_NATMAP_CANARY_PORTS`。当前端点只有在 `currentValidUntil` 未过期时才返回为可用值；租约过期不会删除 candidate、last-observed、last-published 或 `network_endpoint_history`。API 不直接访问小米路由器、不修改 NAS 路由；真实小米规则、R4SE NATMap bind 与本地 DNAT 缺失证据、raw UDP 和 NAS 对称回程规则由固定 Agent/helper/Companion 处理，直达 TCP 业务数据不经过 R4SE。

自动 DDNS 支持 `A` 和 `AAAA`。A 记录绑定 `sourceType=port_forward_ipv4` 与一条合格的 UDP Keeper 或 TCP NATMap 协议通道；来源选项返回 `groupId/protocol/mechanism`，名称为 `组名 / UDP Keeper` 或 `组名 / TCP NATMap`。AAAA 可使用不携带 `portForwardId` 的 `sourceType=agent_ipv6`，也可使用绑定合格 TCP NATMap 通道的 `sourceType=port_forward_ip4p`；后者按 NATMap 官方 `2001::端口:IPv4高两字节:IPv4低两字节` 约定编码动态公网 tuple，供 SSH `ProxyCommand` 解码。来源暂不可用时记录进入 `waiting_source`，不会向腾讯云写入空地址。协调器只修改腾讯云云解析 DNS 中已存在、已启用、默认线路且唯一的同类型记录，写入时保留 RecordId、线路和 TTL，并回读相同 RecordId 验证结果。A 来源仅端口变化不调用 provider，只更新派生的 `accessEndpoint=FQDN:port`；IP4P 来源的端口变化会改变 AAAA 并触发同步。删除接口只删除本地自动更新绑定，不删除云端记录。Provider 状态接口只返回开关、配置完整性和官方 provider 标识，不返回 SecretId、SecretKey 或 SDK 原始错误。

Agent 状态响应额外包含可选的 `currentPublicIpv6/currentIpv6ObservedAt`。只有在线且未超过 `NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS` 的规范化全局 IPv6 才能作为 AAAA 来源；缺少 IPv6 不影响现有端口转发、UDP Keeper 或 Agent 在线状态。

## 环境变量分组

| 分组          | 关键变量                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL         | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| MinIO         | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`BLOG_LIVE2D_BUCKET`、`BLOG_LIVE2D_ROOT_PREFIX`、`BLOG_LIVE2D_PREFIX`、`BLOG_ASSET_MIGRATION_*`                                                                                                                                                                                                                                                                                                                                                  |
| Admin         | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`ADMIN_AUTH_ALLOW_INSECURE_LOCAL`、`ADMIN_NOTICE_SSE_REPLAY_LIMIT`、`ADMIN_NOTICE_SSE_HEARTBEAT_MS`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID`                                                                                                                                                                                                                                                                                                                                       |
| Loki          | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_QUERY_SELECTOR`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| QQBot         | `BOT_ENABLED`、`BOT_ACCOUNT_SECRET_KEY`、`TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL`、`BOT_REVERSE_WS_PATH`、`BOT_REVERSE_WS_TOKEN`、`BOT_EVENT_BUS`、`BOT_SEND_*`、`PLUGIN_QUEUE_REDIS_*`、`PLUGIN_TASK_QUEUE_REDIS_*`、`PLUGIN_QUEUE_WAIT_TIMEOUT_MS`、`BOT_COMMAND_MIN_COOLDOWN_MS`、`BOT_RULE_MIN_COOLDOWN_MS`、`PLUGIN_REPEATER_*`                                                                                                                                                                                                        |
| NapCat        | `NAPCAT_WEBUI_BASE_URL`、`NAPCAT_WEBUI_TOKEN`、`NAPCAT_*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| MQTT          | `MQTT_URL`、`MQTT_USERNAME`、`MQTT_PASSWORD`、`MQTT_CLIENT_ID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Env Dashboard | `ENV_DASHBOARD_CACHE_TTL_MS`、`ENV_DASHBOARD_SIGNAL_TIMEOUT_MS`、`ENV_DASHBOARD_EVENT_BUS`、`ENV_DASHBOARD_MQTT_*`、`ENV_DASHBOARD_SSE_*`、`ENV_DASHBOARD_CODEX_APP_SERVER_URL`、`ENV_DASHBOARD_HOME_ASSISTANT_*`、`ENV_DASHBOARD_SUNSHINE_*`、`ENV_DASHBOARD_R4SE_*`                                                                                                                                                                                                                                                                    |
| Network       | `NETWORK_AGENT_ID`、`NETWORK_AGENT_TARGET_IPV4`、`NETWORK_AGENT_MQTT_URL`、`NETWORK_AGENT_MQTT_CLIENT_ID`、`NETWORK_AGENT_MQTT_USERNAME`、`NETWORK_AGENT_MQTT_PASSWORD`、`NETWORK_AGENT_MQTT_RETRY_MS`、`NETWORK_TCP_NATMAP_RELEASE_MODE`、`NETWORK_TCP_NATMAP_CANARY_PORTS`、`NETWORK_MANAGEMENT_SSE_HEARTBEAT_MS`、`NETWORK_MANAGEMENT_SSE_REPLAY_LIMIT`、`NETWORK_DDNS_DNSPOD_ENABLED`、`NETWORK_DDNS_DNSPOD_SECRET_ID`、`NETWORK_DDNS_DNSPOD_SECRET_KEY`、`NETWORK_DDNS_RECONCILE_INTERVAL_MS`、`NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS` |
| Media         | `MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET`、`MEDIA_GOVERNANCE_EXECUTOR_BASE_URL`、`MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET`、`MEDIA_GOVERNANCE_EXECUTOR_TIMEOUT_MS`                                                                                                                                                                                                                                                                                                                                                                          |
| LLM           | `LLM_CONFIG_SECRET_KEY`、`LLM_CODEX_GATEWAY_BASE_URL`、`LLM_CODEX_GATEWAY_INTERNAL_SECRET`、`LLM_CODEX_GATEWAY_TIMEOUT_MS`、`LLM_CODEX_CHAT_CWD`                                                                                                                                                                                                                                                                                                                                                                                         |
| Codex Remote  | `CODEX_REMOTE_NAS_WS_URL`、`CODEX_REMOTE_NAS_WS_SHARED_SECRET`、`CODEX_REMOTE_NAS_PROJECTS_JSON`、`CODEX_REMOTE_PC_WS_URL`、`CODEX_REMOTE_PC_WS_SHARED_SECRET`、`CODEX_REMOTE_PC_PROJECTS_JSON`                                                                                                                                                                                                                                                                                                                                          |
| BangDream     | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| FF14 Market   | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_DEFAULT_WORLD`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FFLogs        | `FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

真实密码、Token、OAuth secret 和生产 env 不提交到 Git。

Codex Remote 使用现有 Admin Bearer 鉴权。`GET /api/codex-remote/nodes` 只返回
配置完整的 WireGuard 节点；`POST /api/codex-remote/nodes/:nodeId/session` 接收
`{"projectId":"..."}`，返回精确项目、节点 WebSocket 地址和两分钟签名 token。
签名 secret 仅存在于 API 私有环境与对应 Codex App Server 节点。

Env Dashboard 与 Mobile Home 共享精确三设备七服务拓扑。私有运行环境必须提供 Codex App Server、Home Assistant、Sunshine、R4SE WireGuard 与 Mihomo 所需键；缺失配置必须返回 `unwired`，Local Dev、Tencent Cloud、Caddy 及其旧键不会进入响应合同。

Plugin Platform worker 队列依赖 Redis。K8s 生产清单提供内部 Redis Service `kt-plugin-redis:6379`，用于 `PLUGIN_QUEUE_REDIS_HOST` / `PLUGIN_QUEUE_REDIS_PORT`。`PLUGIN_QUEUE_WAIT_TIMEOUT_MS` 控制排队等待窗口，插件定时任务可通过 `PLUGIN_TASK_QUEUE_REDIS_*` 使用独立 BullMQ prefix。

## 大模型配置与流式对话

| 方法     | 路径                                     | 说明                                     |
| -------- | ---------------------------------------- | ---------------------------------------- |
| `GET`    | `/llm/providers`                         | 查询六类供应商、默认端点和协议           |
| `GET`    | `/llm/configs`                           | 分页查询脱敏连接卡片                     |
| `GET`    | `/llm/configs/summary`                   | 汇总连接状态                             |
| `GET`    | `/llm/configs/:id`                       | 查询不含凭据和静态模型数组的脱敏连接详情 |
| `GET`    | `/llm/configs/:id/models`                | 按供应商协议实时发现当前凭据可用模型     |
| `POST`   | `/llm/configs`                           | 加密创建连接                             |
| `PUT`    | `/llm/configs/:id`                       | 更新连接；空 API Key 保留旧密钥          |
| `DELETE` | `/llm/configs/:id`                       | 软删除已停用连接                         |
| `POST`   | `/llm/configs/:id/enabled`               | 启用或停用连接                           |
| `POST`   | `/llm/configs/:id/default`               | 设为默认连接                             |
| `POST`   | `/llm/configs/:id/test`                  | 通过真实流式首包验证连接                 |
| `GET`    | `/llm/conversations`                     | 按连接查询持久化对话                     |
| `POST`   | `/llm/conversations`                     | 创建对话                                 |
| `GET`    | `/llm/conversations/:id`                 | 查询对话和完整可见消息                   |
| `DELETE` | `/llm/conversations/:id`                 | 软删除没有活动回合的对话                 |
| `POST`   | `/llm/conversations/:id/messages/stream` | POST SSE 发送消息并流式返回统一事件      |

流事件固定为 `start`、`reasoning-delta`、`text-delta`、`done` 或 `error`；每个事件
携带递增 `sequence`，助手终态保存上游实际模型。浏览器中止请求会传播到供应商或 Codex
turn，并把已经收到的部分正文保存为 `interrupted`，不存在非流式降级路径。OpenAI、智谱、
DeepSeek 和 Moonshot 使用 OpenAI-compatible SSE；Anthropic 使用 Messages SSE；本地
Codex 使用同一 `/internal/llm-codex` App Server gateway。

连接新增与编辑请求不接受 `modelIds`。模型目录只通过
`GET /llm/configs/:id/models` 获取：OpenAI、智谱、DeepSeek、Moonshot 调用各自
OpenAI-compatible Models API，Anthropic 使用官方 Models API 的 `after_id` 有界分页，
本地 Codex 经 gateway `GET /internal/llm-codex/models` 调用 App Server `model/list`。
每个模型项可返回 `reasoningEfforts/defaultReasoningEffort` 与
`serviceTiers/defaultServiceTier`；Codex 完整映射 App Server 能力，Anthropic 映射实际
`capabilities.effort`，OpenAI-compatible 供应商只归一响应中真实声明的扩展能力。空能力数组
表示不支持或未声明，调用方必须隐藏对应控件。对话页进入时实时刷新目录，每次 POST SSE
发送前 API 再次校验模型及所选推理强度/速度档位；非法组合在建立流前返回 400，模型发现
失败或返回空目录时失败关闭，不回退配置表中的静态列表。

媒体治理不再配置第二套 Codex 地址、密钥、模型或消息接口。调用 `agent/start` 时，API
从当前启用的 Admin Codex 连接创建一条 `scene=media-governance` 的标准 LLM conversation，
Task 只持久化唯一 `llmConversationId`；模型选择、消息、流式终态、实际模型和底层
`providerThreadId` 均由 LLM conversation 统一管理。媒体入口跳转到同一个标准 LLM 对话页，
续聊只使用 `/llm/conversations/:id/messages/stream`，不存在媒体专用非流式或第二消息路由。
类型化治理工具、Task revision、密封计划和人工候选仍由媒体领域校验。Codex 网关统一使用
`LLM_CODEX_GATEWAY_INTERNAL_SECRET`、`x-kt-llm-gateway-secret` 与启用网络和 live Web
Search 的 `llm-codex` 权限档。

媒体场景的结构化结果包含完整 `answer` 与短 `summary`：`answer` 作为标准 Assistant 消息流式展示，`summary/status/planSha256` 只用于 Task 投影。Gateway 每轮从 API 当前 Task 取得 `availableActions`，并只允许阶段门声明的工具；4xx/409/超时必须向模型返回非空、脱敏的稳定失败码。策略 v3 新增受 revision、胶囊、scene/provider-thread CAS 与既有业务服务共同约束的身份确认、磁链来源、分页清单、自动映射、探针、下载、治理、元数据和验收工具。TV 自动映射接受 `SxxExx`、根目录纯数字方括号，或根目录中唯一的发布标点分隔 1–3 位集号；电影多视频清单只有在最大文件不少于 512 MiB、其余均不超过 64 MiB，且最大文件至少为第二大文件 8 倍时才自动判为正片。任何集号歧义或电影主次不满足门槛都返回 409，不猜测选择。任一写工具成功后必须结束本轮，由下一轮读取新 revision；浏览器、模型和 Gateway 都不能直接写数据库、qBittorrent 或正式媒体目录。

`provider.metadata.read` 的 TMDB 搜索最多使用两条独立、禁用连接复用的有界请求；不可用时返回 `lookupAvailable=false`。模型通过 live Web Search 提供显式 TMDB ID 后，`media.identity.confirm` 仍会独立请求固定官方详情页并核对媒体类型与发行年份，不能把搜索结果或自由文本直接当作可写身份。

## Admin 与基础后台

### 媒体治理 API/Admin 生产链路

目录和执行严格按 `Series → Work → Season/Episode → Task` 分层。Task 根资源只提供查询与执行，
不存在根级创建、身份编辑、身份恢复或 Task-to-Series reconcile 路由。所有新 Task 必须从既有
Work 派生不可变的 `seriesId/workId/operationKind` 与 catalog 身份。

| 方法     | 路径                                                               | 说明                                                              |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET`    | `/media-governance/tasks/page`                                     | 分页和语义过滤纯执行任务                                          |
| `GET`    | `/media-governance/tasks/summary`                                  | 查询任务、下载、治理和 Agent 聚合                                 |
| `GET`    | `/media-governance/tasks/:taskId`                                  | 查询权威任务详情投影                                              |
| `DELETE` | `/media-governance/tasks/:taskId?expectedRevision=:revision`       | 按版本删除未执行任务并清除绑定账本                                |
| `POST`   | `/media-governance/tasks/:taskId/sources/magnet`                   | 脱敏添加磁链来源                                                  |
| `POST`   | `/media-governance/tasks/:taskId/sources/torrent`                  | 上传并安全解析私有种子描述文件                                    |
| `PUT`    | `/media-governance/tasks/:taskId/sources/:sourceId/classification` | 修订来源角色和内容分类                                            |
| `POST`   | `/media-governance/tasks/:taskId/sources/:sourceId/remove`         | 精确清理并移除已取消的待更换来源                                  |
| `POST`   | `/media-governance/tasks/:taskId/sources/:sourceId/inspect`        | 生成来源清单；磁链最长 120 秒                                     |
| `POST`   | `/media-governance/tasks/:taskId/sources/:sourceId/probe-runtime`  | 执行有界运行时来源探针                                            |
| `PUT`    | `/media-governance/tasks/:taskId/units/:unitId/subtitle-contract`  | 密封逐季单一发布组字幕合同                                        |
| `POST`   | `/media-governance/tasks/:taskId/downloads/start`                  | 启动或接管失联的 NAS 隔离目录下载                                 |
| `POST`   | `/media-governance/tasks/:taskId/downloads/pause`                  | 暂停同一下载 Run                                                  |
| `POST`   | `/media-governance/tasks/:taskId/downloads/cancel`                 | 取消下载并保留载荷直到精确来源清理                                |
| `POST`   | `/media-governance/tasks/:taskId/downloads/resume`                 | 续传活动 Run，或创建失联恢复 Run                                  |
| `POST`   | `/media-governance/tasks/:taskId/governance/start`                 | 密封并启动 Schema 1.2.0 本地治理                                  |
| `POST`   | `/media-governance/tasks/:taskId/governance/identity-rebase`       | 按版本把已提交旧目录重排到当前规范身份                            |
| `POST`   | `/media-governance/tasks/:taskId/metadata/verify`                  | 启动 A/B/C 分档元数据核验                                         |
| `POST`   | `/media-governance/tasks/:taskId/metadata/repair`                  | 启动最多两次的确定性有界元数据修复                                |
| `POST`   | `/media-governance/tasks/:taskId/acceptance/verify`                | 启动独立本地验收与精确清理                                        |
| `POST`   | `/media-governance/tasks/:taskId/agent/start`                      | 创建并绑定唯一的本地 Codex LLM 对话                               |
| `GET`    | `/media-governance/tasks/:taskId/agent/session?afterSequence=N`    | 查询由 LLM 对话派生的只读治理投影                                 |
| `POST`   | `/media-governance/tasks/:taskId/agent/operator-decision`          | 提交人工候选选择并闭环                                            |
| `GET`    | `/media-governance/tasks/:taskId/evidence`                         | 查询脱敏证据和零写入边界摘要                                      |
| `GET`    | `/media-governance/events/stream`                                  | 订阅 task-changed/catalog-changed 与 replay/snapshot-required SSE |

Series-first 目录接口先创建系列及主 Work，再在同一 Series 下增加 TV、电影或剧场版 Work。
Series 与 Work 的官方身份都由候选选择后重新核验；TMDB 唯一键包含 `tv/movie` namespace。`workType` 同时约束两个资料源：TV 使用 Bangumi `type=2/platform=TV` 与 TMDB TV，电影使用 Bangumi `type=6/platform=电影` 与 TMDB Movie，剧场版使用 Bangumi `type=2/platform=剧场版` 与 TMDB Movie。Bangumi 搜索的 `meta_tags` 只作上游缩小，API 仍逐项核对 `type + platform`，选中后详情核验再次执行同一合同。
非 TV Work 在事务行锁内最多保留一个未闭环 Task；已有闭环 Task 时，下一个 Work Task 是唯一升级候选。
`governance/start` 会把同 Work 唯一闭环 Task 的计划摘要、revision、work item 与规范视频证据密封为
`canonicalReplacement`。NAS 在 trim.media 停服窗口用候选/旧目标双 hardlink 保护的原子 rename
执行替换，普通 `move` 遇到既有目标仍返回冲突。候选独立验收成功时，API 在保存候选 Task、Run、
Event 的同一事务中删除被替换 Task 的完整账本；验收前失败只回滚文件，不提前隐藏或删除旧 Task。
电影与剧场版不能创建 Season，TV 的所有季级路径必须同时携带 Work ID：

| 方法     | 路径                                                                                                                      | 说明                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `GET`    | `/media-governance/series/page`                                                                                           | 分页查询 Series/Work/季集/执行聚合           |
| `GET`    | `/media-governance/series/identity-candidates`                                                                            | 按关键词和 Work 类型搜索官方身份候选         |
| `POST`   | `/media-governance/series`                                                                                                | 原子创建 Series 与唯一主 Work                |
| `DELETE` | `/media-governance/series/:seriesId?expectedRevision=`                                                                    | 仅删除无 Season/Episode/Task/绑定/RSS 的空壳 |
| `POST`   | `/media-governance/series/:seriesId/works`                                                                                | 向既有 Series 添加已核验 Work                |
| `POST`   | `/media-governance/series/:seriesId/works/:workId/seasons`                                                                | 为 TV Work 创建连续 Season/Episode           |
| `POST`   | `/media-governance/series/:seriesId/works/:workId/tasks`                                                                  | 从 Work 派生一次 source-intake Task          |
| `GET`    | `/media-governance/series/history-classification`                                                                         | 只读核对历史 Task 的 Work 归类状态           |
| `GET`    | `/media-governance/series/rss-discovery/identity-candidates`                                                              | 按关键词查询 RSS 使用的 TV 身份候选          |
| `GET`    | `/media-governance/series/:seriesId`                                                                                      | 查询 Series、Works、季、Task 与 RSS          |
| `GET`    | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/episodes`                                         | 分页查询 Work Episode 与 Task/来源绑定       |
| `POST`   | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/magnet-batch`                                     | 在一个 Work Task 内创建 1–16 条按集磁链来源  |
| `POST`   | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/rss-discovery/search`                             | 按 Work/Season 聚合固定来源和发布组 RSS      |
| `POST`   | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/rss-subscriptions`                                | 创建 Work-scoped 按季 RSS 订阅               |
| `PUT`    | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/rss-subscriptions/:subscriptionId/context`        | 清理错误 Task 后迁移订阅上下文并重置条目     |
| `PUT`    | `/media-governance/series/:seriesId/works/:workId/seasons/:seasonNumber/rss-subscriptions/:subscriptionId/context-repair` | 保留未密封 RSS Task/来源/条目并合并误建 Work |
| `PUT`    | `/media-governance/series/rss-subscriptions/:subscriptionId/state`                                                        | 按 revision 启停 RSS                         |
| `POST`   | `/media-governance/series/rss-subscriptions/:subscriptionId/poll`                                                         | 立即轮询、去重并按集创建 Work-bound Task     |
| `GET`    | `/media-governance/series/rss-subscriptions/:subscriptionId/items`                                                        | 分页查询 RSS 条目处理历史                    |

Series 删除使用独立 `Media:Governance:Delete` 权限和客户端已读取的 revision。服务端在同一事务中锁定 Series、Work、Task、Season/Episode、绑定、RSS 与资料引用范围；只允许级联删除 Work/Series 资料引用和空 Work，任一执行或订阅事实存在时固定返回 `409`。权限由 `media-governance-series-delete-v1.sql` 幂等注册并只授予活动 `super`，对应 verify 脚本检查身份唯一、无冲突、无重复和无非 super 授权。

RSS 来源发现严格分为身份候选与来源聚合两个阶段：用户必须先从 Bangumi/TMDB 候选中选择身份，
服务端再次核验该身份后才并行查询 Mikan、Bangumi.moe、Nyaa、ACG.RIP、动漫花园、AniBT、
Shana Project、nekoBT 和 SubsPlease。单个来源失败只进入该来源状态，不丢弃其他来源结果；
没有可证明发布组的条目不会伪造“未识别发布组”。Mikan 会从精确番组页发现全部字幕组 RSS，
分批读取每个子组 Feed 的真实条目，再回填条目数、最近发布时间、样例和专属订阅地址，
不能仅凭 RSS 地址存在就显示空统计。ACG.RIP、动漫花园等旧查询接口若拒绝完整长标题，
服务端最多再尝试一次从已核验标题尾部提取的短别名；返回条目仍必须通过完整身份别名过滤，
短词只解决上游查询兼容性，不能放宽身份边界。

创建订阅必须携带第一阶段选中的资料来源、编号和可选年份；API 会再次读取 Bangumi/TMDB
官方详情，并把用户在当前 Season 明确确认的身份写入订阅及 Work/Series `catalog-evidence`。
若该 provider 身份已属于另一 Work 则返回 409；订阅会持久化 provider、编号、标题和年份，
后续 `rss-intake-auto` Task 使用这组精确身份，而不是回退成 Work canonical。同一 Series/Feed
不重复建订阅；普通错误上下文在旧 Task 清理后使用 revision 绑定的 context 路由并把条目重置为
`discovered`。如果错误上下文已经产生未密封 Task，context-repair 还必须精确提交源 Work、订阅
revision 和完整 Task revision 清单，并确认全部 active Run 为零；事务保持 Task/Source/RSS item ID，
把 Unit、来源季号和 Episode Binding 迁到目标 Season，移动资料引用后仅删除已空源 Work。
轮询可重新处理没有 `taskId/sourceId` 的 `discovered/ignored/failed` item；
已入队条目仍保持幂等跳过。
默认集号解析支持发布名中的 ` - 41`、`E41` 和 `S01E41`；`SxxEyy` 只把 `yy` 作为当前
canonical Season 的绝对 Episode 号，避免紧凑命名因为 `E` 前无单词边界而被误记为 ignored。
同批 RSS Task 会先检查全部来源清单，再执行自动映射。仅当全部主来源都有视频、没有 sidecar
字幕且视频名带明确内封标记时，服务端才把错误的 `bundled_sidecar_media` 原子纠偏为
`embedded_subtitle_media`；合同校验失败时原来源选择保持不变，旧的精确映射阻塞可由状态机重试。
Mikan 等只提供 HTTPS torrent enclosure 的 Feed 由固定主机白名单有界读取描述符、重算
BTIH 并把原始 torrent 字节写入私有描述符存储后，再创建最多 16 集的 Task；探针和下载直接复用
该描述符，不再从裸磁链重新等待 metadata。历史已入队 magnet 来源在同 Feed 轮询时按
Task/Source/BTIH 一次提交原地升级，Task、Source、RSS item 与 Episode Binding ID 均保持不变。
`operationKind=rss-intake-auto` 的 Task 会由 API 状态机逐来源
自动完成清单检查、保守视频/简中字幕映射和运行时探针；全部来源可下载时自动派发隔离下载，
无法安全映射或任一探针失败时停止在带明确原因的人工复核态，不再要求每个来源手点同一按钮。
下载 Run 在启动阶段先单次兑换并校验全部来源描述符，再进入可能耗时的逐来源 qBittorrent 流程；
后续来源不会因前一来源下载超过 envelope TTL 而失效。失效或重复 descriptor grant 返回 409，
执行器不将其误判为 5xx 暂态重试。
成功创建 Binding 后发布 `catalog-changed`，Series 详情与当前 Episode 页通过 SSE 回读权威
快照，不需要浏览器手工刷新。

Season 事实使用 `episodeStart + episodeCount` 表示连续集号区间；`episodeStart`
省略时为 `1`。这允许同一系列保留 S02 `E25–E47`、S03 `E48–E59` 等资料库原始连续编号，
批量磁链、RSS、Episode 分页和历史 Task 归类均按该闭区间校验，不做隐式偏移换算。
历史分类接口完全只读，只按精确 `provider + namespace + providerId`、既有 Work 上下文、
Task Unit 和来源映射判断 `classified / classifiable / pending`，并返回稳定原因。普通 TV Task
仅在 `metadataStatus=verified`、主媒体 `manifestState=inspected` 且 Unit/视频映射完全一致时
进入目录同步；同步目标必须是 Task 已绑定 Work 中已经存在的 Season/Episode，不会从 Task
自动创建或合并 Series/Work。精确身份跨 Work、Season 缺失、集号有洞或映射不完整时零写；
服务启动会补偿扫描已验证任务并只恢复合法的既有 Work 绑定。事务不修改 Task revision、Run、
来源、密封计划或下载状态；提交后在 `/media-governance/events/stream` 发布携完整 SeriesCard 的
`catalog-changed`。

`GET /media-governance/tasks/summary` 额外返回 `blocked`、`stuckRunCount`、
`evidenceDriftCount`、`mixedSubtitleSeasonCount`、去重后的 `attentionRequired` 和中文
`healthLabel`。失联 Run 只统计数据库生产 Task 中 queued/running 状态与 `activeRunId`
不一致，或执行器 `observedAt` 超过既有 10 分钟无增量窗口的任务；暂停并保留原 Run 的
blocked 下载不会误报。closed Task 仍有 Unit 缺 `localAcceptedAt` 或 `evidenceSha256`
时计入证据漂移。没有持续 NAS 观测源时 `stagingResidualCount=null`，不得解释为 0；
正式独立验收仍要求回调中的实际 `stagingResiduals=0`。

`probe-runtime` 会先完成 3 分钟初始观察；来源即使产生少量数据，按观察窗平均吞吐估算
无法在 24 小时内完成所选载荷时仍返回 `degraded/insufficient_throughput`；该唯一降级原因
保留为速度警告并允许 `downloads/start` 继续，其他降级、证据不足和不可用原因仍失败关闭。
磁链 `source.inspect` 与该运行时健康探针相互独立：清单获取每 5 秒产生一次
`peer-progress`，120 秒仍无元数据即返回 `magnet_metadata_unavailable`，清除 active Run
并把任务保持在可换源、可改身份、已有清单时可重编映射、无成果时可删除的 intake 阶段。
种子清单不会把 `attr=p` 的 padding 传输项暴露为可治理文件，并按 qBittorrent Web API
的用户可见顺序连续编号；API 与 qBittorrent 因此使用同一 file index 和 manifest 摘要。

NAS 执行器通过独立内部 secret 调用以下接口；浏览器和普通 Admin 权限不能访问：

| 方法   | 路径                                                     | 说明                           |
| ------ | -------------------------------------------------------- | ------------------------------ |
| `GET`  | `/internal/media-governance/executor/health`             | 核对数据库回调状态仓是否 ready |
| `POST` | `/internal/media-governance/executor/events`             | 按 Run 连续序号提交语义事件    |
| `POST` | `/internal/media-governance/executor/descriptors/redeem` | 单次兑换密封来源描述           |
| `POST` | `/internal/media-governance/executor/plans/redeem`       | 单次兑换 Schema 1.2.0 密封计划 |

全部接口要求 Admin JWT 和对应的 `Media:Governance:*` 权限，响应使用
`Cache-Control: no-store`；增量 SQL 初始只把菜单和九个权限授予启用中的 `super`。
所有命令请求必须携带 `expectedRevision`，陈旧版本返回 409 且不执行。TV 至少声明一个
`Sxx` 季号，特别篇/番外篇使用 `S00`；Movie/Theatrical 不填写季号。`providerRef` 和
`releaseYear` 是带格式校验和中文引导的身份消歧字段；创建时可暂缺，下载前可通过
`PUT /identity` 绑定当前 revision 修正作品名、媒体类型、季号、`providerRef` 或年份，
且至少提供一项。该操作只接受
`intake` 的 `draft/blocked` 任务，保留已有来源及健康/阻塞状态；下载、治理、Agent、载荷
或计划任一已经开始后失败关闭。`workItemId` 是内部账本与
本地事务身份：导入存量任务时可显式绑定；未来新任务省略时，API 会在首次本地治理前
通过数据库互斥锁从 `media-063` 起分配且永久复用，不要求操作员填写。
下载取消只终止当前密封 Run，不在失败路径直接删除载荷；Run 返回可验证终态后，来源
移除命令才会停用精确描述版本、执行 `source.cleanup` 并删除对应来源投影。在载荷密封和
治理计划生成前，低速来源即使已分配本地账本身份或被字幕合同引用，也可在取消下载后精确移除；
完成清理时同步解除对应字幕合同并重算预期集号。活动 Run、已生成载荷密封或治理计划的任务仍拒绝移除来源；仅对无作品编号、无载荷/计划、无元数据身份且无单元验收证据的旧版 `requires-agent` 残留，允许清理最后一个来源并同步清空旧 Agent 会话，使其回到可删除空草稿。
另有一个严格的治理前回退例外：Task 必须停在 `governance/blocked`，进度固定为 5 阶段中的
`completedItems<=1`，且 Unit 尚无验收/元数据成果。此时来源移除会先执行类型化
`source.cleanup`，成功后清空旧 `payloadSeal/sealedPlan/sealedPlanSha256`、保留原
`workItemId` 并回到 intake；已进入第 2 阶段的备份或正式事务仍拒绝回退。

同一 Task 只能存在一个 `primary_media` 下载 owner。无字幕媒体按季绑定完整字幕
来源，不同季可使用不同发布组，同一季只接受与该季范围、所选来源发布组一致的
合同；主媒体与所有补充字幕来源均完成清单检查和运行时探针后才允许启动下载。
下载 Run 已失联且活动 Run 已清空时，调用 `downloads/resume` 或再次调用 `downloads/start` 会密封
`source.resume` 接管 Run：任务、来源和 info-hash 身份保持不变，执行器复用原
staging/qBittorrent 状态；尚未轮到的同任务补充来源才从零开始。存在 qBittorrent
状态但任务 staging 已丢失时失败关闭，不能静默重新下载。
状态仓恢复历史来源时，若 Source 的当前 objectId+SHA 精确命中同 Source 的较新 descriptor
revision，则采用该真实 revision 并在下一次原子任务保存中核平；不按 objectId 猜跨来源记录，
也不直接修改数据库。这避免已存在 r2 对象时把 r1 更新为同一唯一对象导致续传 500。
首次 `source.download` 若已有部分已验证载荷后才因旧策略返回 `download_stalled`，API 会在该
失败终态持久化后按最新 revision 自动预约唯一一次 `source.resume`；零载荷失败和
`source.resume` 再次失败均不自动重试。新执行器对首次与恢复 Run 统一以已验证载荷事实关闭
no-data 门，临时 peer 空窗不会重建 owner 或丢弃 fastresume。
本地计划密封失败会生成新 revision 并保持原载荷不变；修正映射、字幕合同或内部身份
后，可用该 revision 重试治理启动，不会重放下载。
本地治理 Run 失败后，完整的最长 400 字符失败摘要写入事件记录，Task 的 `gateReason`
只保留前 160 字符以符合持久化列契约。Task 处于 `governance/blocked`、无活动 Run 且
原 payload/计划摘要仍密封时，可用当前 revision 再次调用 `governance/start`；API 复用
原计划，但生成新的 Run、revision 和 replay key，不复用已消费事务键，也不重放下载。
执行器会优先提取版本化工具返回的结构化 `error`，避免 Python traceback 挤掉
`gateReason` 中真正的失败原因。除原 Run 续传外，每个新动作入队时都重置自己的进度，
不得继承上一阶段的 100%；元数据证据返回唯一身份后，`identityPreview` 同步投影该
provider/年份并标记为“元数据身份已验证”。成功终态无论是否携带额外进度事件，都会
投影为 `100% / 已完成`；启动恢复时会以同一源码合同纠正历史成功任务的陈旧终态进度。
`metadata/verify` 或 `acceptance/verify` 的 NAS 执行失败也可用失败后的当前 revision 重试；
仅在对应阶段、无活动 Run、密封计划仍在且元数据状态未被改写时接受，并生成新的 Run、
revision 和 replay key。治理完成后 fnOS 尚未稳定回填身份时，若所有 Unit 的 A 级缺口
严格只有 `identity.provider/providerId`、尚未执行元数据修复且没有 C 级缺口，可从同一
密封计划重新采集元数据事实，不会重跑下载或重做本地事务。延迟身份刷新每个 Unit
最多一次，次数持久化为 `metadataProjection.identityRefreshAttempts`；刷新后仍缺身份
时 `/metadata/verify` 拒绝第三次相同尝试，并由 Agent 的类型化身份修正收口。确定性
刷新与任意阶段 Agent 入口互不覆盖；普通元数据缺口或独立验收仍按原门禁处理。
升级前已处于该精确缺口且缺少计数字段的任务按一次已消费迁移。
普通元数据缺口投影若已为每个 Unit 绑定成功核验证据，且 Task 仍持有同一密封计划、无活动 Run、`gateReason` 为明确元数据缺口，则可用当前 revision 重新调用 `/metadata/verify`。该重采集只替换 A/B/C 事实投影，不执行媒体写入，也不绕过已用完的延迟身份刷新门禁。

媒体任务身份固定拆分为三份密封投影：`catalogIdentity` 从用户已确认的 Work 派生主资料库、作品年份与标题；`metadataIdentity` 是 trim.media/NFO 所需的 TMDB 二级身份；`identity` 只表示当前密封文件清单所在的物理规范根。Agent 可以补齐 TMDB 元数据身份，但不得改写 Task 的 Work 派生 `providerRef/releaseYear`。管理端从 Series 详情进入 Task，Task 列表只展示执行语义与状态。

Work canonical provider 为 TMDB 时，新 Task 在创建快照中直接携带该二级身份；RSS 仍把用户所选
Bangumi/TMDB 篇章保存为 catalog。显式 `catalogIdentity` 且 `metadataIdentity=null` 的历史计划
只允许从飞牛规范路径唯一映射、季集一致并经官方 TMDB 页面复核的身份自动绑定。执行器没有返回
身份时，API 不得再用 `task.providerRef` 回填 `metadataIdentity`；升级前仅在计划显式空二级身份、
旧 Task 身份与 catalog 完全相等且 Unit A 缺口恰为 provider/providerId 时，一次性清除污染并复核。

所有后继唯一的元数据 Task 都进入服务端确定性自动续跑，而不是由 Admin 或 LLM 逐段调用阶段接口：
普通治理成功直接核验，延后 provider 身份最多复核一次，A/C 为空且 B 可修复时执行最多两次 repair，
随后复核并进入独立验收。Agent 身份修正仍额外要求 amendment 与当前二级身份精确一致。每个终态先
按原 Run 序号持久化，再预约带新 revision/replay key 的下一 Run；失败、身份漂移、未知 A/C、次数
耗尽或人工候选固定停止。API 启动只恢复无活动 Run 的精确持久化边界，`closed` Task 不重复运行。

公开 Task API 不提供 `catalog-identity/restore` 或身份编辑器。历史身份折叠残留只有在 Series 下确认唯一 Work 后才能通过受控迁移补充 `seriesId/workId/operationKind`；电影与剧场版禁止标题近似自动归类。
内嵌字幕 profile 已获得唯一 TMDB 身份、且缺口严格只有 LocalNFO 与作品/季海报时，
第一次确定性元数据生成记为自动补齐；其独立验收通过后保持 `closedMode=automatic`。
其他 profile、第二次尝试或更广的缺口仍按 `bounded_repair`/Agent 分支计数，不能借自动
补齐标签降级硬门禁。

Task、Unit、来源、Run 和治理证据由 `media_governance_*` TypeORM 状态仓持久化；新媒体
Task 的 Agent 绑定只保存 `llm_conversation_id`，消息和 Codex thread 分别由
`admin_llm_message` 与 `admin_llm_conversation.provider_thread_id` 管理。旧的
`media_governance_agent_session` 只用于读取历史任务；Task 获得 LLM 绑定后会删除对应
旧 session 行。API 启动时按 `llmConversationId` 恢复派生的治理状态。正式下载、治理、元数据核验和独立
验收先在数据库事务中密封 Run 与 Outbox，再通过
`MEDIA_GOVERNANCE_EXECUTOR_BASE_URL`、`MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET`
和 `MEDIA_GOVERNANCE_EXECUTOR_TIMEOUT_MS` 调用 NAS 执行器；缺少数据库状态仓、私有
地址或 secret 时失败关闭。执行器只兑换一次描述/计划授权，并按 Run 从序号 1 连续回调，
重复序号幂等忽略，缺号和身份漂移拒绝。NAS executor 在调用 API 前先把每条事件写入连续
journal；transport、408/425/429 与 5xx 按同一序号持续退避，因此 API `Recreate` 不会终止
活动 qBittorrent。发送终态前还会把最终报告原子密封到固定 Codex Run 证据根。API 还会
按 Run、Task 与密封输入摘要读取执行器的精确 systemd runner 状态；runner 已退出或失联时，
状态请求携权威 `afterSequence`，executor 先按最多 256 条且不超过 4 MiB 分页补回连续
非终态缺口；状态响应随后必须提供匹配的 Run manifest SHA、精确成功/失败终态和下一连续
序号，API 才在同一事务应用该终态。缺少密封证据、身份漂移或序号跳跃时保持活动 Run 等待
下轮核对，绝不由 API 伪造失败事件。状态响应采用 8 MiB 有界读取，可恢复包含 732 项 `payloadFiles` 的
大批量终态，同时继续拒绝超限或未密封响应。
高频执行器回调先校验 Run、manifest 与连续序号，再原子追加 Redis 热层并立即发布包含
`runId`、`runSequence` 与紧凑 Task patch 的 `task-changed`。普通 tick 不等待 MySQL；
MySQL 最多每 10 秒、出现语义变化或进入终态时保存权威快照，终态会等待本实例已排队
快照。下载 runner 每 1 秒采集 qBittorrent 进度，磁链清单检查仍按 5 秒/120 秒合同。
SSE 仅在 API 有界内存窗内重放；游标超窗返回 `snapshot-required`，由 Admin 静默读取
权威快照。Redis Stream 目前不是跨进程 SSE 历史重放接口。
该 SSE 响应固定返回 `Cache-Control: no-store` 与 `X-Accel-Buffering: no`，让浏览器前的
Nginx 立即转发每条业务事件，不能等缓冲区积满后批量送达。普通状态变更先提交数据库
再发布 SSE。`agent/start` 只创建或返回该 Task 唯一的媒体场景 LLM conversation，并从
Admin 当前启用的 Codex 连接取端点与初始模型；重复请求不会创建第二条业务对话。
旧的 `MEDIA_CODEX_AGENT_GATEWAY_*` 与 `MEDIA_CODEX_AGENT_INTERNAL_SECRET` 不再参与运行
决策。标准 LLM POST SSE 在每一轮把 conversation scene、Task ID、当前模型和用户消息交给
统一 gateway；gateway 通过
`POST /internal/media-governance/agent/llm-conversations/context` 读取当前 revision、
manifest、policy 与 capsule，通过类型化工具回调读取事实，并在严格结构化结果完成后调用
`POST /internal/media-governance/agent/llm-conversations/result` 更新治理投影。浏览器只消费
标准 `start/reasoning-delta/text-delta/done/error` 事件，停止生成沿同一 Abort 链路中断
Codex turn，不存在非流式回退。

媒体 conversation 的规范身份固定为
`conversationId + scene + sceneRefId + activeTurnId + providerThreadId`。Task 只保存
`llmConversationId`，其余字段只以 `admin_llm_conversation` 为权威；context、provider thread
绑定和 result 回调必须携带同一个 `activeTurnId`。gateway 取得 App Server thread 后必须先调用
`POST /internal/media-governance/agent/llm-conversations/provider-thread`，API 在对话行锁内以
`expectedProviderThreadId` 执行 CAS：常规只允许 `null -> actual` 或 `same -> same`；仅策略版本升级可显式执行一次 `old -> new`，绑定成功后才
发送 `turn/start`。上一回合的迟到请求、错误 Task/scene/ref 或不同 thread 均返回 409，不能
覆盖当前身份。旧 `media_governance_agent_session` 与 NAS 宿主 `task-sessions` 文件不会被恢复
为标准 conversation；旧文件只可在新链路验收后按备份清单隔离清理。
Gateway 可在内存中为 `candidateSummaries` 派生候选 ID，但 result 回调与助手消息 metadata
只能传输 `answer/candidateSummaries/nextActionLabel/planSha256/status/summary` 六个输出 Schema 字段；
`candidates` 等内部投影不得越过该边界。

gateway 只监听 NAS 私有 k3d bridge 地址，统一根为 `/internal/llm-codex`；健康接口是
`GET /internal/llm-codex/health`，实时模型接口是
`GET /internal/llm-codex/models`，流接口是
`POST /internal/llm-codex/chat/stream`，三者均使用 `x-kt-llm-gateway-secret`。模型接口
通过独立 Unix-WebSocket 连接有界分页调用 App Server `model/list`，排除隐藏项并按发送
模型 ID 去重。每次
thread/start、thread/resume 和 turn/start 都必须命中 `llm-codex` 权限档、
`networkAccess=true` 与 `approvalPolicy=never`，同时启用 live Web Search；媒体写边界
继续由动态类型化工具、Task revision 和密封计划约束。App Server Unix socket 使用标准
WebSocket HTTP Upgrade，wire JSON-RPC 省略 `jsonrpc` 字段，动态工具以下划线 wire 名映射
回点号内部合同。可见消息、reasoning、终态 metadata、实际模型和底层 Codex thread 都写入
同一 LLM conversation；媒体治理页面仅按 Task 的 `llmConversationId` 进入这条标准对话。
结构化结果异常投影为失败；真实候选歧义保持 `needs-operator`，不能用
`operator-decision` 绕过候选和密封计划校验。
`turn/start` 的结构化输出 Schema 必须把 `properties` 中的每个字段同时列入
`required`；无候选时返回空 `candidateSummaries`，不得以省略字段绕过严格 Schema。
种子上传
会在内存中解析 bencode、重新计算 v1 info hash，并拒绝路径穿越、绝对路径、重复
路径、符号链接、可执行项、畸形和超量描述文件。磁链只接受有界 BTIH 身份。两类
原始描述都只能写入 `MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET`（默认
`kt-media-governance-private`），普通 `/minio/*` 查询、上传、下载和删除入口会拒绝
该 Bucket；列表、日志、SSE 和普通证据只返回脱敏投影。

### Auth / User

| 方法   | 路径            | 说明                                                          |
| ------ | --------------- | ------------------------------------------------------------- |
| `POST` | `/auth/login`   | 后台登录，返回 accessToken 和用户信息，并写入 httpOnly cookie |
| `POST` | `/auth/refresh` | 原子消费并轮换 refresh token，同时刷新 accessToken            |
| `POST` | `/auth/logout`  | 吊销当前 refresh-token family 并清理 Admin 登录 cookie        |
| `GET`  | `/auth/codes`   | 获取当前用户按钮权限码                                        |
| `GET`  | `/user/info`    | 获取当前用户信息                                              |

### Menu / Role / Dept / User Manage

| 方法     | 路径                        | 说明               |
| -------- | --------------------------- | ------------------ |
| `GET`    | `/menu/all`                 | 当前用户菜单       |
| `GET`    | `/system/menu/list`         | 系统菜单树         |
| `GET`    | `/system/menu/name-exists`  | 菜单 name 重名校验 |
| `GET`    | `/system/menu/path-exists`  | 菜单 path 重名校验 |
| `POST`   | `/system/menu`              | 新增菜单           |
| `PUT`    | `/system/menu/:id`          | 更新菜单           |
| `DELETE` | `/system/menu/:id`          | 删除菜单及子菜单   |
| `GET`    | `/system/role/list`         | 角色分页           |
| `POST`   | `/system/role`              | 新增角色           |
| `PUT`    | `/system/role/:id`          | 更新角色           |
| `DELETE` | `/system/role/:id`          | 删除角色           |
| `GET`    | `/system/dept/list`         | 部门树             |
| `POST`   | `/system/dept`              | 新增部门           |
| `PUT`    | `/system/dept/:id`          | 更新部门           |
| `DELETE` | `/system/dept/:id`          | 删除部门           |
| `GET`    | `/system/user/list`         | 用户分页           |
| `POST`   | `/system/user`              | 新增用户           |
| `PUT`    | `/system/user/:id`          | 更新用户           |
| `PUT`    | `/system/user/:id/password` | 重置用户密码       |
| `DELETE` | `/system/user/:id`          | 删除用户           |

系统菜单实体包含 `sort` 字段；菜单树输出按 `meta.order` 优先，其次按 `sort` 升序排列。Admin 菜单管理页面维护 `sort`，不要把普通菜单排序写进隐藏的 route meta。

### Dict

| 方法     | 路径                           | 说明                                                                               |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `GET`    | `/dict/list`                   | 字典项分页，支持 `dictCode`、`keyword`、`label`、`value`、`childrenCode`、`status` |
| `GET`    | `/dict/tree`                   | 兼容树形字典视图                                                                   |
| `GET`    | `/dict/groups`                 | 字典编码分组列表，适合左右表左侧分组                                               |
| `GET`    | `/dict/codes`                  | 字典编码选项                                                                       |
| `GET`    | `/dict/getDictByKey`           | 按 `dictKey` 获取启用字典项                                                        |
| `GET`    | `/dict/getComponentDictByType` | 按组件一级类型查二级类型                                                           |
| `POST`   | `/dict/save`                   | 新增字典项                                                                         |
| `POST`   | `/dict/update`                 | 更新字典项                                                                         |
| `DELETE` | `/dict/:id`                    | 物理删除字典项                                                                     |
| `POST`   | `/dict/toggle`                 | 启停字典项                                                                         |

字典核心字段：

| 字段           | 说明                                                      |
| -------------- | --------------------------------------------------------- |
| `dictCode`     | 字典分组，例如 `COMPONENT_TYPE`、`BANGDREAM_SERVER_ALIAS` |
| `label`        | 展示文本                                                  |
| `value`        | 字典值                                                    |
| `childrenCode` | 关联子分组编码                                            |
| `sort`         | 排序                                                      |
| `status`       | `1` 启用                                                  |

### Component

组件接口保持 `/component/*` 路径兼容，但数据表为 `admin_component`。

| 方法   | 路径                    | 说明                                                                 |
| ------ | ----------------------- | -------------------------------------------------------------------- |
| `GET`  | `/component/allList`    | 全量组件                                                             |
| `GET`  | `/component/list`       | 组件分页，支持 `pageNo`、`pageSize`、`name`、`type`、`componentType` |
| `GET`  | `/component/detail?id=` | 组件详情                                                             |
| `POST` | `/component/save`       | 新增组件                                                             |
| `POST` | `/component/update`     | 更新组件                                                             |
| `POST` | `/component/remove?id=` | 逻辑删除组件                                                         |

### Timezone / Upload / Demo

| 方法   | 路径                           | 说明                          |
| ------ | ------------------------------ | ----------------------------- |
| `GET`  | `/timezone/getTimezoneOptions` | 时区选项                      |
| `GET`  | `/timezone/getTimezone`        | 当前用户时区                  |
| `POST` | `/timezone/setTimezone`        | 设置当前用户时区              |
| `POST` | `/upload`                      | Vben 上传适配，实际写入 MinIO |
| `GET`  | `/table/list`                  | Vben 示例表格                 |
| `GET`  | `/status`                      | 状态码测试                    |
| `GET`  | `/demo/bigint`                 | BigInt JSON 测试              |
| `GET`  | `/test`                        | GET 测试                      |
| `POST` | `/test`                        | POST 测试                     |

## 系统日志

后端通过 `nestjs-pino` 输出结构化日志。配置 Loki 后，Admin 日志页面通过后端代理查询，不直连 Loki。

| 方法  | 路径                   | 说明                                                                                                      |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET` | `/system/logs`         | 日志分页，支持 `level`、`keyword`、`context`、`path`、`requestId`、`startTime`、`endTime`、`rangeMinutes` |
| `GET` | `/system/logs/summary` | 按级别统计                                                                                                |
| `GET` | `/system/logs/levels`  | 日志级别选项                                                                                              |
| `GET` | `/system/logs/status`  | Loki 查询配置状态                                                                                         |

日志行包含 `timestamp`、`level`、`message`、`method`、`path`、`statusCode`、`durationMs`、`requestId`、`raw` 等字段。

### 系统站内信

站内信用于承接运行期事件，不再作为人工公告入口。后端在接口 5xx、QQBot OneBot 下线 notice、NapCat 容器日志检测到账户离线或 Message Management 的站内信订阅者收到统一消息时生成或聚合通知，默认通知 `super` 角色；接口在服务端也强制 `super` 角色访问。相同 `dedupeKey` 的事件通过 `active_dedupe_key` 唯一索引聚合，会累加 `occurrenceCount`，刷新 `lastSeenAt`，并重新置为未读。运行期通知会按表字段长度归一化 `title`、`dedupeKey`、`source`、`eventType` 和 `notifyRoleCode`，长 `dedupeKey` 会保留稳定 hash 后缀，避免长路径接口错误丢通知。

Admin 先通过 `/system/notice/unread-count` 读取权威未读数，再维持一条带 Bearer 鉴权的 `/system/notice/events/stream` SSE。首次连接或重放游标失效时收到 `snapshot-required`，已提交变更发送 `notice-changed`，心跳只保活；客户端用 `Last-Event-ID` 续接有界内存重放并在断线时退避重连。SSE 只广播失效信号，未读数和列表仍由 HTTP 快照校准；站内信订阅者在 Message Management 共享事务内落库，并通过通用提交后回执确保事件不会早于事务提交。

| 方法     | 路径                           | 说明                                                                                                                                          |
| -------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/system/notice/list`          | 消息中心分页列表，支持 `keyword`、`severity`、`source`、`eventType`、`status`、`isTop`、`notifyRoleCode`、`notifyUsers`、`pageNo`、`pageSize` |
| `GET`    | `/system/notice/detail/:id`    | 查询站内信详情                                                                                                                                |
| `GET`    | `/system/notice/unread-count`  | 查询未删除且状态为未读的消息数量                                                                                                              |
| `GET`    | `/system/notice/events/stream` | SSE 订阅提交后的站内信变化，支持 `Last-Event-ID` 或 `lastEventId`                                                                             |
| `DELETE` | `/system/notice/:id`           | 删除站内信（逻辑删除）                                                                                                                        |
| `POST`   | `/system/notice/toggle`        | 标记已读或未读（`id`、`status`，`1` 未读，`0` 已读）                                                                                          |
| `POST`   | `/system/notice/read/batch`    | 一次把 `ids` 中 1–100 条唯一未读消息标记已读，返回实际更新数                                                                                  |
| `POST`   | `/system/notice/top`           | 切换置顶（`id`、`isTop`）                                                                                                                     |

返回字段包含 `severity`、`source`、`eventType`、`dedupeKey`、`occurrenceCount`、`notifyRoleCode`、`metadata`、`firstSeenAt`、`lastSeenAt`。后端不暴露人工 `save/update` 入口。

## Blog 本地内容

`/blog/*` 是本地博客内容能力，供 `Vue/kt-blog-web` 和 Admin 博客管理使用。

### Blog Article

| 方法   | 路径                             | 说明                       |
| ------ | -------------------------------- | -------------------------- |
| `GET`  | `/blog/article/public/list`      | 公开文章分页               |
| `GET`  | `/blog/article/public/detail`    | 公开文章详情，支持 id/slug |
| `GET`  | `/blog/article/list`             | 后台文章分页               |
| `GET`  | `/blog/article/detail`           | 后台文章详情               |
| `POST` | `/blog/article/save`             | 新增文章                   |
| `POST` | `/blog/article/update`           | 更新文章                   |
| `POST` | `/blog/article/remove`           | 删除文章                   |
| `GET`  | `/blog/article/category-options` | 文章分类选项               |
| `GET`  | `/blog/article/tag-options`      | 文章标签选项               |

文章 body 常用字段：

```json
{
  "title": "文章标题",
  "slug": "post-slug",
  "status": "publish",
  "content": "Markdown 或 HTML",
  "contentFormat": "markdown",
  "cover": "",
  "categories": ["tech"],
  "tags": ["kt"]
}
```

### Blog Category / Tag / Theme

| 方法   | 路径                    | 说明                |
| ------ | ----------------------- | ------------------- |
| `GET`  | `/blog/category/list`   | 本地分类分页        |
| `GET`  | `/blog/category/detail` | 本地分类详情        |
| `POST` | `/blog/category/save`   | 新增分类            |
| `POST` | `/blog/category/update` | 更新分类            |
| `POST` | `/blog/category/remove` | 删除分类            |
| `GET`  | `/blog/tag/list`        | 本地标签分页        |
| `GET`  | `/blog/tag/detail`      | 本地标签详情        |
| `POST` | `/blog/tag/save`        | 新增标签            |
| `POST` | `/blog/tag/update`      | 更新标签            |
| `POST` | `/blog/tag/remove`      | 删除标签            |
| `GET`  | `/blog/term/options`    | 分类/标签选项       |
| `GET`  | `/blog/theme/config`    | 获取 Argon 主题配置 |
| `POST` | `/blog/theme/save`      | 保存本地主题配置    |

## MinIO

| 方法     | 路径                                         | 说明                                                                                                                             |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/minio/check`                               | 检查连接和 bucket                                                                                                                |
| `POST`   | `/minio/bucket`                              | 创建 bucket                                                                                                                      |
| `POST`   | `/minio/upload`                              | 上传文件，`multipart/form-data`                                                                                                  |
| `GET`    | `/minio/list`                                | 文件列表                                                                                                                         |
| `GET`    | `/minio/url`                                 | 根相对同源下载 URL，不公开内部 MinIO endpoint                                                                                    |
| `GET`    | `/minio/resource-proxy`                      | 代理读取资源                                                                                                                     |
| `GET`    | `/minio/download`                            | 下载文件流                                                                                                                       |
| `DELETE` | `/minio/remove`                              | 删除文件                                                                                                                         |
| `GET`    | `/blog/live2d/:character/catalog.json`       | 公开读取 Pio/Tia Live2D 公共目录索引，按 Referer/Origin 白名单防盗链                                                             |
| `GET`    | `/blog/live2d/:character/:family/*assetPath` | 公开读取 Pio/Tia Live2D 运行包资源，`character` 只允许 `pio`/`tia`，`family` 只允许 `moc`/`moc3`，按 Referer/Origin 白名单防盗链 |
| `GET`    | `/blog/asset/:sha256/:basename`              | 公开读取迁移后的内容寻址 Blog 资源                                                                                               |
| `HEAD`   | `/blog/asset/:sha256/:basename`              | 读取迁移后的 Blog 资源 MIME、长度和 immutable 缓存元数据                                                                         |

`bucketName` 不传时使用 `MINIO_BUCKET`。

Blog Live2D 运行包读取入口不使用 Vben 响应包装，直接返回 MinIO 文件流。根 `catalog.json` 暴露当前角色 family、目录规范和动作/贴图计数；asset 路由只读取 `moc/` 或 `moc3/` 下的 `index.json`、`manifest.json`、runtime、model、motion、shader 和 source texture 文件。允许的请求源固定为旧 Blog Origin `https://blog.kwitsukasa.top`，以及由可信代理链、归一化协议和原始 Host 推导出的当前 `https://nas4.kwitsukasa.top:{动态端口}` Origin；动态端口必须显式存在，省略端口或显式默认 `443` 均不属于 NATMap 入口，`X-Forwarded-Host` 不能改变该 authority。`BLOG_LIVE2D_BUCKET` 决定 bucket，`BLOG_LIVE2D_ROOT_PREFIX` 决定角色根目录（默认 `blog/live2d`），旧 `BLOG_LIVE2D_PREFIX=blog/live2d/pio` 会自动派生到同一根前缀以兼容现有环境。路由支持嵌套资源路径，如 `textures/default-costume.png` 和 `assets/model/motions/breath1.motion3.json`，并拒绝缺失或不匹配的 Referer/Origin、绝对 URL、反斜杠、`.`/`..`、多重编码后的路径逃逸、未知角色和 `v1/v2` 这类自定义版本 family。MinIO 上传及 `/minio/url` 返回根相对 `/api/minio/download?...`，客户端不再接收内部 MinIO 预签名地址。

旧 Blog 资源迁移器扫描 `blog_article.content_html/content_markdown/cover/excerpt` 与 `blog_theme_config.config`。下载只允许 `BLOG_ASSET_MIGRATION_ALLOWED_HOSTS` 的精确 HTTP(S) Host，每次 redirect 都重新校验并使用绑定已校验 DNS 结果的直连 Agent；响应同时受 redirect、timeout、大小和安全 MIME 限制。对象键固定为 `blog/migrated/{sha256}/{basename}`，数据库写入根相对 `/api/blog/asset/{sha256}/{basename}`。命令 `pnpm blog-assets:migrate -- <参数>` 支持 `--dry-run`、`--execute`、`--resume`、`--verify` 与 `--rollback-manifest <path>`；manifest 必须由调用方指定在 `.kt-workspace` 下，破坏性模式必须声明当前数据库身份、维护确认和已有备份。公开 GET/HEAD 路由只按 64 位 SHA-256 与安全 basename 映射固定前缀，进入公开读取限流并返回一年 immutable 缓存；rollback 默认只恢复数据库旧 URL，不删除共享对象。

当前本地证据已包含固定镜像摘要的一次性 MySQL+MinIO 真实往返：
`dry-run -> execute -> verify -> rollback` 后五个锁定字段全部恢复，
迁移 URL 遗留数为 0。生产发布仍必须独立完成生产备份、维护窗口、
dry-run 审查和迁移后 verify，不能用本地结果替代生产证据。

## Bot、Bot Adapter 与 Plugin Platform

`src/modules/bot` 只提供无状态协议信封与 adapter registry；账号、连接、会话、命令、规则、日志和持久化位于 `bot-adapter/core`。NapCat 与 Tencent 分别适配 OneBot 和 QQ 官方协议；Plugin Platform 只保存插件生命周期与无状态回调，不保存 `selfId`、AppID、OpenID 或账号绑定。

### Account / Scan Login

| 方法   | 路径                                                         | 说明                                   |
| ------ | ------------------------------------------------------------ | -------------------------------------- |
| `GET`  | `/bot-adapter/napcat/account/list`                           | NapCat 账号分页                        |
| `GET`  | `/bot-adapter/napcat/account/enabled`                        | 启用账号列表                           |
| `POST` | `/bot-adapter/napcat/account/save`                           | 手动新增账号                           |
| `POST` | `/bot-adapter/napcat/account/update`                         | 更新账号                               |
| `POST` | `/bot-adapter/napcat/account/scan/create`                    | 扫码新增账号，创建登录会话             |
| `POST` | `/bot-adapter/napcat/account/scan/refresh?id=`               | 对已有账号刷新登录态                   |
| `GET`  | `/bot-adapter/napcat/account/scan/status?sessionId=`         | 查询扫码会话状态                       |
| `GET`  | `/bot-adapter/napcat/account/scan/events?sessionId=`         | SSE 订阅扫码进度                       |
| `POST` | `/bot-adapter/napcat/account/scan/qrcode/refresh?sessionId=` | 刷新当前会话二维码                     |
| `POST` | `/bot-adapter/napcat/account/scan/captcha/submit`            | 提交密码登录安全验证码结果             |
| `POST` | `/bot-adapter/napcat/account/scan/cancel?sessionId=`         | 取消扫码会话                           |
| `POST` | `/bot-adapter/napcat/account/delete?id=`                     | 删除账号并断开 WS                      |
| `POST` | `/bot-adapter/napcat/account/kick?selfId=`                   | 断开反向 WS 会话                       |
| `POST` | `/bot-adapter/tencent/webhook/:appId/:webhookToken`          | QQ 官方公开 Webhook challenge/事件入口 |
| `GET`  | `/bot-adapter/napcat/runtime/detail?accountId=`              | 读取账号 NapCat 运行态证据             |
| `POST` | `/bot-adapter/napcat/account/bind/command`                   | 绑定账号和在线命令                     |
| `POST` | `/bot-adapter/napcat/account/unbind/command`                 | 解绑账号和在线命令                     |
| `POST` | `/bot-adapter/napcat/account/bind/rule`                      | 绑定账号和自动回复规则                 |
| `POST` | `/bot-adapter/napcat/account/unbind/rule`                    | 解绑账号和自动回复规则                 |
| `GET`  | `/bot-adapter/napcat/account/plugins?selfId=`                | 读取 NapCat adapter 插件绑定           |
| `POST` | `/bot-adapter/napcat/account/plugins/{bind,unbind}`          | 修改 NapCat adapter 插件绑定           |

Tencent 连接使用独立接口，不与 NapCat 表单或路由混用：

| 方法   | 路径                                                  | 说明                                |
| ------ | ----------------------------------------------------- | ----------------------------------- |
| `GET`  | `/bot-adapter/tencent/list`                           | Tencent WebSocket/Webhook 连接分页  |
| `POST` | `/bot-adapter/tencent/{save,update,delete,reconnect}` | 创建、编辑、删除或重连 Tencent 连接 |
| `GET`  | `/bot-adapter/tencent/webhook-url?id=`                | 读取 NAS 直连 Webhook 回调 URL      |
| `GET`  | `/bot-adapter/tencent/plugins?accountId=`             | 读取 adapter 插件绑定               |
| `POST` | `/bot-adapter/tencent/plugins/{bind,unbind}`          | 修改绑定并同步官方菜单              |
| `POST` | `/bot-adapter/tencent/menu/sync?accountId=`           | 幂等同步 QQ 官方菜单与四场景面板    |

NapCat 请求只接受 `connectionMode=reverse-ws` 与 `selfId/accessToken/loginPassword`；Tencent 请求只接受 `official-websocket|official-webhook` 与 `appId/appSecret`。`loginPassword` 与 `appSecret` 只允许经 TLS 提交并加密持久化，列表、事件、日志和响应不回显，空白编辑保留旧密文。

官方 WebSocket 使用腾讯 SDK 高层 `QQBot.on('message')` / `QQBot.start()` 接收 C2C 与群消息，SDK 派生的 `replyTarget` 会沿 normalized message、命令/规则/事件插件和发送队列一直保留到 `bot.sendText`；被动回复必须携同一入站 `msgId`。官方 Webhook 入口不使用 Admin JWT，但先绑定启用的 `official-webhook` 账号和 HMAC URL token，再按 QQ 官方 Ed25519 头校验原始请求字节。`op=13` 返回 `{ plain_token, signature }`；合法事件立即返回 `{ op: 12, d: 0 }`，数据库活动状态与业务分发异步执行。`TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL` 只能配置为不经腾讯云中转的 NAS 直连 HTTPS API 基址，公网端口必须属于官方允许的 `80/443/8080/8443`，服务端再追加 `/bot-adapter/tencent/webhook/:appId/:webhookToken`；其他动态端口失败关闭。

插件回调只使用平台无关的 conversation/sender/event key 与 reply intent。NapCat 事件绑定保存在 `bot_account_ability(event_plugin)`；Tencent 绑定保存在 `tencent_bot_plugin_binding`。Plugin Platform 不保存 Bot 身份，真实命令仍由 adapter core 的账号能力精确绑定。

Tencent 插件菜单同步遵循 QQ 官方 `/v2/menu` 和 `/v2/panels`：先 GET 当前菜单并保留非 `KT·` 项，再 PUT 完整菜单；四个 scope 分别分页 GET，只管理 remark 为 `kt-plugin-menu:v1:<scope>` 的面板。数量和字符限制在写入前失败关闭；比较时忽略 GET 自动补入的菜单 icon、把缺失的 `only_admin` 归一为 `false`，面板指令名称不携带 `/`，因此重复同步无差异时不调用写接口。NapCat 外发则保留核心构造的受控 OneBot 字符串或消息段，使 CQ 图片和 @ 提及继续按协议解释，严格纯文本链仍使用文本段。统一会话、消息和发送日志的消息 ID 列宽为 255，确保 QQ 官方长 `msg_id` 能完整进入入站记录并作为五分钟窗口内的被动回复依据。

账号列表的 `connectStatus` 对 NapCat 表示 OneBot 连接，对官方 WebSocket 表示 Gateway，对官方 Webhook 表示已通过 challenge 或收到合法事件。`napcat.oneBotOnline`、`napcat.containerOnline`、`napcat.webuiOnline`、`napcat.qqLoginStatus`、`napcat.qqLoginMessage` 只适用于 NapCat；官方账号调用扫码、NapCat 运行态或 WebUI 接口会被拒绝。

扫码链路返回 `sessionId`，前端应使用 SSE 查看步骤进度，而不是等待长 HTTP 请求完成；新增账号扫码会先预留容器和临时设备身份后立即返回 pending，会话后台再启动远端 Docker 和生成二维码。`CheckLoginStatus.isLogin=true` 只表示 NapCat 登录阳性，新增账号必须继续等 `GetQQLoginInfo` 返回 `uin/selfId` 后才允许创建和绑定真实 QQ 号；短暂缺号时 `/bot-adapter/napcat/account/scan/status` 保持同一会话 pending 并显示正在读取 QQ 号，等待 `NAPCAT_LOGIN_SELF_ID_WAIT_MS`，不得重建容器、补 env 或从容器元数据猜号。已有账号的更新登录不会通过 Docker 重建、重启或补 env 来刷新 QQ 登录态；如果目标容器仍在线，即使 QQ 账号已离线，也会保持同一容器并通过 NapCat WebUI 推进原有弹窗流程。若 WebUI 明确返回 QQ 离线，API 会先调用同容器 `/api/QQLogin/RestartNapCat` 重启 NapCat worker 以重建 QQCore login service，再继续 `SetQuickLogin`、`PasswordLogin`、`RefreshQRcode` / `GetQQLoginQrcode`；这不是 Docker 容器重建/重启，设备身份、env 和 dataDir 不变，同一个更新登录 session 只消费一次 worker restart 预算，后续轮询继续刷新二维码但不得反复重启 worker。只有 Docker 容器离线或缺失时，容器准备阶段才会创建/重建容器，并在创建时一次性注入 `ACCOUNT` 和必要登录 env；已在线的源容器不补 env。快速登录失败后，如果账号保存了登录密码，后端使用解密后的密码计算 MD5 调用 `/api/QQLogin/PasswordLogin`，不会把密码写回运行态 env，也没有成功后的 env 清理步骤；密码登录结果按 `NAPCAT_PASSWORD_LOGIN_WAIT_MS` / `NAPCAT_LOGIN_POLL_INTERVAL_MS` 轮询。准备阶段的扫码会话会持续续期，避免后台登录未完成时前端先判过期。同一账号已有 pending 更新登录会话时，重复调用 `/bot-adapter/napcat/account/scan/refresh` 通常会返回原 `sessionId`，不会再次启动 quick/password/二维码准备；但当这条 pending 会话创建时账号还没有保存登录密码、且会话尚未进入密码验证码或新设备验证上下文，而账号后来通过编辑维护了登录密码时，API 必须退役旧无密码会话并新建 refresh session，重新读取最新密码后进入 `PasswordLogin`。取消扫码会话必须在接口返回前把持久化 `napcat_login_session` 落到非 pending 终态并写入完成时间，避免已取消的测试二维码从 DB 恢复成可轮询会话。若 API Pod 在准备阶段重启，持久化的 `preparingRelogin` 超过 `NAPCAT_RELOGIN_PREPARING_STALE_MS`（留空使用密码等待窗口加缓冲）后，`/bot-adapter/napcat/account/scan/status` 会自动恢复普通登录态检测，不再永久停留在“正在尝试密码登录”；`/bot-adapter/napcat/account/scan/events` 在进程内事件缓存丢失时会先推送当前会话快照。pending refresh 会话如果没有二维码、验证码或新设备挑战，`/bot-adapter/napcat/account/scan/status` 会按 `NAPCAT_LOGIN_QR_AUTO_REFRESH_COOLDOWN_MS` 冷却在同一容器自动重试 `RefreshQRcode/GetQQLoginQrcode`，避免 SSE 长时间卡在“二维码生成中”。密码登录触发 QQ 安全验证时，接口返回的 `captchaUrl` 只用于前端拉起腾讯验证码；前端必须把腾讯验证码返回的 `ticket`、`randstr`、`sid` 连同 `sessionId` 提交到 `/bot-adapter/napcat/account/scan/captcha/submit`，后端再代理到同一 NapCat 容器的 `/api/QQLogin/CaptchaLogin` 继续密码登录第二步。验证码和新设备验证这类真人交互态使用 `NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS`（默认 15 分钟，且至少不短于普通二维码 TTL）续期；普通登录二维码仍使用 `NAPCAT_LOGIN_QR_EXPIRE_MS`。`/bot-adapter/napcat/account/scan/status` 遇到 NapCat 只返回“需要验证码/继续完成验证/安全验证”但不带 URL 时，会先从当前容器日志提取 `proofWaterUrl`，提取不到则保持验证码处理中而不切到二维码兜底；会话已有 `captchaUrl` 后，同类状态仍保持 `pending` 和原 `captchaUrl`。密码登录仍失败、验证码未完成、离线、账号不匹配或缺少 QQ 号时，直接通过 WebUI 二维码接口进入扫码兜底，不 reset 登录态。看门狗只做离线巡检、账号错误写入和 `super` 站内信告警，不会触发 quick/password 登录或扫码登录。

密码验证码通过后如果 NapCat 返回 `needNewDevice`，后端不会只把 `jumpUrl` 透给 Admin，而是在同一会话中继续调用 `/api/QQLogin/GetNewDeviceQRCode` 生成新设备验证二维码；`/bot-adapter/napcat/account/scan/status` 后续轮询会代理 `/api/QQLogin/PollNewDeviceQR`，状态映射为 `newDeviceStatus=qr-pending|scanned|confirming|verified|expired|failed`，进入确认态后再调用 `/api/QQLogin/NewDeviceLogin` 并回到密码登录完成检查。扫码会话结果新增 `newDeviceQrcode`、`newDeviceStatus`、`deviceVerifyUrl` 字段；`captchaUrl` 和 `newDeviceQrcode` 分别表示腾讯安全验证码和 QQ 新设备验证二维码，前端必须分开展示。SSE 进度文案包含快速登录、密码登录、验证码、新设备二维码、已扫码、确认中、二维码兜底、登录成功/失败。

同一 QQ 账号只保留一个有效 NapCat 主容器。扫码后如果已有账号绑定到新容器，后端会释放旧绑定和未共享的旧容器，避免同账号多实例互相挤下线。OneBot notice 只有机器人下线、登录失效、`KickedOffLine` 等账号级信号才会记录 QQ 登录态异常并生成 `qqbot.account.offline` 站内信，普通群成员 kick 不属于账号离线信号。下线原因写入 `lastError` 前按 `last_error` 500 字符列宽截断；后续无错误的普通断连只更新 OneBot 连接状态，不清空该原因。账号列表会按近期缓存检查绑定 NapCat 容器的最新登录状态日志，日志检测默认 5 秒超时；`isOnline:false` 属于 QQ 登录态离线信号；心跳只代表 OneBot/容器通信，不能推导 QQ 登录态；近期连接只用于避免重连瞬间被旧缓存误伤，后续仍必须以 NapCat WebUI/日志检查判断 QQ 登录态。托管容器必须显式配置 `NAPCAT_IMAGE`，不要依赖 `latest` 默认镜像。

托管 NapCat 容器按账号持久化设备身份，`napcat_device_identity` 保存账号对应的数据目录、hostname、machine-id 路径、MAC 地址、验证状态和最近登录证据。重建同一账号容器时会复用 `pc-<8hex>` hostname、实体 OUI 风格 MAC 和 machine-id，并明确排除 Docker `02:42`、QEMU/KVM `52:54:00`、VMware、Hyper-V 等虚拟化前缀；新增账号创建期在真实 QQ selfId 未知时使用预留容器 id 创建临时设备身份，第一次 Docker run 就注入完整拟真参数，扫码成功后再把该身份和 runtime/protocol profile 归属到真实账号。Docker run 会注入 `--hostname`、`--mac-address`、只读 `/etc/machine-id` 挂载、`SYS_ADMIN`、`apparmor=unconfined`、`seccomp=unconfined` 和 `NAPCAT_REQUIRE_DEVICE_PROFILE=1`；后端还会同步写入 QQNT Linux `machine-info`，让 QQNT 计算 GUID 时使用的 MAC 与 Docker 网卡一致。派生镜像 entrypoint 会用同一设备 profile 覆盖 QQCore 实际打开的 DMI、boot_id、kernel release/version/proc version、CPU model、uptime、TTY active、mountinfo、`/etc/hosts` 和 `/proc/devices` 等探针；NapCat fork native login 和 core session config 的 `machineId` 与 `systemVersion` 也从该 profile 读取，避免 QQ native 入参和 Docker 可见探针不一致。当前策略名为 `qqnt-visible-hostname-v1` / `physical-oui-mac-v1`，绑定关系会回填 `napcat_account_binding.device_identity_id`。

### Message Management 与订阅者适配器

消息链路固定为：消息源 → Message Management 来源适配器 → 绑定来源的模板 → 绑定多个同来源模板及一个订阅者的订阅 → 统一 `templates[]` 协议 → 具体订阅者投递。Message Management 负责来源规范化、订阅匹配、全部模板渲染和一次订阅者调用；Bot 与站内信只适配统一协议并自行决定如何投递。

所有管理接口先通过 Admin JWT。通用协议接口使用 `MessageManagement:Subscription:*`、`MessageManagement:Template:*`、`MessageManagement:Push:*`；Bot 订阅者私有配置使用 `Bot:Account:MessagePush:*`，不提供旧 `/qqbot` 路由或 `QqBot:*` 权限兼容。

| 方法                  | 路径                                                                                                                                   | 说明                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET`                 | `/message-management/subscribers`                                                                                                      | 读取统一协议订阅者定义                               |
| `GET`                 | `/message-management/sources`、`/message-management/sources/:sourceKey`、`/message-management/sources/:sourceKey/subscription-options` | 读取 Message Management 已注册来源及规范化订阅候选项 |
| `GET/POST/PUT/DELETE` | `/message-management/subscriptions`、`/message-management/subscriptions/:id`、`/message-management/subscriptions/:id/enabled`          | 管理多模板、单订阅者订阅                             |
| `GET/POST/PUT/DELETE` | `/message-management/templates`、`/message-management/templates/:id`、`/message-management/templates/:id/enabled`                      | 管理绑定一个来源的模板                               |
| `POST`                | `/message-management/templates/preview`                                                                                                | 按来源变量预览模板                                   |
| `GET/POST/PUT/DELETE` | `/message-management/subscribers/bot/accounts/:selfId/bindings`                                                                        | 管理 Bot 订阅者的账号、订阅和目标绑定                |
| `GET`                 | `/message-management/subscribers/bot/accounts/:selfId/targets`                                                                         | 读取该 Bot 账号可投递目标                            |
| `GET/POST/PUT/DELETE` | `/message-management/subscribers/station-notice/bindings`                                                                              | 管理站内信订阅者的订阅、标题与接收角色绑定           |
| `GET/POST/DELETE`     | `/message-management/subscribers/station-notice/notices/*`                                                                             | 查询或维护已物化站内信；要求 `super`                 |

订阅与模板列表返回 `data.items/data.total`，source、subscriber 与 binding 列表直接返回数组，其余接口返回单个对象或布尔值；全部 `POST` 使用 HTTP 200。NapCat 账号离线或 OneBot 不可用时 targets 返回不可用投影；Tencent 账号由 adapter 使用事件中的 OpenID，不调用 OneBot 好友或群列表。

请求采用严格白名单：Snowflake/外键 ID 是 1–24 位正十进制字符串；NapCat UIN 和目标 ID 保持字符串，Tencent OpenID 只在 adapter 内解释。模板通过 `sourceKey` 绑定一个来源；订阅接收 1–20 个有序且不重复的 `templateIds`、一个 `subscriberKey` 和来源 `sourceConfig`。Bot 与站内信绑定只接收 `subscriptionId` 和各自私有投递配置。

响应只返回协议白名单：来源、订阅者、模板、订阅及具体订阅者视图；不会返回 adapter、entity/repository、`activeKey`、digest、软删除字段、账号内部 ID、原始事件 payload、凭据、access token 或 Provider/OneBot/MQTT 对象。系统事件只能通过 Nest 内部 Outbox stager 暂存，不存在 publish、event、delivery、fan-out、retry 或 worker HTTP 发布接口。契约错误只公开稳定错误码，未知来源/订阅者及缺失资源为 404，不可用或冲突状态为 409，其余输入错误为 400；非领域错误保持 500 且不泄露内部细节。

TCP NATMap 独立消息源为 `network.tcp.natmap-endpoint-changed`、版本 `1`，订阅配置精确为 `{ tcpChannelId, ddnsRecordId }`，两个字段都必须是字符串 Snowflake ID，且 DDNS 必须是启用、未删除、绑定同一 TCP 通道的 A 记录。变量精确为 `endpoint`、`fqdn`、`publicIpv4`、`publicPort`、`previousPublicIpv4`、`previousPublicPort`、`portForwardName`；`endpoint` 使用事件端口冻结为 `FQDN:newPort`。DDNS 尚未同步到事件 IPv4 时由 Message Management 把事件置为 `deferred`，不会先创建任何订阅者私有投递；当前 tuple 已变化或租约过期为 `superseded`，通道撤下、删除、停用 NATMap 或 DDNS 改绑为 `cancelled`。现有 STUN 来源定义与变量保持不变。

初始化与增量 SQL 使用稳定 ID `2041700000000200602` 幂等创建 `TCP NATMap 端点变更默认模板`，正文固定为 `当前 TCP NATMap 端点已变更为 ${{endpoint}}`；既有 STUN 模板 ID、来源键和正文不得修改。TCP NATMap 独立操作权限为 `System:Network:PortForward:Natmap`，只授予活动 `super` 角色。

#### 内部事件与投递生命周期

- UDP 在既有有效端口直接变化为另一个有效端口，或 `withdrawn` 后以不同端口恢复时写既有 STUN Outbox；后者使用最近一条非 `withdrawn` 有效历史作为 `previousPort`，同端口恢复不写。TCP 在既有有效 tuple 直接变化，或紧邻 `withdrawn` 后恢复且公网 IPv4 或端口任一变化时写独立 NATMap endpoint Outbox；恢复同样跨过撤回历史取最近一条非 `withdrawn` 有效 TCP tuple，同 tuple 恢复不写。首次 `published`、同 tuple 续期、`withdrawn`、重复事件和回滚事务都不产生 TCP 消息事件。事件使用生产者 `eventId` 幂等，matching report/event 的 history、current/baseline 与 Outbox 保持既有事务关联门禁，事务提交后才调用 `requestDrain()`。
- Message Management 事件状态为 `accepted`、`processing`、`deferred`、`retry`、`completed`、`failed`；每次最多领取 50 行并设置 30 秒租约，启动后立即恢复且每 5 秒扫描。来源暂未就绪的事件进入 `deferred` 并每 60 秒复检，过期 `processing` 租约可由重启后的进程重新领取。
- 对每个匹配订阅，核心按 `message_subscription_template.sort_order` 渲染全部模板，形成一个包含完整有序 `templates[]` 的统一消息，只调用该订阅的 `subscriberKey` 一次。订阅者收到完整集合后自行选择一条、多条、聚合或跳过投递；核心不读取 QQ 账号、站内信角色或任何订阅者私有配置。
- Bot 当前选择对全部模板和全部启用目标做笛卡尔投递，私有状态为 `pending`、`processing`、`retry`、`success`、`failed`、`superseded`、`cancelled`；站内信当前选择每个模板物化一条 `admin_notice`。
- 来源 resolve 和 Bot 投递的临时错误从 10 秒开始指数退避，单次最长 15 分钟；发送前仍重检订阅、绑定、目标和账号。

#### SQL、发布与回滚

既有环境使用幂等增量入口 `sql/bot-message-push-init.sql`，随后执行只读的 `sql/bot-message-push-verify.sql`；包含历史迁移的 `sql/bot-init.sql` 不能作为本功能生产迁移。只有一次性、可丢弃的全量初始化环境才依次使用 `sql/refactor-v3/00-full-schema.sql`、`01-seed-core.sql`、`99-verify.sql`。增量迁移把旧 QQBot 模板、订阅和事件移入通用表；若一个旧订阅在不同账号绑定上使用不同模板，则先按“旧订阅 + 模板”拆成多个单模板订阅并重写绑定，禁止求并集后改变旧账号投递行为。

发布顺序是：备份现存旧/新协议表、QQBot 三张订阅者表、站内信绑定表及相关菜单/角色授权行 → 应用增量 SQL → 验证 8 张现行表、精确索引、多模板同来源约束、默认模板与权限 → 先验证 API 再发布 Admin → 创建来源模板、绑定多个模板及一个订阅者的订阅，再配置订阅者私有绑定 → 使用授权非生产目标分别完成来源事件到 QQBot 与站内信的有界验收。

回滚先停用全部发布绑定，再回滚 Admin 和 API，并保留事件、投递及发送日志；Network Agent、端口转发、STUN Keeper 和 DDNS 继续运行。Jenkins/K8s 通过只证明版本已部署，不能替代真实 CRUD、页面或事件到消息的功能验收。每次发布必须分别记录生产 SQL、真实 API、页面、Outbox/DDNS 和授权 QQ 投递证据；没有明确授权的 QQ 群或 QQ 号时不得任选目标，并应把真实投递单独标记为未验证。

### NapCat Runtime Profile

| 方法  | 路径                                            | 说明                                                                                        |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET` | `/bot-adapter/napcat/runtime/detail?accountId=` | 读取账号 NapCat runtime/protocol/session behavior profile、风险降载和历史登录事件兼容表状态 |

该接口只返回脱敏后的运行态证据，供 Admin 排查镜像、locale、shm、配置 hash、漂移状态、风险模式和 watchdog 巡检告警状态；不会返回 WebUI token、reverse WS token、QQ 登录密码、SSH 私钥或运行态密码环境。账号列表只挂载 `napcat.profileStatus`、`napcat.runtimeProfile` 等摘要字段，不触发登录、重建或修复动作。watchdog 不执行登录恢复：遇到 QQ 登录态离线只记录离线原因并通知 `super`，登录恢复统一由 Admin 手动「更新登录」触发；session behavior profile 只做冷启动、housekeeping、presence 和自动能力分阶段降载，不实现账号级每小时/每日累计发送预算。

NapCat Chinese Desktop Runtime 使用 KT `NapCatQQ` fork 源码构建出的 `NapCat.Shell` artifact，并在 QQ `KickedOffLine` 后重置 native login service 再请求二维码；同一次踢下线事件只消费一次 reset，明确二维码过期或扫码确认窗口失效的 QR session failure 会自动换码，其他非自动重试 QR failure 会标记下次 WebUI 登录动作先重置 native login service。v14 起运行时会为 QQ/NapCat/Xvfb 长期进程做 PID 级 `/proc/<pid>/mountinfo` 遮蔽，避免 QQCore 通过 `/proc/self/mountinfo` 看到 `overlay`、`/vol1/docker`、`docker-init`、`/docker/containers`、`napcat-instances`、`btrfs`、`/dev/mapper/trim` 等宿主路径；v15 在扫码登录成功回调中先写入 `QQLoginInfo` 再写登录态，避免 API 读到 `isLogin=true` 但 QQ 号为空的短暂不一致；v16 在 native reset 缺少 `offline()` 时改用 `destroy()` 硬重置半登录服务，并让镜像 verify 等待 mountinfo guard 收敛；v17/v18 增加 WebUI 鉴权的 `/api/Debug/RuntimeViewProbe` 同进程诊断并修正 native maps 截断导致的 hook 证据假阴性；v19 保留 WebUI `RestartNapCat` 重启 worker 时的 `-q <uin>` 快速登录参数，避免重启后退回无账号扫码；v20 保护 API 预写的 `/app/napcat/config`，避免上游首次解包 `NapCat.Shell/*` 覆盖 `bypass.*=true` 与 `o3HookMode=0`。构建前必须运行 `scripts/napcat-desktop-cn-stage-build.mjs` 生成 Docker build context；生产 `NAPCAT_IMAGE` 应指向验证过的 `kt-napcat-desktop-cn:*` digest。生产 K8s manifest 保留 `kt-napcat-desktop-cn:desktop-cn-v20` / `desktop-cn-v20` 稳定默认值；Jenkins `NAPCAT_IMAGE_OVERRIDE` 与 `NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE` 只有非空时才覆盖 API Deployment env，空值会保持 manifest/default env。运行时回滚应重新运行 Jenkins 并填入上一版镜像 digest/profile，或清空两个 override 后重新部署回 manifest 默认值。

当前发布基线为 `desktop-cn-v21`，插件页面由框架按 page 文件和最具体静态路由生成页面基址；生产 API 同时声明共享写协议 `journal-flock-v1`。既有环境必须在部署 profile upsert 前执行 `sql/napcat-profile-container-unique.sql`，先拒绝重复非空 `container_id`，再幂等替换 runtime/protocol profile 唯一索引；空 `container_id` 仍允许多个创建期 profile。该索引完成后，容器 profile 重复写入才以单条 MySQL upsert 更新既有逻辑容器行。

API 仓库不提交 `NapCat.Shell.zip`；生产镜像必须从 staged context 构建，且 `fork-artifact.json` 必须包含完整 marker metadata：upstream release tag/commit、fork commit、base image digest、Jenkins URL 和 artifact hashes。NapCat base image 在 release evidence 中必须 pin 到 digest。API Jenkins 只做显式参数推广，不负责自动合并上游、自动构建运行时镜像或在 override 为空时隐式改写 NapCat env。

```bash
node scripts/napcat-desktop-cn-stage-build.mjs \
  --napcat-root /home/yemu2/KT/GitHub/NapCatQQ \
  --upstream-release-tag v4.8.0 \
  --upstream-release-commit 0000000000000000000000000000000000000000 \
  --napcat-base-image-digest mlikiowa/napcat-docker@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  --jenkins-build-url https://jenkins.kwitsukasa.top/job/KT-NapCatQQ-Runtime-Release/1/
```

### NapCat WebUI Gateway

NapCat WebUI Gateway 是独立部署的内部代理服务，生产镜像由 `dockerfile.gateway` 打包 `dist/apps/napcat-webui-gateway/main.js`，K8s 服务名为 `kt-napcat-webui-gateway`，端口 `48086`。API 侧只通过内部路由 `NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL` 创建、续期、撤销会话和交换一次性 ticket；浏览器只访问公开前缀 `NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL` 下的代理页面、静态资源和 WebSocket 转发，不能直连 NapCat 容器 WebUI。

统一网关公开前缀为 `/admin/napcat-webui`。Traefik 去掉 `/admin` 后，
Admin Nginx 与 Gateway 应用内部前缀仍为 `/napcat-webui`；两个层次不能
混用或重复拼接。

Gateway 只改写 NapCat HTML/JS/CSS 中需要浏览器直连的绝对根路径：`/webui/*`、`/api/*`、`/files/*` 和 `/plugin/*`。NapCat 文件管理的 `File` 路由属于 axios `baseURL="/api"` 下的 API 子路径，页面源码里的 `"/File/list"` 必须保持原样，由浏览器最终请求 `/api/File/list`；不能把 `/File/*` 当作独立静态根路径改写到 Gateway session 前缀，否则会形成 `/webui/api/napcat-webui/session/.../File/list` 并让文件管理拿到 HTML。

Gateway 使用固定的 streaming HTTP、文本 HTTP 和 WebSocket 三个代理实例。每个请求的 target、Credential 与 session 响应改写通过请求级隔离上下文传递；HTTP 代理固定 `ws=false`，唯一且幂等的 `upgrade` dispatcher 才能调用 WebSocket 代理。禁止为普通页面或资源请求创建新的 `ws=true` middleware，否则会累积 Server `upgrade/close` listener，并让未剥 session 前缀的旧 listener 抢占后续 WebSocket。不匹配或畸形的 Upgrade 必须立即返回无认证挑战的 403 并销毁 socket，不得留下悬空连接。

NapCat `/webui/sw.js` 上游响应里的 `Service-Worker-Allowed: /webui/`
不能原样透传。Gateway 只在上游显式返回该响应头时，把它替换为当前公开
session 的精确 `/admin/napcat-webui/session/:id/webui/webui/` scope；不能扩大
到 session 根、其他 session 或站点根，也不能暴露内部 `/napcat-webui` 前缀。

必需环境变量：`NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL`、`NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL`、`NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET`、`NAPCAT_WEBUI_GATEWAY_REDIS_HOST`、`NAPCAT_WEBUI_GATEWAY_REDIS_PORT`、`NAPCAT_WEBUI_GATEWAY_SESSION_TTL_MS`、`NAPCAT_WEBUI_GATEWAY_TICKET_TTL_MS`、`NAPCAT_WEBUI_GATEWAY_UPSTREAM_TIMEOUT_MS`。生产 `NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` 只来自 Jenkins 私有 `.env.production` 生成的 `kt-template-online-api-env` Secret，不写入 Git 或 manifest 字面量。

部署验收使用：`pnpm exec jest --runTestsByPath test/modules/bot-adapter/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand`、`pnpm run typecheck`、`pnpm run build`、`test -f dist/apps/napcat-webui-gateway/main.js`、`git diff --check`。安全验收要求浏览器永远不接收 WebUI token、Credential、上游 URL/端口、Docker 拓扑、Redis 地址或内部 secret。

`napcat_login_event` 实体和表仅作为历史 schema 兼容保留；watchdog 不再写入 quick/password 恢复事件，也不再依赖该表判断是否恢复登录。

外发消息不直接抢发：后端会按 `BOT_SEND_GLOBAL_INTERVAL_MS`、`BOT_SEND_TARGET_INTERVAL_MS` 和 `BOT_SEND_JITTER_MS` 预约发送窗口，默认全局 2500ms、同会话 8000ms、抖动 0-800ms；如果等待超过 `BOT_SEND_MAX_QUEUE_WAIT_MS`，本次发送会在下发前被拒绝。在线命令和自动回复规则会叠加运行时保底冷却，默认命令 5000ms、规则 30000ms；复读机默认连续 4 次相同普通文本才触发，同一会话默认 10 分钟内只复读一次，并限制普通文本长度，减少自动行为被风控识别的概率。

### Command / Rule / Permission

| 方法   | 路径                                   | 说明                                                                |
| ------ | -------------------------------------- | ------------------------------------------------------------------- |
| `GET`  | `/bot/command/list`                    | 在线命令分页，支持 `pluginKey`、`operationKey`、`selfId`、`enabled` |
| `POST` | `/bot/command/save`                    | 新增在线命令                                                        |
| `POST` | `/bot/command/update`                  | 更新在线命令                                                        |
| `POST` | `/bot/command/delete?id=`              | 删除在线命令                                                        |
| `POST` | `/bot/command/toggle?id=&enabled=`     | 启停在线命令                                                        |
| `POST` | `/bot/command/test`                    | 预览测试在线命令                                                    |
| `GET`  | `/bot/rule/list`                       | 自动回复规则分页                                                    |
| `POST` | `/bot/rule/save`                       | 新增自动回复规则                                                    |
| `POST` | `/bot/rule/update`                     | 更新自动回复规则                                                    |
| `POST` | `/bot/rule/delete?id=`                 | 删除自动回复规则                                                    |
| `POST` | `/bot/rule/toggle?id=&enabled=`        | 启停自动回复规则                                                    |
| `GET`  | `/bot/permission/config`               | 权限名单配置                                                        |
| `POST` | `/bot/permission/config`               | 保存权限名单配置                                                    |
| `GET`  | `/bot/permission/allowlist`            | 白名单分页                                                          |
| `POST` | `/bot/permission/allowlist/save`       | 新增白名单                                                          |
| `POST` | `/bot/permission/allowlist/update`     | 更新白名单                                                          |
| `POST` | `/bot/permission/allowlist/delete?id=` | 删除白名单                                                          |
| `GET`  | `/bot/permission/blocklist`            | 黑名单分页                                                          |
| `POST` | `/bot/permission/blocklist/save`       | 新增黑名单                                                          |
| `POST` | `/bot/permission/blocklist/update`     | 更新黑名单                                                          |
| `POST` | `/bot/permission/blocklist/delete?id=` | 删除黑名单                                                          |

`/bot/command/test` 示例：

```json
{
  "commandId": "2041700000000000001",
  "text": "/查曲 夏祭り",
  "selfId": "10000",
  "targetType": "group",
  "targetId": "123456",
  "userId": "2354598417"
}
```

线上 smoke 必须按 `operationKey` 查询启用命令 ID 后传入 `commandId`，避免默认 `preview` selfId 误报未匹配命令。

### Plugin / Dashboard / Send / Message

| 方法   | 路径                                      | 说明                                       |
| ------ | ----------------------------------------- | ------------------------------------------ |
| `GET`  | `/plugin-platform/catalog/list`           | 插件列表，支持 `triggerMode=command/event` |
| `GET`  | `/plugin-platform/catalog/operation/list` | 插件能力列表                               |
| `GET`  | `/plugin-platform/catalog/operation/page` | 插件能力分页                               |
| `GET`  | `/plugin-platform/catalog/health`         | 插件健康检查                               |
| `GET`  | `/plugin-platform/catalog/event/list`     | 无账号身份的事件插件定义                   |
| `GET`  | `/bot/dashboard/summary`                  | Bot 工作台汇总                             |
| `GET`  | `/bot/send/log/list`                      | 发送日志分页                               |
| `POST` | `/bot/send/private`                       | 发送私聊消息                               |
| `POST` | `/bot/send/group`                         | 发送群聊消息                               |
| `GET`  | `/bot/conversation/list`                  | 会话列表                                   |
| `GET`  | `/bot/message/list`                       | 消息列表                                   |

### Plugin Platform

插件平台使用统一 `plugin.json` manifest 描述插件 key、版本、入口、操作、事件、定时任务、权限和运行预算；后端会校验路径必须留在插件包内，权限必须命中白名单，安装包 content hash 必须与 manifest 匹配。`tasks` 字段声明平台托管的定时任务：

| 字段          | 说明                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `key`         | 全局唯一任务 key，例如 `bangdream.bestdori.sync-main-data`           |
| `name`        | Admin 展示名称                                                       |
| `handlerName` | 插件入口暴露的任务处理器名称                                         |
| `defaultCron` | 5 段 cron 表达式，不允许每分钟执行，并按 BullMQ/cron-parser 语义校验 |
| `timeoutMs`   | 单次任务执行预算                                                     |
| `enabled`     | 安装/启用时是否默认调度                                              |
| `permissions` | 任务需要的插件权限，例如 `runtime.http`、`plugin.storage.write`      |
| `description` | 可选说明                                                             |

CLI 入口：

```bash
pnpm plugin create <pluginKey>
pnpm plugin validate <pluginDir>
pnpm plugin pack <pluginDir>
pnpm plugin install-local <packageFile>
```

平台管理接口：

| 方法   | 路径                              | 说明                               |
| ------ | --------------------------------- | ---------------------------------- |
| `GET`  | `/plugin-platform/installations`  | 插件安装记录，支持 key/status 过滤 |
| `POST` | `/plugin-platform/upload`         | 上传插件包并返回校验摘要           |
| `POST` | `/plugin-platform/validate`       | 校验 manifest JSON                 |
| `POST` | `/plugin-platform/install`        | 按上传包安装插件版本               |
| `POST` | `/plugin-platform/install-local`  | 按本地包路径安装插件版本           |
| `POST` | `/plugin-platform/enable`         | 启用插件安装                       |
| `POST` | `/plugin-platform/disable`        | 禁用插件安装                       |
| `POST` | `/plugin-platform/upgrade`        | 升级插件安装版本                   |
| `POST` | `/plugin-platform/uninstall`      | 卸载插件安装                       |
| `POST` | `/plugin-platform/config`         | 保存插件配置                       |
| `GET`  | `/plugin-platform/runtime-events` | 查询插件运行事件                   |

定时任务管理接口：

| 方法   | 路径                                 | 说明                                 |
| ------ | ------------------------------------ | ------------------------------------ |
| `GET`  | `/plugin-platform/tasks/page`        | 插件定时任务分页，支持插件、状态过滤 |
| `GET`  | `/plugin-platform/tasks/:id`         | 任务详情                             |
| `POST` | `/plugin-platform/tasks/:id/enable`  | 启用任务并注册 BullMQ Job Scheduler  |
| `POST` | `/plugin-platform/tasks/:id/disable` | 停用任务并移除调度                   |
| `POST` | `/plugin-platform/tasks/:id/cron`    | 修改 5 段 cron，校验通过后重建调度   |
| `POST` | `/plugin-platform/tasks/:id/run`     | 手动提交一次任务                     |
| `GET`  | `/plugin-platform/tasks/:id/runs`    | 任务运行记录分页                     |

`src/modules/plugin-platform/infrastructure/integration/runtime` 提供 host-side driver、队列、超时和崩溃事件归档；插件侧只能通过受控 SDK 访问配置、存储、HTTP、资产、操作与事件上下文，回复以 intent 返回 adapter。

Admin 入口为 `/plugin-platform/plugins` 与 `/plugin-platform/tasks`。BangDream 内置任务 `bangdream.bestdori.sync-main-data` 会同步 Bestdori 主数据到 `BANGDREAM_TSUGU_CACHE_ROOT`；生产路径为 `/data/plugin-platform/plugins/bangdream/cache`，hostPath 为 `/var/lib/rancher/k3s/kt-template-online-api/plugin-platform/plugins`。

### OneBot Reverse WebSocket

`BOT_REVERSE_WS_PATH` 默认是 `/bot-adapter/napcat/onebot/reverse`。NapCat 通过反向 WS 连接 API，token 使用 `BOT_REVERSE_WS_TOKEN`。

## Bot 插件能力

### NATMap Port

插件 key：`natmap-port`，operation key：`natmap.port.current`，默认命令为 `/natmap [通道名称]`。真实命令必须同时通过账号命令能力和插件账号绑定；插件 worker 只拥有 `network.endpoint.read`，不能直接访问数据库目录或网络管理写能力。

Host 只接受已知安全通道名称，并精确匹配 `network_port_forward` 中 `protocol=tcp`、NATMap 已启用的通道。只有 `syncStatus=synced`、`natmapStatus=active`、当前端点存在、IPv4 合法、端口在 `1..65535` 且租约未过期时返回 `publicPort`；过期状态归零，多通道只返回数量并要求显式名称，地址、端口或路径形态选择器直接拒绝。输出不包含公网 IP、内部目标、记录 ID、数据库名称或原始异常。既有生产库使用 `sql/natmap-port-command-v1.sql` 与对应 verify 脚本补齐唯一命令身份；该入口只插入完全缺失的命令，身份冲突会失败关闭，重复发布不会覆盖管理员的启停或删除状态。

### Bilibili Card

插件 key：`bilibili-card`。这是事件型内置插件，不新增在线命令；启用后由对应 Bot Adapter 的事件绑定决定哪些连接接收 `bilibili-card.message`。

| event key               | 触发来源 | 说明                                                                  |
| ----------------------- | -------- | --------------------------------------------------------------------- |
| `bilibili-card.message` | message  | 从 QQ/NapCat `share/json/xml/lightapp` 卡片和文本中提取 Bilibili 链接 |

插件会解析 `www.bilibili.com`、`m.bilibili.com` 和 `b23.tv`。适配器核心先以 64 KiB、十层和 500 节点上限展开 JSON/lightapp 段的字符串化普通对象，再把其中 `qqdocurl` 等 HTTP(S) 叶子投影到通用 `links[]`；不把 OneBot 原始卡片结构重新暴露给插件。短链通过插件平台受控 `resolveRedirect` host 能力限制跳转次数和超时；视频信息来自 Bilibili `x/web-interface/view`，回复首行使用视频封面 CQ image，随后输出标题、UP 主、时长、播放/弹幕/点赞等文本摘要和标准视频链接。同一账号、同一会话、同一视频在 `PLUGIN_BILIBILI_CARD_DEDUPE_TTL_MS` 内去重。

可配置键：

| 配置键                                 | 默认值 | 说明                 |
| -------------------------------------- | ------ | -------------------- |
| `PLUGIN_BILIBILI_CARD_HTTP_TIMEOUT_MS` | 6000   | HTTP 请求超时毫秒    |
| `PLUGIN_BILIBILI_CARD_MAX_REDIRECTS`   | 5      | `b23.tv` 最大跳转数  |
| `PLUGIN_BILIBILI_CARD_DEDUPE_TTL_MS`   | 600000 | 同视频去重毫秒       |
| `PLUGIN_BILIBILI_CARD_DESC_MAX_LENGTH` | 80     | 回复中简介最大字符数 |

### BangDream

插件 key：`bangdream`。旧 `bangDream` 作为兼容别名仍可解析；当前源码根目录为 `src/modules/plugins/bangdream/src`，按第三期插件结构拆分为 `operations`、`domain/*`、`application`、`infrastructure/integration`、`infrastructure/storage`、`config`、`assets` 和 `theme`，不再使用旧 `tsugu` 子目录、宿主 builtins 包装层或纯转接目录。

| operation key                 | 命令          | 说明                     |
| ----------------------------- | ------------- | ------------------------ |
| `bangdream.song.search`       | `/查曲`       | 查歌曲信息图片           |
| `bangdream.song.chart`        | `/查谱面`     | 查谱面图片               |
| `bangdream.song.random`       | `/随机曲`     | 随机歌曲                 |
| `bangdream.song.meta`         | `/查询分数表` | 查歌曲分数榜             |
| `bangdream.card.search`       | `/查卡`       | 查卡牌信息图片           |
| `bangdream.card.illustration` | `/查卡面`     | 查卡面插画               |
| `bangdream.character.search`  | `/查角色`     | 查角色信息               |
| `bangdream.event.search`      | `/查活动`     | 查活动信息               |
| `bangdream.event.stage`       | `/查试炼`     | 查活动试炼，保持拆图输出 |
| `bangdream.player.search`     | `/查玩家`     | 查玩家信息               |
| `bangdream.gacha.search`      | `/查卡池`     | 查卡池                   |
| `bangdream.gacha.simulate`    | `/抽卡模拟`   | 模拟抽卡                 |
| `bangdream.cutoff.detail`     | `/ycx`        | 单档位预测线             |
| `bangdream.cutoff.all`        | `/ycxall`     | 全档位预测线             |
| `bangdream.cutoff.recent`     | `/lsycx`      | 历史/近期档线            |

`plugins/bangdream/plugin.json` 是 BangDream operation、handlerName、别名、权限、超时和说明的单一来源。新增或调整命令必须同步在线命令 SQL，并跑 manifest/command-SQL 测试。

### FF14 Market

插件 key：`ff14-market`。旧 `ff14Market` 作为兼容别名仍可解析；源码按第三期插件结构拆分为 `operations`、`application`、`domain`、`infrastructure/integration` 和 `config`。

| operation key       | 说明                                       |
| ------------------- | ------------------------------------------ |
| `ff14.item.resolve` | 按物品名称或 ID 解析 XIVAPI 物品           |
| `ff14.market.price` | 查询指定服务器/大区的 Universalis 市场价格 |

市场查价支持 `item`、`itemId`、`world`、`dataCenter`、`region`、`hq`、`language`。

### FFLogs

插件 key：`fflogs`。

源码按第三期插件结构拆分为 `operations`、`application`、`domain`、`infrastructure/integration`、`infrastructure/storage` 和 `config`。

| operation key              | 说明                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `fflogs.character.summary` | 查询 FFLogs 角色公开排名；传 `encounter` 时查询指定高难最近记录 |

常用输入：`characterName`、`serverSlug`、`serverRegion`、`encounter`、`limit`、`metric`、`timeframe`、`zoneId`。

## 初始化 SQL

| 文件                                           | 用途                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `sql/vben-admin-init.sql`                      | 创建 Admin 基础表、用户、角色、菜单、部门、字典和空组件表  |
| `sql/blog-init.sql`                            | 初始化本地 Blog 表                                         |
| `sql/blog-menu.sql`                            | 初始化 Blog 管理菜单                                       |
| `sql/bot-init.sql`                             | 初始化 Bot Adapter 表、插件命令和字典                      |
| `sql/bot-adapter-protocol-v1.sql`              | 幂等迁移旧表、绑定与订阅键                                 |
| `sql/bot-adapter-menu-v1.sql`                  | 迁移 Bot/Plugin Platform 菜单、权限与字典                  |
| `sql/bot-adapter-protocol-v1-verify.sql`       | 只读验证 33 张新表及旧契约清零                             |
| `sql/system-log-menu.sql`                      | 初始化系统日志菜单和权限                                   |
| `sql/system-notice-menu.sql`                   | 初始化系统站内信表与菜单权限                               |
| `sql/media-governance-intake-menu.sql`         | 增量注册仅 `super` 可见的媒体治理任务/Agent 菜单和九个权限 |
| `sql/migrate-dict-to-admin-dict.sql`           | 旧 `dict` 迁移到 `admin_dict`                              |
| `sql/migrate-component-to-admin-component.sql` | 旧 `component` 迁移到 `admin_component`                    |
| `sql/fix-admin-menu-meta.sql`                  | 修复菜单 meta 被覆盖为空                                   |
| `sql/fix-admin-user-zero-id.sql`               | 修复旧版本 `admin_user.id=0` 脏数据                        |

## 验证入口

常规文档/配置检查：

```bash
git diff --check
```

后端代码检查：

```bash
pnpm run typecheck
pnpm run lint
pnpm test
```

BangDream 图片 smoke：

```bash
bash scripts/bangdream-render-smoke.sh --operation-key bangdream.song.search --text "夏祭り" --out-file ".kt-workspace/bangdream-smoke/song.jpg"
bash scripts/bangdream-render-smoke.sh --operation-key bangdream.event.stage --text "310" --out-file ".kt-workspace/bangdream-smoke/stage.jpg" --expected-image-count 5
```

Jenkins/K8s 发布后还需要观察 rollout、新 Pod 日志，并跑真实运行态 smoke；推送成功不等于发布完成。
