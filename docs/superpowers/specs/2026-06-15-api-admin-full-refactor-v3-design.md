# API/Admin 第三期全量重构设计

## 背景

第一期已经完成 Runtime Foundation 与线上部署观测铺底，第二期完成了 API 全模块架构、全库表设计、QQBot 插件平台和 NapCat Runtime 的中文规划。第三期不再只修 QQBot，也不是继续追加局部补丁，而是进入用户确认的 C 阶段：按第二期规划完整迁移 API 全模块，并同步重构 Admin 管理端。

当前业务数据不重要，因此第三期允许从头设计数据库表，允许破坏式重建 schema，允许重写旧初始化 SQL 和旧模块结构。破坏式不等于无保护：本阶段必须把备份、回滚、验证 SQL、本地 dry run、线上发布观测和真实功能 smoke 作为同一条闭环的一部分。

本文件是 Superpowers brainstorming 的第三期设计落地文档。它只固化设计和执行边界，不创建实现分支，不清理 Admin 旧产物，不写业务实现。用户 review 本文件后，下一步进入 Superpowers `writing-plans`。

## 已确认决策

- 第三期范围是完整 C 阶段迁移，必须覆盖 API 全模块，不只做 Batch 0-2。
- API 与 Admin 一起重构。API 仓库使用 `dev/api-full-refactor-v3`，Admin 仓库使用 `dev/admin-full-refactor-v3`。
- 当前 Admin 仓库未提交改动属于旧产物，用户已授权在实现准备阶段放弃；设计阶段先不清理。
- 每个批次在本地完成 TDD、验证、review 和提交，不按批次推送。
- Batch 0-8 全部完成并通过本地闭环后，再统一推送、重建数据库、观察 Jenkins/K8s、执行线上完整 smoke。
- 数据库按全新 schema 设计，可破坏式重建，但必须有备份、恢复路径、验证 SQL 和 API 镜像回滚策略。
- QQBot 插件平台是统一平台能力，必须支持 manifest、CLI 脚手架、线上安装、热插拔、worker 或 child process 隔离、配置、健康、运行事件和账号绑定。
- NapCat Runtime 不是插件。它属于 QQBot/NapCat 基础运行时，必须独立实现设备身份持久化和登录状态机。
- NapCat 新设备验证必须实现 `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`，不能只把 `jumpUrl` 透给 Admin。
- SSE/Admin 必须展示完整中文进度：快速登录、密码登录、验证码、新设备二维码、已扫码、确认中、登录成功、登录失败。

## 范围

### API 仓库

第三期 API 重构覆盖：

- `runtime` 和 `common` 基础层。
- Admin/Auth/Platform Config。
- Blog/WordPress/Asset。
- QQBot Core。
- QQBot Plugin Platform。
- 现有 QQBot 插件重写。
- NapCat Runtime。
- 全量初始化 SQL、schema 文档、验证 SQL、备份和恢复脚本。
- 本地、发布、线上 smoke 和 KT/Superpowers review 证据。

### Admin 仓库

第三期 Admin 重构覆盖：

- 登录、菜单、权限、用户、角色、部门等身份和权限页面。
- 平台设置、字典、组件模板、系统通知。
- Blog/WordPress/Asset 管理页。
- QQBot 账号、连接、命令、规则、消息、发送队列管理页。
- QQBot 插件管理页：上传、校验、安装、启用、禁用、升级、卸载、配置、健康、运行事件、账号绑定。
- NapCat 登录管理页：设备身份、登录 session、验证码、新设备二维码、SSE 中文进度、清理失败提示。

Admin 不做独立产品改版。UI 调整服务于新 API 契约、状态语义和管理流程。

## 非目标

- 本设计阶段不写实现代码。
- 本设计阶段不创建 `dev/api-full-refactor-v3` 或 `dev/admin-full-refactor-v3` 分支。
- 本设计阶段不清理 Admin 旧未提交改动。
- 不保留旧表结构来迁就旧数据。
- 不把 NapCat 登录安全校验做成自动绕过。
- 不允许线上插件直接访问后端真实密钥、TypeORM Repository、Nest DI 或任意宿主文件路径。
- 不把 Jenkins/K8s 成功当成功能完成。线上真实 smoke 是完成条件的一部分。

## 分支和仓库策略

实现准备阶段按顺序处理：

1. 确认 API 仓库状态，基于当前 `main` 创建 `dev/api-full-refactor-v3`。
2. 确认 Admin 仓库状态，放弃用户已授权的旧未提交产物后，基于当前 `main` 创建 `dev/admin-full-refactor-v3`。
3. API 与 Admin 分别提交，提交信息使用英文 type 前缀加中文说明。
4. 每个批次可以产生 API 提交、Admin 提交或两者都有的提交。
5. Batch 8 本地闭环完成前不推送。
6. 统一推送前再次确认两仓 diff、提交序列、数据库破坏式操作范围和回滚入口。

跨仓依赖以 API 契约为中心：API 批次先定义 contract、schema 和状态语义，Admin 同批次或紧随其后完成 caller、页面状态和 smoke。任何 breaking change 必须在批次开始前写入 breaking-change 清单。

## 目标模块架构

API 目标结构继承第二期规划：

```text
src/
  runtime/
  common/
  modules/
    admin/
    blog/
    wordpress/
    asset/
    qqbot/
```

模块内部使用稳定分层：

```text
module/
  contract/
  application/
  domain/
  infrastructure/
    persistence/
    integration/
  schema/
  tests/
```

- `contract`：Controller、DTO、Swagger、SSE 事件和外部兼容适配。
- `application`：用例编排、事务、权限、状态流转和跨端契约。
- `domain`：纯规则、状态机、策略和值对象，不依赖 Nest、TypeORM、Docker 或 HTTP。
- `infrastructure/persistence`：Entity、Repository、查询模型和 schema mapper。
- `infrastructure/integration`：WordPress、MinIO、Loki、OneBot、NapCat WebUI、Docker、插件 worker RPC。
- `schema`：表设计、初始化 SQL、验证 SQL、备份恢复说明和批次迁移记录。
- `tests`：unit、contract、repository、integration smoke 和回归用例。

Admin 目标结构以功能域组织 API caller、页面、组件和状态适配，避免把 QQBot、插件平台、NapCat 状态继续塞进单一大页面。

## 全库表重建设计

第三期以全新 schema 为目标，不做旧表兼容迁移。表设计必须在 Batch 0 冻结第一版，并在每个后续批次按模块补齐实现。

全局约定：

- 主键使用 Snowflake `BIGINT`，API 边界按字符串语义处理。
- 外键列使用 `*_id`，查询路径必须建索引。
- 业务强关系使用唯一约束，日志和事件类表避免强外键。
- 时间字段使用 `create_time`、`update_time`，软删使用 `delete_time`。
- 状态字段使用明确 varchar 枚举，允许值写入 schema 文档。
- JSON 字段只放外部原始 payload、低频配置、插件 metadata 或证据详情；需要查询的字段必须结构化。
- 初始化 SQL 是全量干净 schema，不继续堆叠历史 `ALTER TABLE`。

核心数据域：

| 数据域 | 表设计方向 |
| --- | --- |
| Admin Identity | 用户、角色、权限、菜单、部门、用户角色、角色权限、角色菜单分离，菜单路由和权限原子拆清。 |
| Platform Config | 字典组、字典项、组件模板、平台设置、系统通知独立成域。 |
| Blog Content | 文章、分类法、术语、文章术语关系、主题 profile、导入 job 分离。 |
| WordPress Mirror | 站点、认证会话、远端文章、远端术语、同步 job、远近端 mapping 分离。 |
| Asset/MinIO | bucket、object、reference、access grant 记录对象归属、MIME、来源模块和临时授权。 |
| System Event | notice、event、dedupe、delivery 保存可处理事件和投递状态，Loki 仍是日志查询源。 |
| Runtime Evidence | 保存重要运行证据索引，不把大日志和 secrets 放入 MySQL。 |
| QQBot Core | 账号、连接 session、能力绑定、权限策略、命令、别名、规则、会话、消息、发送任务、发送日志、去重事件分离。 |
| NapCat Runtime | 容器、设备身份、账号绑定、登录 session、登录 challenge、清理记录分离。 |
| QQBot Plugin Platform | 插件、版本、安装、operation、event handler、账号绑定、配置、资产、运行事件分离。 |
| Plugin-Owned Data | 插件自有表必须带 plugin key 或注册 namespace 前缀。 |

破坏式重建流程必须包含：

1. 本地空库 dry run：应用全量 SQL、seed、验证 SQL、API 启动、关键接口 smoke。
2. 线上备份：备份当前 API 数据库，记录备份路径、时间、库名和恢复命令。
3. 写流量限制：在 drop 或 rename 旧表前停止或限制 API 写流量。
4. 应用新 schema：按批准脚本重建表、索引、seed、插件 metadata 和菜单权限。
5. 绑定 API 镜像：schema 版本和 API 镜像作为同一回滚单元。
6. 线上验证：Admin、Blog、Asset、QQBot、插件平台、NapCat、`/health/runtime` smoke。
7. 失败恢复：恢复备份或切回旧 schema bundle，并回滚 API/Admin 镜像。

## QQBot 插件平台设计

插件平台是第三期独立核心能力。它不是把现有插件目录挪位置，而是建立统一 contract、安装链路、运行隔离和 Admin 管理面。

### 插件包结构

```text
plugins/<pluginKey>/
  plugin.json
  src/
    index.ts
    operations/
    events/
    config/
    migrations/
    assets/
    tests/
```

`plugin.json` 是单一事实来源，包含：

- plugin key、名称、描述、版本、作者、license、主页。
- 最低 API plugin SDK 版本。
- 权限声明。
- operations、event handlers、config schema、assets、migrations。
- runtime 要求：timeout、memory limit、worker type、并发策略。

### CLI 脚手架

API 仓库提供插件 CLI：

```bash
pnpm qqbot-plugin create <pluginKey>
pnpm qqbot-plugin validate <path>
pnpm qqbot-plugin pack <path>
pnpm qqbot-plugin install-local <package>
```

`create` 生成初始插件模块结构、manifest、入口、operation 模板、event 模板、config schema、migration 模板、contract tests 和说明草稿。

`validate` 校验 manifest shape、operation key、event key、权限声明、migration、assets、包大小、禁用路径和基础测试。

`pack` 输出带版本和 content hash 的插件包。

`install-local` 走与线上安装相同的校验链路，避免本地与线上行为分叉。

### 运行隔离

插件代码运行在 worker 或 child process 中。API 主进程只负责安装包、校验、registry、路由、权限和受控 SDK。

RPC 协议必须支持：

- `load`
- `activate`
- `deactivate`
- `executeOperation`
- `handleEvent`
- `health`
- `dispose`

插件崩溃、超时或健康失败只影响对应插件 installation，不能拖垮 API 主进程。Host 记录插件 runtime event，并把状态暴露给 Admin。

插件 SDK 只能提供受控能力：

- 走 host 发送队列发送 QQBot 消息。
- 读写插件配置。
- 读写插件自有 storage。
- 发送插件运行事件。
- 通过 host runtime HTTP client 调外部 API。
- 从声明 asset root 读取资源。
- 读取当前 operation 或 event context。

插件不得读取真实环境变量、任意宿主文件、Nest DI、TypeORM 原始 Repository 或跨插件私有数据。

### 线上安装和热插拔

状态机：

```text
uploaded -> validated -> installed -> enabled
enabled -> disabled
installed -> uninstalled
enabled -> upgrading -> enabled
enabled -> failed
```

Admin 上传插件包后，API 负责校验 manifest、hash、版本兼容、权限、migration 和 assets。启用时启动 worker 并注册 operation/event。禁用时停止 worker 并从 active registry 移除。卸载时停止 worker、移除 registry 和绑定，默认保留插件数据，只有管理员明确选择清理才删除插件自有数据。

### 现有插件重写

- BangDream：作为大型参考插件重写，保留 song、card、character、event、gacha、player、cutoff、provider、renderer、theme、assets 等能力边界，operation metadata 由 manifest 支撑，图片 smoke 行为必须保留。
- FF14 Market：外部查询插件，通过 host runtime HTTP SDK 调用 XIVAPI 和 Universalis。
- FFLogs：外部查询插件，通过 host runtime HTTP SDK 调 GraphQL/token，凭据来自插件 config 的受控引用。
- Repeater：事件插件，由 host 管理账号绑定和发送队列，插件只维护自身策略状态，不能绕过限流和队列。

## NapCat Runtime 设计

NapCat Runtime 排在 QQBot Core 和插件平台之后实现，但它不是插件。它属于账号、容器、设备身份和登录安全流程的基础运行时。

目标：

- Docker 设备状态持久化，避免每次重建容器都被 QQ 识别成新设备。
- 设备身份是一等数据：容器名、data dir、hostname、machine-id、MAC、账号绑定、验证状态和最后登录证据必须可追踪。
- 登录状态机保持清晰：快速登录、密码登录、验证码、新设备验证、二维码 fallback、成功、失败、清理失败各自独立。
- 新设备验证按 NapCat 上游流程完成：`GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`。
- SSE/Admin 全中文进度可观察，用户能知道当前卡在扫码、确认、验证码、清理失败还是最终失败。
- 运行态密码清理失败必须阻断成功或二维码 fallback，并写入明确错误，不被普通离线原因覆盖。

登录顺序：

```text
quick login -> saved password login -> captcha challenge -> new device QR challenge -> manual QR fallback
```

验证码处理：

- `proofWaterUrl` 只作为用户完成腾讯验证码的入口。
- 用户提交 `ticket`、`randstr`、`sid` 后，API 调 NapCat `CaptchaLogin`。
- 不伪造验证码票据，不绕过腾讯安全校验。
- 一旦 session 进入 captcha pending，后续状态缺少 URL 也不能直接失败，必须保留 challenge 语义。

新设备验证处理：

- `CaptchaLogin` 或登录状态返回 `needNewDevice` 时，API 创建或更新 new-device challenge。
- API 调 NapCat `GetNewDeviceQRCode` 获取新设备二维码，不只透传 `jumpUrl`。
- API 周期调用 `PollNewDeviceQR`，把未扫码、已扫码、确认中、过期、失败状态映射为中文 SSE/Admin 状态。
- 用户确认后 API 调 `NewDeviceLogin`，同一登录 session 继续完成登录。
- 新设备验证成功后保留设备身份证据，后续容器重建复用持久化设备状态。

SSE/Admin 状态至少覆盖：

- 正在快速登录。
- 快速登录失败，进入密码登录。
- 正在密码登录。
- 需要验证码。
- 验证码已提交，等待 NapCat 确认。
- 需要新设备验证二维码。
- 新设备二维码待扫码。
- 新设备二维码已扫码。
- 新设备确认中。
- 新设备验证成功，继续登录。
- 正在生成手动二维码。
- 登录成功。
- 登录失败。
- 运行态清理失败。

## 执行批次

### Batch 0：迁移准备

产物：

- API/Admin 双仓分支准备方案。
- Admin 旧产物清理记录。
- 全库 schema map。
- 全量初始化 SQL 草案。
- 破坏式重建脚本设计。
- 备份和恢复命令。
- 验证 SQL。
- 模块模板。
- breaking-change 清单。
- API/Admin 契约矩阵。

验收：

- 空库 schema dry run 可执行。
- 初始 seed 覆盖 Admin 登录、菜单、基础设置、插件 metadata 和 QQBot 基础命令。
- writing-plans 输出的任务能够映射到 Batch 1-8。

### Batch 1：Runtime/Common

范围：

- 稳定 runtime profile、runtime client、evidence、timeout、process/Docker adapter、错误分类。
- 收缩 common，只保留通用响应、错误、时间、Snowflake、日志基础能力。

验收：

- `/health/runtime` 行为稳定。
- 现有 runtime tests 继续通过。
- 下游模块可以通过统一 adapter 接入外部 HTTP、process、Docker 和证据记录。

### Batch 2：Admin/Auth/Platform Config

范围：

- 重建身份、角色、权限、菜单、部门、字典、组件模板、平台设置和系统通知模型。
- Admin 登录、菜单、权限页面同步新 contract。

验收：

- 本地真实登录接口通过。
- Admin 菜单加载和页面路由通过。
- 权限、菜单、字典、设置的增删改查通过 scoped smoke。

### Batch 3：Blog/WordPress/Asset

范围：

- 重建 Blog 内容、分类法、术语关系、主题 profile。
- 重建 WordPress mirror、sync job、mapping。
- 重建 MinIO asset 归属、引用和临时授权。
- Admin Blog、WordPress、Asset 页面同步新 contract。

验收：

- Blog public list/detail 本地真实请求通过。
- Admin Blog 管理 smoke 通过。
- WordPress 同步 dry run 或受控 smoke 通过。
- Asset 上传、引用和读取 smoke 通过。

### Batch 4：QQBot Core

范围：

- 重建账号、连接 session、能力绑定、权限策略、命令、别名、规则、会话、消息、发送任务、发送日志和去重事件。
- 拆清 OneBot 连接、容器、WebUI 和 QQ 登录态。
- Admin QQBot 基础管理页同步新 contract。

验收：

- 命令 registry 和 command SQL 测试通过。
- 发送队列、去重、权限策略单测通过。
- `/qqbot/command/test` 本地真实请求通过。
- Admin QQBot 账号和命令页面 smoke 通过。

### Batch 5：QQBot Plugin Platform

范围：

- 插件 manifest schema。
- 插件 registry 数据库。
- CLI `create/validate/pack/install-local`。
- worker 或 child process runtime。
- RPC 协议。
- 线上安装、启用、禁用、升级、卸载。
- 插件配置、健康、运行事件、账号绑定。
- Admin 插件管理页面。

验收：

- CLI 创建插件并通过 validate。
- pack 产物含 hash，install-local 走统一校验链路。
- worker load、activate、execute、health、deactivate、崩溃隔离测试通过。
- Admin 插件上传、安装、启用、禁用 smoke 通过。

### Batch 6：现有插件重写

范围：

- BangDream 重写为平台插件。
- FF14 Market 重写为平台插件。
- FFLogs 重写为平台插件。
- Repeater 重写为平台插件。
- 旧硬编码插件 registry 退出。

验收：

- BangDream 现有核心命令和图片 smoke 通过。
- FF14 Market 查询 smoke 通过。
- FFLogs 查询 smoke 通过。
- Repeater 事件策略和发送队列 smoke 通过。
- Admin 能查看插件 operation、配置、健康和运行事件。

### Batch 7：NapCat Runtime

范围：

- Docker 设备状态持久化。
- NapCat 容器、设备身份、账号绑定、登录 session、challenge、cleanup 记录。
- 快速登录、密码登录、验证码、新设备验证、二维码 fallback 状态机。
- `GetNewDeviceQRCode -> PollNewDeviceQR -> NewDeviceLogin`。
- SSE/Admin 中文进度。
- 清理失败阻断成功。

验收：

- 本地 NapCat login session 状态机单测通过。
- API 真实本地请求覆盖验证码和新设备 challenge 模拟。
- Admin 登录页面进度 smoke 通过。
- 容器重建后设备身份持久化证据可查询。

### Batch 8：统一上线闭环

范围：

- API/Admin 最终本地验证。
- 两仓统一推送。
- 数据库备份、重建、seed、验证 SQL。
- Jenkins/K8s 观测。
- 线上完整 smoke。
- 真实 QQBot/NapCat 账号闭环验证。

验收：

- Jenkins build number、commit hash、镜像 tag、Deployment generation、Pod image、restart count 和日志证据齐全。
- `/health/runtime` 线上通过。
- Admin 登录、菜单、关键管理页线上通过。
- Blog public 线上通过。
- 插件安装、启用、健康、命令线上通过。
- `/qqbot/command/test` 线上按 operationKey 查询 commandId 后通过。
- NapCat 真实账号完成登录闭环，包含设备持久化和新设备验证链路。

## 每批验证和提交节奏

每个批次必须按同一节奏执行：

1. RED：先写或定位失败检查，包括单测、schema 验证、contract smoke 或 Admin smoke。
2. GREEN：做最小足够实现。
3. 本地验证：按批次风险运行 typecheck、scoped lint、scoped Jest、真实 API 请求和 Admin smoke。
4. 文档同步：更新 schema、README/API、TASKS 或相关 docs。
5. KT global review。
6. Superpowers code review。
7. 批次提交，API/Admin 分仓提交。

接口变化必须真实本地调用一次。发布或线上功能必须通过对应线上 self-test 后才能声明完成。

## 推送和上线策略

第三期本地实现期间不推送。Batch 0-8 全部本地完成后，统一执行：

1. 双仓最终 `git status` 和 diff 复核。
2. 本地完整轻量验证矩阵。
3. 用户确认推送和破坏式数据库动作窗口。
4. 推送 API 和 Admin 分支或目标分支。
5. 确认 Jenkins build number 和 commit hash。
6. 观察 K8s Deployment、Pod、image tag、restart count 和日志。
7. 线上数据库备份、重建、seed、验证 SQL。
8. 线上 API/Admin/Blog/QQBot/插件/NapCat smoke。

如果线上 smoke 失败，按 schema 与 API 镜像绑定回滚：恢复数据库备份或旧 schema bundle，回滚 API/Admin 镜像，记录失败点和稳定解法。

## 风险和控制

- 范围过大：通过 Batch 0-8 拆分，每批有独立 RED/GREEN、review、commit 和验收。
- 数据库破坏式重建风险：本地空库 dry run、线上备份、恢复命令、验证 SQL 和镜像绑定回滚。
- API/Admin 契约漂移：每批维护 contract matrix，接口变化必须真实调用，Admin 同步 smoke。
- 插件安全风险：manifest 权限、hash 校验、受控 SDK、worker 隔离、运行事件和禁用路径校验。
- NapCat 状态混淆：QQ 登录态、OneBot 连接、容器、WebUI、验证码、新设备、清理失败分别建模。
- 线上成功误判：Jenkins/K8s 只算部署证据，功能完成必须有线上 smoke。

## 本设计验收标准

本设计阶段完成条件：

1. 本文件写入 `docs/superpowers/specs/`。
2. 本文件通过占位、矛盾、范围和模糊性自检。
3. `TASKS.md` 记录第三期设计上下文。
4. API 和根仓库文档变更分别提交。
5. 用户 review 本文件。
6. 用户确认后进入 Superpowers `writing-plans`，再产出可执行计划。

## 交接到 writing-plans

`writing-plans` 必须把本设计转换为可执行计划，至少包含：

- Batch 0-8 逐批任务清单。
- 每批 RED/GREEN 测试入口。
- API/Admin 双仓文件范围。
- 表设计和初始化 SQL 产物路径。
- 破坏式重建、备份、恢复、验证 SQL 细节。
- 插件 CLI、worker runtime、Admin 插件管理页任务拆分。
- NapCat 设备持久化和新设备验证任务拆分。
- 每批提交、review、清理、文档同步和最终上线闭环门禁。

在用户 review 本文件前，不进入实现，也不进入分支清理或 Admin 旧产物处理。
