# KT Template Online API

后端服务默认监听 `48085`，Swagger 地址为 `/api`，OpenAPI JSON 地址为 `/api-json`。

除文件下载接口外，接口统一返回：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {}
}
```

失败时仍使用相同结构，常见为：

```json
{
  "code": 400,
  "msg": "操作失败",
  "data": null
}
```

## 功能模块

| 模块      | 说明                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| Component | Admin 下受保护的组件/图表模板列表、详情、新增、编辑、逻辑删除，数据表为 `admin_component` |
| Dict      | 基于新 `admin_dict` 表的数据库字典查询，以及组件一级类型到二级类型的数据库关系映射        |
| Admin     | Vben Admin 真实接口，包含认证、用户、菜单、角色、部门、时区和上传适配                     |
| MinIO     | Bucket 检查/创建、文件上传、列表、临时访问地址、下载和删除                                |
| WordPress | WordPress 文章、标签、分类管理，复用客户端 WordPress 登录态访问 REST API                  |
| Common    | 统一响应 Swagger 注解、字典翻译注解、`POST */save` 请求体规范化拦截器                     |

## 通用规则

### 数字 ID

后台主键统一使用 Snowflake 数字 ID。数据库字段使用 `BIGINT`；接口 JSON 中按字符串返回，例如 `"2041739550026043392"`，避免 JavaScript 直接用 `number` 承载 64 位长整型导致精度丢失。

如果旧版本曾经写入 `admin_user.id=0`，请先执行 `sql/fix-admin-user-zero-id.sql` 修复已有脏数据，再重启后端服务。

### Save 请求体规范化

系统全局注册 `SaveBodyInterceptor`，默认会对 `POST */save` 请求删除 `body.id`，避免新增接口因为前端误传 `id` 而走指定主键保存。

如果个别接口需要保留 `id`，可在对应 Controller 方法上使用 `@SkipSaveBodyNormalize()`。

### 后台认证

Admin、Component、Dict 与 MinIO 业务接口统一走 `JwtAuthGuard`。请求可以通过 `Authorization: Bearer <accessToken>` 传递 accessToken，也可以携带登录接口写入的 httpOnly `admin_access_token` cookie。未认证时接口返回 HTTP `401`。

`ADMIN_COOKIE_SECURE=false` 适用于当前内网 HTTP 访问；如果后续切到 HTTPS 域名，可以改为 `true`，cookie 会使用 `Secure + SameSite=None`。

`@Public()` 可用于保留不需要认证的接口口子，目前登录、刷新 token、退出登录和部分示例状态测试接口放行。

### WordPress 认证透传

WordPress 侧只使用客户端登录态，后端不走 BasicAuth。当前 WordPress 只有单管理员账号且不开放注册，管理员账号配置放在 env 中，Admin 调用 `/auth/login` 通过后，后端会在同一个登录流程里自动登录 WordPress，把 WordPress cookie 保存到本系统 httpOnly cookie，再把 REST nonce 和用户信息随 Admin 登录结果返回给前端持久化。

环境变量：

| 变量                            | 说明                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `WORDPRESS_BASE_URL`            | WordPress 站点根地址，例如 `http://192.168.31.224:8080`                                    |
| `WORDPRESS_ADMIN_USERNAME`      | WordPress 单管理员账号用户名                                                               |
| `WORDPRESS_ADMIN_PASSWORD`      | WordPress 单管理员账号密码，仅放真实 env，不提交到仓库                                     |
| `WORDPRESS_TIMEOUT_MS`          | WordPress REST API 请求超时时间，默认 `15000`                                              |
| `WORDPRESS_LOGIN_TIMEOUT_MS`    | Admin 登录链路里 WordPress 自动认证的短超时时间，默认 `3000`，避免远程不可用阻塞主系统登录 |
| `WORDPRESS_AVAILABILITY_TTL_MS` | WordPress 可用性缓存时间，默认 `60000`；远程不可用时用于过滤博客菜单和按钮权限             |

支持的 WordPress 登录态来源：

| Header/Cookie               | 说明                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `X-WordPress-Authorization` | 优先透传的 WordPress 授权头，例如客户端登录拿到的 `Bearer <token>`                                  |
| `Authorization`             | 仅当它不是本系统 Admin access token 时才会透传，避免和后台认证冲突                                  |
| `X-WP-Nonce`                | WordPress REST cookie 认证 nonce                                                                    |
| `Cookie`                    | 只会过滤并透传 `wordpress_*`、`wordpress_logged_in_*`、`wp-settings-*` 等 WordPress 登录相关 cookie |
| `X-WordPress-Cookie`        | 显式传入 WordPress cookie，适合非浏览器客户端联调                                                   |
| `kt_wordpress_auth`         | 后端自动认证后写入的 httpOnly cookie，前端不可读取，后端会自动转成 WordPress cookie 透传            |

如果 WordPress 所在 Apache/Nginx 未开启 rewrite，`/wp-json/*` 可能返回 404。后端会自动回退到 WordPress 原生 `?rest_route=/...` 形式，避免因为固定链接配置阻断文章、标签和分类管理接口。

Admin 主登录不依赖 WordPress 可用性：本系统账号验证通过后会先写入 Admin token；WordPress 自动认证失败时登录仍返回成功，`wordpressAuth` 为 `null`、`wordpressAvailable=false`，并清理旧 WordPress cookie。随后 `/menu/all` 与 `/auth/codes` 会基于最近一次 WordPress 可用性状态过滤 `Blog*` 菜单和 `Blog:*` 按钮权限码，避免前端展示不可用的文章、分类、标签管理入口。

### 数据库字典翻译

组件数据维护在 `admin_component` 表中，字典数据维护在新的 `admin_dict` 表中。`Component.typeMsg`、`Component.componentTypeMsg` 会在 TypeORM `AfterLoad` 阶段根据字典缓存自动映射；旧 `/dict/*` 接口路径保持兼容，但仍需要登录态。

`admin_dict` 表核心字段：

| 字段         | 类型    | 说明                                                   |
| ------------ | ------- | ------------------------------------------------------ |
| id           | string  | 字典数字 ID                                            |
| dictCode     | string  | 字典分组，例如 `COMPONENT_TYPE`、`CHART`、`COMPONENT`  |
| label        | string  | 展示文本                                               |
| value        | string  | 字典值                                                 |
| childrenCode | string  | 子字典分组，例如 `COMPONENT_TYPE.value=1` 指向 `CHART` |
| sort         | number  | 排序                                                   |
| status       | number  | 启停状态，`1` 启用                                     |
| isDeleted    | boolean | 逻辑删除标记                                           |

当前数据库示例关系：

| dictCode       | value | label | childrenCode |
| -------------- | ----- | ----- | ------------ |
| COMPONENT_TYPE | 1     | 图表  | CHART        |
| COMPONENT_TYPE | 2     | 组件  | COMPONENT    |

## 数据结构

### Component

| 字段             | 类型    | 说明                               |
| ---------------- | ------- | ---------------------------------- |
| id               | string  | 组件数字 ID，新增时由后端生成      |
| name             | string  | 组件名称                           |
| type             | number  | 一级类型，实际含义由 `dict` 表维护 |
| componentType    | number  | 二级类型，实际含义由 `dict` 表维护 |
| typeMsg          | string  | 一级类型文本，查询后自动映射       |
| componentTypeMsg | string  | 二级类型文本，查询后自动映射       |
| image            | string  | 封面图或封面图地址                 |
| template         | string  | Playground 序列化模板内容          |
| createTime       | string  | 创建时间                           |
| updateTime       | string  | 更新时间                           |
| is_deleted       | boolean | 逻辑删除标记                       |

### Dict

接口返回的字典项结构：

| 字段  | 类型          | 说明     |
| ----- | ------------- | -------- |
| label | string        | 展示文本 |
| value | number/string | 字典值   |

### MinIO

`bucketName` 未传时默认读取环境变量 `MINIO_BUCKET`，缺省值为 `kt-template-online`。

## Root

### GET `/`

重定向到 Swagger 文档页 `/api#/`，HTTP 状态码为 `301`。

## Component 接口

组件接口仍保持 `/component/*` 路径兼容，但模块已迁入 Admin 目录并要求后台登录态。`kt-template-online-web` 和 `kt-template-online-playground` 收到 `401` 后会跳转到 `kt-template-admin` 登录页，登录完成再回到原页面。

### GET `/component/allList`

获取全部组件。

响应 `data`：`Component[]`。

示例：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": [
    {
      "id": "2041739550026043392",
      "name": "基础折线图",
      "type": 1,
      "componentType": 1,
      "typeMsg": "图表",
      "componentTypeMsg": "折线图",
      "image": "",
      "template": "%7B%22version%22%3A%221.0%22%7D",
      "createTime": "2026-05-13T02:30:00.000Z",
      "updateTime": "2026-05-13T02:30:00.000Z",
      "is_deleted": false
    }
  ]
}
```

### GET `/component/list`

分页获取组件列表。列表默认过滤 `is_deleted=false`，并支持按名称模糊搜索。

Query：

| 参数          | 类型   | 必填 | 说明             |
| ------------- | ------ | ---- | ---------------- |
| pageNo        | number | 是   | 页码             |
| pageSize      | number | 是   | 每页条数         |
| name          | string | 否   | 组件名称模糊搜索 |
| type          | number | 否   | 一级类型         |
| componentType | number | 否   | 二级类型         |

响应 `data`：

```ts
{
  list: Component[]
  total: number
}
```

### GET `/component/detail`

获取组件详情。

Query：

| 参数 | 类型   | 必填 | 说明    |
| ---- | ------ | ---- | ------- |
| id   | string | 是   | 组件 ID |

响应 `data`：`Component`。

### POST `/component/save`

新增组件。全局 `SaveBodyInterceptor` 会删除 `body.id`，新增时不需要传 `id`。

Body：

```json
{
  "name": "基础折线图",
  "type": 1,
  "componentType": 1,
  "image": "",
  "template": "%7B%22version%22%3A%221.0%22%7D"
}
```

响应 `data`：新增组件 ID。

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": "2041739550026043392"
}
```

### POST `/component/update`

编辑组件。

Body：

```json
{
  "id": "2041739550026043392",
  "name": "基础折线图",
  "type": 1,
  "componentType": 1,
  "image": "",
  "template": "%7B%22version%22%3A%221.0%22%7D"
}
```

响应 `data`：`true` 表示更新成功。

### POST `/component/remove`

逻辑删除组件。

Query：

| 参数 | 类型   | 必填 | 说明    |
| ---- | ------ | ---- | ------- |
| id   | string | 是   | 组件 ID |

响应 `data`：`true` 表示删除成功。

## Dict 接口

### GET `/dict/getDictByKey`

根据字典分组获取字典项。

Query：

| 参数    | 类型   | 必填 | 说明                   |
| ------- | ------ | ---- | ---------------------- |
| dictKey | string | 是   | 字典分组，例如 `CHART` |

响应示例：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": [
    {
      "label": "折线图",
      "value": 1
    }
  ]
}
```

### GET `/dict/getComponentDictByType`

根据组件一级类型获取对应的二级类型字典。

查询逻辑：先查 `dictCode=COMPONENT_TYPE` 且 `value=type` 的字典项，再使用该项的 `childrenCode` 查询子字典。

Query：

| 参数 | 类型   | 必填 | 说明     |
| ---- | ------ | ---- | -------- |
| type | number | 是   | 一级类型 |

响应 `data`：`Array<{ label: string; value: number | string }>`。

## Vben Admin 真实接口

这些接口用于 `Vue/kt-template-admin`，响应格式与 Vben 请求拦截器对齐：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

核心接口：

| 方法   | 路径                           | 说明                                                                                                  |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`                  | 登录，返回 `accessToken` 与 `wordpressAuth`，并写入 access token、刷新 token 和 WordPress 授权 cookie |
| POST   | `/auth/refresh`                | 通过刷新 token cookie 刷新 accessToken，并更新 token cookie                                           |
| POST   | `/auth/logout`                 | 退出登录并清理 access token、刷新 token 与 WordPress 授权 cookie                                      |
| GET    | `/auth/codes`                  | 获取当前用户权限码                                                                                    |
| GET    | `/user/info`                   | 获取当前用户信息                                                                                      |
| GET    | `/menu/all`                    | 获取当前用户可访问菜单                                                                                |
| GET    | `/system/menu/list`            | 获取系统菜单树                                                                                        |
| GET    | `/system/menu/name-exists`     | 校验菜单 name 是否重复                                                                                |
| GET    | `/system/menu/path-exists`     | 校验菜单 path 是否重复                                                                                |
| POST   | `/system/menu`                 | 新增菜单                                                                                              |
| PUT    | `/system/menu/:id`             | 更新菜单                                                                                              |
| DELETE | `/system/menu/:id`             | 删除菜单及子菜单                                                                                      |
| GET    | `/system/role/list`            | 分页查询角色                                                                                          |
| POST   | `/system/role`                 | 新增角色                                                                                              |
| PUT    | `/system/role/:id`             | 更新角色                                                                                              |
| DELETE | `/system/role/:id`             | 删除角色                                                                                              |
| GET    | `/system/dept/list`            | 获取部门树                                                                                            |
| POST   | `/system/dept`                 | 新增部门                                                                                              |
| PUT    | `/system/dept/:id`             | 更新部门                                                                                              |
| DELETE | `/system/dept/:id`             | 删除部门                                                                                              |
| GET    | `/timezone/getTimezoneOptions` | 获取时区选项                                                                                          |
| GET    | `/timezone/getTimezone`        | 获取当前用户时区                                                                                      |
| POST   | `/timezone/setTimezone`        | 设置当前用户时区                                                                                      |
| POST   | `/upload`                      | Vben Upload 适配接口，真实上传到 MinIO 并返回 `{ url }`                                               |
| GET    | `/table/list`                  | Vben 示例远程表格数据                                                                                 |
| GET    | `/status`                      | Vben 状态码测试接口                                                                                   |
| GET    | `/demo/bigint`                 | Vben BigInt JSON 测试接口                                                                             |

初始化 SQL：

- `sql/vben-admin-init.sql`：创建 `admin_*` 表并导入基础用户、角色、菜单、部门、字典数据，同时创建空的 `admin_component` 表。
- `sql/migrate-dict-to-admin-dict.sql`：将旧 `dict` 表数据迁移到 `admin_dict`。
- `sql/migrate-component-to-admin-component.sql`：将旧 `component` 表数据迁移到 `admin_component`，并把旧表改名为备份表。
- `sql/fix-admin-menu-meta.sql`：修复基础后台菜单 `meta` 被旧数据或错误保存覆盖为空的问题。

## WordPress 接口

所有 `/wordpress/*` 管理接口都需要本系统后台登录态和 WordPress 客户端登录态。Admin 前端只调用现有 `/auth/login`，后端在该登录接口内部自动建立 WordPress 授权态；后端只把 WordPress cookie 保存到本系统 httpOnly cookie，不把 cookie 明文放入前端持久化。

### POST `/wordpress/auth/login`

使用 env 中的 `WORDPRESS_ADMIN_USERNAME` 和 `WORDPRESS_ADMIN_PASSWORD` 登录 WordPress，写入 `kt_wordpress_auth` httpOnly cookie，并返回前端需要持久化的 REST nonce 和 WordPress 当前用户信息。该接口主要保留为后端内部能力和调试口子，正常 Admin 登录链路不由前端主动调用它，而是通过 `/auth/login` 自动触发。

响应 `data`：

```json
{
  "auth": {
    "nonce": "wordpress-rest-nonce",
    "type": "cookie"
  },
  "user": {
    "id": 1,
    "name": "admin"
  }
}
```

### POST `/wordpress/auth/logout`

清理本系统保存的 WordPress 授权 cookie。该接口用于 Admin 退出登录时同步清理 WordPress 授权态。

### GET `/wordpress/auth/check`

调用 WordPress `/wp-json/wp/v2/users/me?context=edit` 校验当前客户端 WordPress 登录态。

响应 `data`：WordPress 当前用户信息。

### WordPress Article

| 方法 | 路径                                        | 说明             |
| ---- | ------------------------------------------- | ---------------- |
| GET  | `/wordpress/article/list`                   | 获取文章分页列表 |
| GET  | `/wordpress/article/detail?id=1`            | 获取文章详情     |
| POST | `/wordpress/article/save`                   | 新增文章         |
| POST | `/wordpress/article/update`                 | 编辑文章         |
| POST | `/wordpress/article/remove?id=1&force=true` | 删除文章         |

列表 Query：

| 参数       | 类型   | 必填 | 说明                    |
| ---------- | ------ | ---- | ----------------------- |
| pageNo     | number | 否   | 页码，默认 `1`          |
| pageSize   | number | 否   | 每页条数，默认 `10`     |
| search     | string | 否   | 关键词搜索              |
| status     | string | 否   | 文章状态，默认 `any`    |
| categories | string | 否   | 分类 ID，多个用逗号分隔 |
| tags       | string | 否   | 标签 ID，多个用逗号分隔 |

新增/编辑 Body 常用字段：

```json
{
  "id": 1,
  "title": "文章标题",
  "content": "文章内容",
  "excerpt": "文章摘要",
  "status": "draft",
  "slug": "post-slug",
  "categories": [1],
  "tags": [2],
  "featured_media": 10,
  "sticky": false
}
```

### WordPress Tag

| 方法 | 路径                                    | 说明             |
| ---- | --------------------------------------- | ---------------- |
| GET  | `/wordpress/tag/list`                   | 获取标签分页列表 |
| GET  | `/wordpress/tag/detail?id=1`            | 获取标签详情     |
| POST | `/wordpress/tag/save`                   | 新增标签         |
| POST | `/wordpress/tag/update`                 | 编辑标签         |
| POST | `/wordpress/tag/remove?id=1&force=true` | 删除标签         |

新增/编辑 Body：

```json
{
  "id": 1,
  "name": "标签名称",
  "slug": "tag-slug",
  "description": "标签描述"
}
```

### WordPress Category

| 方法 | 路径                                         | 说明             |
| ---- | -------------------------------------------- | ---------------- |
| GET  | `/wordpress/category/list`                   | 获取分类分页列表 |
| GET  | `/wordpress/category/detail?id=1`            | 获取分类详情     |
| POST | `/wordpress/category/save`                   | 新增分类         |
| POST | `/wordpress/category/update`                 | 编辑分类         |
| POST | `/wordpress/category/remove?id=1&force=true` | 删除分类         |

新增/编辑 Body：

```json
{
  "id": 1,
  "name": "分类名称",
  "slug": "category-slug",
  "description": "分类描述",
  "parent": 0
}
```

## MinIO 接口

### GET `/minio/check`

检查 MinIO 连接和 bucket 状态。

Query：

| 参数       | 类型   | 必填 | 说明        |
| ---------- | ------ | ---- | ----------- |
| bucketName | string | 否   | bucket 名称 |

响应 `data`：`{ bucketName: string; exists: boolean }`。

### POST `/minio/bucket`

创建 bucket，已存在时跳过。

Query：

| 参数       | 类型   | 必填 | 说明        |
| ---------- | ------ | ---- | ----------- |
| bucketName | string | 否   | bucket 名称 |

响应 `data`：bucket 名称。

### POST `/minio/upload`

上传文件，请求类型为 `multipart/form-data`。

Body：

| 参数       | 类型   | 必填 | 说明                   |
| ---------- | ------ | ---- | ---------------------- |
| file       | File   | 是   | 文件                   |
| bucketName | string | 否   | bucket 名称            |
| objectName | string | 否   | 对象名，不传时自动生成 |

响应示例：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {
    "bucketName": "kt-template-online",
    "objectName": "uploads/1715580000000-a1b2c3-demo.png",
    "etag": "9b2cf535f27731c974343645a3985328",
    "size": 2048,
    "mimeType": "image/png",
    "url": "http://127.0.0.1:9000/kt-template-online/uploads/demo.png"
  }
}
```

### GET `/minio/list`

获取文件列表。

Query：

| 参数       | 类型   | 必填 | 说明                          |
| ---------- | ------ | ---- | ----------------------------- |
| bucketName | string | 否   | bucket 名称                   |
| prefix     | string | 否   | 对象名前缀                    |
| recursive  | string | 否   | 是否递归，传 `false` 时不递归 |

响应 `data`：MinIO 对象数组，常见字段为 `name`、`size`、`etag`、`lastModified`。

### GET `/minio/url`

获取文件临时访问地址。

Query：

| 参数       | 类型   | 必填 | 说明                        |
| ---------- | ------ | ---- | --------------------------- |
| objectName | string | 是   | 对象名                      |
| bucketName | string | 否   | bucket 名称                 |
| expiry     | string | 否   | 有效期秒数，默认 `86400` 秒 |

响应 `data`：临时访问 URL。

### GET `/minio/download`

下载文件，直接返回文件流。

Query：

| 参数       | 类型   | 必填 | 说明        |
| ---------- | ------ | ---- | ----------- |
| objectName | string | 是   | 对象名      |
| bucketName | string | 否   | bucket 名称 |

### DELETE `/minio/remove`

删除文件。

Query：

| 参数       | 类型   | 必填 | 说明        |
| ---------- | ------ | ---- | ----------- |
| objectName | string | 是   | 对象名      |
| bucketName | string | 否   | bucket 名称 |

响应 `data`：`true` 表示删除成功。
