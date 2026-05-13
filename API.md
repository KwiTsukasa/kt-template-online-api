# KT Template Online API

后端服务默认监听 `48085`，Swagger 地址为 `/api`，OpenAPI JSON 地址为 `/api-json`。接口除文件下载外，统一返回 `{ code, msg, data }`。

## 通用响应

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

## Root

### GET `/`

重定向到 Swagger 文档页 `/api#/`，HTTP 状态码为 `301`。

## 数据结构

### Component

| 字段             | 类型    | 说明                         |
| ---------------- | ------- | ---------------------------- |
| id               | string  | 组件 ID，新增时由后端生成    |
| name             | string  | 组件名称                     |
| type             | number  | 一级类型，`1` 图表，`2` 组件 |
| componentType    | number  | 二级类型                     |
| typeMsg          | string  | 一级类型文本，列表接口返回   |
| componentTypeMsg | string  | 二级类型文本，列表接口返回   |
| image            | string  | 封面图                       |
| template         | string  | playground 序列化模板内容    |
| createTime       | string  | 创建时间                     |
| updateTime       | string  | 更新时间                     |
| is_deleted       | boolean | 逻辑删除标记                 |

### 字典

`COMPONENT_TYPE`：

| label | value |
| ----- | ----- |
| 图表  | 1     |
| 组件  | 2     |

`CHART`：`未分类(-1)`、`折线图(1)`、`柱状图(2)`、`饼图(3)`、`散点图(4)`、`地图(5)`、`K线图(6)`、`雷达图(7)`、`盒须图(8)`、`热力图(9)`、`关系图(10)`、`路径图(11)`、`树图(12)`、`矩树图(13)`、`旭日图(14)`、`平行坐标系(15)`、`桑基图(16)`、`漏斗图(17)`、`仪表盘(18)`、`象形图(19)`、`河流图(20)`、`水球(21)`、`词云(22)`。

`COMPONENT`：`未分类(-1)`、`表格(23)`、`表单(24)`、`容器(25)`。

## Component

### GET `/component/allList`

获取全部组件。

响应示例：

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

分页获取组件列表。

Query：

| 参数          | 类型   | 必填 | 说明         |
| ------------- | ------ | ---- | ------------ |
| pageNo        | number | 是   | 页码         |
| pageSize      | number | 是   | 每页条数     |
| name          | string | 否   | 名称模糊搜索 |
| type          | number | 否   | 一级类型     |
| componentType | number | 否   | 二级类型     |

响应 `data`：`{ list: Component[], total: number }`。

### GET `/component/detail`

获取组件详情。

Query：

| 参数 | 类型   | 必填 | 说明    |
| ---- | ------ | ---- | ------- |
| id   | string | 是   | 组件 ID |

响应 `data`：`Component`。

### POST `/component/save`

新增组件。`SaveMiddleware` 会删除 body 中的 `id`，新增时不需要传 `id`。

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

响应示例：

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

## Dict

### GET `/dict/getDictByKey`

根据字典 key 获取字典。

Query：

| 参数    | 类型   | 必填 | 可选值                                 |
| ------- | ------ | ---- | -------------------------------------- |
| dictKey | string | 是   | `COMPONENT_TYPE`、`CHART`、`COMPONENT` |

响应示例：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": [
    {
      "label": "图表",
      "value": 1
    },
    {
      "label": "组件",
      "value": 2
    }
  ]
}
```

### GET `/dict/getComponentDictByType`

根据一级类型获取二级类型字典。

Query：

| 参数 | 类型   | 必填 | 说明               |
| ---- | ------ | ---- | ------------------ |
| type | number | 是   | `1` 图表，`2` 组件 |

响应 `data`：`Array<{ label: string; value: number }>`。

## MinIO

### GET `/minio/check`

检查 MinIO 连接和 bucket 状态。

Query：`bucketName?: string`

响应 `data`：`{ bucketName: string; exists: boolean }`。

### POST `/minio/bucket`

创建 bucket，已存在时跳过。

Query：`bucketName?: string`

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

Query：`bucketName?: string`、`prefix?: string`、`recursive?: string`

响应 `data`：MinIO 对象数组，常见字段为 `name`、`size`、`etag`、`lastModified`。

### GET `/minio/url`

获取文件临时访问地址。

Query：`objectName: string`、`bucketName?: string`、`expiry?: string`

响应 `data`：临时访问 URL。

### GET `/minio/download`

下载文件，直接返回文件流。

Query：`objectName: string`、`bucketName?: string`

### DELETE `/minio/remove`

删除文件。

Query：`objectName: string`、`bucketName?: string`

响应 `data`：`true` 表示删除成功。
