# KT Template Online API

`kt-template-online-api` 是 KT Template Online 的后端服务，负责组件模板、数据库字典、MinIO 文件和 WordPress 内容管理能力。前台列表和 Playground 保存都通过本服务完成数据读写。

## 技术栈

- Node.js + TypeScript
- NestJS 9
- TypeORM + MySQL
- MinIO
- Swagger / Knife4j
- pnpm

## 功能模块

| 模块        | 说明                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| `component` | Admin 下受保护的组件/图表模板列表、详情、新增、编辑、逻辑删除，数据表为 `admin_component` |
| `dict`      | 基于新 `admin_dict` 表的字典查询，维护组件一级类型和二级类型关系                          |
| `admin`     | Vben Admin 真实接口，包含登录、用户、菜单、角色、部门、时区、上传和示例表格               |
| `minio`     | Bucket 检查/创建、文件上传、列表、临时访问地址、下载和删除                                |
| `wordpress` | WordPress 文章、标签、分类管理接口，复用客户端 WordPress 登录态访问 REST API              |
| `common`    | 响应注解、字典翻译、`POST */save` 请求体规范化等通用能力                                  |

## 目录结构

```text
src
  common/       # 通用装饰器、拦截器、服务、Swagger 封装
  admin/        # Vben Admin 后台认证、组件、字典、菜单、角色、部门等接口
  minio/        # MinIO 文件模块
  wordpress/    # WordPress REST API 文章、标签、分类代理模块
  types/        # 全局类型声明
  app.module.ts # 全局模块、数据库、MinIO、拦截器注册
  main.ts       # Swagger、Knife4j、端口启动入口
```

## 环境变量

项目按 `NODE_ENV` 读取 `.env.${NODE_ENV}`，未指定时默认读取 `.env.development`。仓库只提交 `.env.example`，真实 `.env.development` 和 `.env.production` 保留在本地。

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=shy_template
DB_SYNC=true

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=kt-template-online

WORDPRESS_BASE_URL=http://localhost
WORDPRESS_ADMIN_USERNAME=admin
WORDPRESS_ADMIN_PASSWORD=
WORDPRESS_TIMEOUT_MS=15000
WORDPRESS_LOGIN_TIMEOUT_MS=3000
WORDPRESS_AVAILABILITY_TTL_MS=60000

ADMIN_TOKEN_SECRET=change-me
ADMIN_COOKIE_SECURE=false
SNOWFLAKE_WORKER_ID=1
SNOWFLAKE_DATACENTER_ID=1
```

`DB_SYNC=true` 会让 TypeORM 根据实体同步表结构。生产环境建议关闭同步，改用迁移脚本维护表结构。
内网 HTTP 访问时保持 `ADMIN_COOKIE_SECURE=false`；如果未来切到 HTTPS 域名，再改为 `true`。

## 启动

```bash
pnpm install
pnpm start:dev
```

服务默认监听 `48085`。

常用命令：

```bash
pnpm start          # 普通启动
pnpm start:prod     # 按 production 环境运行已构建的 dist/main
pnpm run build      # Nest 构建
pnpm run lint       # ESLint 检查
pnpm test           # 单元测试
pnpm test:e2e       # e2e 测试
```

## 接口文档

- Swagger UI：`http://localhost:48085/api`
- OpenAPI JSON：`http://localhost:48085/api-json`
- 根路径 `/` 会重定向到 Swagger 文档
- 接口细节见 [API.md](./API.md)

除文件下载接口外，业务接口统一返回：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {}
}
```

失败时统一返回 `err` 字段，成功响应不包含 `err`：

```json
{
  "code": 400,
  "msg": "操作失败",
  "err": "错误原因"
}
```

## 核心规则

- `admin_component` 表保存组件/图表模板，`admin_dict` 表是统一字典翻译数据源，`Component.typeMsg` 和 `Component.componentTypeMsg` 查询后自动映射；旧 `/dict/*` 接口路径保持兼容。
- 业务主键统一由 Snowflake 生成数字 ID，数据库使用 `BIGINT`，接口按字符串返回以避免前端长整型精度问题。
- 如果基础后台菜单的 `meta` 被旧数据覆盖为空，执行 `sql/fix-admin-menu-meta.sql` 可以恢复初始化菜单的 `title/icon/order` 等元数据。
- 旧 `component` 表迁移到 `admin_component` 时，执行 `sql/migrate-component-to-admin-component.sql`，脚本会把旧表重命名为备份表。
- 如果旧版本曾写入 `admin_user.id=0`，先执行 `sql/fix-admin-user-zero-id.sql` 修复脏数据，再重启服务。
- Admin、Component、Dict 与 MinIO 业务接口统一走 `JwtAuthGuard`；登录、刷新 token、退出登录和部分示例状态测试接口通过 `@Public()` 放行。
- WordPress 管理接口同样先走本系统 `JwtAuthGuard`，再透传客户端 WordPress 登录态访问 WordPress REST API；当前 WordPress 只有单管理员账号且不开放注册，账号配置放在 env 中，但不作为 BasicAuth 发送。
- Admin 前端只调用现有 `/auth/login`；后端会在登录流程里自动尝试登录 WordPress，把 WordPress cookie 写入本系统 httpOnly cookie，前端只持久化 REST nonce 和用户信息。WordPress 远程不可用时不会阻塞 Admin 主登录，后端会返回 `wordpressAuth=null` 并在菜单和按钮权限接口中过滤博客管理相关入口。
- WordPress 文章的 `categories` 和 `tags` 按原生 REST API 语义透传 ID 数组；分类和标签 term 支持新增、编辑、强制删除，删除 term 不会删除文章。
- WordPress 客户端登录态优先通过 `X-WordPress-Authorization` 透传，也支持 `X-WP-Nonce` 加 WordPress 登录 cookie 的 REST cookie 认证。
- 如果 WordPress 服务器未开启 rewrite 导致 `/wp-json/*` 返回 404，后端会自动回退到 `?rest_route=/...` 形式继续访问 REST API。
- `kt-template-admin` 登录会写入 access token 与刷新 token cookie，`kt-template-online-web` 和 `kt-template-online-playground` 可在回跳后通过刷新 token 重新持久化登录态。
- `kt-template-admin` 开发环境通过 `/api` 代理到本服务 `48085`，已关闭 Vben Nitro Mock。
- `POST /component/save` 新增组件，`POST /component/update` 编辑组件。
- 全局 `SaveBodyInterceptor` 会删除 `POST */save` 请求体里的 `id`，避免新增接口误用前端主键。
- 如个别 `save` 接口必须保留 `id`，在 Controller 方法上使用 `@SkipSaveBodyNormalize()`。
- MinIO 上传接口返回的 `url` 会被 Playground 写入组件 `image` 字段。

## 联调关系

- `kt-template-online-web` 读取 `/component/list`、`/component/detail`、`/dict/*` 展示组件列表，并生成 Playground 跳转链接；业务接口返回 `401` 时跳转到 `kt-template-admin` 登录。
- `kt-template-online-playground` 读取 `/dict/*` 初始化分类，保存时上传截图到 `/minio/upload`，再调用 `/component/save` 或 `/component/update`；业务接口返回 `401` 时跳转到 `kt-template-admin` 登录并在回跳后刷新 token。
- 前端项目通过 Vite 代理把 `/api` 转发到 `http://localhost:48085/`。

## 轻量验证

文档或小范围后端改动优先跑轻量命令：

```bash
pnpm run lint
pnpm test
```

完整构建只在发布前或改动影响构建链路时执行：

```bash
pnpm run build
```
