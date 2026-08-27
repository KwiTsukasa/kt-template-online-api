# KT Template Online API

`kt-template-online-api` 是 KT 工作区的 NestJS 后端服务，承接 Admin 后台、博客内容、组件模板、MinIO 文件、系统日志、Bot 协议、Bot Adapter、Plugin Platform 和游戏查询插件能力。

## 技术栈

- Node.js 22 / TypeScript 5.9
- NestJS 11 / Express 5
- TypeORM 0.3 / MySQL
- Swagger / Knife4j
- nestjs-pino / pino-loki / Loki
- MinIO
- MQTT / OneBot v11 reverse WebSocket / NapCat / QQ 官方 WebSocket 与 Webhook
- skia-canvas / Chart.js
- pnpm 9

## 功能模块

| 模块                      | 说明                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `admin`                   | Vben Admin 认证、用户、菜单、角色、部门、时区、字典、组件模板、系统日志、环境总览、网络管理和媒体治理生产编排 |
| `blog`                    | 本地博客文章、分类、标签和 Argon 主题配置                                                                     |
| `modules/bot`             | 无状态 Bot 协议、标准入站/投递信封和 adapter registry；禁止账号、会话、连接与持久化依赖                       |
| `modules/bot-adapter`     | 有状态 Bot Core，以及 NapCat/OneBot、Tencent WebSocket/Webhook 和消息投递适配器                               |
| `modules/plugin-platform` | 无账号身份的插件 manifest、版本安装、运行事件、定时任务、受控 SDK 和 CLI                                      |
| `modules/plugins/*`       | BangDream、Bilibili Card、FF14 Market、FFLogs、Repeater、NATMap Port 等独立协议插件包                         |
| `minio`                   | Bucket 检查、上传、列表、临时 URL、代理下载、删除，以及 Blog Live2D 运行包受控读取入口                        |
| `common`                  | 响应封装、异常过滤、请求日志、日期格式化、字典解码、Snowflake、工具服务                                       |

## 目录结构

```text
src/
  apps/        独立进程入口（CodexAgent Gateway、NapCat WebUI Gateway）
  commands/    有界命令行入口
  common/      跨业务装饰器、过滤器、拦截器、日志、安全和基础服务
  modules/     admin、asset、blog、bot、bot-adapter、plugin-platform、plugins 等业务边界
    admin/identity/auth/                       application/contract/infrastructure/persistence/presentation 分层
    admin/media-governance/                    application/contract/domain/infrastructure/presentation 分层
    admin/platform-config/network-management/ application/contract/domain/infrastructure/presentation 分层
    bot/                                       仅含无状态 contract、registry、module 和公共导出
    bot-adapter/{core,napcat,tencent}/          账号、连接、传输与平台适配状态
    plugin-platform/                           平台无关插件协议与运行时
    plugins/                                   具体插件包
  runtime/     运行时客户端、配置、错误、证据和健康检查
  app.module.ts
  main.ts
test/          Jest 单元测试，统一放在 test 下
sql/           初始化、菜单、迁移和修复 SQL
scripts/       smoke、husky 快速检查等脚本
k8s/           K8s 生产部署清单
ci/            Jenkins Agent/Docker 辅助文件
```

## 环境变量

项目按 `NODE_ENV` 读取 `.env.${NODE_ENV}`，未指定时默认 `.env.development`。仓库只跟踪 `.env.example`；真实 `.env.development`、`.env.production`、数据库密码、Token、OAuth secret 和 SSH key 不提交。

主要配置分组：

| 分组                  | 变量                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL                 | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC`                                                                                                                                                                                                                                                                                                                                                                                    |
| MinIO                 | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET`、`MINIO_USE_SSL`、`BLOG_LIVE2D_BUCKET`、`BLOG_LIVE2D_ROOT_PREFIX`、`BLOG_LIVE2D_PREFIX`、`BLOG_ASSET_MIGRATION_*`                                                                                                                                                                                                                  |
| Admin                 | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`ADMIN_AUTH_ALLOW_INSECURE_LOCAL`、`ADMIN_NOTICE_SSE_REPLAY_LIMIT`、`ADMIN_NOTICE_SSE_HEARTBEAT_MS`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID`                                                                                                                                                                                                                                                              |
| Public Security       | `PUBLIC_SECURITY_*`、`PUBLIC_RATE_LIMIT_REDIS_*`、`PUBLIC_RATE_LIMIT_*`                                                                                                                                                                                                                                                                                                                                                                                         |
| Logging/Loki          | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_*`                                                                                                                                                                                                                                                                                                                                                                                            |
| Bot/Bot Adapter       | `BOT_ENABLED`、`BOT_ACCOUNT_SECRET_KEY`、`TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL`、`BOT_REVERSE_WS_*`、`BOT_SEND_*`、`BOT_COMMAND_MIN_COOLDOWN_MS`、`BOT_RULE_MIN_COOLDOWN_MS`、`NAPCAT_*`、`MQTT_*`                                                                                                                                                                                                                                                               |
| Plugin Platform       | `PLUGIN_QUEUE_REDIS_*`、`PLUGIN_TASK_QUEUE_REDIS_*`、`PLUGIN_QUEUE_WAIT_TIMEOUT_MS`、`PLUGIN_REPEATER_*`                                                                                                                                                                                                                                                                                                                                                        |
| Environment Dashboard | `ENV_DASHBOARD_CACHE_TTL_MS`、`ENV_DASHBOARD_SIGNAL_TIMEOUT_MS`、`ENV_DASHBOARD_EVENT_BUS`、`ENV_DASHBOARD_MQTT_*`、`ENV_DASHBOARD_SSE_*`、`ENV_DASHBOARD_JENKINS_*`、`ENV_DASHBOARD_K8S_*`、`ENV_DASHBOARD_TENCENT_*`、`ENV_DASHBOARD_CADDY_*`、`ENV_DASHBOARD_R4SE_*`                                                                                                                                                                                         |
| Network Management    | `NETWORK_AGENT_ID`、`NETWORK_AGENT_TARGET_IPV4`、`NETWORK_AGENT_MQTT_URL`、`NETWORK_AGENT_MQTT_CLIENT_ID`、`NETWORK_AGENT_MQTT_USERNAME`、`NETWORK_AGENT_MQTT_PASSWORD`、`NETWORK_AGENT_MQTT_RETRY_MS`、`NETWORK_TCP_NATMAP_RELEASE_MODE`、`NETWORK_TCP_NATMAP_CANARY_PORTS`、`NETWORK_MANAGEMENT_SSE_HEARTBEAT_MS`、`NETWORK_MANAGEMENT_SSE_REPLAY_LIMIT`、`NETWORK_DDNS_DNSPOD_*`、`NETWORK_DDNS_RECONCILE_INTERVAL_MS`、`NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS` |
| Media Governance      | `MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET`、`MEDIA_GOVERNANCE_EXECUTOR_BASE_URL`、`MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET`、`MEDIA_GOVERNANCE_EXECUTOR_TIMEOUT_MS`；Codex 端点、模型与内部认证统一复用下方 LLM 配置                                                                                                                                                                                                                                                |
| LLM                   | `LLM_CONFIG_SECRET_KEY`、`LLM_CODEX_GATEWAY_BASE_URL`、`LLM_CODEX_GATEWAY_INTERNAL_SECRET`、`LLM_CODEX_GATEWAY_TIMEOUT_MS`、`LLM_CODEX_CHAT_CWD`                                                                                                                                                                                                                                                                                                                |
| Codex Remote          | `CODEX_REMOTE_NAS_WS_URL`、`CODEX_REMOTE_NAS_WS_SHARED_SECRET`、`CODEX_REMOTE_NAS_PROJECTS_JSON`、`CODEX_REMOTE_PC_WS_URL`、`CODEX_REMOTE_PC_WS_SHARED_SECRET`、`CODEX_REMOTE_PC_PROJECTS_JSON`                                                                                                                                                                                                                                                               |
| BangDream             | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT`                                                                                                                                                                                                                                                                                                                                                                |
| FF14 Market           | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_MARKET_CACHE_TTL_MS`                                                                                                                                                                                                                                                                                                                                                                                 |
| FFLogs                | `FFLOGS_BASE_URL`、`FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET`                                                                                                                                                                                                                                                                                                                                                         |

`DB_SYNC=true` 只适合本地开发或明确允许自动同步表结构的环境；生产应关闭并使用 SQL/迁移脚本。

Codex Remote 节点目录只接受固定 WireGuard 地址 `10.66.66.2`（NAS）和
`10.66.66.4`（PC）。`GET /api/codex-remote/nodes` 返回已完整配置的节点与项目，
`POST /api/codex-remote/nodes/:nodeId/session` 使用当前 Admin SSO 身份签发两分钟
HS256 WebSocket token；节点共享密钥永不返回客户端。

公网安全边界只信任 `PUBLIC_SECURITY_TRUSTED_PROXY_IPS` 中的精确代理地址，并只允许 `PUBLIC_SECURITY_SWAGGER_ALLOWLIST` 中的生产管理来源访问 Swagger。Admin 登录、刷新和退出在任何 token 或 Cookie 副作用前校验可信代理归一化后的公开 Origin；Admin 用户新增、编辑和密码重置也在哈希或持久化前经过同一门禁。生产只接受 HTTPS，`ADMIN_AUTH_ALLOW_INSECURE_LOCAL=true` 仅允许非生产 loopback 本地开发且默认关闭。认证 Cookie 固定 `HttpOnly`、`SameSite=Lax`、`Path=/`、无 `Domain`，生产始终 `Secure`，退出同时清理 `/`、`/api/auth`、`/auth` 三种 Path。每次登录建立独立的 Redis refresh-token family；刷新原子消费当前 `jti` 并在同一 `sid` 下轮换，旧 refresh token 不能重放，退出会吊销当前 family。Redis 限流键只保存客户端 IP、规范化用户名或已验证 token subject 的 SHA-256。登录按 IP（5 次/分钟）、用户名（10 次/15 分钟）和全局（100 次/分钟）原子计数；成功认证会在签发 token 前清理该用户名退避，清理失败按 503 fail closed。刷新与退出继续使用 IP/全局额度，并仅对签名校验成功的 refresh token 增加 subject 额度：刷新 30 次/分钟，退出 10 次/分钟。Blog 公开列表的 `pageSize` 最大 100。登录、refresh-token family 和已验证 token 的 Redis 故障 fail closed；普通公开读取与 Live2D 并发租约故障 fail open，并使用限频告警。

Admin 密码使用
`$pbkdf2-sha256$v=1$i=600000$<salt-base64url>$<digest-base64url>`，旧明文只
允许在维护窗口由编译后的 `pnpm admin-passwords:migrate -- <参数>` 一次性
迁移。必须先 `--dry-run`，再带数据库身份、维护确认、已存在备份和
`.kt-workspace` manifest 执行 `--execute`，最后 `--verify` 并运行
`sql/admin-password-hash-verify.sql`。所有模式都必须显式指定 manifest；
manifest 必须是规范化后仍位于 `.kt-workspace` 路径组件下的 `.json`
新文件，首次发布使用排他创建且不会覆盖既有 evidence；`--execute` 的备份
必须是可读、非空普通文件，且规范化后不能与
manifest 指向同一路径。备份和 manifest 的现存父路径、目标均拒绝符号链接，
现存文件还会按设备号/inode 拒绝硬链接别名；备份通过 `O_NOFOLLOW` 打开并在
迁移结束前保持只读描述符，manifest 每次原子替换前都会重新检查目标。哈希落库
后禁止回滚到明文比较版本。

Blog Live2D 运行包存放在 MinIO，公开读取入口为 `/blog/live2d/:character/catalog.json` 和 `/blog/live2d/:character/:family/*assetPath`。`character` 只允许 `pio`、`tia`，family 只允许 `moc` 和 `moc3`：`moc/` 提供旧 WordPress 同款 Cubism2 `index.json`、`model.moc`、`.mtn` 动作和贴图，`moc3/` 保留当前重建 Cubism3 包（Tia 当前只发布 `moc/`，不会在 catalog 声明不存在的 MOC3）。防盗链只接受旧 Blog Origin `https://blog.kwitsukasa.top`，或由可信代理链和原始 Host 推导出的当前 `https://nas4.kwitsukasa.top:{动态端口}` Origin；动态端口必须显式存在，省略端口或显式默认 `443` 均不作为 NATMap Origin。客户端提供的 forwarded Host 不能扩展允许范围。Live2D 每个客户端 IP 默认最多 8 条跨副本 Redis 并发租约；每条流使用唯一 token 的 ZSET 成员，定期续租，HTTP `finish`、`close` 或 `error` 时只精确释放自身 token，旧流不会递减后续代际的计数，120 秒 TTL 兜底断连和异常。`BLOG_LIVE2D_ROOT_PREFIX` 指向角色根目录（默认 `blog/live2d`），旧 `BLOG_LIVE2D_PREFIX=blog/live2d/pio` 会自动派生到同一根前缀以兼容现有环境；缺失或不匹配的 Referer/Origin 会在读取 MinIO 前被拒绝。MinIO 上传结果和 `/minio/url` 只返回根相对 `/api/minio/download?...`，不向浏览器公开内部 MinIO endpoint。

旧 Blog 资源迁移使用编译后的 `pnpm blog-assets:migrate -- <参数>`。命令严格区分 `--dry-run`、`--execute`、`--resume`、`--verify` 和 `--rollback-manifest <path>`；所有模式都要求调用方提供 `.kt-workspace` 下的 manifest。`execute`、`resume` 与 rollback 还必须提供匹配当前连接的 `--database-identity`、`--maintenance-confirmed` 和已存在的 `--backup-path`。下载只接受 `BLOG_ASSET_MIGRATION_ALLOWED_HOSTS` 中的精确 HTTP(S) Host，每次重定向都会重新解析并绑定已校验公网地址；私网、环回、CGNAT、链路本地、未指定、组播和 IPv6 ULA 均拒绝。迁移对象固定写入 `blog/migrated/{sha256}/{basename}`，数据库只保存根相对 `/api/blog/asset/{sha256}/{basename}`；rollback 默认不删除可共享的内容寻址对象。

上述资源迁移已在固定镜像摘要的一次性本地 MySQL+MinIO 环境完成
`dry-run -> execute -> verify -> rollback`：五个锁定字段全部恢复，
迁移 URL 遗留数为 0，且只生成一个内容寻址对象。该本地证据不代替生产
备份、维护授权、生产 dry-run 审查和迁移后 verify。

Plugin Platform worker 使用 BullMQ 串行执行同一插件安装实例的请求；定时任务由 manifest `tasks` 声明并持久化到 `plugin_task` / `plugin_task_run`。平台不保存 `selfId`、AppID、OpenID 或账号绑定，插件回调只接收标准会话键、发送者键、消息和 reply intent。K8s 使用独立 `kt-plugin-redis`，插件数据挂载到 `/data/plugin-platform/plugins`，Admin 页面为独立顶级 `/plugin-platform/{plugins,tasks}`。

`src/modules/bot` 只定义无状态 `BotAdapterProtocol` 和 adapter registry。账号、命令、规则、会话、发送日志与持久化位于 `bot-adapter/core`；NapCat 连接位于 `bot-adapter/napcat`；Tencent WebSocket/Webhook 位于 `bot-adapter/tencent`。NapCat 事件插件绑定保存在 `bot_account_ability(event_plugin)`，Tencent 插件绑定保存在 `tencent_bot_plugin_binding`；两种 adapter 都从 Plugin Platform 读取同一插件协议，但平台本身不感知任何 Bot 身份。

Tencent 连接支持官方 WebSocket 与 Webhook。官方 WebSocket 继续使用腾讯 SDK 的 `QQBot.on('message')` / `QQBot.start()`，被动回复保留同一 `replyTarget/msgId`；Webhook 公开入口为 `/bot-adapter/tencent/webhook/:appId/:webhookToken`，使用账号 URL capability token、原始请求字节与官方 Ed25519 签名。`TENCENT_BOT_WEBHOOK_PUBLIC_BASE_URL` 只允许不经腾讯云中转的 NAS 直连 HTTPS，端口必须是 `80/443/8080/8443`。

绑定或解绑 Tencent 插件后，adapter 按官方协议先读取 `GET /v2/menu`，保留非 `KT·` 项后以 `PUT /v2/menu` 全量覆盖；再分别读取 `c2c/group/channel/dm` 的 `GET /v2/panels`，只更新、创建或删除 remark 为 `kt-plugin-menu:v1:<scope>` 的面板。菜单顶层最多 10 项、子菜单最多 5 项、单面板最多 20 项，字符权重在任何写入前验证；幂等比较忽略 GET 自动补入的菜单图标、把省略的 `only_admin` 视为 `false`，面板指令使用官方不带 `/` 的名称，因此重复同步无差异时不调用写接口。

三种 transport 共用发送排队和发送日志。NapCat adapter 复用核心已构造的受控 OneBot 字符串或消息段，使 CQ 图片和 @ 提及不会降级为普通文本，严格纯文本投递仍保持文本段；官方 C2C/群消息使用 OpenID，频道回复保留 `channelId/guildId/replyMessageId`，现有插件产生的 HTTPS 或 `base64://` CQ 图片会转换为官方媒体上传。`bot_conversation.last_message_id`、`bot_message.message_id` 和 `bot_send_log.message_id` 统一为 `varchar(255)`，避免 QQ 官方长 `msg_id` 在入站会话或被动回复日志落库前被截断。消息推送目标在 NapCat 模式继续校验数字 QQ/群号，官方模式改为手工填写事件中获得的用户 OpenID/群 OpenID，不调用 OneBot 好友或群列表。NapCat 更新登录、运行态和 WebUI 接口对官方账号失败关闭，Admin 同样只展示当前 provider 适用的动作。

既有数据库由 K8s `bot-adapter-migration` initContainer 执行 `sql/bot-adapter-protocol-v1.sql` 与 `sql/bot-adapter-menu-v1.sql`，随后强校验 `bot-adapter-protocol-v1-verify.sql`。迁移通过数据库 advisory lock 运行：新旧表并存时逐字段对账，NapCat/Tencent 插件绑定分别归入 adapter，Message Management 私有旧表只在等价关系核验后删除，旧 `/qqbot` 菜单、权限和字典物理清理。验证要求新表 33/33，旧表、旧索引、旧菜单、旧字典和 `qqbot:` 订阅键全部为 0；任一冲突以 `SQLSTATE 45000` 失败关闭并阻止 API 容器启动。

Admin 环境总览面板使用 `ENV_DASHBOARD_*` 只读配置聚合 local-dev、NAS 线上、腾讯云和 r4se 状态。`ENV_DASHBOARD_ADMIN_LOCAL_URL` / `ENV_DASHBOARD_ADMIN_PUBLIC_URL` 只用于展示 Admin 本机与线上入口证据。HTTP 快照提供当前拓扑，后端 local/MQTT 事件总线通过 SSE 推送增量事件给 Admin；前端不直连 MQTT，也不轮询刷新。Jenkins、K8s、Tencent Cloud、Caddy、WireGuard、Mihomo/OpenClash 未配置时会显示 `unwired` 证据，不能渲染成健康假象；第一版不暴露重启、部署、迁移、容器重建、插件启停或代理切换等写操作。

KwiCore 主页面通过 `GET /system/mobile-home/bootstrap` 一次读取环境快照、最近 40 条站内信、站内信总数和权威未读数。该接口要求 Admin JWT 与 `super` 权限，响应禁止缓存，并行复用 `EnvironmentDashboardService` 和 `AdminNoticeService`；任一来源失败时整体失败，不返回部分成功或伪造健康状态。Remote 仍由 `/codex-remote/nodes`、短期 session 与 relay 负责，设置仍使用 Admin SSO 和 Android 本机状态；Mobile Home 不复制这些状态，也不增加环境变量、数据库表或基础设施。

Environment Dashboard 的 Home Assistant 与 Sunshine 基础连接只使用固定只读 API：Home Assistant 以 `ENV_DASHBOARD_HOME_ASSISTANT_URL/TOKEN` 对官方 `GET /api/` 发送 Bearer Header，并要求精确健康消息；Sunshine 以 `ENV_DASHBOARD_SUNSHINE_URL/USERNAME/PASSWORD` 对官方 `GET /api/apps` 发送 Basic Header，但不保存或投影应用清单正文。缺少任一配置时分别返回稳定 `home-assistant` / `sunshine` 服务的 `unwired` 证据，认证失败与超时只返回脱敏 `degraded` 摘要。URL、token、用户名和密码只存在于私有运行环境；仓库不提供 WOL、启动/停止串流、改配置等写入口，Sunshine HTTPS URL 必须使用 API 运行时信任的证书。

System 网络管理以 MySQL 中的逻辑端口转发组和 TCP/UDP 协议通道为唯一事实源。`super` 可在同一外部端口配置 `TCP`、`UDP` 或 `TCP+UDP`，并分别启停 TCP NATMap 与 UDP Keeper；TCP 发布范围由 `NETWORK_TCP_NATMAP_RELEASE_MODE` 和 canary 端口控制。Agent 状态接口返回当前生效的 `tcpReleaseMode`；TCP NATMap 启停接口可选携带 `expectedDesiredRevision`，并在事务锁内、no-op 判断前执行 CAS，供受控退役流程绑定已审查状态，普通 Admin 请求保持兼容。API 在事务内单调提升 revision，提交后按当前 schema owner 使用 `kt/network/v1|v2/agents/{agentId}`、QoS 1 retained 完整快照通知 NAS `kt-network-agent`，自身不登录路由器、不接收路由器密码，也不执行 raw socket。Agent 声明 v2 capability 且发布门禁允许后，v2 成为唯一 desired/reported/events 写入者，迟到的 v1 reported/events 不再覆盖状态。

MQTT v2 分别保存 candidate、current、last-observed、last-published、通道 report 原始 RFC3339Nano 水位，以及静态路径、Keeper 和 NATMap 错误。TCP current 只有在 desired present、NATMap intent、sync、Router、互斥数据面证据、NATMap 进程、generation、同 tuple 证据和新鲜 lease 全部通过时才发布：旧版接受 `dnatPresent=true` 且 `routePresent` 缺失或 false；小米直达接受 `dnatPresent=false` 且 `routePresent=true`。两项同时 true 或同时未就绪均撤回 current；TCP tombstone 也必须确认可选 route 已不为 true 才能删除。相同 tuple 续租只推进 validation/lease，不新增历史、不触发 DDNS、Outbox 或 Admin 刷新。同 revision 的旧 report 不得覆盖较新的通道状态；合法外层 snapshot 完成协调尝试后推进 applied revision 与独立 applied schema 水位，单通道 conflict 只隔离该通道。Agent 接受 v2 后会耐久锁存唯一 owner，在未来实现 Agent 可确认的降级握手前，API 单边降级固定拒绝。

v2 endpoint event 通常先于 matching reported 到达，因此 event-first 先提交 history；UDP 有效端口变化写入既有 STUN Outbox，TCP 公网 IPv4 或端口任一变化写入独立的 `network.tcp.natmap-endpoint-changed` Outbox，二者都必须等 matching current 通过后才能 stage。UDP 端口变化若表现为 `withdrawn -> restored`，恢复事件会与最近一条非 `withdrawn` 的有效端点比较；只有端口确实变化才 stage，同端口恢复仍保持静默。TCP `restored` 同样只在紧邻 `withdrawn` 时跨过撤回历史取最近一条非 `withdrawn` 的有效 TCP 端点；公网 IPv4 或端口任一变化才 stage，同 tuple 恢复静默。event、report 与 ownership 切换统一按 Agent state、channel、history 顺序加锁；history 耐久保存来源 revision 和完整 lease identity，只有 revision、tuple 与未被时间精度截断的 lease 身份全部匹配才允许 stage，避免迟到事件误投递。首次发布、同 tuple 续租、撤下和同 tuple 恢复不会产生 TCP 消息事件。所有 SSE、DDNS reconcile、投递 wake 和 desired republish 都在数据库事务成功后最多触发一次；组只有所有协议通道都确认 exact absent 后才软删除。结构修复通常仍要求全部通道 `synced + disabled`；唯一恢复例外是机制期望已停用、revision 已回报、没有 current lease 且机制状态为 `disabled/failed` 的静止失败通道，可直接把非法端口修回受管范围，不能借此修改活动或端点尚存的通道。Agent 失联或 MQTT 暂不可用时合法请求仍保存为 pending，恢复后按 revision 自动收敛；瞬时数据库错误或 SUBACK 失败依赖持久会话重投，非法负载确认后丢弃。当前公网端点受 `currentValidUntil` 约束，过期后列表隐藏 current，但保留候选、最近观测、发布基线与历史。

同一模块提供腾讯云云解析 DNS 的双栈自动 DDNS。A 记录可从合格 UDP Keeper 或 TCP NATMap 通道的有效公网 IPv4 取值；AAAA 既可使用在线 Agent 最近上报的全局 IPv6，也可将合格 TCP NATMap 的公网 IPv4 与动态端口编码为 NATMap 官方 IP4P 地址，供 SSH `ProxyCommand` 解析。A 来源以 `组名 / UDP Keeper` 或 `组名 / TCP NATMap` 展示，IP4P 来源以 `组名 / TCP NATMap IP4P` 展示。A 来源仅端口变化只更新派生的 `accessEndpoint=FQDN:port`，不调用腾讯云；IP4P 端口变化会改变 AAAA 并触发同步。协调器只修改已存在、已启用、默认线路且唯一的 A/AAAA 记录，保留 RecordId、线路和 TTL，并在写入后回读确认。删除 Admin 绑定只停止本地自动更新，不删除云端 DNS 记录。凭据只从 API 私有运行环境的 `NETWORK_DDNS_DNSPOD_SECRET_ID/SECRET_KEY` 读取，不进入 Admin、数据库、MQTT、Agent、日志或 Git；`DNSPOD` 是腾讯云官方 SDK 的技术服务名。

公开 `open.kwitsukasa.top/<service>/` 仅通过腾讯云 Caddy 与 WireGuard 调用 Host 限定的 `/network/open-redirect/:serviceKey`。API 不接收任意重定向目标，而是从固定服务白名单选取 Host/路径，并在同一个 `REPEATABLE READ` 事务中确认 `10443/TCP` NATMap 通道、逻辑组、`nas4` A 记录和 Agent 都处于当前且已同步状态后返回临时 `302`。成功响应同时发布单值 `X-KT-Endpoint-IPv4`、`X-KT-Endpoint-Generation`、`X-KT-Endpoint-Valid-Until`，分别绑定规范公网 IPv4、64 位小写十六进制端点身份和当前 UTC 租约；私网/CGNAT/保留 IPv4 或非法身份不会发布。未知服务为 `404`，离线、lease 过期、revision 落后、DDNS 不一致或数据库异常为无 `Location` 和端点头的 `503`。首跳后浏览器直接访问 `https://*.nas4.kwitsukasa.top:{动态端口}/...`，业务数据不经过腾讯云；Android KernelSU 客户端用同一权威 IPv4 建立精确 `/32` hook。Voice Archive 只新增 `voice` 与 `voiceios` 两个固定服务键，分别跳到 `voice.nas4.kwitsukasa.top:{动态端口}/` 与同 Host 的 `/auth/ios-login`；不新建独立腾讯云 Caddy Host。

系统消息现由独立 Message Management 管理，链路固定为“消息源 → 来源适配器 → 绑定来源的模板 → 绑定多个同来源模板及一个订阅者的订阅 → 统一消息协议 → 订阅者私有投递”。来源 adapter 只注册在 Message Management；QQBot 和站内信只作为统一协议订阅者，不直接依赖 STUN、TCP NATMap 等消息源。每个匹配订阅会把全部模板按绑定顺序渲染为一个 `templates[]`，只调用所选订阅者一次，由订阅者决定一条、多条、聚合或跳过投递。系统事件只通过内部 Outbox stager 暂存，不提供 publish/event/worker HTTP 路由；管理响应仅返回字段白名单，不暴露凭据、Provider/OneBot/MQTT 运行对象、原始事件载荷或内部持久化键。

通用协议数据位于 `message_template`、`message_subscription`、`message_subscription_template` 和 `message_event`。Bot 适配器只拥有账号订阅绑定、目标和耐久投递，当前策略是对每个模板 × 每个启用目标各创建一条投递；站内信适配器只拥有订阅、标题与接收角色绑定。

`message_event` 扇出状态为 `accepted`、`processing`、`deferred`、`retry`、`completed`、`failed`。Bot 投递状态为 `pending`、`processing`、`retry`、`success`、`failed`、`superseded`、`cancelled`，唯一键为事件、目标和模板三元组。

NapCat Runtime/Protocol Profile 已完成本地 API/Admin 实施，线上发布和账号闭环按 `docs/plans/2026-06-18-qqbot-napcat-runtime-protocol-profile-implementation-plan.md` 的 Task 10 执行。当前实现覆盖运行态/协议/会话行为/历史登录事件兼容表/风险模式表，真实物理设备风格 hostname/MAC，NapCat/OneBot 配置 hash，KT `zh_CN.UTF-8` 中国桌面派生镜像资产，只读 `/bot-adapter/napcat/runtime/detail` 证据接口，watchdog 离线巡检告警，以及 Admin 账号页“运行态”抽屉；不绕过 QQ/Tencent 验证码、不修改 QQ/NTQQ 签名协议、不启用 privileged/host network，也不做账号级每小时/每日累计发送预算。NapCat Chinese Desktop Runtime v20 使用 KT `NapCatQQ` fork 源码构建出的 `NapCat.Shell` artifact，并在 QQ `KickedOffLine` 后标记 native login service stale；API 在源 Docker 容器在线但 WebUI 明确 QQ 离线时会同容器调用 `RestartNapCat` 重启 NapCat worker，重建 QQCore login service 后再推进 quick/password/qrcode，不做 Docker 重建、补 env 或设备身份迁移，且同一个更新登录 session 只消费一次 worker restart 预算；v14 起还会对 QQ/NapCat/Xvfb 长期进程的 `/proc/<pid>/mountinfo` 做 PID 级遮蔽，防止 `overlay`、`/vol1/docker`、`docker-init`、`/docker/containers`、`napcat-instances` 等宿主路径泄露；v15 修复扫码成功时 `QQLoginInfo` 晚于登录态写入造成的 QQ 号回读空窗；v16 在 native reset 缺少 `offline()` 时改用 `destroy()` 硬重置半登录服务，并让镜像 verify 等待 mountinfo guard 收敛；v17/v18 增加 WebUI 鉴权的 `/api/Debug/RuntimeViewProbe` 同进程诊断并修正 native maps 截断导致的 hook 证据假阴性；v19 保留 WebUI `RestartNapCat` 重启 worker 时的 `-q <uin>` 快速登录参数，避免重启后退回无账号扫码；v20 保护 API 预写的 `/app/napcat/config`，避免上游首次解包 `NapCat.Shell/*` 覆盖 `bypass.*=true` 与 `o3HookMode=0`。镜像必须先用 `scripts/napcat-desktop-cn-stage-build.mjs` staged build context，生产 `NAPCAT_IMAGE` 应指向验证过的 `kt-napcat-desktop-cn:desktop-cn-v20` digest。`k8s/prod/api.yaml` 保留 `desktop-cn-v20` 稳定默认值；Jenkins `NAPCAT_IMAGE_OVERRIDE` 和 `NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE` 仅在填写时通过 `kubectl set env` 推广已验证运行时镜像/profile，空值会继续使用 manifest/default env。回滚时重新运行 Jenkins 并填入上一版 digest/profile，或清空两个 override 后重新部署 manifest 默认值。

上段 v20 为历史演进说明；当前仓库发布基线已经升级到 `desktop-cn-v21`，新增插件框架级页面基址契约，并由 `k8s/prod/api.yaml` 显式声明 `NAPCAT_MUTATION_PROTOCOL=journal-flock-v1`。既有数据库在部署含 profile upsert 的 API 前必须先执行幂等入口 `sql/napcat-profile-container-unique.sql`；它拒绝非空 `container_id` 重复，只把 runtime/protocol profile 的旧普通索引替换为唯一索引，执行后不得留下临时 procedure。

运行时发布时，API 仓库不提交 `NapCat.Shell.zip`；生产镜像必须从 staged context 构建，`fork-artifact.json` 必须带完整 marker metadata，包括 upstream release tag/commit、fork commit、base image digest、Jenkins URL 和 artifact hashes。release evidence 里的 NapCat base image 必须用 digest pin。API Jenkins 只消费人工确认后的运行时推广参数，不自动合并上游、不自动构建隐藏镜像，也不在 override 为空时覆盖 K8s manifest 中的默认 env。

```bash
node scripts/napcat-desktop-cn-stage-build.mjs \
  --napcat-root /home/yemu2/KT/GitHub/NapCatQQ \
  --upstream-release-tag v4.8.0 \
  --upstream-release-commit 0000000000000000000000000000000000000000 \
  --napcat-base-image-digest mlikiowa/napcat-docker@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  --jenkins-build-url https://jenkins.kwitsukasa.top/job/KT-NapCatQQ-Runtime-Release/1/
```

NapCat WebUI Gateway 是独立运行的 NestJS 入口，生产镜像使用 `dockerfile.gateway` 打包 `dist/apps/napcat-webui-gateway/main.js` 并监听 `48086`。API 通过内部地址创建/续期/撤销 WebUI 会话，Admin 浏览器只访问 `/admin/napcat-webui`。验收入口为 `test/modules/bot-adapter/napcat-webui-gateway/*`、API `typecheck/build` 和 Gateway 构建产物；浏览器不得收到 WebUI token、Credential、上游 URL/端口、Docker 拓扑、Redis 地址或内部 secret。

统一网关的部署布局、Canary、DNS/Caddy、密码迁移和 WordPress 两阶段回滚
见 KT 工作区根文档 `docs/unified-natmap-tls-gateway-operations.md`。统一网关、
WordPress Phase 1 与公网 NATMap/DDNS 已发布；Phase 2 直接退役已于
`2026-07-31` 获得用户明确授权。本版本从正常 API 进程移除离线资源迁移器及其
HTTP/DNS provider，并从 domain contract 和新建库 SQL 移除
`blog_import_job`。生产退役必须先完成专用密文备份和无网络恢复验证，只精确
移除五个 `WORDPRESS_*` key 并停止原容器；原容器对象和 bind 数据继续作为
回滚资产保留。

## 启动

```bash
pnpm install
pnpm start:dev
```

服务固定监听 `48085`。

### 本地直接启动与真实验证

WSL 本地开发不再要求反复修改 `.env.development` 的端口或补 Redis 变量。保留该私有文件中的 MySQL 用户、密码和应用 Secret，随后直接运行：

```bash
# 自动复用 Windows MySQL:3306、按需启动 Windows Redis，并前台启动 API
pnpm start:local

# 同一依赖准备流程，使用 Nest watch 模式
pnpm start:local:dev

# 自动启动 API，执行真实登录、未读数、批量已读与 SSE 烟测，然后清理本轮进程
pnpm verify:local
```

三个入口都只会重建名称匹配 `kt_template_local` 或 `kt_template_local_*` 的专用可丢弃数据库，依次加载 `sql/refactor-v3/00-full-schema.sql`、`sql/media-governance-init.sql`、`sql/refactor-v3/01-seed-core.sql` 和 `sql/system-notice-menu.sql`；不会读写现有 `kt_template` 业务库。WSL 会先探测 `127.0.0.1:3306`，必要时尝试启动已安装的 Windows MySQL 服务；Redis 未监听时通过 Windows PATH 定位 `redis-server.exe` 及同目录 `redis.conf`，只在本轮启动了 Redis 时才在退出阶段结束对应 PID。所有非 Secret 的本地安全默认值由脚本以进程环境覆盖，既不改私有 env，也不连接 MQTT、NapCat 或 DDNS。

`pnpm verify:local` 会加载 refactor-v3、媒体治理、消息中心增量菜单与权限 SQL，并在专用库写入后清理一条固定 fixture；真实烟测覆盖 `/health/runtime`、Admin 登录、两条站内信路由的未读数一致性、批量已读更新数量，以及 SSE 的首次快照和 `notice-changed/read` 实时事件。日志只写入忽略目录 `.kt-workspace/test-artifacts/local-runtime/`。Admin 侧继续直接运行 `pnpm dev`，其 `/api` 代理固定指向本入口的 `48085`。

常用命令：

```bash
pnpm start
pnpm start:prod
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm plugin create <pluginKey>
pnpm plugin validate <pluginDir>
pnpm plugin pack <pluginDir>
pnpm plugin install-local <packageFile>
```

Jest 只扫描 `test/**/*.spec.ts`。如果在 Windows 下指定测试文件，使用：

```bash
pnpm exec jest --runInBand --runTestsByPath test/path/to/file.spec.ts
```

## 接口文档

- Swagger 全量：`http://localhost:48085/api`
- OpenAPI JSON：`http://localhost:48085/api-json`
- 分组文档：`/api/admin`、`/api/bot`、`/api/plugin-platform`、`/api/basic`
- Knife4j：服务启动后同样使用上述 OpenAPI 服务列表
- 手工接口索引：[API.md](./API.md)

业务接口统一返回 Vben 结构，文件下载/流式接口除外：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {}
}
```

错误响应里的 `err` 必须是字符串，避免前端解析 JSON 对象时报错：

```json
{
  "code": 400,
  "msg": "操作失败",
  "err": "错误原因"
}
```

## 运行时健康检查

API 暴露 `GET /health/runtime` 作为本地 smoke、Jenkins/K8s 和 ktWorkflow 观测入口。该接口返回 plain JSON，不使用 Vben 响应包装，便于脚本直接读取。

返回内容包括：

- `status`：`live`、`ready`、`degraded` 或 `blocked`。
- `checks`：进程存活和运行时配置检查状态。

该公开入口不返回数据库、Loki、NapCat SSH 等运行拓扑配置快照；配置检查只暴露 key 级别、是否存在和缺失说明。`blocked` 表示关键配置缺失；`degraded` 表示可选运行时配置缺失，核心 API 仍可继续工作。本地未配置 Loki、NapCat 等可选依赖时，健康状态可能保持 `degraded`。

Admin 媒体治理生产链路使用 `JwtAuthGuard` 与媒体专用权限门，提供作品身份、来源、
逐季字幕合同、运行时探针、下载/治理进度、低效下载取消与精确换源、CodexAgent
人工放行、聚合和可续接 SSE。
作品目录与执行任务采用 Series-first 层级：`Series → Work → Season/Episode → Task`。
Series 必须先从 Bangumi/TMDB 官方候选中确认主身份，创建事务会同时建立唯一主 Work。身份搜索与创建前核验使用同一作品类型合同：TV 对应 Bangumi `type=2/platform=TV` 与 TMDB TV，电影对应 Bangumi `type=6/platform=电影` 与 TMDB Movie，剧场版对应 Bangumi `type=2/platform=剧场版` 与 TMDB Movie；Bangumi 请求同时使用正向 `meta_tags`，响应仍按官方 `platform` 本地复核，不能让动画 TV、动画剧场版和三次元电影互相混入候选。
后续 TV、电影和剧场版都作为同一 Series 下的独立 Work 管理。Work 身份使用
`provider + namespace + providerId` 唯一键区分 TMDB TV/Movie；只有 TV Work 可以创建
Season/Episode，电影与剧场版禁止伪造 S00。Season 通过 `episodeStart + episodeCount`
保留非 1 起始的连续集号。
Task 只表达一次执行，不能从根任务接口单独创建或修改作品身份；新 Task 只能从既有 Work、
逐集磁链或 RSS 入队创建，`seriesId/workId/operationKind` 从 Work/Season 派生；RSS Task 的
标题、资料编号和年份固定使用订阅时再次核验并持久化的所选身份，不回退成 Work 主身份。
误建目录只能通过 revision-bound Series 删除入口清理：独立 `Media:Governance:Delete` 权限只对空壳卡片可见，API 在事务锁内确认 Season、Episode、Task、绑定和 RSS 全部为零后，才级联删除 Work/Series 资料引用及空 Work；任一事实存在时返回 `409`，不提供绕过保护的强制删除。
Work 为 TMDB 时同时把其已核验 canonical 身份密封为 Task 的二级 `metadataIdentity`；其他
Work 保持空二级身份，后续只允许从飞牛对规范路径唯一映射出的官方身份自动发现，不能拿
RSS/Bangumi catalog 身份冒充二级元数据身份。
TV Task 在 `metadataStatus=verified`、主媒体清单已检查且 Unit/视频映射完全一致后，
只会绑定目标 Work 已存在的 Season/Episode；缺季、缺集、跨 Work 或 Episode 已被其他 Task
占用时保持零目录写入。该同步不修改 Task revision、Run、来源或密封状态。每个 Task 最多密封 16 个同治理类型的主媒体来源，
因此逐集磁链可在一个 Task 内批量接入；同包外挂字幕会跨这些来源合并为同一发布组合同。
RSS 订阅按 Series/Work/Season 持久化所选资料身份、地址、过滤和集号解析规则，每分钟扫描到期订阅，条目按
GUID/BTIH 去重后按最多 16 集一组创建 Task；原始磁链或 torrent 字节只进入私有描述符存储，不写入 RSS 表。
内置集号解析同时接受 ` - 41`、`E41` 与 `S01E41`，其中紧凑季集格式仍取绝对 Episode `41`，
不会把年份、分辨率或前缀季号误当成目标集号。
RSS 自动接收会先完成同批全部来源清单检查；只有每个主来源都含视频、没有 sidecar 字幕，且
视频文件名都明确带 `SC_TC`、`CHS_CHT`、`简繁内封` 等内封标记时，才把误选的“同包外挂”
原子纠偏为“内嵌字幕”后继续映射。失败的字幕合同校验不会留下部分文件选择。
创建订阅前先从 Bangumi/TMDB 选择作品身份，再由服务端并行聚合九个固定社区来源并按发布组去重。
Mikan 精确番组页发现的每个字幕组 RSS 都会被分批读取，卡片中的命中数、最近时间和样例来自
该子组 Feed 的真实条目；单源失败独立展示，不生成意义不明的“未识别发布组”。
旧来源若对完整长标题返回 500，发现链路只追加一次标题尾部短别名请求，并继续用完整身份别名
过滤条目；因此来源可用性不会被站点查询词缺陷误判，也不会把宽泛搜索结果混入作品。
订阅创建会再次核验所选 Bangumi/TMDB 身份，并把用户在当前 Season 明确选中的身份原子登记为
Work/Series `catalog-evidence`；若该身份已属于另一 Work 则返回冲突。所选 provider、编号、标题和
年份随订阅持久化，轮询创建 Task 时原样使用。普通错误订阅可在旧 Task 清理后按 revision 迁移并
重置历史 item；误建 Work 已产生未密封 RSS Task 时，专用 context-repair 只在活动 Run 归零且
subscription/Task revision 精确匹配时迁移同一 Task、来源、Episode Binding 和 item 历史，再删除
已空的源 Work。轮询会重试尚无 Task/Source 的历史 ignored/failed 条目，固定白名单 HTTPS
torrent enclosure 重算 BTIH 后仍原样保存私有 torrent 描述符，再按最多 16 集创建 Task 和 Episode Binding；
历史上已入队但被降格为裸磁链的来源会在同 Feed 重轮询时按 Task/Source/BTIH 原地批量升级，来源 ID 与
Episode Binding 不变。RSS Task 随后自动
串行完成清单检查、保守文件映射和探针，全部来源通过后自动进入隔离下载，失败则停在明确人工
复核态。成功后通过 `catalog-changed` 让系列详情、覆盖率和剧集表自动回读。
多来源下载 Run 会在执行开始时一次性兑换并复核全部描述符授权，再按来源顺序处理载荷；因此长下载
不会让后续来源授权在等待期间过期，也不需要延长或复用一次性授权。无效或已消费授权由 API 返回
409 合同拒绝，数据库故障才返回 503，不再把授权问题伪装成可重试 500。
下载首次 Run 或续传 Run 一旦取得任一已验证载荷，就不再因临时 peer/速率空窗触发
`download_stalled`；只有已验证字节、`downloaded_session` 增量和 `dlspeed` 始终全为零的
首次窗口才有界失败。旧版本首次下载已有部分载荷后失败时，API 只自动转换一次新的
`source.resume`，复用原 staging/profile/fastresume；零载荷和续传再次失败继续停止。
历史 torrent 升级若已把 Source 切到新 objectId/SHA、但 revision 数字仍停在旧值，状态仓会
只按同 Source 的 objectId+SHA 精确选择已存在修订并恢复真实 revision，避免续传保存时与唯一
对象索引冲突；无法精确命中时仍按声明 revision 失败关闭。
磁链清单检查每 5 秒发布语义进度并在 120 秒内终结；失败后清除 active Run 并保留精确
来源身份，允许重新填写来源、已有清单时重编文件映射，或在无载荷/计划/
来源清理 Run 时删除任务。执行任务列表只提供状态、进度和执行操作，不再提供作品新建或身份编辑；删除只
接受当前 revision，且允许尚未进入执行阶段的 intake `draft/blocked` Task 连同来源配置
和绑定的本地账本一起删除。API 在同一数据库
事务中清理 Task、Unit、Source、Run、Event、Outbox、Agent 与关联决策/例外记录，并返回
`clearedWorkItemId`；已有活动 Run、载荷/计划密封、元数据成果或验收证据的任务仍返回冲突。
迁移前遗留 Task 只有在操作者为 Series 新增完全相同官方身份的 Work 后才会补充绑定；
电影与剧场版不会按标题相似度自动合并，Series/Work 上下文缺失或歧义固定保持待确认。
治理执行若只完成 5 阶段中的第 1 阶段 dry-run、随后阻塞，且尚无 Unit 验收或元数据成果，
允许按当前 revision 精确移除错误来源。执行器先清除该来源独占 staging/profile；终态回调
再清空旧载荷和计划密封、保留已分配的 `workItemId`，把同一 Task 退回 intake 以接入正确来源。
一旦 completedItems 大于 1，说明备份或正式事务已经开始，来源回退继续失败关闭。
元数据链路会持久化作品身份、逐 Unit A/B/C 缺口与证据。普通治理成功后由服务端自动串联
首次核验、一次延后身份复核、最多两次确定性 LocalNFO/海报/逐集元数据修复、修复后复核和
独立验收；每个后继 Run 都在前一终态事务提交并递增 revision 后才预约。未知 A/C、身份冲突、
证据漂移或次数耗尽才停到 CodexAgent/人工决策，最终闭环模式只由独立验收判定。
Task、Unit、来源、Run、Series/Work 目录和 RSS 由 19 张 TypeORM 领域表持久化；其中旧 Agent session
表只作历史兼容。新任务只保存 `llmConversationId`，API 启动时从标准 LLM conversation
恢复派生状态；状态变更和语义事件在数据库事务提交后才发布 SSE。
生产发布由同一 API digest 的 `media-governance-series-work-migration` initContainer 在
数据库 advisory lock 内依次执行 `media-governance-series-work-v1.sql` 与
`media-governance-rss-context-v2.sql`，随后用独立只读 SQL 核对表结构、唯一索引、
Series/Work/Season 所有权、RSS 所选身份、旧资料引用和 Task 上下文；任一计数
漂移都会阻止 API 启动。结构迁移不按标题写入电影归属；操作者确认的历史电影或剧场版
通过认证的 Work 创建接口加入既有 Series，API 只绑定资料身份完全一致的遗留 Task，且
不创建伪 Season/Episode。
执行器高频进度先校验 Run、manifest 与连续序号，再原子追加到 Redis 热层并立即发布
携带紧凑 Task patch 的 `task-changed`；普通 tick 不等待 MySQL。MySQL 最多每 10 秒、
出现语义变化或进入终态时保存权威快照，终态必须等本实例已排队快照落库。Admin 对正常
tick 原位合并补丁，不重载列表/详情，也不显示整页 Spin；SSE 游标超出 API 有界内存
回放窗时发送 `snapshot-required`，由 Admin 静默重取权威快照。目录事务提交后在同一 SSE 发布
携完整 SeriesCard 的 `catalog-changed`；删除后发布 `series=null` 的删除墓碑。当前页卡片原位替换或移除，新 Series、筛选边界或游标失效静默重载系列分页。
Redis Stream 当前承担
执行器序号与进度热层，不声明为跨进程 SSE 历史回放层。媒体 SSE 响应同时返回
`Cache-Control: no-store` 和 `X-Accel-Buffering: no`，防止反向代理积攒进度事件。
运维入口 `pnpm media-governance:backup-restore-drill -- ...` 默认只输出计划；执行模式
自动识别迁移前 17 张或 Series-first 19 张媒体治理表，并且只允许恢复到新建的
`kt_media_governance_restore_*` 隔离库。入口会在 dump 前后比较源库表行数及
Task/Run/Event/Series/Work/Season/Episode/Binding/RSS 身份快照、校验 SQL SHA-256、恢复后再次比较相同快照，最后只删除本次
创建的隔离库；快照比较复用同一 `sha256sum`，不额外依赖 `cmp`。源库变化、目标已
存在、摘要漂移或能力缺失都会失败关闭。
任务汇总接口从真实 Task/Unit/Run 投影阻塞任务、10 分钟无心跳的失联运行、已关闭但
缺少 Unit 验收证据的漂移以及同季混合字幕发布组，并去重生成中文“需要关注”结论；
执行器回调时间写入持久化进度投影，列表和详情按当前时间显示“刚刚/几分钟前/几小时前”。
成功终态会统一收口为 `100% / 已完成`；服务重启恢复历史任务时，也会纠正早期已成功但
仍停留在 `0% / 执行中` 的陈旧进度投影，不需要直接修改数据库。
NAS 暂存残留没有持续观测证据时返回 `null`，Admin 不再把未知状态显示成固定 `0`；
正式独立验收仍必须提供实际 `stagingResiduals=0` 才能关闭 Task。
内部回调健康只有数据库状态仓完成加载时才返回 `database/ready`。源码已接入统一
本地 Codex gateway：Admin 大模型配置中的启用 Codex 连接是端点和内部认证的唯一来源；
可用模型不进入新增或编辑合同，而是在连接创建后由 LLM 模块经
`GET /llm/configs/:id/models` 实时发现。普通对话与媒体治理共用 `/internal/llm-codex`、
`LLM_CODEX_GATEWAY_INTERNAL_SECRET`、`x-kt-llm-gateway-secret` 和启用网络及 live
Web Search 的 `llm-codex` 权限档。媒体治理调用 `agent/start` 时只创建一条
`scene=media-governance` 的标准 LLM conversation，Task 只持久化唯一
`llmConversationId`；消息、模型切换、流式状态、实际模型和 Codex `providerThreadId`
全部归 LLM 模块管理。媒体入口直接进入标准 LLM 对话页，续聊只走
`POST /llm/conversations/:id/messages/stream`，没有媒体专用消息接口，也没有非流式降级。

媒体 CodexAgent 每轮从当前 Task 重新生成 `availableActions`，提示词与 API 共用同一阶段门；工具拒绝必须返回非空、脱敏稳定码，禁止把 409 吞成空结果后诱导模型原样重试。结构化结果以最长 8000 字的 `answer` 进入标准 LLM 消息，以短 `summary` 更新 Task 投影。策略 v3 的类型化工具覆盖 TMDB 身份确认、磁链添加/检查/移除、分页清单、保守自动文件映射、来源探针、下载、治理、元数据核验/修复与独立验收；自动映射除 `SxxExx` 和根目录纯数字方括号外，还接受根目录中唯一、由发布标点分隔的 1–3 位集号，多个候选继续失败关闭。电影来源存在宣传短片时，仅在最大视频至少 512 MiB、其余视频均不超过 64 MiB 且正片至少为第二大文件 8 倍时自动选择，否则仍要求人工复核。所有写动作仍由 Task revision、当前阶段、胶囊、provider thread CAS 和既有应用服务门保护，成功改变 revision 后当前回合必须停止，下一轮重新读取线上 Task。旧 App Server thread 在策略升级时通过显式 CAS 旋转一次，标准 conversationId 保持不变。

Agent 身份修正一旦通过计划摘要、修正历史和当前二级 TMDB 身份三重绑定，后续不再要求操作员逐阶段点击。API 只在无活动 Run 的确定性边界自动预约唯一后继：需要规范根重排时先执行治理事务；否则按 `metadata.verify → 最多两次 metadata.repair → metadata.verify → acceptance.verify` 串联，任一执行失败、次数耗尽或仍需人工判断时立即停止。服务启动会恢复同一类已持久化阶段边界，包括旧版曾被错误覆盖成 `metadata/blocked + gateReason=null` 的已应用计划；已关闭任务、普通人工任务和未应用的候选计划不会被自动推进。LLM 对话恢复时，已落入计划修正历史的 `plan-submitted` 结果投影为 `succeeded` 且清空 `pendingPlanSha256`，不会重新显示成待人工处理。

TMDB 搜索页读取固定使用 `connection: close` 与最多两次独立 10 秒请求，防止长驻 API 进程复用失效连接后持续 `fetch failed`；两次都不可用时 `provider.metadata.read` 返回 `lookupAvailable=false`，不再把整轮变成 503。Agent 可用 live Web Search 给出明确的 `themoviedb.org/movie|tv/<id>`，但 `media.identity.confirm` 仍必须由 API 独立读取该官方详情页并核对媒体类型和年份，验证失败保持零写。

OpenAI、智谱、DeepSeek 与 Moonshot 通过各自 OpenAI-compatible `GET /models` 读取当前
凭据可用模型；Anthropic 通过带 `x-api-key`、`anthropic-version` 和 `after_id` 有界分页的
Models API；本地 Codex 由 gateway 调用 App Server `model/list`。实时模型项同时归一
`reasoningEfforts/defaultReasoningEffort` 与 `serviceTiers/defaultServiceTier`：Codex 完整投影
App Server 声明的推理强度和 Fast 档位，Anthropic 消费 Models API 实际声明的 effort 能力，
OpenAI-compatible 供应商只在响应真实提供扩展能力字段时公开选项。未声明或不支持的能力保持
空数组，Admin 隐藏对应控件；每次发送前 API 再次校验模型、推理强度与速度档位，并把选择
传入供应商 SSE 或 Codex turn，不读取数据库静态模型数组。

媒体场景的每一轮仍按当前 Task revision 生成 policy/capsule/manifest，通过动态类型化工具
读取事实，并以严格输出 Schema 返回结果；接收资料、NAS 下载、独立验收及存在活动 Run
时只能旁路读取，密封写计划仍受媒体领域门禁。gateway 在流开始时调用内部 context
接口校验 Task 与 conversation 身份，在 done 前调用 result 接口更新治理投影。App Server
请求必须命中 `llm-codex` 权限档、`networkAccess=true` 和 `approvalPolicy=never`，错误
权限档、网络、路径、工具或摘要均失败关闭；浏览器不会接触 Codex 登录态或原始协议。
旧 `media_governance_agent_session` 只保留历史兼容读取，新 Task 获得 LLM 绑定后不再保存
第二套 session/thread/message。旧的 `MEDIA_CODEX_AGENT_GATEWAY_BASE_URL`、
`MEDIA_CODEX_AGENT_GATEWAY_TIMEOUT_MS` 与 `MEDIA_CODEX_AGENT_INTERNAL_SECRET` 已退出运行
合同。媒体会话身份只认数据库中的
`conversationId + scene + sceneRefId + activeTurnId + providerThreadId` 五元组；gateway 在
App Server `turn/start` 前携同一 `activeTurnId` 调内部绑定接口，由对话行锁以 CAS 完成
`providerThreadId` 首次空值绑定或同值幂等确认。迟到回合、错误 Task/scene/ref 或不同 thread
全部失败关闭。NAS 宿主遗留 `task-sessions` 文件不会恢复、迁移或覆盖标准 conversation，
因此 API/Gateway 重启后仍只有一个会话事实源。Gateway 内部派生的候选 ID 不进入回调或
消息 metadata；两个出口都只发送输出 Schema 的六个原始字段（含完整 `answer`），避免严格解析器拒绝内部字段。
Agent 结构化输出的 `properties` 必须全部进入 `required`，无候选时显式返回空数组；
真实候选歧义保持 `needs-operator`，operator decision 仍必须通过候选和密封计划复核。
每个 Task 只允许一个主媒体下载 owner；来源选择把每个显式文件
索引一一绑定到 Unit、文件角色、季集和字幕语言，并持久化为
`selected_file_mappings`。下载门在完整载荷开始前核对每个 Unit 的主视频覆盖、非内嵌
profile 的中文字幕覆盖、同季单一字幕发布组以及补充来源只含字幕/字体；Schema
`1.2.0` 计划只消费该映射，字体压缩包生成本地 `asset`，不再从发布组文件名猜季集。
逐季字幕来源必须与目标季和发布组一致，全部来源完成清单检查与运行时探针后才允许
进入下载。种子描述文件会安全解析，磁链和种子原文只写入
`MEDIA_GOVERNANCE_DESCRIPTOR_BUCKET` 指定的私有 MinIO Bucket；通用 `/minio/*`
服务会拒绝访问该 Bucket。种子内 `attr=p` 的 padding 传输项不会进入治理清单，
真实文件按 qBittorrent Web API 的用户可见顺序连续编号，使两端 manifest 摘要一致。
领域合同覆盖 Task/Unit/Run、五种来源分类、逐季单一
字幕发布组、`S00`、运行时来源健康、A/B/C 元数据、三层事件保留。来源探针先完成
3 分钟初始观察；即使已产生少量数据，按平均吞吐估算无法在 24 小时内完成所选载荷时
仍返回 `degraded/insufficient_throughput` 速度警告，但该唯一降级原因允许操作员继续下载；
其他降级、证据不足或不可用原因仍阻止下载，不再把任意 1 字节误判为可用。领域合同同时覆盖
revision/run/replay 幂等和五层 Agent 边界。数据库 Outbox 会把密封 Run 发送到仅监听
私网的 NAS 执行器，执行器按任务隔离目录完成下载、治理、元数据核验和独立验收；缺少
数据库状态仓、私网地址或内部 secret 时失败关闭。云端治理仍保持关闭。
NAS executor 会在调用 API 前先把每条事件 fsync 到连续 journal；网络传输和服务端暂态
状态按同一序号持续退避，API `Recreate` 发布期间 qBittorrent 与 runner 保持运行。最终报告
原子密封到 `/vol1/docker/kt-codex/artifacts/automation/media/<runId>` 后再向 API 发送终态。
下载 runner 每 1 秒采集 qBittorrent 字节、速度、ETA、peer 与逐文件进度；磁链清单检查
仍按每 5 秒、最长 120 秒的独立合同执行。隔离 qBittorrent 使用零下载限速、全部 Tracker、
DHT/PeX/LSD、全局 800/单种 400 连接和每秒 100 个新连接；不修改 NAS 温控或电源保护。
API 每 5 秒以 Run、Task 和密封输入摘要查询
对应 systemd runner；执行单元退出或失联时，
状态查询会携 API 已确认的 `afterSequence`；失联 runner 先分页补回连续非终态事件，只有
随后状态响应同时携带匹配的 Run manifest SHA、精确成功/失败终态与下一连续序号，API
才应用终态并清除活动 Run。缺少密封证据、身份漂移或序号跳跃时保持 Run 活跃等待下轮
核对，API 不自行伪造失败事件。此后调用继续或再次开始下载会密封新的接管 Run，按
Task/Source/info-hash 复用原 staging 与 qBittorrent 状态；已完整载荷只重新校验，未完成
载荷从原分片续传，存在 qBittorrent 状态却丢失 staging 时失败关闭。
新任务不需要操作员填写内部 `workItemId`：首次本地治理前由数据库串行分配
`media-063+` 并持久化复用。计划密封失败会推进 revision，修正合同后可从同一
payload-ready 载荷重试，不会重新下载。
治理执行失败时，完整的最长 400 字符技术摘要保留在事件记录中，Task 的用户可见
阻塞原因只投影前 160 字符以匹配数据库契约；再次开始治理会复用同一密封计划，创建
新的 revision、Run 和 replay key，不重放下载，也不复用已经消费的事务键。
元数据核验或独立验收出现明确的 NAS 执行失败时，也可用失败后的当前 revision 从原
阶段重试；API 保留密封计划并创建新的 Run 和 replay key，不会把业务核验不通过误当成
执行失败重试。元数据执行器会在治理完成后有界等待 fnOS 回填作品身份；若旧 Run 已在
回填完成前只返回 `identity.provider/providerId` 两项缺口，API 允许从同一密封计划重新
采集元数据事实，不重跑下载或本地治理；该确定性入口与任意阶段的 Agent 旁路入口彼此
独立，启动 Agent 不会消费或覆盖媒体 Run。延迟身份刷新每个 Unit 最多一次，并把
`identityRefreshAttempts` 保存在元数据投影中；一次刷新后仍缺身份时禁止第三次相同
Run，并由 Agent 的类型化身份修正收口。升级前已处于这一精确缺口
且尚无计数字段的持久化任务按刷新已用完迁移，避免 API 重启重新打开循环。
任务若已有每个 Unit 的成功核验证据、明确的元数据缺口阻塞、同一密封计划且无活动 Run，可用当前 revision 重新调用 `metadata/verify` 采集事实，以承接执行器版本修正或外部合法元数据收敛；该路径本地媒体/云端/数据库直写均为 0，不会重开已用完的延迟身份刷新次数。
任务的 Work 派生 `catalogIdentity`、TMDB 二级元数据 `metadataIdentity` 与密封物理根 `identity` 分别校验。已选 Bangumi/TVDB/TMDB Work 主身份不会被 Agent 的 TMDB 候选静默覆盖；NFO 的 provider 季集可使用二级 TMDB，但 `title/showtitle/year` 仍使用 Work catalog 标题和年份。公开 Task API 不提供身份恢复或编辑入口；历史身份折叠残留必须先在 Series 下建立并确认正确 Work，再通过受控迁移补充上下文。
内嵌字幕任务在唯一 TMDB 身份已闭合且只缺 LocalNFO、作品/季海报时，第一次确定性生成
属于自动元数据补齐，独立验收后记为 `automatic`；第二次尝试、其他 profile 或额外缺口
继续进入 `bounded_repair`/Agent，不改变 A/B/C 硬门禁。

## 核心规则

- 后台主键使用 Snowflake 数字 ID，数据库字段为 `BIGINT`，接口按字符串返回。
- 媒体治理生产源码由递归 AST 门禁覆盖：禁止条件三元表达式和六叶及以上的复合 `if`，符合规则的具名函数必须具备有意义的中文 JSDoc。
- 后端响应时间统一用 `KtDateTime extends Date` 承接序列化语义；Entity 使用 `@KtDateTimeColumn(format)`、`@KtCreateDateColumn(format)`、`@KtUpdateDateColumn(format)` 在 TypeORM hydrate 边界转换，DTO/外部数据源使用 `@KtDateTimeField(format)` + `transformKtDateTimeFields()` 转换，默认格式为 `YYYY-MM-DD HH:mm:ss`。Create/Update 列显式配置 `precision` 时，公共装饰器会在调用方未覆盖的前提下生成同精度 `CURRENT_TIMESTAMP(n)` 默认值与更新表达式，避免 MySQL 列精度不匹配；`vbenSuccess` / `ToolsService.res` 不做全量递归格式化。
- 字典维护在 `admin_dict`，Admin 字典管理按 `dictCode` 分组展示；可运营映射优先走字典或静态配置，不硬编码到业务函数。
- 全局 `SaveBodyInterceptor` 会删除 `POST */save` 请求体里的 `id`；需要保留时使用 `@SkipSaveBodyNormalize()`。
- Admin、Component、Dict、MinIO、Blog、Bot、Bot Adapter 和 Plugin Platform 管理接口默认走 `JwtAuthGuard`；公开接口用 `@Public()`。
- 系统日志由 pino 输出，Loki 查询统一通过后端 `/system/logs/*` 代理，前端不直连 Loki。
- 日志级站内信只承接运行期事件：接口 5xx、Bot 下线 notice、NapCat 容器最新离线日志及 Message Management 的站内信订阅者会自动写入或聚合通知；服务端强制 `super` 访问，Admin 不暴露人工新增/编辑入口。
- NapCat 扫码登录通过 SSE `/bot-adapter/napcat/account/scan/events` 暴露进度；新增账号必须在 `CheckLoginStatus.isLogin=true` 后继续等待 `GetQQLoginInfo.uin/selfId`，不能重建容器或猜号。
- Bot 外发统一走 adapter registry 和发送排队；在线命令、自动回复和复读机继续使用现有冷却与风控边界，核心不直接 import OneBot 或 Tencent transport。
- Plugin Platform 使用 `plugin.json` 描述 key、版本、操作、事件、权限、运行预算和包入口；CLI 负责 create/validate/pack/install-local。平台只保存插件生命周期与运行状态，不保存账号身份或 adapter 绑定。
- NapCat 与 Tencent 各自保存插件绑定并自行把入站事件适配为无状态插件协议；在线命令仍保留 adapter core 的账号能力精确绑定。
- Bilibili Card 是事件型内置插件：`bilibili-card.message` 只在账号绑定后监听 QQ/NapCat `share/json/xml/lightapp` 卡片或文本里的 Bilibili 链接。BotAdapter 通用事件投影会在 64 KiB、十层和 500 节点预算内展开协议段中的字符串化 JSON，使 QQ 小程序卡片的 `qqdocurl` 进入平台无关 `links[]`，插件无需重新依赖 OneBot 原始结构；`b23.tv` 短链再通过平台 `resolveRedirect` 受控 host 能力解析，视频信息从 Bilibili `x/web-interface/view` 获取后回复首行封面图和文本摘要。
- NATMap Port 是命令型内置插件：`natmap.port.current` 对应 `/natmap [通道名称]`，同时要求当前 Bot 适配器的账号命令或插件授权。worker 只经 `network.endpoint.read` 读取精确名称命中的 TCP NATMap 通道；仅 `synced + active + present + IPv4 + 未过期租约 + 1..65535 端口` 返回端口，其他状态按过期、空、歧义或不可用返回脱敏中文结果，绝不暴露公网 IP、内部目标、数据库 ID 或原始异常。既有生产库由 exact image 的 Bot Adapter initContainer 幂等执行 `sql/natmap-port-command-v1.sql` 并用 `sql/natmap-port-command-v1-verify.sql` 强校验命令身份；重复发布不会重新启用、恢复或覆盖管理员已经调整的命令状态。
- 同一账号只允许一个有效 NapCat 主容器；账号列表拆开展示 OneBot、容器、WebUI 和 QQ 登录态，心跳只代表 OneBot/容器通信，不能推导 QQ 登录态。
- NapCat 托管容器必须显式配置 `NAPCAT_IMAGE`，不要依赖 `latest` 默认镜像；生产切换镜像前先 pin 明确版本或 digest 并单账号观察。`desktop-cn-v20` 镜像从 KT `NapCatQQ` fork 的 source-built `NapCat.Shell` 构建，不再在镜像内对上游 bundle 做字符串 patch，并修复非自动重试 QR failure 后下次 WebUI 登录动作不重置、QQCore 通过进程级 mountinfo 探针看到 Docker/宿主路径、扫码登录成功后 API 立即读不到 QQ 号、生产 native reset 缺少 `offline()` 时半登录态无法清理、runtime view native maps 取证假阴性、WebUI `RestartNapCat` 重启 worker 丢失快速登录账号参数，以及首次解包覆盖 API 预写 NapCat config 导致 bypass 开关回落默认关闭的问题。踢下线后的半登录态不能只靠旧 native reset 兜底；源 Docker 容器在线时 API 会先同容器 `RestartNapCat` 重建 NapCat worker，再继续登录流程，同一个更新登录 session 不能反复重启 worker。
- NapCat 账号新增/编辑支持可选请求字段 `loginPassword`：只允许经 TLS 提交，后端使用 `BOT_ACCOUNT_SECRET_KEY`（或非默认 `ADMIN_TOKEN_SECRET`）包装为 AES-GCM `ktv1` secret 并保存到 `bot_account.napcat_login_password_secret`；空白编辑不更新，任何响应均不回显。
- NapCat 容器为已知 `selfId` 创建/重建时会一次性注入 `ACCOUNT` 等必要 env；容器重启（崩溃/重启策略/宿主重启）可复用持久化会话，但硬踢 `登录已失效` 仍需人工登录。Admin「更新登录」不通过 Docker 重建、重启或补 env 刷新登录态：只要源容器在线，就保持同一 Docker 容器；若 WebUI 明确返回 QQ 离线，会先调用同容器 `/api/QQLogin/RestartNapCat` 重启 NapCat worker，随后通过 NapCat WebUI `SetQuickLogin -> PasswordLogin -> RefreshQRcode/GetQQLoginQrcode` 推进原弹窗流程；同一个更新登录 session 只允许一次 worker restart，后续状态轮询只能继续 WebUI 登录/二维码刷新，不能反复重启 worker。只有 Docker 容器离线或缺失时，容器准备阶段才创建/重建并一次性注入 env。快速登录失败后，如果账号保存了登录密码，后端使用解密密码计算 MD5 调 `/api/QQLogin/PasswordLogin`，不会把密码写入运行态 env，也没有成功后的 env 清理步骤；密码登录按 `NAPCAT_PASSWORD_LOGIN_WAIT_MS` / `NAPCAT_LOGIN_POLL_INTERVAL_MS` 轮询结果。准备中的扫码会话会续期，重复调用更新登录会复用同一 pending `sessionId`，不会再次启动 quick/password/二维码准备；但如果该 pending 会话是在账号维护登录密码前创建、且尚未进入密码/验证码/新设备上下文，后续更新登录必须退役这条无密码会话并新建 refresh session，以重新读取账号表中的最新密码。取消扫码会话会在接口返回前把持久化 session 标成 `error/cancelled` 并写完成时间，避免已取消二维码从 DB 恢复为 active pending。若 API Pod 在准备阶段重启，持久化的 `preparingRelogin` 超过 `NAPCAT_RELOGIN_PREPARING_STALE_MS` 后会自动恢复为普通状态检测。pending refresh 会话没有二维码、验证码或新设备挑战时，状态轮询会按 `NAPCAT_LOGIN_QR_AUTO_REFRESH_COOLDOWN_MS` 冷却在同一容器自动重试二维码刷新，避免 SSE 长时间停在生成中。验证码和新设备验证保持同一会话 pending：腾讯验证码结果 `ticket`/`randstr`/`sid` 通过 `/bot-adapter/napcat/account/scan/captcha/submit` 回交到同一容器的 `/api/QQLogin/CaptchaLogin`；状态轮询遇到验证码文案但缺少 URL 时会先从当前容器日志恢复 `proofWaterUrl`，没有 URL 也保持验证码处理中而不切到二维码兜底。扫码或密码链路拿到 NapCat 登录阳性但 QQ 号暂不可读时，会按 `NAPCAT_LOGIN_SELF_ID_WAIT_MS` 保持 pending，超过窗口才失败。密码登录仍失败、验证码未完成、离线、账号不匹配或缺少 QQ 号时，直接通过 WebUI 二维码接口进入扫码兜底，不 reset 登录态。Admin SSE 步骤顺序按实际路径为 `quick-login-*` -> `password-login-*` / `password-login-captcha` / 新设备验证 -> `qrcode/waiting-scan` -> `login-success|login-failed`；SSE 事件缓存因 Pod 重启丢失时，新订阅会收到当前会话快照。
- NapCat 设备身份按账号持久化到 `napcat_device_identity`：同一账号重建容器会复用数据目录、`pc-<8hex>` hostname、machine-id 和实体 OUI 风格 MAC，明确排除 Docker `02:42`、QEMU/KVM `52:54:00`、VMware、Hyper-V 等虚拟化前缀；新增账号首次扫码会先用预留容器 id 创建临时设备身份并应用到第一次 Docker run，扫码成功后归属到真实账号并同步 runtime/protocol profile；Docker run 会注入 `--hostname`、`--mac-address`、只读 `/etc/machine-id`，并同步写入 QQNT Linux `machine-info`，使 `/etc/machine-id`、Docker MAC 和 QQNT 本地设备缓存保持一致。当前策略名为 `qqnt-visible-hostname-v1` / `physical-oui-mac-v1`。
- NapCat 新设备验证走同一 scan session：`CaptchaLogin` 返回 `needNewDevice` 后，后端继续调用 `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`，Admin/SSE 分开展示 `captchaUrl`、`newDeviceQrcode`、已扫码、确认中、验证成功、登录成功/失败等中文进度，不把 `jumpUrl` 当作唯一完成入口。
- NapCat 离线看门狗按 `NAPCAT_WATCHDOG_INTERVAL_MS`（默认 `120000`，最小 `30000`，`NAPCAT_WATCHDOG_ENABLED=false` 关闭）定时巡检在线账号，使掉线/被踢无需管理员打开列表页即可及时发现；检测到离线后只写入离线原因并复用 `super` 站内信告警，恢复登录必须由管理员在 Admin 手动触发「更新登录」。
- BangDream 当前源码根目录是 `src/modules/plugins/bangdream/src`；业务在 `domain/*`，编排在 `application`，操作在 `operations`，外部 API 在 `infrastructure/integration`，缓存/静态修正在 `infrastructure/storage`，字典和静态配置在 `config`，视觉渲染公共件在 `theme`。
- BangDream 在线命令以 `plugins/bangdream/plugin.json` 为单一来源，新增命令必须同步 SQL/在线命令表并跑 manifest/command-SQL 测试。
- BangDream event stage 大图必须保持分页拆图行为，线上 smoke 关注 `imageCount=5`，避免大 canvas OOM 回归。

## 轻量验证

文档、小范围配置或低风险改动：

```bash
git diff --check
```

后端代码改动：

```bash
pnpm run typecheck
pnpm run lint
pnpm test
```

BangDream 图片能力改动：

```bash
bash scripts/bangdream-render-smoke.sh --operation-key bangdream.song.search --text "夏祭り" --out-file ".kt-workspace/bangdream-smoke/song.jpg"
bash scripts/bangdream-render-smoke.sh --operation-key bangdream.event.stage --text "310" --out-file ".kt-workspace/bangdream-smoke/stage.jpg" --expected-image-count 5
```

接口改动必须启动或复用本地服务，并真实调用一次对应接口。

## 发布

主线发布由 Jenkins 构建镜像、推送 NAS 本地 Registry，并滚动更新 K8s `kt-prod/kt-template-online-api`。推送后不能只看 Git push 成功，需要继续观察 Jenkins、K8s rollout、新 Pod 状态和至少一条真实运行态 smoke。

Task 13 首次发布先以 `TASK13_PREBUILD_ONLY=true`、`DEPLOY_TARGET=docker`、
`BUILD_DOCKER_IMAGE=true`、`PUSH_DOCKER_IMAGE=true`、
`RUN_DOCKER_CONTAINER=false` 单独构建镜像。该模式只允许 Linux/NAS
Agent 上远端 `main/dev` 与 checkout 完全相同的非 PR `main`，只推送本次
API/Gateway tag，不更新 `latest`，也不会进入 K8s Deploy 或 Docker Run。
发布身份以 `checkout scm` 返回值与 workspace `HEAD` 的一致结果为准，不依赖
手动参数构建中可能缺失的环境变量 `GIT_COMMIT`；远端 `main/dev` 校验必须由
Jenkins SSH Agent 使用现有 SCM 凭据 `github-ssh-kt-template`，不能假定
Agent 容器自身持有 Gitea 私钥。
两张镜像必须具有同一 source revision 和 build-pair；成功后 Jenkins 归档
`.kt-workspace/task13-prebuild/task13-exact-digests.env`，后续维护流程只消费
其中的 exact digest。Task 13 两种受限模式都拒绝 NapCat image/profile
override，避免夹带无关 Pod template 变更。本地 Jest 只静态验证
Jenkinsfile 状态机；正式迁移前仍必须在 Jenkins canary 中验证参数绑定、
Registry digest 回读、归档和“零部署”结果。
Task 13 的 exact-digest 推送与受控 K8s 恢复状态机分别位于
`ci/jenkins/task13-prebuild-push.sh` 和
`ci/jenkins/task13-prebuilt-release.sh`；Jenkinsfile 只传递已通过精确门禁的
固定输入并编排脚本，测试同时限制 Jenkinsfile 字节数，避免 Groovy CPS
`Method too large`。恢复脚本不会把生产 Secret YAML 写入 workspace，并用同一
EXIT/signal 守卫覆盖 manifest apply、回读和双 rollout；任一失败都会清理
overlay，并将 API 恢复为零副本。
Task 13 首次迁移期间曾拒绝未显式选择上述 build-only 或
`PREBUILT_RELEASE` 的普通非 PR `main` 构建。密码迁移、exact release、
线上登录 smoke 和维护 annotation 清理全部完成后，该临时拒绝门禁已移除，
后续 `main` 恢复标准 Jenkins/K8s 发布；两种 Task 13 模式仍保留为历史
exact-digest 构建和受控恢复入口。

Task 13 密码迁移后的恢复使用 Jenkins `PREBUILT_RELEASE` 受控模式，不重新
安装、测试、构建或推送。调用方必须保证 checkout 无 tracked/untracked
漂移，并传入远端 `main/dev` 同时指向的
`EXPECTED_SOURCE_COMMIT`、当前目标 `PREBUILT_API_IMAGE`、迁移使用的
`PREBUILT_MIGRATION_API_IMAGE`、预先批准且支持 PBKDF2 的
`PREBUILT_FALLBACK_API_IMAGE`、与 migration API 同一次 build 的
`PREBUILT_GATEWAY_IMAGE` exact digest，以及
`TASK13_MIGRATION_BATCH_ID`。目标 API 只能是 migration 或 fallback
digest；migration/fallback 的 digest 后缀和拉取后的 Docker image ID
都必须不同。API Deployment 还必须保留绑定 batch、migration/fallback digest
和生产 env SHA256 的活动维护 annotation，以及当前 batch 的 NAS 外备份、
Blog verify、Admin verify 三项完成证明。该模式固定规范生产 env 路径，在
第一次 Kubernetes 写前验证零 API Pod、镜像 revision/build-pair 和上述
证明，再重建 Secret，用临时 Kustomize overlay 以 API `replicas=0` 应用
并回读两个 digest 和维护租约，最后才扩容 API 到 `1` 并等待 rollout。
manifest apply、本地回读、rollout 或最终回读失败时都会尝试恢复 API `0`
副本并清空 Pod；普通 tag 发布不能替代此流程。

Message Management 与订阅者适配器按以下顺序发布和回滚：

1. 备份现存的旧 `qqbot_message_subscription` / `qqbot_message_template` / `qqbot_message_event`、现行四张 `message_*` 协议表、QQBot 三张订阅者表、`station_notice_message_binding`，以及相关 `admin_menu` / `admin_role_menu` 行；不存在的表只记录为未创建。
2. 既有环境只应用本功能的幂等增量入口 `sql/bot-message-push-init.sql`，随后执行只读的 `sql/bot-message-push-verify.sql`；不要把包含历史迁移的 `sql/bot-init.sql` 作为本功能生产迁移。仅一次性、可丢弃的全量初始化环境按顺序使用 `sql/refactor-v3/00-full-schema.sql`、`01-seed-core.sql`、`99-verify.sql`。发布前还需通过网络菜单 SQL 应用独立 `System:Network:PortForward:Natmap` 权限并确认只授予活动 `super`。
3. 增量迁移会把旧协议表复制到通用表，并把不同账号所选的旧模板按“旧订阅 + 模板”拆成单模板订阅；验证 8 张现行表、精确索引、订阅非空模板集合、同来源约束、QQBot 私有绑定无 `template_id`、默认模板、菜单和活动角色授权。
4. 先发布并验证 API 健康检查、Message Management CRUD、旧 QQBot 发送能力和两个订阅者接口，再发布并验证 Admin。
5. 管理员先创建绑定来源的模板，再创建绑定一个或多个同来源模板及一个订阅者的订阅；随后仅在具体订阅者页面配置 QQ 账号/目标或站内信标题/接收角色，并分别完成授权的有界来源事件验收。
6. 回滚时先停用 Bot 与站内信订阅者绑定，再回滚 Admin 和 API；保留通用事件、Bot 投递、站内信和 `bot_send_log` 历史供审计，不停止 Network Agent、端口转发、STUN Keeper 或 DDNS。
7. Jenkins/K8s 成功只属于部署证据，不能代替真实 CRUD、页面、Outbox/DDNS 或 QQ 投递功能验收。

每次发布记录必须分别写明代码部署、生产 SQL、真实 CRUD、Admin 页面、Outbox/DDNS 和授权 QQ 投递的证据；没有明确授权的 QQ 群或 QQ 号时不得任选目标，且必须把真实投递标记为未验证，不能用 Jenkins/K8s 成功替代。

## 来源与许可证

| 一级来源                                                                 | 使用方式                                                                                   | License |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| [Tsugu BangDream Bot](https://github.com/Yamamoto-2/tsugu-bangdream-bot) | BangDream 插件能力已重构合入 `src/modules/plugins/bangdream/src`，保留本地 `TSUGU-LICENSE` | MIT     |
