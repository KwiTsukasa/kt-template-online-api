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

| 模块 | 说明 |
| --- | --- |
| `admin` | Vben Admin 认证、用户、菜单、角色、部门、时区、字典、组件模板、系统日志 |
| `blog` | 本地博客文章、分类、标签、Argon 主题配置和 WordPress 导入 |
| `wordpress` | WordPress REST 代理、登录态透传、文章/分类/标签/主题配置 |
| `qqbot` | QQBot 账号、NapCat 扫码登录、OneBot 反向 WS、在线命令、规则、权限、发送/接收日志 |
| `qqbot/plugins/bangDream` | BanG Dream 查曲、查卡、查活动、试炼、玩家、卡池、抽卡模拟、档线、谱面出图 |
| `qqbot/plugins/ff14Market` | XIVAPI + Universalis 物品解析和 FF14 市场查价 |
| `qqbot/plugins/fflogs` | FFLogs v2 GraphQL 角色排名和指定高难最近记录查询 |
| `minio` | Bucket 检查、上传、列表、临时 URL、代理下载、删除 |
| `common` | 响应封装、异常过滤、请求日志、日期格式化、字典解码、Snowflake、工具服务 |

## 目录结构

```text
src/
  admin/       Admin 后台接口和实体
  blog/        本地博客内容与主题配置
  common/      全局装饰器、过滤器、拦截器、logger、工具和类型
  minio/       MinIO 文件服务
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

| 分组 | 变量 |
| --- | --- |
| MySQL | `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC` |
| MinIO | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET` |
| Admin | `ADMIN_TOKEN_SECRET`、`ADMIN_COOKIE_SECURE`、`SNOWFLAKE_WORKER_ID`、`SNOWFLAKE_DATACENTER_ID` |
| WordPress | `WORDPRESS_BASE_URL`、`WORDPRESS_HOST_HEADER`、`WORDPRESS_ADMIN_USERNAME`、`WORDPRESS_ADMIN_PASSWORD`、`WORDPRESS_*_TIMEOUT_MS` |
| Logging/Loki | `LOG_LEVEL`、`LOG_APP_NAME`、`LOKI_URL`、`LOKI_QUERY_HOST`、`LOKI_*` |
| QQBot/NapCat | `QQBOT_ENABLED`、`QQBOT_REVERSE_WS_*`、`NAPCAT_*`、`QQBOT_NAPCAT_*`、`MQTT_*` |
| BangDream | `BANGDREAM_TSUGU_MAIN_SERVER`、`BANGDREAM_TSUGU_DISPLAYED_SERVERS`、`BANGDREAM_TSUGU_CACHE_ROOT` |
| FF14 Market | `FF14_XIVAPI_BASE_URL`、`FF14_UNIVERSALIS_BASE_URL`、`FF14_MARKET_CACHE_TTL_MS` |
| FFLogs | `FFLOGS_BASE_URL`、`FFLOGS_GRAPHQL_URL`、`FFLOGS_TOKEN_URL`、`FFLOGS_CLIENT_ID`、`FFLOGS_CLIENT_SECRET` |

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

## 核心规则

- 后台主键使用 Snowflake 数字 ID，数据库字段为 `BIGINT`，接口按字符串返回。
- 后端响应时间统一用 `YYYY-MM-DD HH:mm:ss`，需要格式化的 DTO/Entity 字段使用 `@FormatDateTime()`。
- 字典维护在 `admin_dict`，Admin 字典管理按 `dictCode` 分组展示；可运营映射优先走字典或静态配置，不硬编码到业务函数。
- 全局 `SaveBodyInterceptor` 会删除 `POST */save` 请求体里的 `id`；需要保留时使用 `@SkipSaveBodyNormalize()`。
- Admin、Component、Dict、MinIO、Blog 管理、WordPress 管理和 QQBot 管理接口默认走 `JwtAuthGuard`；公开接口用 `@Public()`。
- WordPress 自动登录失败不会阻断 Admin 主登录，会通过菜单和权限码过滤不可用的 Blog 管理入口。
- 系统日志由 pino 输出，Loki 查询统一通过后端 `/system/logs/*` 代理，前端不直连 Loki。
- QQBot 扫码登录通过 SSE `/qqbot/account/scan/events` 暴露进度，耗时链路不应阻塞普通 HTTP 响应。
- BangDream 当前源码根目录是 `src/qqbot/plugins/bangDream`；不要恢复旧 `tsugu` 层级或旧大桶目录。
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
