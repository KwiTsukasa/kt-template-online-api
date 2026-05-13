# KT Template Online API

`kt-template-online-api` 是 KT Template Online 的 Nest.js 后端服务，负责组件模板管理、数据库字典映射和 MinIO 文件能力。

## 技术栈

- Node.js + TypeScript
- Nest.js
- TypeORM + MySQL
- MinIO
- Swagger / Knife4j

## 功能概览

### Component

管理图表/组件模板：

- 组件列表、分页列表、详情
- 新增、编辑、逻辑删除
- 查询阶段自动补充 `typeMsg`、`componentTypeMsg`

### Dict

维护数据库字典：

- 字典项存储在 `dict` 表
- `COMPONENT_TYPE.children_key` 关联二级字典，例如 `CHART`、`COMPONENT`
- 服务会将数据库字典刷新到进程缓存，供实体 `AfterLoad` 阶段同步翻译字段

### MinIO

提供文件服务：

- 检查/创建 bucket
- 上传文件
- 查询对象列表
- 获取临时访问地址
- 下载和删除对象

### Common

项目通用能力：

- 统一响应 Swagger 注解
- 字典翻译注解
- `POST */save` 请求体规范化拦截器
- 通用响应、分页和查询条件工具

## 目录结构

```text
src
  common
    decorators/     # 通用装饰器
    interceptors/   # 全局/通用拦截器
    services/       # 通用服务
    swagger/        # Swagger 响应注解封装
    index.ts        # common 统一出口
  component/        # 组件模板模块
  dict/             # 数据库字典模块
  minio/            # MinIO 文件模块
  types/            # 全局类型声明
  app.module.ts
  main.ts
```

## 环境变量

项目默认读取 `.env`，生产环境会读取 `.env.prod`。

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=shy_template
DB_SYNC=true

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=kt-template-online
```

`DB_SYNC=true` 时 TypeORM 会按实体同步表结构。生产环境建议关闭同步，改用迁移脚本维护表结构。

## 数据库字典

`dict` 表是字典翻译的唯一数据源，代码中不再维护本地字典列表。

核心字段：

| 字段           | 说明                                                  |
| -------------- | ----------------------------------------------------- |
| `dict_key`     | 字典分组，例如 `COMPONENT_TYPE`、`CHART`、`COMPONENT` |
| `label`        | 展示文本                                              |
| `value`        | 字典值                                                |
| `children_key` | 子字典分组，例如一级类型 `1` 指向 `CHART`             |
| `sort`         | 排序                                                  |
| `is_deleted`   | 逻辑删除标记                                          |

组件类型示例：

| dict_key       | value | label | children_key |
| -------------- | ----- | ----- | ------------ |
| COMPONENT_TYPE | 1     | 图表  | CHART        |
| COMPONENT_TYPE | 2     | 组件  | COMPONENT    |

## 全局 Save 规则

项目注册了 `SaveBodyInterceptor`，会对 `POST */save` 请求统一删除 `body.id`，避免新增接口误用前端传入的主键。

如果某个接口需要保留 `id`，可以使用：

```ts
@SkipSaveBodyNormalize()
```

## 启动项目

安装依赖：

```bash
pnpm install
```

开发环境：

```bash
pnpm start:dev
```

普通启动：

```bash
pnpm start
```

生产启动：

```bash
pnpm start:prod
```

## 文档地址

服务默认监听 `48085`：

- Swagger UI：`http://localhost:48085/api`
- OpenAPI JSON：`http://localhost:48085/api-json`
- Knife4j：由 `nestjs-knife4j-plus` 根据 `/api-json` 提供增强文档

接口细节见 [API.md](./API.md)。

## 常用校验

类型检查：

```bash
pnpm exec tsc --noEmit
```

格式化：

```bash
pnpm exec prettier --write "src/**/*.ts" "test/**/*.ts"
```

测试：

```bash
pnpm test
pnpm test:e2e
```
