# API/Admin 第三期架构收敛批次设计

## 背景

第三期全量重构已经完成了基础能力、schema、插件平台、NapCat 登录链路和线上闭环，但当前源码结构仍没有完全兑现第三期目标架构：API 业务实现仍散落在 `src/admin`、`src/blog`、`src/minio`、`src/wordpress`、`src/qqbot`，`src/modules/**` 仍大量反向导入旧根。用户已确认本批次选择“方案 A：强门禁全收敛”。

本批次目标不是“继续能跑”，而是让第三期目标架构在当前代码里变成事实：旧根删除，业务实现归入 `src/modules/**`，结构测试阻止回退，Admin 同步按功能域整理，并在迁移过程中清理无用代码、废话代码和重复胶水，同时保持现有功能一致。

## 已确认原则

- 先清干净工作区，再开始架构收敛。
- 清理前必须分类：旧产物可删除，当前目标产物才提交，不确定的改动先停下来确认。
- 不做无意义备份、临时日志提交、根目录临时文件或为了“保险”留下的补丁文件。
- API 与 Admin 使用开发分支，不使用 `.worktree`。
- 本批次必须覆盖父级模块、子模块、插件目录和 Admin 页面/caller/state，不只移动父级目录。
- 功能行为保持一致，内部结构可以破坏式收敛。
- 完成条件必须由结构测试、typecheck、Jest、真实接口 smoke、Admin typecheck/page smoke 和 review 共同证明。

## 当前状态证据

清理后工作区状态：

- 根仓库 `D:\MyFiles\KT`：`main`，干净。
- API 仓库 `D:\MyFiles\KT\Node\kt-template-online-api`：`dev-api-architecture-convergence-v3`，干净。
- Admin 仓库 `D:\MyFiles\KT\Vue\kt-template-admin`：`dev-admin-architecture-convergence-v3`，干净。
- 其他 KT 子仓库：干净。

API 当前旧结构计数：

| 路径 | 文件数 | 目录数 | 本批次结论 |
| --- | ---: | ---: | --- |
| `src/admin` | 42 | 11 | 旧根，必须迁入 `src/modules/admin/**` 后删除。 |
| `src/blog` | 13 | 0 | 旧根，必须迁入 `src/modules/blog/**` 后删除。 |
| `src/minio` | 5 | 0 | 旧根，必须迁入 `src/modules/asset/**` 后删除。 |
| `src/wordpress` | 9 | 0 | 旧根，必须迁入 `src/modules/wordpress/**` 后删除。 |
| `src/qqbot` | 55 | 14 | 旧根，必须迁入 `src/modules/qqbot/**` 后删除。 |
| `src/modules` | 293 | 52 | 目标业务根，但当前仍依赖旧根。 |
| `src/common` | 26 | 11 | 允许保留，仅限跨模块基础能力。 |
| `src/runtime` | 13 | 5 | 允许保留，仅限运行时基础能力。 |

`src/modules/**` 当前反向导入旧根计数：

| 禁止导入 | 当前命中数 | 本批次结论 |
| --- | ---: | --- |
| `@/admin/` | 37 | 必须归零。 |
| `@/blog/` | 7 | 必须归零。 |
| `@/minio/` | 3 | 必须归零。 |
| `@/wordpress/` | 7 | 必须归零。 |
| `@/qqbot/` | 50 | 必须归零。 |

Admin 当前结构证据：

- `apps/web-antdv-next/src/api/qqbot` 目前有 `index.ts`、`napcat.ts`、`plugin.ts` 和测试文件，caller 初步拆分但仍需按 Core、Plugin Platform、NapCat 的契约边界收敛类型和复用请求模型。
- `apps/web-antdv-next/src/views/qqbot` 已按 account、command、conversation、dashboard、message、permission、plugin、rule、sendLog 等页面散开，但页面状态、状态标签、登录进度、插件操作和 QQBot 基础管理仍需要统一复用边界。

## 范围

### API

必须完成：

- 删除旧根：`src/admin`、`src/blog`、`src/minio`、`src/wordpress`、`src/qqbot`。
- 所有业务实现迁入 `src/modules/**`：
  - `src/modules/admin/**`
  - `src/modules/blog/**`
  - `src/modules/wordpress/**`
  - `src/modules/asset/**`
  - `src/modules/qqbot/core/**`
  - `src/modules/qqbot/napcat/**`
  - `src/modules/qqbot/plugin-platform/**`
  - `src/modules/qqbot/plugins/**`
- `src/modules/**` 不再导入 `@/admin/*`、`@/blog/*`、`@/minio/*`、`@/wordpress/*`、`@/qqbot/*`。
- `src/app.module.ts` 只注册目标模块，不注册旧根 shim。
- Entity、DTO、Controller、Service、domain policy、integration client、plugin implementation、tests 按实际模块归属移动。
- `src/common` 只保留真正跨模块基础能力，例如响应、错误、时间、Snowflake、日志、装饰器、通用工具。
- `src/runtime` 只保留运行时基础能力，例如 HTTP/process/Docker adapter、runtime evidence、health。
- 删除或合并迁移后无引用的重复类型、重复常量、临时兼容胶水、空目录和纯转发文件。

### Admin

必须完成：

- 按功能域同步 API caller 和类型：
  - Admin/Auth/Platform Config。
  - Blog/WordPress/Asset。
  - QQBot Core。
  - QQBot Plugin Platform。
  - NapCat 登录与设备。
- QQBot 页面按 Core、Plugin Platform、NapCat 三条边界整理状态和组件，避免账号页、插件页、登录页各自复制状态标签、进度文案、错误归一化和请求处理。
- 插件管理、NapCat 登录进度、QQBot 账号/命令/规则/消息/发送队列现有功能保持一致。
- 清理无引用组件、重复枚举、过时类型、临时兼容 caller 和只包一层的无意义函数。

### 测试与文档

必须补齐：

- API 结构测试：旧根不存在、`src/modules/**` 禁止导入旧根、目标模块边界存在。
- API 行为验证：typecheck、聚焦 Jest、核心接口真实本地 smoke。
- Admin 行为验证：typecheck、关键 QQBot/插件/NapCat 页面 smoke。
- 文档同步：架构收敛说明、必要 API/Admin 契约说明、`TASKS.md` 简短记录。
- KT global review 与 Superpowers code review。

## 非目标

- 不新增业务功能。
- 不重新发明第三期 schema，除非迁移 Entity 暴露出当前 schema 与代码不一致；若发现，必须单独列为修复项并有验证。
- 不为了目录好看创建空的 `domain/application/infrastructure` 文件夹。
- 不保留旧根作为“兼容层”。
- 不把功能保持一致理解为保留内部旧路径。
- 不清理与本批次无关的其他 KT 子仓库。
- 不推送、不部署、不做线上数据库操作，除非后续用户明确要求进入上线闭环。

## 目标架构

API 目标顶层：

```text
src/
  app.module.ts
  common/
  runtime/
  modules/
    admin/
    asset/
    blog/
    wordpress/
    qqbot/
```

允许的业务模块内部结构按实际复杂度使用：

```text
module/
  contract/
  application/
  domain/
  infrastructure/
  tests/
```

规则：

- `contract` 放 Controller、DTO、SSE event、外部 API 适配。
- `application` 放用例编排、事务、跨服务状态流转。
- `domain` 放不依赖 Nest/TypeORM/Docker/HTTP 的规则和值对象。
- `infrastructure` 放 Entity、Repository、外部集成 client、Docker/NapCat/WordPress/MinIO/worker adapter。
- 小模块可以少层，但不能通过一个大 `*.module.ts` 继续导入旧根。
- 插件代码仍在 `src/modules/qqbot/plugins/**`，但插件内部也要按业务能力瘦身，不能把旧顶层 bucket 迁回插件内部。

Admin 目标：

```text
apps/web-antdv-next/src/
  api/
    system/
    blog/
    qqbot/
      core or index
      plugin
      napcat
  views/
    system/
    blog/
    qqbot/
      account/
      command/
      message/
      permission/
      plugin/
      napcat/
      shared/
```

Admin 允许沿用现有 Vben/Antdv/Vue TSX 组织方式，但状态文案、状态 tag、SSE 进度映射、插件操作按钮和 API 错误解析必须抽到可复用边界。

## 清理分类标准

每个待处理文件必须归类后再改：

| 分类 | 判断标准 | 动作 |
| --- | --- | --- |
| 旧产物 | 位于旧根、只为旧路径存在、迁移后无调用、过渡 shim、重复兼容类型、临时胶水。 | 迁移必要逻辑后删除，不提交保留副本。 |
| 应提交 | 新目标结构、结构测试、必要行为修复、文档同步、验证脚本或真实复用抽象。 | 分批提交。 |
| 需保留 | `src/common`/`src/runtime` 中真实跨模块能力、Admin/Vben 框架基础能力、功能保持所需兼容输入输出。 | 保留并把 import 改到目标边界。 |
| 不确定 | 看起来无引用但可能由反射、Nest DI、路由、SQL seed、插件 manifest 或外部入口调用。 | 先加搜索证据；只有测试或真实 smoke 证明无活入口后才能删除。 |

无意义内容包括：

- 单纯转发旧根的 shell module。
- 迁移后没人引用的 DTO/type/entity。
- 与当前功能无关的 demo 页面或临时测试入口。
- 只重复包一层 request、没有统一错误/状态价值的 Admin helper。
- 空目录、重复常量、重复中文状态文案。
- 生成日志、截图、patch 备份、临时 JSON。

## 收敛顺序

### 1. RED 结构门禁

先新增失败的结构测试，明确最终架构：

- `src/admin`、`src/blog`、`src/minio`、`src/wordpress`、`src/qqbot` 必须不存在。
- `src/modules/**` 不得导入旧根。
- `src/modules/{admin,asset,blog,wordpress,qqbot}` 必须存在。
- `src/modules/qqbot/{core,napcat,plugin-platform,plugins}` 必须存在。
- `src/app.module.ts` 不得导入旧根。

这些测试在迁移前应失败，迁移结束必须通过。

### 2. Admin/Auth/Platform Config

把 `src/admin/**` 迁入 `src/modules/admin/**`：

- identity：auth、user、role、menu、dept、guard、JWT。
- platform-config：dict、component、notice、timezone、system-log；`example` 只有在菜单、路由或测试仍证明它是现有功能入口时才迁移，否则删除。
- 清理重复 DTO、过渡 module、旧 import。
- Admin system caller/page 只做必要同步，保持登录、菜单、字典、通知等现有行为。

### 3. Blog/WordPress/Asset

把 `src/blog/**`、`src/wordpress/**`、`src/minio/**` 迁入目标模块：

- Blog 内容、术语、主题配置进入 `src/modules/blog/**`。
- WordPress 授权、远端文章/分类/标签/主题进入 `src/modules/wordpress/**`。
- MinIO controller/service 进入 `src/modules/asset/**`，对外路由保持兼容。
- 清理只为旧路径存在的 module 和 import。
- Admin blog/asset caller 保持现有页面行为。

### 4. QQBot Core 与 NapCat

把 `src/qqbot/account`、`command`、`connection`、`dashboard`、`dedupe`、`message`、`mqtt`、`permission`、`rule`、`send`、`config` 等核心能力迁入 `src/modules/qqbot/core/**`。

把 `src/qqbot/napcat/**` 和登录相关服务迁入 `src/modules/qqbot/napcat/**`，保持：

- Docker 设备身份持久化。
- quick -> password -> captcha -> new-device -> manual QR 登录顺序。
- `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`。
- SSE/Admin 中文进度。
- QQ 登录态、OneBot、WebUI、容器状态继续拆开。

### 5. Plugin Platform 与现有插件

收敛 `src/modules/qqbot/plugin-platform/**` 与 `src/modules/qqbot/plugins/**`：

- 插件平台不得继续依赖旧 `@/qqbot/plugin` registry。
- 插件接口类型从目标平台 contract 或 SDK 引入。
- BangDream、FF14 Market、FFLogs、Repeater 插件内部扫描无用 bucket、重复 provider、旧 key 胶水和直接 HTTP 绕过。
- `legacyKeys` 只作为外部数据兼容语义保留；不能成为保留旧源码根的理由。

### 6. Admin QQBot 全域瘦身

整理 Admin QQBot 管理面：

- Core 管理：账号、命令、规则、消息、权限、发送队列。
- Plugin Platform：插件安装、启用、禁用、配置、健康、事件、账号绑定。
- NapCat：设备身份、登录 session、验证码、新设备二维码、扫码/确认/成功/失败进度。
- 抽取共享状态映射、tag 渲染、SSE 进度解析、API 错误归一化。
- 删除无引用页面、组件、重复类型和临时兼容函数。

### 7. 旧根删除与最终验证

删除旧根后运行完整门禁：

- `rg --files src/admin src/blog src/minio src/wordpress src/qqbot` 必须找不到路径。
- `rg '@/admin/|@/blog/|@/minio/|@/wordpress/|@/qqbot/' src/modules` 必须无命中。
- API `pnpm run typecheck` 通过。
- API 聚焦 Jest 通过；删除旧根后的最终批次运行 API 全量 Jest。
- API 本地真实 smoke 覆盖 `/health/runtime`、Admin 登录/菜单、Blog public、Asset 上传/下载、QQBot command test、插件平台、NapCat 模拟登录状态机。
- Admin typecheck 通过。
- Admin 关键页面 smoke 通过。
- KT global review 与 Superpowers review 无阻断。

## 提交策略

本批次提交必须表达真实进展：

1. `test/refactor: 增加架构收敛门禁`。
2. `refactor: 收敛Admin与平台配置模块`。
3. `refactor: 收敛Blog WordPress Asset模块`。
4. `refactor: 收敛QQBot核心与NapCat模块`。
5. `refactor: 收敛QQBot插件平台与现有插件`。
6. `refactor: 收敛Admin QQBot管理边界`。
7. `test: 完成架构收敛验证闭环`。

实际执行时可按风险拆得更细，但每个提交都必须满足：

- 没有混入生成产物或备份文件。
- 没有不相关仓库改动。
- 提交前 `git status` 已确认。
- 若删除文件，已经用搜索、类型检查或测试证明不是活入口。

## 验收标准

本批次完成必须同时满足：

- API 旧根 `src/admin`、`src/blog`、`src/minio`、`src/wordpress`、`src/qqbot` 全部不存在。
- `src/modules/**` 对旧根导入为 0。
- Admin QQBot/插件/NapCat 页面和 caller 完成边界瘦身，没有重复进度文案和明显无引用旧代码。
- 现有 API 路由和 Admin 功能保持一致。
- 插件平台和现有插件仍可安装、启用、执行、查看健康和运行事件。
- NapCat 登录链路仍覆盖设备持久化、验证码、新设备验证、手动 QR fallback 和中文进度。
- 所有计划中的验证命令有当前证据。
- 代码 review 门禁通过。
- 工作区最终干净。

## 交接到 writing-plans

用户审阅并确认本 spec 后，下一步进入 Superpowers `writing-plans`。计划必须把本 spec 拆成可执行任务，尤其要写清：

- 结构测试的 RED/GREEN 步骤和精确文件路径。
- 每个旧根迁移到哪个目标模块。
- 每批删除前的引用扫描命令。
- 每批需要保留的行为 smoke。
- Admin 共享状态/进度/错误处理抽取位置。
- 插件和 NapCat 的功能保持验证。
- 每批提交前的干净度检查和 review 门禁。
