# QQBot 架构强收敛与 BangDream 重写设计

## 背景

第三期重构目标不是把文件移动到 `src/modules`，而是让模块边界、插件平台、插件包、NapCat 运行时和 Admin 管理页都真实符合已批准的第三期架构。当前 QQBot 仍存在结构性偏差：

- `src/modules/qqbot/core/qqbot-core.module.ts` 仍直接注册 BangDream、FF14 Market、FFLogs、Repeater 具体插件 service。
- `src/modules/qqbot/plugin-platform/**` 目前主要是 manifest、实体和管理接口，未真正接管 worker runtime、operation/event 路由和热插拔生命周期。
- `src/modules/qqbot/plugins/**` 仍是内置 Nest service 形态，插件代码仍能直接接触 `ConfigService`、`DictService`、`process.env`、`fs`、`axios`、QQBot core service。
- BangDream 旧实现目录和职责混乱，存在大文件、大桶目录、operation 元数据双写和运行时副作用。它不能作为继续修补的基础。
- NapCat 已迁入 `src/modules/qqbot/napcat`，但 login/container 仍是大服务，内存 session、challenge、cleanup 语义没有完全进入第三期持久化模型。
- Admin 插件页把插件能力、安装记录、运行事件、账号绑定和 manifest 操作混在一个页面状态域里。

本设计是对第三期 QQBot 部分的强制返工收敛：实现必须以第三期规划文件结构为准，并把 BangDream 作为业务重写专项处理。

## 目标

1. QQBot 模块严格收敛到第三期业务模块统一结构。
2. Plugin Platform 真正成为插件安装、启停、worker runtime、operation/event registry 和热插拔的拥有者。
3. Core 不再依赖任何具体插件实现文件。
4. 每个插件使用同一套插件包目录规范，禁止按历史习惯自由生长。
5. BangDream 业务彻底重写，旧代码只作为行为参照和资产来源，能力 100% 还原。
6. NapCat Runtime 拆清 device、container、login session、challenge、cleanup 和 integration 责任。
7. Admin 同步拆清 QQBot core、plugin-platform、NapCat 的 caller 和页面状态。

## 非目标

- 不改变第三期已批准的全模块分层标准。
- 不引入另一套新的目录哲学。
- 不用“legacy adapter 长期保留”掩盖未收敛结构。
- 不为了快速通过测试保留 BangDream 旧 facade、旧 registry、大桶 shared 或旧 Nest plugin service。
- 不在本设计阶段改实现代码。

## 统一模块结构

QQBot 下的 core、plugin-platform、napcat 必须按第三期统一业务模块结构组织：

```text
src/modules/qqbot/core/
  contract/
  application/
  domain/
  infrastructure/
    persistence/
    integration/
  schema/

src/modules/qqbot/plugin-platform/
  contract/
  application/
  domain/
  infrastructure/
    persistence/
    integration/
  schema/

src/modules/qqbot/napcat/
  contract/
  application/
  domain/
  infrastructure/
    persistence/
    integration/
  schema/
```

职责固定：

- `contract`：Controller、DTO、Swagger 元信息、路由兼容适配。
- `application`：用例编排、事务边界、权限检查、状态流转。
- `domain`：纯业务规则、状态机、策略、值对象。不得依赖 Nest、TypeORM、Docker、HTTP、外部凭据。
- `infrastructure/persistence`：TypeORM Entity、Repository、查询模型、schema mapper。
- `infrastructure/integration`：OneBot WebSocket、NapCat WebUI、Docker/SSH/process、plugin worker RPC、外部 HTTP adapter。
- `schema`：模块表设计说明、SQL 归属、验证 SQL、重建说明。

验收门禁：

- `core/**` 禁止 import `src/modules/qqbot/plugins/**`。
- `core/**` 禁止注册 `QqbotPluginController`、具体 plugin service、plugin SDK HTTP client。
- `core/domain/**` 禁止依赖 Nest、TypeORM、HTTP、Docker、Admin、Plugin Platform 具体实现。
- `plugin-platform/**` 禁止把具体插件 service 硬编码进 registry。
- `napcat/application/**` 禁止直接拼 Docker/SSH shell；这些必须在 `napcat/infrastructure/integration/**`。

## Core 边界

Core 只保留 QQBot 基础能力：

- account identity、enabled/binding 状态。
- connection/session、OneBot reverse WebSocket 输入输出。
- message/conversation。
- command binding、command matching 基础逻辑。
- permission、rule、send queue、send log、dedupe、dashboard summary。

Core 调用插件只能通过抽象执行口：

- operation executor：输入 command、raw args、message context，返回 normalized input、output、replyText 或 error。
- event dispatcher：输入 normalized event，返回 handled 状态和可审计 runtime event。

插件专属解析从 core 移走。FF14 服务器路径解析、FFLogs positional 解析、BangDream 参数解析必须进入对应插件 operation。Core 只负责命令前缀和 alias 命中，把 raw args 交给插件执行口。

Repeater 不再由 rule engine 直接调用。权限、命令、规则都未消费消息后，Core 将事件交给 Plugin Platform event dispatcher；是否触发 repeater 由平台 active event handler 和插件 worker 决定。

## Plugin Platform 边界

Plugin Platform 拥有以下能力：

- manifest 解析和强校验。
- 插件包上传、hash、大小、路径白名单、受控安装目录。
- 安装、启用、禁用、升级、卸载状态机。
- worker runtime manager。
- child process 或 node worker driver。
- operation/event active registry。
- operation executor。
- event dispatcher。
- SDK host adapter：send queue、config、storage、HTTP、asset、runtime event、operation/event context。
- runtime event 持久化。
- account binding、plugin config、plugin asset、plugin-owned migration 管理。

启用插件时，平台必须启动 worker、load manifest、activate、刷新 active operation/event registry。禁用插件时，平台必须 deactivate/dispose worker，并从 active registry 移除对应 operation/event。升级必须先进入 `upgrading`，新版本 worker 健康后再替换 active registry；失败时保留旧版本或标记 failed，不允许留下半激活状态。

`/qqbot/plugin/*` 能力查询接口可以保留兼容路径，但实现归属必须在 `plugin-platform/contract`。`/qqbot/plugin-platform/*` 管理接口也归属同一 contract 层。

## 插件包结构规范

所有内置插件和线上安装插件必须使用同一套目录，不允许每个插件各自发散。内置插件源码位于：

```text
src/modules/qqbot/plugins/<pluginKey>/
  plugin.json
  src/
    index.ts
    operations/
    events/
    domain/
    application/
    infrastructure/
      integration/
      storage/
    config/
    assets/
    migrations/
    tests/
```

命名规则：

- `<pluginKey>` 使用平台 key，统一 kebab-case 或纯小写。
- 现有目录迁移为 `bangdream`、`ff14-market`、`fflogs`、`repeater`。
- legacy key 只存在于 manifest alias 或 seed 数据，不作为目录名和主 key。

目录职责：

- `plugin.json`：唯一元数据源，声明 key、版本、权限、runtime、operations、events、assets、migrations、config schema。
- `src/index.ts`：唯一插件入口，只导出 `createPlugin()`。
- `src/operations/`：命令/查询 operation，一个 operation 一个目录或文件。
- `src/events/`：事件 handler，一个 event handler 一个目录或文件。
- `src/domain/`：纯业务模型、规则、策略、状态机。
- `src/application/`：插件内部用例编排。
- `src/infrastructure/integration/`：外部 API adapter，只能通过 host SDK HTTP 能力。
- `src/infrastructure/storage/`：插件私有缓存/存储 adapter，只能通过 host SDK storage/asset。
- `src/config/`：默认配置、配置 schema、配置解析。不得读 `process.env`。
- `src/assets/`：插件静态资源、字体、图片、静态数据文件。
- `src/migrations/`：插件自有数据表 migration。
- `src/tests/`：插件包内 contract/unit 测试模板。

插件包硬门禁：

- 禁止 `@nestjs/*`。
- 禁止 `@/modules/admin/**`。
- 禁止 `@/modules/qqbot/core/**`。
- 禁止 `ConfigService`、`DictService`。
- 禁止 `process.env`。
- 禁止直接 `axios`、`fetch`、`fs` 访问宿主能力。
- 禁止 operation metadata 在 `plugin.json` 和 TS registry 双写。
- 禁止模块 import 即启动 timer、加载远端数据或写文件。

## BangDream 重写专项

BangDream 不是迁移瘦身，而是业务彻底重写。旧实现只允许作为：

- 能力清单来源。
- operation key、alias、handlerName 参照。
- 输入解析和输出结构 oracle。
- 视觉资产、字体、静态配置来源。
- smoke 对照对象。

旧实现不得作为新实现依赖。新实现完成后必须删除旧 BangDream 业务结构，不保留 facade、大桶 shared、旧 operation registry、旧 main-data-store 或旧 file-cache。

BangDream 新目录：

```text
src/modules/qqbot/plugins/bangdream/
  plugin.json
  src/
    index.ts
    operations/
      song-search/
      song-chart/
      song-random/
      song-meta/
      card-search/
      card-illustration/
      character-search/
      event-search/
      event-stage/
      player-search/
      gacha-search/
      gacha-simulate/
      cutoff-detail/
      cutoff-all/
      cutoff-recent/
    events/
    domain/
      song/
      card/
      character/
      event/
      gacha/
      player/
      cutoff/
      catalog/
    application/
    infrastructure/
      integration/
      storage/
    config/
    assets/
    migrations/
    tests/
```

必须 100% 还原的能力：

| Operation Key | 能力 |
| --- | --- |
| `bangdream.song.search` | 查曲 |
| `bangdream.song.chart` | 查谱面 |
| `bangdream.song.random` | 随机曲 |
| `bangdream.song.meta` | 查询分数表 |
| `bangdream.card.search` | 查卡 |
| `bangdream.card.illustration` | 查卡面 |
| `bangdream.character.search` | 查角色 |
| `bangdream.event.search` | 查活动 |
| `bangdream.event.stage` | 查试炼 |
| `bangdream.player.search` | 查玩家 |
| `bangdream.gacha.search` | 查卡池 |
| `bangdream.gacha.simulate` | 抽卡模拟 |
| `bangdream.cutoff.detail` | ycx |
| `bangdream.cutoff.all` | ycxall |
| `bangdream.cutoff.recent` | lsycx |

还原标准：

- operation key 不变。
- aliases 不变。
- online command seed/linkage 不变。
- 输入解析语义不变。
- 输出结构不变。
- 图片输出数量不变。
- `bangdream.event.stage` 保持当前拆图行为，`imageCount=5` 是硬门禁。
- 对外依赖 Bestdori、HHWX、静态修正数据和缓存语义保持可用。
- 可见中文文案和错误语义不降低。

重写策略：

1. 先从现有 `plugin.json` 和 command SQL 冻结能力矩阵。
2. 为每个 operation 建立 contract test，使用旧实现或固定 fixture 作为 oracle。
3. 建立新的 `createPlugin()` 入口和 SDK-bound application 层。
4. 按 operation 逐个重写，旧实现只在测试中对照。
5. 全部 operation 通过后删除旧 BangDream 目录结构。
6. 最终静态扫描确认新 BangDream 不含 Nest/Admin/Core/env/fs/axios 依赖。

## 其他插件重写

FF14 Market：

- 目录改为 `ff14-market`。
- `resolve-item` 和 `market-price` 分成独立 operations。
- world catalog、region/data center/world 解析进入插件 domain。
- XIVAPI、Universalis 访问进入 `infrastructure/integration`，只通过 SDK HTTP。
- 字典或默认世界配置由 plugin config/SDK 注入，不直接依赖 Admin DictService。

FFLogs：

- `qqbot-fflogs-client.service.ts` 必须拆除。
- OAuth token、GraphQL client、encounter catalog、localization、reply formatter、config defaults 分离。
- client id/secret 只通过 host secret/config reference 解析，不读宿主 env。

Repeater：

- message event handler 位于 `src/events/message/`。
- repeat state、阈值、冷却、文本过滤进入 domain。
- 账号绑定通过 event context/SDK 获得。
- 发送只走 SDK send queue，不直接注入 `QqbotSendService`。

## NapCat Runtime 收敛

NapCat 仍不是插件。它收敛到 `src/modules/qqbot/napcat` 的第三期模块结构：

- `contract`：scan/create、scan/refresh、scan/status、captcha submit、SSE events、account runtime status 路由兼容。
- `application`：登录 session 用例、容器用例、账号绑定用例、cleanup 用例。
- `domain`：quick/password/captcha/new-device/manual QR 状态机、cleanup 阻断规则、login challenge 状态。
- `infrastructure/persistence`：`napcat_container`、`napcat_device_identity`、`napcat_account_binding`、`napcat_login_session`、`napcat_login_challenge`、`napcat_runtime_cleanup`。
- `infrastructure/integration`：NapCat WebUI client、Docker/SSH adapter、container log reader、QR/captcha/new-device API adapter。

内存 session 只允许作为 SSE listener cache，不作为登录真相来源。验证码、新设备验证、清理失败必须可从持久化状态恢复。

## Admin 收敛

Admin 继续位于 `apps/web-antdv-next/src/views/qqbot/**`，但页面状态必须按功能域拆开：

- QQBot core：account、command、rule、message、send log、dashboard。
- Plugin Platform：capability list、installation lifecycle、runtime events、account bindings、manifest/package actions。
- NapCat：账号登录、扫码、新设备、验证码、运行态状态。

API caller 保持第三期规划：

- `apps/web-antdv-next/src/api/qqbot/index.ts`：QQBot core 兼容接口。
- `apps/web-antdv-next/src/api/qqbot/plugin.ts`：Plugin Platform 管理接口。
- `apps/web-antdv-next/src/api/qqbot/napcat.ts`：NapCat login/device/SSE 接口。

插件页不能继续由单个 TSX 文件承担能力列表、安装记录、运行事件、账号绑定、manifest 编辑的全部状态。实现时应拆成同一路由下的模块化组件或子视图，但不引入与第三期规划冲突的新顶层路由结构。

## 数据和 Schema

第三期 schema 是目标真相：

- Core 表只保存 QQBot 基础账号、连接、权限、命令、规则、会话、消息、发送和 dedupe。
- Plugin Platform 表保存 plugin、version、installation、operation、event handler、account binding、config、asset、runtime event。
- Plugin-owned data 使用插件 namespace 表。
- NapCat 表使用 `napcat_*` 目标命名，不再新增 `qqbot_napcat_*` legacy 表。

`plugin.json` 是插件 metadata 真相，SQL seed 只保存平台安装和默认命令绑定，不再复制出另一套无法校验的 operation 元数据。

## 错误处理和运行态语义

- 插件 worker crash 只影响对应 installation，记录 runtime event，不拖垮 API。
- operation timeout 由平台统一控制，错误进入 command log 和 runtime event。
- 插件禁用后，operation/event 不再出现在 active registry。
- 插件升级失败不得让旧版本和新版本同时 active。
- BangDream 单 operation 失败不得污染其他 operation 的缓存或状态。
- NapCat cleanup failure 继续阻断登录成功或 QR fallback，并写入专用错误。
- NapCat QQ 登录态、OneBot 连接态、容器态、WebUI 态继续分离。

## 验证策略

必须先写 RED 门禁：

1. Core import/provider boundary scan。
2. Plugin package dependency boundary scan。
3. Plugin Platform lifecycle state machine tests。
4. Worker runtime real driver tests。
5. Operation executor 和 event dispatcher contract tests。
6. BangDream operation parity tests。
7. FF14/FFLogs/Reapter behavior tests。
8. NapCat persistence/state-machine recovery tests。
9. Admin caller/page state tests。

本地验证范围：

- API focused Jest：core、plugin-platform、plugins、napcat。
- API `pnpm run typecheck`。
- API changed-file ESLint。
- Admin focused Vitest。
- Admin typecheck。
- 本地真实接口 smoke：`/qqbot/plugin/operation/page`、`/qqbot/command/test`、plugin install/enable/disable、NapCat scan status。
- BangDream render smoke：至少覆盖 event stage、song search、card search、cutoff、gacha simulate。
- Browser smoke：QQBot 插件平台页和账号登录页。

线上闭环仍按第三期最终流程执行：提交、推送、Jenkins/K8s 观察、线上 API/Admin smoke、QQBot command smoke、NapCat 真实账号登录闭环。

## 实施顺序

1. 冻结当前能力矩阵和旧实现 oracle。
2. 增加结构 RED 门禁，先让当前代码明确失败。
3. 重建 Plugin Platform runtime、lifecycle、registry、executor、dispatcher。
4. Core 改为只依赖平台执行口和事件分发口。
5. 彻底重写 BangDream 插件，逐 operation 迁移并跑 parity。
6. 重写 FF14 Market、FFLogs、Repeater。
7. 拆分 NapCat Runtime 到第三期模块结构。
8. Admin 同步拆 caller 和页面状态。
9. 删除旧目录、旧 facade、旧 registry、旧大桶 shared、旧 Nest plugin services。
10. 运行本地验证、全局 review、KT global review，再进入上线闭环。

## 完成标准

- `src/modules/qqbot/core/**` 无插件实现依赖。
- `src/modules/qqbot/plugin-platform/**` 真正接管插件运行时。
- `src/modules/qqbot/plugins/**` 每个插件目录结构一致。
- BangDream 旧业务结构已删除，15 个 operation 能力 100% 还原。
- 插件包静态扫描无 Nest/Admin/Core/env/fs/axios 违规依赖。
- NapCat login/container 大服务已拆到第三期结构，session/challenge/cleanup 可持久化恢复。
- Admin 插件页状态域拆清。
- 本地和线上 smoke 通过，未验证项必须明确列出。
