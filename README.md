# KT Template Online API

`kt-template-online-api` 是 KT Template Online 的后端服务，负责组件模板、数据库字典和 MinIO 文件能力。前台列表和 Playground 保存都通过本服务完成数据读写。

## 技术栈

- Node.js + TypeScript
- NestJS 9
- TypeORM + MySQL
- MinIO
- Swagger / Knife4j
- pnpm

## 功能模块

| 模块 | 说明 |
| --- | --- |
| `component` | 组件/图表模板的列表、详情、新增、编辑、逻辑删除 |
| `dict` | 数据库字典查询，维护组件一级类型和二级类型关系 |
| `minio` | Bucket 检查/创建、文件上传、列表、临时访问地址、下载和删除 |
| `common` | 响应注解、字典翻译、`POST */save` 请求体规范化等通用能力 |

## 目录结构

```text
src
  common/       # 通用装饰器、拦截器、服务、Swagger 封装
  component/    # 组件模板模块
  dict/         # 字典模块
  minio/        # MinIO 文件模块
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
```

`DB_SYNC=true` 会让 TypeORM 根据实体同步表结构。生产环境建议关闭同步，改用迁移脚本维护表结构。

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

## 核心规则

- `dict` 表是字典翻译数据源，`Component.typeMsg` 和 `Component.componentTypeMsg` 查询后自动映射。
- `POST /component/save` 新增组件，`POST /component/update` 编辑组件。
- 全局 `SaveBodyInterceptor` 会删除 `POST */save` 请求体里的 `id`，避免新增接口误用前端主键。
- 如个别 `save` 接口必须保留 `id`，在 Controller 方法上使用 `@SkipSaveBodyNormalize()`。
- MinIO 上传接口返回的 `url` 会被 Playground 写入组件 `image` 字段。

## 联调关系

- `kt-template-online-web` 读取 `/component/list`、`/component/detail`、`/dict/*` 展示组件列表，并生成 Playground 跳转链接。
- `kt-template-online-playground` 读取 `/dict/*` 初始化分类，保存时上传截图到 `/minio/upload`，再调用 `/component/save` 或 `/component/update`。
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
