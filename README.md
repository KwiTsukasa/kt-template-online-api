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

| 模块                            | 说明                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `admin`                         | Vben Admin 认证、用户、菜单、角色、部门、时区、字典、组件模板、系统日志                    |
| `blog`                          | 本地博客文章、分类、标签、Argon 主题配置和 WordPress 导入                                  |
| `wordpress`                     | WordPress REST 代理、登录态透传、文章/分类/标签/主题配置                                   |
| `qqbot`                         | QQBot 账号、NapCat 扫码登录、OneBot 反向 WS、在线命令、规则、权限、发送/接收日志和插件平台 |
| `modules/qqbot/plugin-platform` | QQBot 插件 manifest 校验、版本安装、运行事件、受控 SDK 和 CLI 脚手架                       |
| `qqbot/plugins/bangDream`       | BanG Dream 查曲、查卡、查活动、试炼、玩家、卡池、抽卡模拟、档线、谱面出图                  |
| `qqbot/plugins/ff14Market`      | XIVAPI + Universalis 物品解析和 FF14 市场查价                                              |
| `qqbot/plugins/fflogs`          | FFLogs v2 GraphQL 角色排名和指定高难最近记录查询                                           |
| `minio`                         | Bucket 检查、上传、列表、临时 URL、代理下载、删除                                          |
| `common`                        | 响应封装、异常过滤、请求日志、日期格式化、字典解码、Snowflake、工具服务                    |

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

| 分组         | 变量                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL        | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC`                                                                                                                                 |
| MinIO        | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`                                                                                                                       |
| Admin        | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID`                                                                                                                |
| WordPress    | `WORDPRESS_BASE_URL`、`WORDPRESS_HOST_HEADER`、`WORDPRESS_ADMIN_USERNAME`、`WORDPRESS_ADMIN_PASSWORD`、`WORDPRESS_*_TIMEOUT_MS`                                                                              |
| Logging/Loki | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_*`                                                                                                                                         |
| QQBot/NapCat | `QQBOT_ENABLED`、`QQBOT_ACCOUNT_SECRET_KEY`、`QQBOT_REVERSE_WS_*`、`QQBOT_SEND_*`、`QQBOT_COMMAND_MIN_COOLDOWN_MS`、`QQBOT_RULE_MIN_COOLDOWN_MS`、`QQBOT_REPEATER_*`、`NAPCAT_*`、`QQBOT_NAPCAT_*`、`MQTT_*` |
| BangDream    | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT`                                                                                                             |
| FF14 Market  | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_MARKET_CACHE_TTL_MS`                                                                                                                              |
| FFLogs       | `FFLOGS_BASE_URL`、`FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET`                                                                                                      |

`DB_SYNC=true` 只适合本地开发或明确允许自动同步表结构的环境；生产应关闭并使用 SQL/迁移脚本。

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
- QQBot 扫码登录通过 SSE `/qqbot/account/scan/events` 暴露进度，耗时链路不应阻塞普通 HTTP 响应。
- QQBot 外发统一走发送排队：默认全局间隔 `2500ms`、同会话间隔 `8000ms`、排队抖动 `0-800ms`，超过 `QQBOT_SEND_MAX_QUEUE_WAIT_MS` 时拒绝本次发送，避免高频自动回复形成突发流量。
- QQBot 在线命令和自动回复规则都有运行时保底冷却：默认命令 `5000ms`、规则 `30000ms`；即使数据库里旧数据冷却值更低，也按保底值判定，降低频繁触发风控的概率。
- QQBot 复读机默认阈值为 4，同一会话默认 10 分钟只复读一次，默认只复读 120 字以内普通文本，避免群聊重复内容导致机器人过于频繁地模拟真人发言。
- QQBot 插件平台统一使用 `plugin.json` manifest 描述插件 key、版本、操作、事件、权限、运行预算和包入口；CLI 负责 create/validate/pack/install-local，后端只暴露受控 SDK 能力并通过插件维度记录安装、配置、账号绑定和运行事件。
- QQBot 同一账号只允许一个有效 NapCat 主容器；绑定新容器时会释放旧绑定和不再共享的旧容器，机器人下线 notice、`isOnline:false` 和 NapCat 容器最新离线日志都会写入账号 `lastError`，普通群成员 kick 不属于账号离线信号；写入 `last_error` 前按 500 字符截断，后续无错误的普通断连不能清空该原因；账号列表拆开展示 OneBot、容器、WebUI 和 QQ 登录态，心跳只代表 OneBot/容器通信，不能推导 QQ 登录态；近期连接只用于避免重连瞬间被旧缓存误伤，后续仍必须以 NapCat WebUI/日志检查判断 QQ 登录态；`qqLoginMessage` 只展示 QQ 登录态消息，WebUI 配置或请求错误留在 `lastError`。
- NapCat 托管容器必须显式配置 `QQBOT_NAPCAT_IMAGE`，不要依赖 `latest` 默认镜像；生产切换镜像前先 pin 明确版本或 digest 并单账号观察。
- NapCat 账号新增/编辑支持可选 QQ 登录密码：Admin 只提交 RSA-OAEP 加密后的 `encryptedLoginPassword`，后端解密后必须用显式配置的 `QQBOT_ACCOUNT_SECRET_KEY`（或非默认 `ADMIN_TOKEN_SECRET`）二次加密保存到 `qqbot_account.napcat_login_password_secret`；空值、`change-me` 和历史公开默认值会被拒绝；列表和详情不回显密码，日志会脱敏密码字段。
- NapCat 容器为已知 `selfId` 创建/重建时会注入 `ACCOUNT` 环境变量启用 `-q` 快速登录：容器重启（崩溃/重启策略/宿主重启）能从持久化会话免扫码自动重登；硬踢 `登录已失效` 会话作废仍需扫码。已绑定但缺少 `ACCOUNT` 的旧容器在下一次「更新登录」时原地重建一次补齐（保留 QQ 数据卷），`docker inspect` 已带 `ACCOUNT` 则跳过，重建失败不阻断登录。`ACCOUNT` 只负责指定快速登录账号；如果数据卷内没有该 QQ 的历史登录记录，后端会跳过快速登录并优先尝试账号保存的登录密码，密码登录会按 `QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS` / `QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS` 轮询结果，准备中的扫码会话会续期，避免后台密码登录未结束时前端先过期；如果 NapCat 返回 `proofWaterUrl` 或日志出现“需要验证码”，会保持会话 pending 并把腾讯验证码结果 `ticket`/`randstr`/`sid` 通过 `/qqbot/account/scan/captcha/submit` 回交到同一容器的 `/api/QQLogin/CaptchaLogin`，不是让用户只打开外链；密码登录成功后会移除运行态 `NAPCAT_QUICK_PASSWORD`，清理失败则本次登录失败，避免成功态残留明文 env；密码登录也失败、验证码未完成、离线、账号不匹配或缺少 QQ 号时才重置登录态并生成二维码。Admin「更新登录」的 SSE 步骤顺序按实际路径为 `quick-login-*`（已有历史会话）-> `password-login-*` / `password-login-captcha` -> `password-env-cleanup` -> `relogin-reset/qrcode/waiting-scan`。
- NapCat 离线看门狗按 `QQBOT_NAPCAT_WATCHDOG_INTERVAL_MS`（默认 `120000`，最小 `30000`，`QQBOT_NAPCAT_WATCHDOG_ENABLED=false` 关闭）定时巡检在线账号，使掉线/被踢无需管理员打开列表页即可及时发现；检测到离线后先尝试 `ACCOUNT` 历史会话快速登录，再尝试账号保存的登录密码，仍失败时写入离线原因并复用 `super` 站内信告警；看门狗不自动进入扫码阶段。
- BangDream 当前源码根目录是 `src/modules/qqbot/plugins/bangDream`；不要恢复旧 `tsugu` 层级或旧大桶目录。
- BangDream 在线命令以 `registry/operation-registry.ts` 为单一来源，新增命令必须同步 SQL/在线命令表并跑 registry/command-SQL 测试。
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
```

接口改动必须启动或复用本地服务，并真实调用一次对应接口。

## 发布

主线发布由 Jenkins 构建镜像、推送 NAS 本地 Registry，并滚动更新 K8s `kt-prod/kt-template-online-api`。推送后不能只看 Git push 成功，需要继续观察 Jenkins、K8s rollout、新 Pod 状态和至少一条真实运行态 smoke。

## 来源与许可证

| 一级来源                                                                 | 使用方式                                                                                   | License |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| [Tsugu BangDream Bot](https://github.com/Yamamoto-2/tsugu-bangdream-bot) | BangDream QQBot 后端能力已重构合入 `src/modules/qqbot/plugins/bangDream`，保留本地 `TSUGU-LICENSE` | MIT     |
