# API 全模块架构、全库表设计与 QQBot 插件平台设计

## 背景

`kt-template-online-api` 已经从一个相对紧凑的 NestJS 后端，演进为承接
Admin、Blog、WordPress、MinIO、QQBot、NapCat、Loki 运行期事件和线上部署
观测的多领域服务。第一期 Runtime Foundation 已经补上 `/health/runtime`、
运行时配置检查和证据格式，为后续重构提供了基础观测能力。

第二期不是继续只修 QQBot 或 NapCat，而是进入 API 全模块架构规划。当前线上
数据不重要，因此后续实现阶段允许从头设计数据库表，允许重命名表、删除旧字段、
拆分或合并旧表，并重建初始化 SQL。即便允许破坏式重建，实现阶段仍必须保留
备份、回滚和线上 smoke，避免线上动作不可追踪。

## 范围决策

本阶段是用户确认的 B 阶段：先完成全局规划，不写业务实现代码。

规划范围：

1. 定义 API 目标模块架构。
2. 从头设计全库 schema。
3. 设计 QQBot 插件平台，支持 worker/child process 隔离、线上安装、热插拔和
   CLI 脚手架。
4. 定义后续 C 阶段的迁移矩阵和实施顺序。

本文件不实现代码、SQL、Admin 页面或运行时行为。用户 review 通过后，下一步
进入 KT workflow `KT plan writing`。完整 C 阶段迁移开始前，必须重新走一轮
KT requirements and design review。

## 目标

- 明确每个 controller、use case、entity、repository、外部集成和测试的模块归属。
- 用干净的新 schema 替代当前补丁式表历史。
- 默认保持外部 API 兼容，确实需要破坏兼容时提前列入 breaking changes。
- 将 QQBot 插件从硬编码 Nest provider 集合升级为统一插件平台。
- 通过 CLI 脚手架让插件创建、校验、打包和本地安装可重复。
- 支持线上插件安装、校验、启用、禁用、升级和卸载，不重启整个 API 进程。
- 将现有 BangDream、FF14 Market、FFLogs、Repeater 按统一插件契约重写。
- 继承第一期 Runtime Foundation 的可靠性和证据模型，作为后续模块迁移的验证底座。

## 非目标

- 本规划阶段不写实现代码。
- 不为了旧数据迁移方便而保留旧表结构。
- 不把 Jenkins/K8s rollout 成功当作功能成功。
- 本阶段不改 Admin 前端。Admin 联动只在本文规划，后续实现前重新 brainstorming。
- 不绕过 QQ 或腾讯安全校验。NapCat 验证码和新设备验证仍然由用户驱动。
- 不允许线上安装的插件代码直接访问后端真实密钥、TypeORM Repository 或任意 Nest DI。

## 目标架构

目标源码结构按平台基础、通用能力和业务模块拆分：

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

`runtime` 负责运行时基础能力：

- 类型化运行时配置 profile。
- 带超时、安全摘要和错误分类的 HTTP/process client。
- 健康检查和 `/health/runtime`。
- 运行证据记录。
- 清理语义。

`common` 只保留稳定通用能力：

- Vben 响应和错误工具。
- 全局 filter/interceptor。
- 时间字段装饰器和序列化工具。
- Snowflake ID。
- 低层文本、对象工具。
- 非业务专属的日志基础能力。

业务模块内部统一结构：

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

### 分层职责

`contract`：Controller、请求 DTO、响应 DTO、Swagger 元信息和现有路由兼容适配。

`application`：用例编排、事务边界、权限检查和状态流转。可以依赖 domain、
repository 和 integration port，但不能直接拼外部 HTTP、Docker 脚本或临时 SQL。

`domain`：纯业务规则、状态机、策略和值对象。Domain 代码应能脱离 Nest、TypeORM、
Docker、HTTP 和外部凭据做单元测试。

`infrastructure/persistence`：TypeORM Entity、Repository 实现、查询模型和 schema mapper。

`infrastructure/integration`：WordPress HTTP、MinIO SDK、Loki query、OneBot WebSocket、
NapCat WebUI、插件 worker RPC 和 runtime process 适配器。

`schema`：模块表设计说明、初始化 SQL 归属、重建脚本和验证 SQL。

`tests`：模块级 unit、contract、repository 和 integration smoke。跨模块用户流程测试可以
继续放在根 `test/` 下。

### 兼容规则

- 外部 route path 默认保持稳定，除非实现计划明确列入 breaking changes。
- Admin-facing 业务接口继续使用当前 Vben success/error wrapper，stream、file、WebSocket
  和 plain JSON 接口除外。
- `/health/runtime` 继续返回 plain JSON。
- Snowflake ID 在 MySQL 中继续使用 `BIGINT`，在 JavaScript/API 边界按字符串语义处理。
- 时间字段继续使用 `KtDateTime extends Date` 和 KT 时间装饰器。
- 后续实现阶段可以替换旧 SQL 文件为全量新库初始化文件，但本规划阶段不改 SQL 实现。

## 全库表设计

后续实现阶段允许从头重建 schema。由于当前数据不重要，目标 schema 优先服务清晰
数据域和模块所有权，而不是旧表兼容。实现阶段仍必须在破坏式数据库动作前备份，
并提供回滚或恢复命令。

### 全局表约定

- 主键使用 Snowflake `BIGINT`。
- 外键列命名为 `*_id` 并建立索引。
- 稳定关系表使用组合唯一约束。
- 高频日志和事件表避免硬数据库外键，减少 retention 和清理成本。
- 只有可恢复、可隐藏的业务配置使用软删。
- 运行事件、命令日志、消息日志、插件运行事件使用 append-only 加 retention。
- 通用时间字段使用 `create_time`、`update_time`，需要软删时加 `delete_time`。
- 状态字段使用明确的 varchar 枚举，并在 schema 说明中列出允许值。
- JSON 字段只承载外部原始 payload、插件 metadata、低频配置或证据详情；可查询字段必须结构化。
- 有 UI 或存储长度限制的文本字段必须写明截断规则。
- 新初始化 SQL 应是干净的全量 schema，不再累积历史 `ALTER TABLE` 补丁。

### 数据域表规划

| 数据域 | 目标表 | 说明 |
| --- | --- | --- |
| Admin Identity | `admin_user`、`admin_role`、`admin_permission`、`admin_menu`、`admin_department`、`admin_user_role`、`admin_role_permission`、`admin_role_menu` | 保持 Admin 登录和菜单行为稳定，同时拆清路由菜单与权限原子。部门为树结构。头像、时区和首页路径属于用户 profile。 |
| Platform Config | `platform_dict_group`、`platform_dict_item`、`platform_component_template`、`platform_setting` | 字典和组件模板从 Admin 杂项中抽离。字典用 group/item 替代当前扁平重载行。 |
| Blog Content | `blog_post`、`blog_taxonomy`、`blog_term`、`blog_post_term`、`blog_theme_profile`、`blog_import_job` | 分类、标签使用关系表，不再依赖逗号或长文本字段。主题配置改为可命名 profile。 |
| WordPress Mirror | `wordpress_site`、`wordpress_auth_session`、`wordpress_remote_post`、`wordpress_remote_term`、`wordpress_sync_job`、`wordpress_sync_mapping` | 远端 WordPress 状态与本地 Blog 内容分离。mapping 表连接远端 ID 和本地 post/term。 |
| Asset/MinIO | `asset_bucket`、`asset_object`、`asset_reference`、`asset_access_grant` | 统一记录对象归属、来源模块、MIME/type 元数据和临时访问授权，避免 MinIO URL 散落在业务表。 |
| System Event | `system_notice`、`system_event`、`system_event_dedupe`、`system_event_delivery` | Loki 仍是日志查询源。MySQL 只保存可处理通知、去重状态和通知投递状态。 |
| Runtime Evidence | `runtime_evidence_index` | 只存重要运行证据文件的安全索引，不存完整日志和 secrets。大 JSON 证据仍保留在 `.kt-workspace/test-artifacts` 或部署产物存储。 |
| QQBot Core | `qqbot_account`、`qqbot_connection_session`、`qqbot_capability_binding`、`qqbot_permission_policy`、`qqbot_command`、`qqbot_command_alias`、`qqbot_rule`、`qqbot_conversation`、`qqbot_message`、`qqbot_send_task`、`qqbot_send_log`、`qqbot_dedupe_event` | 拆分账号身份、连接态、权限、路由、会话、消息历史和发送队列/历史。 |
| NapCat Runtime | `napcat_container`、`napcat_device_identity`、`napcat_account_binding`、`napcat_login_session`、`napcat_login_challenge`、`napcat_runtime_cleanup` | 设备身份是一等表，记录 MAC、hostname、machine-id 路径、data dir 和验证状态。登录 challenge 覆盖验证码和新设备验证。清理记录用于阻断假成功。 |
| QQBot Plugin Platform | `qqbot_plugin`、`qqbot_plugin_version`、`qqbot_plugin_installation`、`qqbot_plugin_operation`、`qqbot_plugin_event_handler`、`qqbot_plugin_account_binding`、`qqbot_plugin_config`、`qqbot_plugin_asset`、`qqbot_plugin_runtime_event` | 插件 metadata、版本、operation、event、账号绑定、配置、资产和运行事件属于平台，不属于某个插件硬编码。 |
| Plugin-Owned Data | `qqbot_plugin_data_*` 或插件命名空间表 | 插件 migration 可创建命名空间表。表名必须以 plugin key 或已注册 namespace 开头，避免冲突。 |

### 破坏式重建策略

实现阶段可按以下流程重建数据库：

1. 对线上数据库做带时间戳的备份。
2. 在破坏式 schema 动作期间停止或限制 API 写流量。
3. 按已批准脚本 drop 或 rename 旧 API 表。
4. 应用新的全量初始化 SQL。
5. 初始化必要 Admin 用户、角色、菜单、平台设置、字典、核心 QQBot 插件 metadata 和默认在线命令。
6. 让 API 使用新 schema 启动。
7. 运行本地或线上 smoke：Admin 登录、菜单加载、Blog 公开读取、MinIO check、QQBot command registry、plugin registry、NapCat 账号状态、`/health/runtime`。
8. 关键 smoke 失败时，恢复备份或重新应用旧 schema bundle，并回滚到上一个 API 镜像。

## QQBot 插件平台

QQBot 插件升级为平台能力，不再是硬编码 Nest service 注册。命令插件、事件插件、
渲染插件、外部查询插件和自动化插件使用同一套 contract。

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

`plugin.json` 是插件元信息的单一来源：

- plugin key、名称、描述、版本、作者、license 和主页。
- 最低 API plugin SDK 版本。
- 请求的 host 权限。
- operations 和 event handlers。
- config schema 和默认值。
- assets 声明。
- migrations 声明。
- runtime 要求，例如 timeout、memory limit 和 worker type。

### Worker 隔离运行时

已确认的运行模型是进程隔离：

- API 主进程负责安装包、校验 manifest、维护 registry、路由 command/event。
- 插件代码运行在独立 worker 或 child process 中。
- 插件崩溃只将插件实例标记为 `degraded` 或 `offline`，不拖垮 API 主进程。
- 启用、禁用、升级、卸载会启动或停止 worker，并在运行时刷新 registry。
- Worker 和 API 通过窄 RPC 协议通信。

RPC 协议至少支持：

- `load`：加载 manifest 和编译入口。
- `activate`：初始化运行态。
- `deactivate`：停止接收新任务。
- `executeOperation`：执行命令或查询能力。
- `handleEvent`：处理消息或账号事件。
- `health`：返回插件健康状态。
- `dispose`：关闭前释放资源。

RPC 消息携带 operation ID、correlation ID、timeout budget、脱敏后的输入和结构化输出。
超时由 host 统一控制。

### 插件 SDK 边界

插件代码不能访问 Nest DI、TypeORM 原始 Repository、后端原始环境变量或任意文件路径。
插件只能拿到受控 SDK：

- 通过 host 发送队列发送 QQBot 消息。
- 通过插件配置服务读写插件配置。
- 读写插件自有 storage。
- 发送插件运行事件。
- 请求 host 提供的 runtime HTTP 能力，带 timeout 和安全证据。
- 从插件 asset root 加载已声明静态资源。
- 读取当前 operation 或 event context。

插件必须在安装前声明权限。Manifest 请求未支持权限，或代码包 hash 与校验记录不一致时，
host 必须拒绝安装或启用。

### CLI 脚手架

仓库应新增插件作者 CLI：

```bash
pnpm qqbot-plugin create <pluginKey>
pnpm qqbot-plugin validate <path>
pnpm qqbot-plugin pack <path>
pnpm qqbot-plugin install-local <package>
```

`create` 自动生成：

- `plugin.json`。
- 带 `createPlugin()` 的 `src/index.ts`。
- 一个 operation handler 模板。
- 一个 event handler 模板。
- config schema 和默认值。
- migration/schema 模板。
- contract tests。
- package metadata。
- README/API 片段草稿。

`validate` 校验 manifest shape、operation key、event key、权限、schema 文件、migrations、
包大小、禁用路径和基础测试是否存在。

`pack` 输出带版本和 content hash 的插件包。

`install-local` 使用与线上安装相同的校验链路，将插件包安装到本地开发插件根目录。

### 线上安装和热插拔状态机

插件安装状态流转：

```text
uploaded -> validated -> installed -> enabled
enabled -> disabled
installed -> uninstalled
enabled -> upgrading -> enabled
enabled -> failed
```

Admin 上传插件包后，API 校验 manifest、包 hash、版本兼容、权限、migration 和 assets。
插件包保存到受控运行时插件目录，不能写入 `src/`。

启用插件时启动 worker，注册 operations 和 event handlers，并记录运行状态。禁用插件时
停止 worker，并从路由中移除 active operation/event，不删除数据。卸载插件时停止 worker、
移除 registry、解绑 command/event，然后按数据策略处理插件数据：默认保留，只有管理员
明确选择清理时才删除。

### 现有插件重写计划

BangDream 作为大型参考插件。现有业务能力拆分可以保留在插件包内：

```text
bangDream/
  operations/
  song/
  card/
  character/
  event/
  gacha/
  player/
  cutoff/
  provider/
  renderer/
  theme/
  assets/
```

现有 BangDream operation registry 改为由 manifest 支撑 operation metadata。
handlerName 仍作为 worker 内部实现细节。现有图片 smoke 预期继续保留，包括
event stage 拆图输出行为。

FF14 Market 改为外部查询插件，通过 host runtime HTTP SDK 调用 XIVAPI 和 Universalis。

FFLogs 改为外部查询插件，通过 host runtime HTTP SDK 调用 GraphQL/token，并通过插件
config 引用客户端凭据。

Repeater 改为事件插件，由 host 管理账号绑定，由插件持有 transient state，且必须走 host
发送队列，不能直接绕过限流和发送排队。

## 模块迁移矩阵

后续实现阶段拆成可审计批次：

| 批次 | 范围 | 结果 |
| --- | --- | --- |
| 0 | 迁移准备 | 新 schema map、全量初始化 SQL 计划、破坏式重建脚本计划、备份/恢复命令、验证 SQL、模块模板和 breaking-change 清单。 |
| 1 | Runtime/Common | 保持 runtime foundation 稳定，补齐模块 adapter 需要的 runtime client/evidence 原语，收缩 common 到稳定共享能力。 |
| 2 | Admin/Auth/Platform Config | 重建身份、菜单、权限、字典、组件模板和系统通知模型。Admin 登录和菜单加载必须先通过。 |
| 3 | Blog/WordPress/Asset | 重建 Blog 内容关系、WordPress mirror/sync 和 MinIO asset 归属。Blog 公开读取和 Admin Blog 管理必须通过。 |
| 4 | QQBot Core | 重建账号、连接、权限、命令、规则、会话、消息和发送队列模型。命令匹配和发送队列测试必须通过。 |
| 5 | QQBot Plugin Platform | 新增插件 manifest 校验、数据库 registry、CLI 脚手架、worker runtime、RPC、线上安装、热插拔状态和 Admin/API 管理契约。 |
| 6 | Existing Plugin Rewrite | 将 BangDream、FF14 Market、FFLogs、Repeater 重写为隔离插件包。现有命令 smoke 行为必须继续可用。 |
| 7 | NapCat Runtime | 在新 QQBot/NapCat 模型上实现容器设备持久化、登录 session 状态机、验证码/新设备流程和清理证据。 |
| 8 | 线上闭环 | 发布后观察 Jenkins/K8s，运行 `/health/runtime`、Admin smoke、Blog smoke、插件安装/启用 smoke、QQBot command smoke 和真实 NapCat 账号登录 smoke。 |

NapCat 故意排在 QQBot Core 和 Plugin Platform 后面。它依赖新账号模型，并和 command/event
路由共同参与线上验证，但它本身不是插件。

## 契约和破坏兼容策略

默认保持外部 API 兼容。任何实现任务如果改变 route path、请求字段、响应字段、状态语义、
SSE 事件名、Admin API wrapper 或 SQL seed 标识，都必须在编码前写入 breaking-change 表。

允许的计划内破坏：

- 数据库表名、字段、索引和初始化 SQL 可以自由改变，因为 schema 从头设计。
- Admin 页面可能需要在实现阶段同步 API wrapper。
- 插件管理接口是新增能力，可以使用新的 route shape。

必须保护的行为：

- Admin 登录和菜单加载。
- 业务 API 的 Vben 响应 wrapper。
- `/health/runtime` plain JSON。
- Blog public article list/detail。
- QQBot command test flow。
- QQBot 账号状态继续区分 OneBot 连接、容器、WebUI 和 QQ 登录态。
- NapCat 登录安全校验、验证码回交、新设备验证和运行态密码清理失败阻断成功语义。

## 验证策略

本规划阶段验证：

- spec 自检：未决标记、内部矛盾和模糊范围。
- `git diff --check`。
- KT 文档同步检查。
- KT global review 扫描变更文件。

后续实现阶段必须包含：

- domain policy 和状态机的定向单测。
- 新 SQL 和 TypeORM mapping 的 repository/schema 测试。
- CLI 生成的插件 contract tests。
- worker runtime 的 load、activate、execute、health、deactivate 和崩溃隔离测试。
- 变更接口的真实本地 API 请求。
- Admin caller 变化时的 Admin UI smoke。
- 破坏式线上数据库动作前，本地数据库重建 dry run。
- 线上备份、重建、恢复路径、Jenkins/K8s 观测和功能 smoke。

## 本规划阶段验收标准

本阶段完成条件：

1. 设计文档写入 `docs/specs/`。
2. 设计文档已提交。
3. 用户 review 已提交文档。
4. 下一步进入 KT workflow `KT plan writing`，不是直接实现代码。
5. 后续完整迁移开始前，重新走 KT requirements and design review。

## 交接到下一阶段

用户 review 通过后，`KT plan writing` 阶段应产出计划文档，把本文转换成可执行 work packages、
schema 文档、插件平台任务和验证清单。

后续完整实现必须重新 brainstorming，因为它会涉及破坏式 schema 工作、Admin/API 契约决策、
插件运行时安全边界和线上闭环。
