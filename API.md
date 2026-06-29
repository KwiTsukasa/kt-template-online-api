# KT Template Online API

本文是当前 API 的人工索引。字段细节、Swagger 示例和 DTO 以运行态 Swagger/Knife4j 为准：

- 全量 Swagger：`/api`
- OpenAPI JSON：`/api-json`
- Admin 分组：`/api/admin`
- QQBot 分组：`/api/qqbot`
- WordPress 分组：`/api/wordpress`
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

Admin、Component、Dict、MinIO、Blog 管理、WordPress 管理和 QQBot 管理接口默认需要后台登录态。

支持两种 access token 传递方式：

- `Authorization: Bearer <accessToken>`
- 登录接口写入的 httpOnly `admin_access_token` cookie

公开接口包括 `/auth/login`、`/auth/refresh`、`/auth/logout`、部分 Blog public 接口和根路径。具体以 Controller 上的 `@Public()` 为准。

### ID 与时间

- 后台主键使用 Snowflake 数字 ID，接口按字符串返回，避免 JavaScript 长整型精度丢失。
- 后端格式化时间字段统一使用 `KtDateTime extends Date`：Entity 通过 `@KtDateTimeColumn(format)`、`@KtCreateDateColumn(format)`、`@KtUpdateDateColumn(format)` 在 TypeORM hydrate 边界转换；DTO/外部数据源通过 `@KtDateTimeField(format)` + `transformKtDateTimeFields()` 转换。默认输出 `YYYY-MM-DD HH:mm:ss`，可在装饰器中传入格式字符串；响应包装不做递归遍历。
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

公开响应不返回数据库、WordPress、Loki、NapCat SSH 等运行拓扑配置快照；配置检查只暴露 key 级别、是否存在和缺失说明。

状态含义：

- `live`：NestJS 进程能响应健康请求。
- `ready`：关键配置存在，当前检查未发现缺失项。
- `degraded`：可选运行时配置缺失，核心 API 可继续工作。
- `blocked`：关键运行时配置缺失，不能声明部署或运行态成功。

## Admin Environment Dashboard

| 方法   | 路径                                | 认证 | 说明                                              |
| ------ | ----------------------------------- | ---- | ------------------------------------------------- |
| `GET`  | `/system/environment/dashboard`     | 是   | 返回 local-dev、NAS 线上、腾讯云、r4se 环境快照   |
| `POST` | `/system/environment/self-check`    | 是   | 触发只读自检并返回最新环境快照                    |
| `GET`  | `/system/environment/events/stream` | 是   | SSE 推送后端环境事件，支持 `lastEventId` 查询参数 |

环境总览接口使用 `Site -> Node -> Service -> Signal` 模型聚合状态，`unwired` 表示只读观测尚未配置，`unknown` 表示已知入口但缺少新鲜证据。Admin 首次加载通过 HTTP 获取快照，后续通过 API SSE 接收 local/MQTT 事件；前端不直接连接 MQTT，也不使用定时轮询。

当前版本只提供观测和只读自检。重启 Pod、触发 Jenkins 部署、执行迁移、重建 NapCat 容器、启停插件、立即执行插件任务、修改 Caddy/OpenClash/WireGuard/Tencent Cloud 等高风险能力只会以禁用动作展示，后端不提供通用写动作入口。

## 环境变量分组

| 分组          | 关键变量                                                                                                                                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL         | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC`                                                                                                                                                                                                                                                |
| MinIO         | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`                                                                                                                                                                                                                                      |
| Admin         | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID`                                                                                                                                                                                                                               |
| WordPress     | `WORDPRESS_BASE_URL`、`WORDPRESS_HOST_HEADER`、`WORDPRESS_ADMIN_USERNAME`、`WORDPRESS_ADMIN_PASSWORD`                                                                                                                                                                                                                       |
| Loki          | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_QUERY_SELECTOR`                                                                                                                                                                                                                                           |
| QQBot         | `QQBOT_ENABLED`、`QQBOT_ACCOUNT_SECRET_KEY`、`QQBOT_REVERSE_WS_PATH`、`QQBOT_REVERSE_WS_TOKEN`、`QQBOT_EVENT_BUS`、`QQBOT_SEND_*`、`QQBOT_PLUGIN_QUEUE_REDIS_*`、`QQBOT_PLUGIN_TASK_QUEUE_REDIS_*`、`QQBOT_PLUGIN_QUEUE_WAIT_TIMEOUT_MS`、`QQBOT_COMMAND_MIN_COOLDOWN_MS`、`QQBOT_RULE_MIN_COOLDOWN_MS`、`QQBOT_REPEATER_*` |
| NapCat        | `NAPCAT_WEBUI_BASE_URL`、`NAPCAT_WEBUI_TOKEN`、`QQBOT_NAPCAT_*`                                                                                                                                                                                                                                                             |
| MQTT          | `MQTT_URL`、`MQTT_USERNAME`、`MQTT_PASSWORD`、`MQTT_CLIENT_ID`                                                                                                                                                                                                                                                              |
| Env Dashboard | `ENV_DASHBOARD_CACHE_TTL_MS`、`ENV_DASHBOARD_SIGNAL_TIMEOUT_MS`、`ENV_DASHBOARD_EVENT_BUS`、`ENV_DASHBOARD_MQTT_*`、`ENV_DASHBOARD_SSE_*`、`ENV_DASHBOARD_JENKINS_*`、`ENV_DASHBOARD_K8S_*`、`ENV_DASHBOARD_TENCENT_*`、`ENV_DASHBOARD_CADDY_*`、`ENV_DASHBOARD_R4SE_*`                                                     |
| BangDream     | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT`                                                                                                                                                                                                                            |
| FF14 Market   | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_DEFAULT_WORLD`                                                                                                                                                                                                                                                   |
| FFLogs        | `FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET`                                                                                                                                                                                                                                        |

真实密码、Token、OAuth secret 和生产 env 不提交到 Git。

Env Dashboard 的 `ENV_DASHBOARD_ADMIN_LOCAL_URL` / `ENV_DASHBOARD_ADMIN_PUBLIC_URL` 只作为 Admin 入口展示证据；Jenkins、K8s、Tencent Cloud、Caddy、WireGuard、Mihomo/OpenClash 仍通过对应 `ENV_DASHBOARD_*` 只读配置接入，缺失配置必须返回 `unwired` 证据。

QQBot 插件 worker 队列依赖 Redis。K8s 生产清单提供内部 Redis Service `kt-qqbot-plugin-redis:6379`，用于 `QQBOT_PLUGIN_QUEUE_REDIS_HOST` / `QQBOT_PLUGIN_QUEUE_REDIS_PORT`。`QQBOT_PLUGIN_QUEUE_WAIT_TIMEOUT_MS` 控制串行队列的排队等待窗口，避免排队时间挤占插件操作本身的 `timeoutMs` 执行预算。插件定时任务可通过 `QQBOT_PLUGIN_TASK_QUEUE_REDIS_*` 使用独立 BullMQ prefix；未配置 host 时复用插件 worker Redis 连接。

## Admin 与基础后台

### Auth / User

| 方法   | 路径            | 说明                                                                                  |
| ------ | --------------- | ------------------------------------------------------------------------------------- |
| `POST` | `/auth/login`   | 后台登录，返回 accessToken、用户信息和 WordPress 自动登录状态，并写入 httpOnly cookie |
| `POST` | `/auth/refresh` | 通过 refresh token cookie 刷新 accessToken                                            |
| `POST` | `/auth/logout`  | 清理 Admin 与 WordPress 登录 cookie                                                   |
| `GET`  | `/auth/codes`   | 获取当前用户按钮权限码                                                                |
| `GET`  | `/user/info`    | 获取当前用户信息                                                                      |

`/auth/login` 会尝试用 env 中的 WordPress 管理员账号建立 WordPress 登录态。WordPress 不可用时，Admin 主登录仍成功，返回 `wordpressAuth=null`、`wordpressAvailable=false`，菜单和权限码会过滤 Blog 管理入口。

### Menu / Role / Dept / User Manage

| 方法     | 路径                       | 说明               |
| -------- | -------------------------- | ------------------ |
| `GET`    | `/menu/all`                | 当前用户菜单       |
| `GET`    | `/system/menu/list`        | 系统菜单树         |
| `GET`    | `/system/menu/name-exists` | 菜单 name 重名校验 |
| `GET`    | `/system/menu/path-exists` | 菜单 path 重名校验 |
| `POST`   | `/system/menu`             | 新增菜单           |
| `PUT`    | `/system/menu/:id`         | 更新菜单           |
| `DELETE` | `/system/menu/:id`         | 删除菜单及子菜单   |
| `GET`    | `/system/role/list`        | 角色分页           |
| `POST`   | `/system/role`             | 新增角色           |
| `PUT`    | `/system/role/:id`         | 更新角色           |
| `DELETE` | `/system/role/:id`         | 删除角色           |
| `GET`    | `/system/dept/list`        | 部门树             |
| `POST`   | `/system/dept`             | 新增部门           |
| `PUT`    | `/system/dept/:id`         | 更新部门           |
| `DELETE` | `/system/dept/:id`         | 删除部门           |
| `GET`    | `/system/user/list`        | 用户分页           |
| `POST`   | `/system/user`             | 新增用户           |
| `PUT`    | `/system/user/:id`         | 更新用户           |
| `DELETE` | `/system/user/:id`         | 删除用户           |

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

站内信用于承接运行期事件，不再作为人工公告入口。后端在接口 5xx、QQBot OneBot 下线 notice、NapCat 容器日志检测到账户离线时自动生成或聚合一条通知，默认通知 `super` 角色；站内信接口在服务端也强制 `super` 角色访问。相同 `dedupeKey` 的事件通过 `active_dedupe_key` 唯一索引聚合，会累加 `occurrenceCount`，刷新 `lastSeenAt`，并把状态重新置为未处理。运行期通知会按表字段长度归一化 `title`、`dedupeKey`、`source`、`eventType` 和 `notifyRoleCode`，长 `dedupeKey` 会保留稳定 hash 后缀，避免长路径接口错误丢通知。

| 方法     | 路径                        | 说明                                                                                                                                              |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/system/notice/list`       | 日志级站内信分页列表，支持 `keyword`、`severity`、`source`、`eventType`、`status`、`isTop`、`notifyRoleCode`、`notifyUsers`、`pageNo`、`pageSize` |
| `GET`    | `/system/notice/detail/:id` | 查询站内信详情                                                                                                                                    |
| `DELETE` | `/system/notice/:id`        | 删除站内信（逻辑删除）                                                                                                                            |
| `POST`   | `/system/notice/toggle`     | 标记处理或重新打开（`id`、`status`，`1` 未处理，`0` 已处理）                                                                                      |
| `POST`   | `/system/notice/top`        | 切换置顶（`id`、`isTop`）                                                                                                                         |

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
| `POST` | `/blog/article/import-wordpress` | 从 WordPress 导入文章      |

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

| 方法   | 路径                           | 说明                      |
| ------ | ------------------------------ | ------------------------- |
| `GET`  | `/blog/category/list`          | 本地分类分页              |
| `GET`  | `/blog/category/detail`        | 本地分类详情              |
| `POST` | `/blog/category/save`          | 新增分类                  |
| `POST` | `/blog/category/update`        | 更新分类                  |
| `POST` | `/blog/category/remove`        | 删除分类                  |
| `GET`  | `/blog/tag/list`               | 本地标签分页              |
| `GET`  | `/blog/tag/detail`             | 本地标签详情              |
| `POST` | `/blog/tag/save`               | 新增标签                  |
| `POST` | `/blog/tag/update`             | 更新标签                  |
| `POST` | `/blog/tag/remove`             | 删除标签                  |
| `GET`  | `/blog/term/options`           | 分类/标签选项             |
| `GET`  | `/blog/theme/config`           | 获取 Argon 主题配置       |
| `POST` | `/blog/theme/save`             | 保存本地主题配置          |
| `POST` | `/blog/theme/import-wordpress` | 从 WordPress 导入主题配置 |

## WordPress 代理

`/wordpress/*` 需要 Admin 登录态和 WordPress 登录态。后端优先使用 `kt_wordpress_auth` httpOnly cookie，也支持显式透传 WordPress 认证 header。

| 方法   | 路径                      | 说明                                            |
| ------ | ------------------------- | ----------------------------------------------- |
| `POST` | `/wordpress/auth/login`   | 使用 env 管理员账号登录 WordPress 并写入 cookie |
| `POST` | `/wordpress/auth/logout`  | 清理 WordPress cookie                           |
| `GET`  | `/wordpress/auth/check`   | 校验 WordPress 登录态                           |
| `GET`  | `/wordpress/theme/config` | 读取 WordPress Argon 主题配置                   |

### WordPress Article / Tag / Category

| 方法   | 路径                               | 说明                |
| ------ | ---------------------------------- | ------------------- |
| `GET`  | `/wordpress/article/public/list`   | 公开文章列表代理    |
| `GET`  | `/wordpress/article/public/detail` | 公开文章详情代理    |
| `GET`  | `/wordpress/article/list`          | WordPress 文章分页  |
| `GET`  | `/wordpress/article/detail`        | WordPress 文章详情  |
| `POST` | `/wordpress/article/save`          | 新增 WordPress 文章 |
| `POST` | `/wordpress/article/update`        | 更新 WordPress 文章 |
| `POST` | `/wordpress/article/remove`        | 删除 WordPress 文章 |
| `GET`  | `/wordpress/tag/list`              | 标签分页            |
| `GET`  | `/wordpress/tag/detail`            | 标签详情            |
| `POST` | `/wordpress/tag/save`              | 新增标签            |
| `POST` | `/wordpress/tag/update`            | 更新标签            |
| `POST` | `/wordpress/tag/remove`            | 删除标签            |
| `GET`  | `/wordpress/category/list`         | 分类分页            |
| `GET`  | `/wordpress/category/detail`       | 分类详情            |
| `POST` | `/wordpress/category/save`         | 新增分类            |
| `POST` | `/wordpress/category/update`       | 更新分类            |
| `POST` | `/wordpress/category/remove`       | 删除分类            |

WordPress rewrite 未开启导致 `/wp-json/*` 返回 404 时，后端会回退到 `?rest_route=/...`。

## MinIO

| 方法     | 路径                    | 说明                            |
| -------- | ----------------------- | ------------------------------- |
| `GET`    | `/minio/check`          | 检查连接和 bucket               |
| `POST`   | `/minio/bucket`         | 创建 bucket                     |
| `POST`   | `/minio/upload`         | 上传文件，`multipart/form-data` |
| `GET`    | `/minio/list`           | 文件列表                        |
| `GET`    | `/minio/url`            | 临时访问 URL                    |
| `GET`    | `/minio/resource-proxy` | 代理读取资源                    |
| `GET`    | `/minio/download`       | 下载文件流                      |
| `DELETE` | `/minio/remove`         | 删除文件                        |

`bucketName` 不传时使用 `MINIO_BUCKET`。

## QQBot 管理

QQBot 运行态包括 NapCat 容器登录、OneBot v11 反向 WebSocket、MQTT 事件总线、账号能力绑定、在线命令、自动回复规则、权限名单、发送/接收日志和插件生态。

### Account / Scan Login

| 方法   | 路径                                            | 说明                       |
| ------ | ----------------------------------------------- | -------------------------- |
| `GET`  | `/qqbot/account/list`                           | QQBot 账号分页             |
| `GET`  | `/qqbot/account/enabled`                        | 启用账号列表               |
| `POST` | `/qqbot/account/save`                           | 手动新增账号               |
| `POST` | `/qqbot/account/update`                         | 更新账号                   |
| `POST` | `/qqbot/account/scan/create`                    | 扫码新增账号，创建登录会话 |
| `POST` | `/qqbot/account/scan/refresh?id=`               | 对已有账号刷新登录态       |
| `GET`  | `/qqbot/account/scan/status?sessionId=`         | 查询扫码会话状态           |
| `GET`  | `/qqbot/account/scan/events?sessionId=`         | SSE 订阅扫码进度           |
| `POST` | `/qqbot/account/scan/qrcode/refresh?sessionId=` | 刷新当前会话二维码         |
| `POST` | `/qqbot/account/scan/captcha/submit`            | 提交密码登录安全验证码结果 |
| `POST` | `/qqbot/account/scan/cancel?sessionId=`         | 取消扫码会话               |
| `POST` | `/qqbot/account/delete?id=`                     | 删除账号并断开 WS          |
| `POST` | `/qqbot/account/kick?selfId=`                   | 断开反向 WS 会话           |
| `GET`  | `/qqbot/napcat/runtime/detail?accountId=`       | 读取账号 NapCat 运行态证据 |
| `POST` | `/qqbot/account/bind/command`                   | 绑定账号和在线命令         |
| `POST` | `/qqbot/account/unbind/command`                 | 解绑账号和在线命令         |
| `POST` | `/qqbot/account/bind/rule`                      | 绑定账号和自动回复规则     |
| `POST` | `/qqbot/account/unbind/rule`                    | 解绑账号和自动回复规则     |

账号保存支持可选 `encryptedLoginPassword`，用于 NapCat 密码登录。前端必须先通过 `/auth/password-public-key` 获取公钥并使用 RSA-OAEP 加密，不传明文 `loginPassword`；后端必须使用显式配置的 `QQBOT_ACCOUNT_SECRET_KEY`（或非默认 `ADMIN_TOKEN_SECRET`）二次加密落库，空值和公开默认值会被拒绝，不在列表/详情中返回。账号列表里的 `connectStatus` 只表示 OneBot 反向 WS；`napcat.oneBotOnline`、`napcat.containerOnline`、`napcat.webuiOnline`、`napcat.qqLoginStatus`、`napcat.qqLoginMessage` 分别表示 OneBot、容器、WebUI 和 QQ 登录态，`webuiOnline=null` 表示本次使用缓存且未重新探测 WebUI；`qqLoginMessage` 只承载真实 QQ 登录态消息，WebUI 配置缺失或请求异常只放在 `lastError`。

扫码链路返回 `sessionId`，前端应使用 SSE 查看步骤进度，而不是等待长 HTTP 请求完成；新增账号扫码会先预留容器和临时设备身份后立即返回 pending，会话后台再启动远端 Docker 和生成二维码。`CheckLoginStatus.isLogin=true` 只表示 NapCat 登录阳性，新增账号必须继续等 `GetQQLoginInfo` 返回 `uin/selfId` 后才允许创建和绑定真实 QQ 号；短暂缺号时 `/qqbot/account/scan/status` 保持同一会话 pending 并显示正在读取 QQ 号，等待 `NAPCAT_LOGIN_SELF_ID_WAIT_MS`，不得重建容器、补 env 或从容器元数据猜号。已有账号的更新登录不会通过 Docker 重建、重启或补 env 来刷新 QQ 登录态；如果目标容器仍在线，即使 QQ 账号已离线，也会保持同一容器并通过 NapCat WebUI 推进原有弹窗流程。若 WebUI 明确返回 QQ 离线，API 会先调用同容器 `/api/QQLogin/RestartNapCat` 重启 NapCat worker 以重建 QQCore login service，再继续 `SetQuickLogin`、`PasswordLogin`、`RefreshQRcode` / `GetQQLoginQrcode`；这不是 Docker 容器重建/重启，设备身份、env 和 dataDir 不变，同一个更新登录 session 只消费一次 worker restart 预算，后续轮询继续刷新二维码但不得反复重启 worker。只有 Docker 容器离线或缺失时，容器准备阶段才会创建/重建容器，并在创建时一次性注入 `ACCOUNT` 和必要登录 env；已在线的源容器不补 env。快速登录失败后，如果账号保存了登录密码，后端使用解密后的密码计算 MD5 调用 `/api/QQLogin/PasswordLogin`，不会把密码写回运行态 env，也没有成功后的 env 清理步骤；密码登录结果按 `QQBOT_NAPCAT_PASSWORD_LOGIN_WAIT_MS` / `QQBOT_NAPCAT_LOGIN_POLL_INTERVAL_MS` 轮询。准备阶段的扫码会话会持续续期，避免后台登录未完成时前端先判过期。同一账号已有 pending 更新登录会话时，重复调用 `/qqbot/account/scan/refresh` 通常会返回原 `sessionId`，不会再次启动 quick/password/二维码准备；但当这条 pending 会话创建时账号还没有保存登录密码、且会话尚未进入密码验证码或新设备验证上下文，而账号后来通过编辑维护了登录密码时，API 必须退役旧无密码会话并新建 refresh session，重新读取最新密码后进入 `PasswordLogin`。取消扫码会话必须在接口返回前把持久化 `napcat_login_session` 落到非 pending 终态并写入完成时间，避免已取消的测试二维码从 DB 恢复成可轮询会话。若 API Pod 在准备阶段重启，持久化的 `preparingRelogin` 超过 `QQBOT_NAPCAT_RELOGIN_PREPARING_STALE_MS`（留空使用密码等待窗口加缓冲）后，`/qqbot/account/scan/status` 会自动恢复普通登录态检测，不再永久停留在“正在尝试密码登录”；`/qqbot/account/scan/events` 在进程内事件缓存丢失时会先推送当前会话快照。pending refresh 会话如果没有二维码、验证码或新设备挑战，`/qqbot/account/scan/status` 会按 `NAPCAT_LOGIN_QR_AUTO_REFRESH_COOLDOWN_MS` 冷却在同一容器自动重试 `RefreshQRcode/GetQQLoginQrcode`，避免 SSE 长时间卡在“二维码生成中”。密码登录触发 QQ 安全验证时，接口返回的 `captchaUrl` 只用于前端拉起腾讯验证码；前端必须把腾讯验证码返回的 `ticket`、`randstr`、`sid` 连同 `sessionId` 提交到 `/qqbot/account/scan/captcha/submit`，后端再代理到同一 NapCat 容器的 `/api/QQLogin/CaptchaLogin` 继续密码登录第二步。验证码和新设备验证这类真人交互态使用 `NAPCAT_LOGIN_HUMAN_VERIFY_EXPIRE_MS`（默认 15 分钟，且至少不短于普通二维码 TTL）续期；普通登录二维码仍使用 `NAPCAT_LOGIN_QR_EXPIRE_MS`。`/qqbot/account/scan/status` 遇到 NapCat 只返回“需要验证码/继续完成验证/安全验证”但不带 URL 时，会先从当前容器日志提取 `proofWaterUrl`，提取不到则保持验证码处理中而不切到二维码兜底；会话已有 `captchaUrl` 后，同类状态仍保持 `pending` 和原 `captchaUrl`。密码登录仍失败、验证码未完成、离线、账号不匹配或缺少 QQ 号时，直接通过 WebUI 二维码接口进入扫码兜底，不 reset 登录态。看门狗只做离线巡检、账号错误写入和 `super` 站内信告警，不会触发 quick/password 登录或扫码登录。

密码验证码通过后如果 NapCat 返回 `needNewDevice`，后端不会只把 `jumpUrl` 透给 Admin，而是在同一会话中继续调用 `/api/QQLogin/GetNewDeviceQRCode` 生成新设备验证二维码；`/qqbot/account/scan/status` 后续轮询会代理 `/api/QQLogin/PollNewDeviceQR`，状态映射为 `newDeviceStatus=qr-pending|scanned|confirming|verified|expired|failed`，进入确认态后再调用 `/api/QQLogin/NewDeviceLogin` 并回到密码登录完成检查。扫码会话结果新增 `newDeviceQrcode`、`newDeviceStatus`、`deviceVerifyUrl` 字段；`captchaUrl` 和 `newDeviceQrcode` 分别表示腾讯安全验证码和 QQ 新设备验证二维码，前端必须分开展示。SSE 进度文案包含快速登录、密码登录、验证码、新设备二维码、已扫码、确认中、二维码兜底、登录成功/失败。

同一 QQ 账号只保留一个有效 NapCat 主容器。扫码后如果已有账号绑定到新容器，后端会释放旧绑定和未共享的旧容器，避免同账号多实例互相挤下线。OneBot notice 只有机器人下线、登录失效、`KickedOffLine` 等账号级信号才会记录 QQ 登录态异常并生成 `qqbot.account.offline` 站内信，普通群成员 kick 不属于账号离线信号。下线原因写入 `lastError` 前按 `last_error` 500 字符列宽截断；后续无错误的普通断连只更新 OneBot 连接状态，不清空该原因。账号列表会按近期缓存检查绑定 NapCat 容器的最新登录状态日志，日志检测默认 5 秒超时；`isOnline:false` 属于 QQ 登录态离线信号；心跳只代表 OneBot/容器通信，不能推导 QQ 登录态；近期连接只用于避免重连瞬间被旧缓存误伤，后续仍必须以 NapCat WebUI/日志检查判断 QQ 登录态。托管容器必须显式配置 `QQBOT_NAPCAT_IMAGE`，不要依赖 `latest` 默认镜像。

托管 NapCat 容器按账号持久化设备身份，`napcat_device_identity` 保存账号对应的数据目录、hostname、machine-id 路径、MAC 地址、验证状态和最近登录证据。重建同一账号容器时会复用 `pc-<8hex>` hostname、实体 OUI 风格 MAC 和 machine-id，并明确排除 Docker `02:42`、QEMU/KVM `52:54:00`、VMware、Hyper-V 等虚拟化前缀；新增账号创建期在真实 QQ selfId 未知时使用预留容器 id 创建临时设备身份，第一次 Docker run 就注入完整拟真参数，扫码成功后再把该身份和 runtime/protocol profile 归属到真实账号。Docker run 会注入 `--hostname`、`--mac-address`、只读 `/etc/machine-id` 挂载、`SYS_ADMIN`、`apparmor=unconfined`、`seccomp=unconfined` 和 `NAPCAT_REQUIRE_DEVICE_PROFILE=1`；后端还会同步写入 QQNT Linux `machine-info`，让 QQNT 计算 GUID 时使用的 MAC 与 Docker 网卡一致。派生镜像 entrypoint 会用同一设备 profile 覆盖 QQCore 实际打开的 DMI、boot_id、kernel release/version/proc version、CPU model、uptime、TTY active、mountinfo、`/etc/hosts` 和 `/proc/devices` 等探针；NapCat fork native login 和 core session config 的 `machineId` 与 `systemVersion` 也从该 profile 读取，避免 QQ native 入参和 Docker 可见探针不一致。当前策略名为 `qqnt-visible-hostname-v1` / `physical-oui-mac-v1`，绑定关系会回填 `napcat_account_binding.device_identity_id`。

### NapCat Runtime Profile

| 方法  | 路径                                      | 说明                                                                                  |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET` | `/qqbot/napcat/runtime/detail?accountId=` | 读取账号 NapCat runtime/protocol/session behavior profile、风险降载和历史登录事件兼容表状态 |

该接口只返回脱敏后的运行态证据，供 Admin 排查镜像、locale、shm、配置 hash、漂移状态、风险模式和 watchdog 巡检告警状态；不会返回 WebUI token、reverse WS token、QQ 登录密码、SSH 私钥或运行态密码环境。账号列表只挂载 `napcat.profileStatus`、`napcat.runtimeProfile` 等摘要字段，不触发登录、重建或修复动作。watchdog 不执行登录恢复：遇到 QQ 登录态离线只记录离线原因并通知 `super`，登录恢复统一由 Admin 手动「更新登录」触发；session behavior profile 只做冷启动、housekeeping、presence 和自动能力分阶段降载，不实现账号级每小时/每日累计发送预算。

NapCat Chinese Desktop Runtime 使用 KT `NapCatQQ` fork 源码构建出的 `NapCat.Shell` artifact，并在 QQ `KickedOffLine` 后重置 native login service 再请求二维码；同一次踢下线事件只消费一次 reset，明确二维码过期或扫码确认窗口失效的 QR session failure 会自动换码，其他非自动重试 QR failure 会标记下次 WebUI 登录动作先重置 native login service。v14 起运行时会为 QQ/NapCat/Xvfb 长期进程做 PID 级 `/proc/<pid>/mountinfo` 遮蔽，避免 QQCore 通过 `/proc/self/mountinfo` 看到 `overlay`、`/vol1/docker`、`docker-init`、`/docker/containers`、`napcat-instances`、`btrfs`、`/dev/mapper/trim` 等宿主路径；v15 在扫码登录成功回调中先写入 `QQLoginInfo` 再写登录态，避免 API 读到 `isLogin=true` 但 QQ 号为空的短暂不一致；v16 在 native reset 缺少 `offline()` 时改用 `destroy()` 硬重置半登录服务，并让镜像 verify 等待 mountinfo guard 收敛；v17/v18 增加 WebUI 鉴权的 `/api/Debug/RuntimeViewProbe` 同进程诊断并修正 native maps 截断导致的 hook 证据假阴性；v19 保留 WebUI `RestartNapCat` 重启 worker 时的 `-q <uin>` 快速登录参数，避免重启后退回无账号扫码；v20 保护 API 预写的 `/app/napcat/config`，避免上游首次解包 `NapCat.Shell/*` 覆盖 `bypass.*=true` 与 `o3HookMode=0`。构建前必须运行 `scripts/napcat-desktop-cn-stage-build.mjs` 生成 Docker build context；生产 `QQBOT_NAPCAT_IMAGE` 应指向验证过的 `kt-napcat-desktop-cn:*` digest。生产 K8s manifest 保留 `kt-napcat-desktop-cn:desktop-cn-v20` / `desktop-cn-v20` 稳定默认值；Jenkins `QQBOT_NAPCAT_IMAGE_OVERRIDE` 与 `QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION_OVERRIDE` 只有非空时才覆盖 API Deployment env，空值会保持 manifest/default env。运行时回滚应重新运行 Jenkins 并填入上一版镜像 digest/profile，或清空两个 override 后重新部署回 manifest 默认值。

API 仓库不提交 `NapCat.Shell.zip`；生产镜像必须从 staged context 构建，且 `fork-artifact.json` 必须包含完整 marker metadata：upstream release tag/commit、fork commit、base image digest、Jenkins URL 和 artifact hashes。NapCat base image 在 release evidence 中必须 pin 到 digest。API Jenkins 只做显式参数推广，不负责自动合并上游、自动构建运行时镜像或在 override 为空时隐式改写 NapCat env。

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --upstream-release-tag v4.8.0 `
  --upstream-release-commit 0000000000000000000000000000000000000000 `
  --napcat-base-image-digest mlikiowa/napcat-docker@sha256:0000000000000000000000000000000000000000000000000000000000000000 `
  --jenkins-build-url https://jenkins.kwitsukasa.top/job/KT-NapCatQQ-Runtime-Release/1/
```

### NapCat WebUI Gateway

NapCat WebUI Gateway 是独立部署的内部代理服务，生产镜像由 `dockerfile.gateway` 打包 `dist/apps/napcat-webui-gateway/main.js`，K8s 服务名为 `kt-napcat-webui-gateway`，端口 `48086`。API 侧只通过内部路由 `NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL` 创建、续期、撤销会话和交换一次性 ticket；浏览器只访问公开前缀 `NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL` 下的代理页面、静态资源和 WebSocket 转发，不能直连 NapCat 容器 WebUI。

Gateway 只改写 NapCat HTML/JS/CSS 中需要浏览器直连的绝对根路径：`/webui/*`、`/api/*`、`/files/*` 和 `/plugin/*`。NapCat 文件管理的 `File` 路由属于 axios `baseURL="/api"` 下的 API 子路径，页面源码里的 `"/File/list"` 必须保持原样，由浏览器最终请求 `/api/File/list`；不能把 `/File/*` 当作独立静态根路径改写到 Gateway session 前缀，否则会形成 `/webui/api/napcat-webui/session/.../File/list` 并让文件管理拿到 HTML。

必需环境变量：`NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL`、`NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL`、`NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET`、`NAPCAT_WEBUI_GATEWAY_REDIS_HOST`、`NAPCAT_WEBUI_GATEWAY_REDIS_PORT`、`NAPCAT_WEBUI_GATEWAY_SESSION_TTL_MS`、`NAPCAT_WEBUI_GATEWAY_TICKET_TTL_MS`、`NAPCAT_WEBUI_GATEWAY_UPSTREAM_TIMEOUT_MS`。生产 `NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` 只来自 Jenkins 私有 `.env.production` 生成的 `kt-template-online-api-env` Secret，不写入 Git 或 manifest 字面量。

部署验收使用：`pnpm exec jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand`、`pnpm run typecheck`、`pnpm run build`、`Test-Path .\dist\apps\napcat-webui-gateway\main.js`、`git diff --check`。安全验收要求浏览器永远不接收 WebUI token、Credential、上游 URL/端口、Docker 拓扑、Redis 地址或内部 secret。

`napcat_login_event` 实体和表仅作为历史 schema 兼容保留；watchdog 不再写入 quick/password 恢复事件，也不再依赖该表判断是否恢复登录。

外发消息不直接抢发：后端会按 `QQBOT_SEND_GLOBAL_INTERVAL_MS`、`QQBOT_SEND_TARGET_INTERVAL_MS` 和 `QQBOT_SEND_JITTER_MS` 预约发送窗口，默认全局 2500ms、同会话 8000ms、抖动 0-800ms；如果等待超过 `QQBOT_SEND_MAX_QUEUE_WAIT_MS`，本次发送会在下发前被拒绝。在线命令和自动回复规则会叠加运行时保底冷却，默认命令 5000ms、规则 30000ms；复读机默认连续 4 次相同普通文本才触发，同一会话默认 10 分钟内只复读一次，并限制普通文本长度，减少自动行为被风控识别的概率。

### Command / Rule / Permission

| 方法   | 路径                                     | 说明                                                                |
| ------ | ---------------------------------------- | ------------------------------------------------------------------- |
| `GET`  | `/qqbot/command/list`                    | 在线命令分页，支持 `pluginKey`、`operationKey`、`selfId`、`enabled` |
| `POST` | `/qqbot/command/save`                    | 新增在线命令                                                        |
| `POST` | `/qqbot/command/update`                  | 更新在线命令                                                        |
| `POST` | `/qqbot/command/delete?id=`              | 删除在线命令                                                        |
| `POST` | `/qqbot/command/toggle?id=&enabled=`     | 启停在线命令                                                        |
| `POST` | `/qqbot/command/test`                    | 预览测试在线命令                                                    |
| `GET`  | `/qqbot/rule/list`                       | 自动回复规则分页                                                    |
| `POST` | `/qqbot/rule/save`                       | 新增自动回复规则                                                    |
| `POST` | `/qqbot/rule/update`                     | 更新自动回复规则                                                    |
| `POST` | `/qqbot/rule/delete?id=`                 | 删除自动回复规则                                                    |
| `POST` | `/qqbot/rule/toggle?id=&enabled=`        | 启停自动回复规则                                                    |
| `GET`  | `/qqbot/permission/config`               | 权限名单配置                                                        |
| `POST` | `/qqbot/permission/config`               | 保存权限名单配置                                                    |
| `GET`  | `/qqbot/permission/allowlist`            | 白名单分页                                                          |
| `POST` | `/qqbot/permission/allowlist/save`       | 新增白名单                                                          |
| `POST` | `/qqbot/permission/allowlist/update`     | 更新白名单                                                          |
| `POST` | `/qqbot/permission/allowlist/delete?id=` | 删除白名单                                                          |
| `GET`  | `/qqbot/permission/blocklist`            | 黑名单分页                                                          |
| `POST` | `/qqbot/permission/blocklist/save`       | 新增黑名单                                                          |
| `POST` | `/qqbot/permission/blocklist/update`     | 更新黑名单                                                          |
| `POST` | `/qqbot/permission/blocklist/delete?id=` | 删除黑名单                                                          |

`/qqbot/command/test` 示例：

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

| 方法   | 路径                           | 说明                                       |
| ------ | ------------------------------ | ------------------------------------------ |
| `GET`  | `/qqbot/plugin/list`           | 插件列表，支持 `triggerMode=command/event` |
| `GET`  | `/qqbot/plugin/operation/list` | 插件能力列表                               |
| `GET`  | `/qqbot/plugin/health`         | 插件健康检查                               |
| `GET`  | `/qqbot/plugin/event/list`     | 事件触发插件绑定状态                       |
| `POST` | `/qqbot/plugin/event/bind`     | 绑定事件触发插件                           |
| `POST` | `/qqbot/plugin/event/unbind`   | 解绑事件触发插件                           |
| `GET`  | `/qqbot/dashboard/summary`     | QQBot 工作台汇总                           |
| `GET`  | `/qqbot/send/log/list`         | 发送日志分页                               |
| `POST` | `/qqbot/send/private`          | 发送私聊消息                               |
| `POST` | `/qqbot/send/group`            | 发送群聊消息                               |
| `GET`  | `/qqbot/conversation/list`     | 会话列表                                   |
| `GET`  | `/qqbot/message/list`          | 消息列表                                   |

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
pnpm qqbot-plugin create <pluginKey>
pnpm qqbot-plugin validate <pluginDir>
pnpm qqbot-plugin pack <pluginDir>
pnpm qqbot-plugin install-local <packageFile>
```

平台管理接口：

| 方法   | 路径                                      | 说明                               |
| ------ | ----------------------------------------- | ---------------------------------- |
| `GET`  | `/qqbot/plugin-platform/installations`    | 插件安装记录，支持 key/status 过滤 |
| `POST` | `/qqbot/plugin-platform/upload`           | 上传插件包并返回校验摘要           |
| `POST` | `/qqbot/plugin-platform/validate`         | 校验 manifest JSON                 |
| `POST` | `/qqbot/plugin-platform/install`          | 按上传包安装插件版本               |
| `POST` | `/qqbot/plugin-platform/install-local`    | 按本地包路径安装插件版本           |
| `POST` | `/qqbot/plugin-platform/enable`           | 启用插件安装                       |
| `POST` | `/qqbot/plugin-platform/disable`          | 禁用插件安装                       |
| `POST` | `/qqbot/plugin-platform/upgrade`          | 升级插件安装版本                   |
| `POST` | `/qqbot/plugin-platform/uninstall`        | 卸载插件安装                       |
| `POST` | `/qqbot/plugin-platform/config`           | 保存插件配置                       |
| `GET`  | `/qqbot/plugin-platform/runtime-events`   | 查询插件运行事件                   |
| `GET`  | `/qqbot/plugin-platform/account-bindings` | 查询插件账号绑定                   |

定时任务管理接口：

| 方法   | 路径                                       | 说明                                 |
| ------ | ------------------------------------------ | ------------------------------------ |
| `GET`  | `/qqbot/plugin-platform/tasks/page`        | 插件定时任务分页，支持插件、状态过滤 |
| `GET`  | `/qqbot/plugin-platform/tasks/:id`         | 任务详情                             |
| `POST` | `/qqbot/plugin-platform/tasks/:id/enable`  | 启用任务并注册 BullMQ Job Scheduler  |
| `POST` | `/qqbot/plugin-platform/tasks/:id/disable` | 停用任务并移除调度                   |
| `POST` | `/qqbot/plugin-platform/tasks/:id/cron`    | 修改 5 段 cron，校验通过后重建调度   |
| `POST` | `/qqbot/plugin-platform/tasks/:id/run`     | 手动提交一次任务                     |
| `GET`  | `/qqbot/plugin-platform/tasks/:id/runs`    | 任务运行记录分页                     |

`src/modules/qqbot/plugin-platform/runtime` 当前提供 host-side driver 边界和超时/崩溃事件归档；实际 worker/child-process driver 可以在后续批次接入，但插件侧只能通过受控 SDK 访问发送队列、配置、存储、HTTP、资产和事件上下文。

Admin 入口为 `/qqbot/plugin-task`，用于分页查看任务、启停、修改 cron、手动运行和查看运行记录。BangDream 内置任务 `bangdream.bestdori.sync-main-data` 会定期同步 Bestdori 主数据到 `BANGDREAM_TSUGU_CACHE_ROOT`；生产容器内路径为 `/data/qqbot/plugins/bangdream/cache`，K8s hostPath 使用 k3d 节点可写目录 `/var/lib/rancher/k3s/kt-template-online-api/qqbot-plugins`。

### OneBot Reverse WebSocket

`QQBOT_REVERSE_WS_PATH` 默认是 `/qqbot/onebot/reverse`。NapCat 通过反向 WS 连接 API，token 使用 `QQBOT_REVERSE_WS_TOKEN`。

## QQBot 插件能力

### Bilibili Card

插件 key：`bilibili-card`。这是事件型内置插件，不新增在线命令；启用后仍需通过账号事件绑定让指定 QQBot 账号接收 `bilibili-card.message`。

| event key                | 触发来源 | 说明                                                                 |
| ------------------------ | -------- | -------------------------------------------------------------------- |
| `bilibili-card.message`  | message  | 从 QQ/NapCat `share/json/xml/lightapp` 卡片和文本中提取 Bilibili 链接 |

插件会解析 `www.bilibili.com`、`m.bilibili.com` 和 `b23.tv`。短链通过插件平台受控 `resolveRedirect` host 能力限制跳转次数和超时；视频信息来自 Bilibili `x/web-interface/view`，回复为纯文本标题、UP 主、时长、播放/弹幕/点赞等摘要和标准视频链接。同一账号、同一会话、同一视频在 `QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS` 内去重。

可配置键：

| 配置键                                      | 默认值 | 说明                 |
| ------------------------------------------- | ------ | -------------------- |
| `QQBOT_BILIBILI_CARD_HTTP_TIMEOUT_MS`       | 6000   | HTTP 请求超时毫秒    |
| `QQBOT_BILIBILI_CARD_MAX_REDIRECTS`         | 5      | `b23.tv` 最大跳转数  |
| `QQBOT_BILIBILI_CARD_DEDUPE_TTL_MS`         | 600000 | 同视频去重毫秒       |
| `QQBOT_BILIBILI_CARD_DESC_MAX_LENGTH`       | 80     | 回复中简介最大字符数 |

### BangDream

插件 key：`bangdream`。旧 `bangDream` 作为兼容别名仍可解析；当前源码根目录为 `src/modules/qqbot/plugins/bangdream/src`，按第三期插件结构拆分为 `operations`、`domain/*`、`application`、`infrastructure/integration`、`infrastructure/storage`、`config`、`assets` 和 `theme`，不再使用旧 `tsugu` 子目录、宿主 builtins 包装层或纯转接目录。

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

| 文件                                           | 用途                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| `sql/vben-admin-init.sql`                      | 创建 Admin 基础表、用户、角色、菜单、部门、字典和空组件表 |
| `sql/blog-init.sql`                            | 初始化本地 Blog 表                                        |
| `sql/blog-menu.sql`                            | 初始化 Blog 管理菜单                                      |
| `sql/qqbot-init.sql`                           | 初始化 QQBot 表、插件命令和字典                           |
| `sql/system-log-menu.sql`                      | 初始化系统日志菜单和权限                                  |
| `sql/system-notice-menu.sql`                   | 初始化系统站内信表与菜单权限                              |
| `sql/migrate-dict-to-admin-dict.sql`           | 旧 `dict` 迁移到 `admin_dict`                             |
| `sql/migrate-component-to-admin-component.sql` | 旧 `component` 迁移到 `admin_component`                   |
| `sql/fix-admin-menu-meta.sql`                  | 修复菜单 meta 被覆盖为空                                  |
| `sql/fix-admin-user-zero-id.sql`               | 修复旧版本 `admin_user.id=0` 脏数据                       |

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

```powershell
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.song.search -Text "夏祭り" -OutFile ".kt-workspace/bangdream-smoke/song.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.event.stage -Text "310" -OutFile ".kt-workspace/bangdream-smoke/stage.jpg" -ExpectedImageCount 5
```

Jenkins/K8s 发布后还需要观察 rollout、新 Pod 日志，并跑真实运行态 smoke；推送成功不等于发布完成。
