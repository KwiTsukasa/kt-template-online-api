# KT Template Online API

`kt-template-online-api` 是 KT 工作区的 NestJS 后端服务，承接 Admin 后台、博客内容、组件模板、MinIO 文件、系统日志、QQBot/NapCat 和游戏查询插件能力。

## 技术栈

- Node.js 22 / TypeScript 5.9
- NestJS 11 / Express 5
- TypeORM 0.3 / MySQL
- Swagger / Knife4j
- nestjs-pino / pino-loki / Loki
- MinIO
- MQTT / OneBot v11 reverse WebSocket / NapCat
- skia-canvas / Chart.js
- pnpm 9

## 功能模块

| 模块                            | 说明                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `admin`                         | Vben Admin 认证、用户、菜单、角色、部门、时区、字典、组件模板、系统日志、环境总览面板                      |
| `blog`                          | 本地博客文章、分类、标签、Argon 主题配置和 WordPress 导入                                                  |
| `wordpress`                     | WordPress REST 代理、登录态透传、文章/分类/标签/主题配置                                                   |
| `qqbot`                         | QQBot 账号、NapCat 扫码登录、运行态 Profile、OneBot 反向 WS、在线命令、规则、权限、发送/接收日志和插件平台 |
| `modules/qqbot/plugin-platform` | QQBot 插件 manifest 校验、版本安装、运行事件、定时任务、受控 SDK 和 CLI 脚手架                             |
| `qqbot/plugins/bangdream`       | BanG Dream 查曲、查卡、查活动、试炼、玩家、卡池、抽卡模拟、档线、谱面出图                                  |
| `qqbot/plugins/bilibili-card`   | 解析 QQ/NapCat Bilibili 卡片和短链，按账号事件绑定回复视频文字摘要                                         |
| `qqbot/plugins/ff14-market`     | XIVAPI + Universalis 物品解析和 FF14 市场查价                                                              |
| `qqbot/plugins/fflogs`          | FFLogs v2 GraphQL 角色排名和指定高难最近记录查询                                                           |
| `minio`                         | Bucket 检查、上传、列表、临时 URL、代理下载、删除                                                          |
| `common`                        | 响应封装、异常过滤、请求日志、日期格式化、字典解码、Snowflake、工具服务                                    |

## 目录结构

```text
src/
  admin/       Admin 后台接口和实体
  blog/        本地博客内容与主题配置
  common/      全局装饰器、过滤器、拦截器、logger、工具和类型
  minio/       MinIO 文件服务
  modules/     第三期重构后的业务边界模块
  qqbot/       QQBot 运行态、管理接口和插件生态
  wordpress/   WordPress REST 代理
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

| 分组                  | 变量                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL                 | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC`                                                                                                                                                                                                                                        |
| MinIO                 | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`                                                                                                                                                                                                                              |
| Admin                 | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID`                                                                                                                                                                                                                       |
| WordPress             | `WORDPRESS_BASE_URL`、`WORDPRESS_HOST_HEADER`、`WORDPRESS_ADMIN_USERNAME`、`WORDPRESS_ADMIN_PASSWORD`、`WORDPRESS_*_TIMEOUT_MS`                                                                                                                                                                                     |
| Logging/Loki          | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_*`                                                                                                                                                                                                                                                |
| QQBot/NapCat          | `QQBOT_ENABLED`、`QQBOT_ACCOUNT_SECRET_KEY`、`QQBOT_REVERSE_WS_*`、`QQBOT_SEND_*`、`QQBOT_PLUGIN_QUEUE_REDIS_*`、`QQBOT_PLUGIN_TASK_QUEUE_REDIS_*`、`QQBOT_PLUGIN_QUEUE_WAIT_TIMEOUT_MS`、`QQBOT_COMMAND_MIN_COOLDOWN_MS`、`QQBOT_RULE_MIN_COOLDOWN_MS`、`QQBOT_REPEATER_*`、`NAPCAT_*`、`QQBOT_NAPCAT_*`、`MQTT_*` |
| Environment Dashboard | `ENV_DASHBOARD_CACHE_TTL_MS`、`ENV_DASHBOARD_SIGNAL_TIMEOUT_MS`、`ENV_DASHBOARD_EVENT_BUS`、`ENV_DASHBOARD_MQTT_*`、`ENV_DASHBOARD_SSE_*`、`ENV_DASHBOARD_JENKINS_*`、`ENV_DASHBOARD_K8S_*`、`ENV_DASHBOARD_TENCENT_*`、`ENV_DASHBOARD_CADDY_*`、`ENV_DASHBOARD_R4SE_*`                                             |
| BangDream             | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT`                                                                                                                                                                                                                    |
| FF14 Market           | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_MARKET_CACHE_TTL_MS`                                                                                                                                                                                                                                     |
| FFLogs                | `FFLOGS_BASE_URL`、`FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET`                                                                                                                                                                                                             |

`DB_SYNC=true` 只适合本地开发或明确允许自动同步表结构的环境；生产应关闭并使用 SQL/迁移脚本。

QQBot 插件 worker 使用 BullMQ 队列串行执行同一插件安装实例的请求。K8s 生产清单包含内部服务 `kt-qqbot-plugin-redis`，生产 env 可将 `QQBOT_PLUGIN_QUEUE_REDIS_HOST` 配为该服务名。`QQBOT_PLUGIN_QUEUE_WAIT_TIMEOUT_MS` 控制排队等待窗口，插件 `operation.timeoutMs` 仍表示单次执行预算。

QQBot 插件定时任务由 manifest 的 `tasks` 声明，平台持久化到 `qqbot_plugin_task` / `qqbot_plugin_task_run`，通过 BullMQ Job Scheduler 调度并经插件 worker 的 `executeTask` 边界执行。`sql/qqbot-init.sql` 可为既有环境增量创建任务表和 Admin 菜单。Admin 页面路径为 `/qqbot/plugin-task`。定时任务队列可用 `QQBOT_PLUGIN_TASK_QUEUE_REDIS_*` 单独配置；留空时复用插件 worker 队列的 Redis 连接。BangDream Bestdori 主数据缓存使用 `BANGDREAM_TSUGU_CACHE_ROOT`，生产清单挂载到容器内 `/data/qqbot/plugins/bangdream/cache`，对应 k3d 节点可写 hostPath `/var/lib/rancher/k3s/kt-template-online-api/qqbot-plugins`。

Admin 环境总览面板使用 `ENV_DASHBOARD_*` 只读配置聚合 local-dev、NAS 线上、腾讯云和 r4se 状态。`ENV_DASHBOARD_ADMIN_LOCAL_URL` / `ENV_DASHBOARD_ADMIN_PUBLIC_URL` 只用于展示 Admin 本机与线上入口证据。HTTP 快照提供当前拓扑，后端 local/MQTT 事件总线通过 SSE 推送增量事件给 Admin；前端不直连 MQTT，也不轮询刷新。Jenkins、K8s、Tencent Cloud、Caddy、WireGuard、Mihomo/OpenClash 未配置时会显示 `unwired` 证据，不能渲染成健康假象；第一版不暴露重启、部署、迁移、容器重建、插件启停或代理切换等写操作。

NapCat Runtime/Protocol Profile 已完成本地 API/Admin 实施，线上发布和账号闭环按 `docs/superpowers/plans/2026-06-18-qqbot-napcat-runtime-protocol-profile-implementation-plan.md` 的 Task 10 执行。当前实现覆盖运行态/协议/会话行为/历史登录事件兼容表/风险模式表，真实物理设备风格 hostname/MAC，NapCat/OneBot 配置 hash，KT `zh_CN.UTF-8` 中国桌面派生镜像资产，只读 `/qqbot/napcat/runtime/detail` 证据接口，watchdog 离线巡检告警，以及 Admin 账号页“运行态”抽屉；不绕过 QQ/Tencent 验证码、不修改 QQ/NTQQ 签名协议、不启用 privileged/host network，也不做账号级每小时/每日累计发送预算。NapCat Chinese Desktop Runtime v3 使用 KT `NapCatQQ` fork 源码构建出的 `NapCat.Shell` artifact；镜像必须先用 `scripts/napcat-desktop-cn-stage-build.mjs` staged build context，生产 `QQBOT_NAPCAT_IMAGE` 应指向验证过的 `kt-napcat-desktop-cn:desktop-cn-v3` digest。

## 启动

```bash
pnpm install
pnpm start:dev
```

服务固定监听 `48085`。

常用命令：

```bash
pnpm start
pnpm start:prod
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm qqbot-plugin create <pluginKey>
pnpm qqbot-plugin validate <pluginDir>
pnpm qqbot-plugin pack <pluginDir>
pnpm qqbot-plugin install-local <packageFile>
```

Jest 只扫描 `test/**/*.spec.ts`。如果在 Windows 下指定测试文件，使用：

```bash
pnpm exec jest --runInBand --runTestsByPath test/path/to/file.spec.ts
```

## 接口文档

- Swagger 全量：`http://localhost:48085/api`
- OpenAPI JSON：`http://localhost:48085/api-json`
- 分组文档：`/api/admin`、`/api/qqbot`、`/api/wordpress`、`/api/basic`
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

该公开入口不返回数据库、WordPress、Loki、NapCat SSH 等运行拓扑配置快照；配置检查只暴露 key 级别、是否存在和缺失说明。`blocked` 表示关键配置缺失；`degraded` 表示可选运行时配置缺失，核心 API 仍可继续工作。本地未配置 Loki、WordPress、NapCat 等可选依赖时，健康状态可能保持 `degraded`。

## 核心规则

- 后台主键使用 Snowflake 数字 ID，数据库字段为 `BIGINT`，接口按字符串返回。
- 后端响应时间统一用 `KtDateTime extends Date` 承接序列化语义；Entity 使用 `@KtDateTimeColumn(format)`、`@KtCreateDateColumn(format)`、`@KtUpdateDateColumn(format)` 在 TypeORM hydrate 边界转换，DTO/外部数据源使用 `@KtDateTimeField(format)` + `transformKtDateTimeFields()` 转换，默认格式为 `YYYY-MM-DD HH:mm:ss`。`vbenSuccess` / `ToolsService.res` 不做全量递归格式化。
- 字典维护在 `admin_dict`，Admin 字典管理按 `dictCode` 分组展示；可运营映射优先走字典或静态配置，不硬编码到业务函数。
- 全局 `SaveBodyInterceptor` 会删除 `POST */save` 请求体里的 `id`；需要保留时使用 `@SkipSaveBodyNormalize()`。
- Admin、Component、Dict、MinIO、Blog 管理、WordPress 管理和 QQBot 管理接口默认走 `JwtAuthGuard`；公开接口用 `@Public()`。
- WordPress 自动登录失败不会阻断 Admin 主登录，会通过菜单和权限码过滤不可用的 Blog 管理入口。
- 系统日志由 pino 输出，Loki 查询统一通过后端 `/system/logs/*` 代理，前端不直连 Loki。
- 日志级站内信只承接运行期事件：接口 5xx、QQBot 下线 notice、NapCat 容器最新离线日志会自动聚合通知 `super` 角色；服务端强制 `super` 访问，Admin 不再暴露人工新增/编辑入口；长路径接口错误会压缩 `dedupeKey/title` 到表字段长度内，避免通知入库失败。
- QQBot 扫码登录通过 SSE `/qqbot/account/scan/events` 暴露进度，耗时链路不应阻塞普通 HTTP 响应；新增账号扫码会先返回 pending `sessionId`，后台再创建 NapCat 容器并生成二维码。
- QQBot 外发统一走发送排队：默认全局间隔 `2500ms`、同会话间隔 `8000ms`、排队抖动 `0-800ms`，超过 `QQBOT_SEND_MAX_QUEUE_WAIT_MS` 时拒绝本次发送，避免高频自动回复形成突发流量。
- QQBot 在线命令和自动回复规则都有运行时保底冷却：默认命令 `5000ms`、规则 `30000ms`；即使数据库里旧数据冷却值更低，也按保底值判定，降低频繁触发风控的概率。
- QQBot 复读机默认阈值为 4，同一会话默认 10 分钟只复读一次，默认只复读 120 字以内普通文本，避免群聊重复内容导致机器人过于频繁地模拟真人发言。
- QQBot 插件平台统一使用 `plugin.json` manifest 描述插件 key、版本、操作、事件、权限、运行预算和包入口；CLI 负责 create/validate/pack/install-local，后端只暴露受控 SDK 能力并通过插件维度记录安装、配置、账号绑定和运行事件。
- Bilibili Card 是事件型内置插件：`bilibili-card.message` 只在账号绑定后监听 QQ/NapCat `share/json/xml/lightapp` 卡片或文本里的 Bilibili 链接，`b23.tv` 短链通过平台 `resolveRedirect` 受控 host 能力解析，视频信息从 Bilibili `x/web-interface/view` 获取后回复纯文本摘要。
- QQBot 同一账号只允许一个有效 NapCat 主容器；绑定新容器时会释放旧绑定和不再共享的旧容器，机器人下线 notice、`isOnline:false` 和 NapCat 容器最新离线日志都会写入账号 `lastError`，普通群成员 kick 不属于账号离线信号；写入 `last_error` 前按 500 字符截断，后续无错误的普通断连不能清空该原因；账号列表拆开展示 OneBot、容器、WebUI 和 QQ 登录态，心跳只代表 OneBot/容器通信，不能推导 QQ 登录态；近期连接只用于避免重连瞬间被旧缓存误伤，后续仍必须以 NapCat WebUI/日志检查判断 QQ 登录态；`qqLoginMessage` 只展示 QQ 登录态消息，WebUI 配置或请求错误留在 `lastError`。
- NapCat 托管容器必须显式配置 `QQBOT_NAPCAT_IMAGE`，不要依赖 `latest` 默认镜像；生产切换镜像前先 pin 明确版本或 digest 并单账号观察。`desktop-cn-v3` 镜像从 KT `NapCatQQ` fork 的 source-built `NapCat.Shell` 构建，不再在镜像内对上游 bundle 做字符串 patch。
- NapCat 账号新增/编辑支持可选 QQ 登录密码：Admin 只提交 RSA-OAEP 加密后的 `encryptedLoginPassword`，后端解密后必须用显式配置的 `QQBOT_ACCOUNT_SECRET_KEY`（或非默认 `ADMIN_TOKEN_SECRET`）二次加密保存到 `qqbot_account.napcat_login_password_secret`；空值、`change-me` 和历史公开默认值会被拒绝；列表和详情不回显密码，日志会脱敏密码字段。
- NapCat 容器为已知 `selfId` 创建/重建时会一次性注入 `ACCOUNT` 等必要 env；容器重启（崩溃/重启策略/宿主重启）可复用持久化会话，但硬踢 `登录已失效` 仍需人工登录。Admin「更新登录」不通过 Docker 重建、重启或补 env 刷新登录态：只要源容器在线，就保持同一容器并通过 NapCat WebUI `SetQuickLogin -> PasswordLogin -> RefreshQRcode/GetQQLoginQrcode` 推进原弹窗流程；只有 Docker 容器离线或缺失时，容器准备阶段才创建/重建并一次性注入 env。快速登录失败后，如果账号保存了登录密码，后端使用解密密码计算 MD5 调 `/api/QQLogin/PasswordLogin`，不会把密码写入运行态 env，也没有成功后的 env 清理步骤；密码登录按 `QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS` / `QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS` 轮询结果。准备中的扫码会话会续期，重复调用更新登录会复用同一 pending `sessionId`，不会再次启动 quick/password/二维码准备。若 API Pod 在准备阶段重启，持久化的 `preparingRelogin` 超过 `QQBOT_NAPCAT_RELOGIN_PREPARING_STALE_MS` 后会自动恢复为普通状态检测。验证码和新设备验证保持同一会话 pending：腾讯验证码结果 `ticket`/`randstr`/`sid` 通过 `/qqbot/account/scan/captcha/submit` 回交到同一容器的 `/api/QQLogin/CaptchaLogin`；状态轮询遇到验证码文案但缺少 URL 时会先从当前容器日志恢复 `proofWaterUrl`，没有 URL 也保持验证码处理中而不切到二维码兜底。密码登录仍失败、验证码未完成、离线、账号不匹配或缺少 QQ 号时，直接通过 WebUI 二维码接口进入扫码兜底，不 reset 登录态。Admin SSE 步骤顺序按实际路径为 `quick-login-*` -> `password-login-*` / `password-login-captcha` / 新设备验证 -> `qrcode/waiting-scan` -> `login-success|login-failed`；SSE 事件缓存因 Pod 重启丢失时，新订阅会收到当前会话快照。
- NapCat 设备身份按账号持久化到 `napcat_device_identity`：同一账号重建容器会复用数据目录、`pc-<8hex>` hostname、machine-id 和实体 OUI 风格 MAC，明确排除 Docker `02:42`、QEMU/KVM `52:54:00`、VMware、Hyper-V 等虚拟化前缀；新增账号首次扫码会先用预留容器 id 创建临时设备身份并应用到第一次 Docker run，扫码成功后归属到真实账号并同步 runtime/protocol profile；Docker run 会注入 `--hostname`、`--mac-address`、只读 `/etc/machine-id`，并同步写入 QQNT Linux `machine-info`，使 `/etc/machine-id`、Docker MAC 和 QQNT 本地设备缓存保持一致。当前策略名为 `qqnt-visible-hostname-v1` / `physical-oui-mac-v1`。
- NapCat 新设备验证走同一 scan session：`CaptchaLogin` 返回 `needNewDevice` 后，后端继续调用 `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`，Admin/SSE 分开展示 `captchaUrl`、`newDeviceQrcode`、已扫码、确认中、验证成功、登录成功/失败等中文进度，不把 `jumpUrl` 当作唯一完成入口。
- NapCat 离线看门狗按 `QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS`（默认 `120000`，最小 `30000`，`QQBOT_NAPCAT_WATCHDOG_ENABLED=false` 关闭）定时巡检在线账号，使掉线/被踢无需管理员打开列表页即可及时发现；检测到离线后只写入离线原因并复用 `super` 站内信告警，恢复登录必须由管理员在 Admin 手动触发「更新登录」。
- BangDream 当前源码根目录是 `src/modules/qqbot/plugins/bangdream/src`；按第三期插件结构放置真实职责代码：业务在 `domain/*`，编排在 `application`，操作在 `operations`，外部 API 在 `infrastructure/integration`，缓存/静态修正在 `infrastructure/storage`，字典和静态配置在 `config`，视觉渲染公共件在 `theme`；不要恢复旧 `tsugu` 层级、旧大桶目录、纯 re-export 转接文件或空 `.gitkeep` 目录壳。
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

```powershell
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.song.search -Text "夏祭り" -OutFile ".kt-workspace/bangdream-smoke/song.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.event.stage -Text "310" -OutFile ".kt-workspace/bangdream-smoke/stage.jpg" -ExpectedImageCount 5
```

接口改动必须启动或复用本地服务，并真实调用一次对应接口。

## 发布

主线发布由 Jenkins 构建镜像、推送 NAS 本地 Registry，并滚动更新 K8s `kt-prod/kt-template-online-api`。推送后不能只看 Git push 成功，需要继续观察 Jenkins、K8s rollout、新 Pod 状态和至少一条真实运行态 smoke。

## 来源与许可证

| 一级来源                                                                 | 使用方式                                                                                               | License |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------- |
| [Tsugu BangDream Bot](https://github.com/Yamamoto-2/tsugu-bangdream-bot) | BangDream QQBot 后端能力已重构合入 `src/modules/qqbot/plugins/bangdream/src`，保留本地 `TSUGU-LICENSE` | MIT     |
