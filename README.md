# KT Template Online API

KT 的 NestJS 后端，提供 Admin、博客、文件服务、Bot 适配器和插件平台。

## 本地使用

使用 Windows 工具链、Node.js 22 和 pnpm；依赖 MySQL、Redis，以及所启用模块对应的服务。按 `.env.example` 准备私有开发配置，真实凭据不要提交。

```powershell
pnpm install
pnpm start:dev
```

本地服务端口为 `48085`。使用现有开发配置时，先核对数据库和外部服务目标；普通启动不负责创建隔离数据库。

`start:local`、`start:local:dev`、`verify:local` 是依赖 Bash/`setsid` 的旧隔离入口，会重建 `kt_template_local` 或 `kt_template_local_*` 可丢弃库。它们不适用于直接在 Windows PowerShell 运行；常规 Windows 开发使用上面的 Nest 入口。Windows/WSL 权威边界见 [工作区规则](../../AGENTS.md)。

## 常用验证

```powershell
pnpm run typecheck
pnpm exec jest --runInBand --runTestsByPath test/path/to/file.spec.ts
```

按修改范围选择已有测试。接口修改还需真实调用本地服务；发布规则由工作区 AGENTS 和发布流程维护。

## 入口

- [必要 API 约定](API.md)，完整 DTO/参数见运行服务的 Swagger `/api` 和 OpenAPI `/api-json`。
- [中央项目文档](../../docs/projects/api/index.md)：详细合同、运维参考和历史设计。
- 源码：`src/modules/`；初始化与迁移：`sql/`；有界运维入口：`scripts/`；测试：`test/`。

## 来源与许可证

BangDream 能力包含 [Tsugu BangDream Bot](https://github.com/Yamamoto-2/tsugu-bangdream-bot) 的 MIT 授权来源，保留仓库内 `TSUGU-LICENSE`。
