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

| 模块      | 说明                                                                  |
| --------- | --------------------------------------------------------------------- |
| Component | 组件/图表模板的列表、详情、新增、编辑、逻辑删除                       |
| Dict      | 数据库字典查询，以及组件一级类型到二级类型的数据库关系映射            |
| MinIO     | Bucket 检查/创建、文件上传、列表、临时访问地址、下载和删除            |
| Common    | 统一响应 Swagger 注解、字典翻译注解、`POST */save` 请求体规范化拦截器 |

## 通用规则

### Save 请求体规范化

系统全局注册 `SaveBodyInterceptor`，默认会对 `POST */save` 请求删除 `body.id`，避免新增接口因为前端误传 `id` 而走指定主键保存。

如果个别接口需要保留 `id`，可在对应 Controller 方法上使用 `@SkipSaveBodyNormalize()`。

### 数据库字典翻译

字典数据维护在数据库 `dict` 表中。`Component.typeMsg`、`Component.componentTypeMsg` 会在 TypeORM `AfterLoad` 阶段根据字典缓存自动映射。

`dict` 表核心字段：

| 字段        | 类型    | 说明                                                   |
| ----------- | ------- | ------------------------------------------------------ |
| id          | string  | 字典 ID                                                |
| dictKey     | string  | 字典分组，例如 `COMPONENT_TYPE`、`CHART`、`COMPONENT`  |
| label       | string  | 展示文本                                               |
| value       | string  | 字典值                                                 |
| childrenKey | string  | 子字典分组，例如 `COMPONENT_TYPE.value=1` 指向 `CHART` |
| sort        | number  | 排序                                                   |
| is_deleted  | boolean | 逻辑删除标记                                           |

当前数据库示例关系：

| dictKey        | value | label | childrenKey |
| -------------- | ----- | ----- | ----------- |
| COMPONENT_TYPE | 1     | 图表  | CHART       |
| COMPONENT_TYPE | 2     | 组件  | COMPONENT   |

## 数据结构

### Component

| 字段             | 类型    | 说明                               |
| ---------------- | ------- | ---------------------------------- |
| id               | string  | 组件 ID，新增时由后端生成          |
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
      "id": "1d8d3dd2-99f0-4d10-9a44-0cf9566b37c9",
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
  "data": "1d8d3dd2-99f0-4d10-9a44-0cf9566b37c9"
}
```

### POST `/component/update`

编辑组件。

Body：

```json
{
  "id": "1d8d3dd2-99f0-4d10-9a44-0cf9566b37c9",
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

查询逻辑：先查 `dictKey=COMPONENT_TYPE` 且 `value=type` 的字典项，再使用该项的 `childrenKey` 查询子字典。

Query：

| 参数 | 类型   | 必填 | 说明     |
| ---- | ------ | ---- | -------- |
| type | number | 是   | 一级类型 |

响应 `data`：`Array<{ label: string; value: number | string }>`。

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
