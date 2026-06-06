# QQBot BangDream Tsugu 全局重构方案

生成日期：2026-06-06

## 目标

基于 `docs/qqbot-bangdream-tsugu-reference.md` 的函数与变量清单，对 Tsugu 内嵌能力做一次全局重构设计。目标不是机械套用所有设计模式，而是把当前确实分散、硬编码、难验证的部分收口成稳定边界：

- 去掉非必要硬编码：用户可感知文案、别名、映射、阈值、数据源、渲染主题、布局规格和命令路由不能继续散落在业务函数里。
- 保留必要硬编码：Bestdori 协议枚举、资源文件名约定、纯算法常量和极少量稳定模型字段可以保留在代码中，但必须有命名和归属。
- 让能力可插拔：命令、数据源、搜索规则、渲染流程、输出后处理和日志观测都通过 registry/pipeline/hook 连接。
- 让重构可验证：每个阶段保留现有命令行为，先补边界测试，再迁移实现。

## 当前事实

- Tsugu 源码目录：`src/qqbot/plugins/bangDream/tsugu`
- TS 文件：初始基线 92；当前 `tsugu` 源码 128
- 函数节点：481，其中稳定函数 410，匿名/内联回调 71
- 源码 JSDoc：稳定函数 410/410 已覆盖
- 变量声明：1896
- class/interface/type 字段：716
- 静态配置：`static-config` 下 9 个文件，包含昵称、CN 修正、模糊搜索、玩家编号等数据
- 现有硬编码集中点：`models/bangdream-constants.ts` 已承接服务器、难度、活动、卡牌、卡池、档位、国服预测等一部分常量

## 硬编码候选扫描

这次只把扫描结果作为重构入口，不直接等价为“全部挪走”。布局坐标、协议路径、图片资源名和业务字典的处理方式不同。

| 文件 | 字符串 | 数字 | 模板字符串 | 主要问题 |
| --- | ---: | ---: | ---: | --- |
| `render-blocks/song-chart-preview.ts` | 112 | 158 | 7 | 谱面预览布局、颜色、轨道、音符规格混在主流程内 |
| `models/bangdream-constants.ts` | 110 | 78 | 0 | 业务枚举已集中，但仍混合用户文案、协议值、配置阈值 |
| `models/cutoff.ts` | 29 | 115 | 5 | 档线数据源、预测规则和请求策略耦合 |
| `render-blocks/list-time.ts` | 29 | 108 | 0 | 时间格式、服务器时区、国服预估规则耦合 |
| `render-blocks/card-art.ts` | 41 | 87 | 3 | 卡牌布局尺寸、素材路径、颜色散落 |
| `render-blocks/detail-blocks.ts` | 13 | 91 | 10 | 通用详情块已收口，但尺寸/token 仍分散 |
| `canvas/text.ts` | 32 | 67 | 2 | 字体、字号、换行、画布兜底尺寸需要统一 token |
| `models/player.ts` | 37 | 56 | 2 | 玩家 API、模式参数、头像/称号资源规则耦合 |
| `models/card.ts` | 53 | 32 | 5 | 卡面资源 URL、类型文案、发布逻辑耦合 |
| `render-blocks/list-frame.ts` | 13 | 77 | 0 | 通用列表布局已有基础，但宽高、间距、颜色仍散落 |

## 硬编码分类

| 类型 | 示例 | 目标归属 | 处理原则 |
| --- | --- | --- | --- |
| 协议常量 | `Server.jp = 0`、Bestdori API 字段名 | enum/types | 保留代码内，但统一命名，不进入数据库 |
| 可运营映射 | 服务器别名、难度别名、命令别名、用户可见文案 | 字典表或静态配置加载器 | 优先可维护，允许缓存，不在渲染函数里写死 |
| 数据源地址 | `https://bestdori.com`、`https://hhwx.org` | runtime options + provider registry | 支持 env 覆盖和数据源策略 |
| 资源路径 | `assets/Card/star.png`、谱面 note 图片名 | asset manifest | 保留文件约定，但用 manifest 管理，不散写路径 |
| 视觉 token | 颜色、字体、间距、圆角、默认宽度 | render theme | 代码内 token 文件或主题 provider，不进字典表 |
| 布局规格 | `800`、`30`、卡片宽高、谱面轨道尺寸 | layout spec | 从主流程抽出为命名规格，支持单元测试 |
| 算法阈值 | 缓存过期、重试次数、数据源切换阈值 | runtime options | 默认值代码内，生产可 env 配置 |
| 上游修正数据 | `cards-cn-fix.json`、`skills-cn-fix.json` | data patch repository | 保留静态文件或转迁移数据，统一读取入口 |

## 当前扁平结构

保持当前插件目录，不引入新顶层仓库或独立服务。Tsugu TS 源码统一压到 `tsugu/<明确分组>/<文件>.ts`，最大两级；资源目录 `assets`、`static-config` 不受 TS 源码层级限制。

```text
src/qqbot/plugins/bangDream/
  commands/
    bangdream-command.definitions.ts
  renderer/
    qqbot-bangdream-renderer.service.ts
  tsugu/
    calculations/
    canvas/
    command-renderers/
    data-clients/
    models/
    render-blocks/
    runtime/
    search/
```

后续新增 registry、hook、provider、policy、spec、theme 或 manifest，也只能落在这些二级目录下，例如 `runtime/operation-registry.ts`、`runtime/hook-registry.ts`、`data-clients/bestdori-provider.ts`、`models/server-policy.ts`、`render-blocks/theme.ts`。

## 设计模式和落点

| 模式/机制 | 当前问题 | 落地方式 | 首批目标 |
| --- | --- | --- | --- |
| Strategy | `execute` 的 switch 把 15 个 operation 堆在一个 service | 每个 operation 暴露 `execute(input, context)` | 歌曲、活动、档线、卡池分组拆出 |
| Registry | 命令定义、operation key、在线命令 SQL 需要保持一致 | `BANGDREAM_OPERATION_REGISTRY` 单一数据源生成插件能力和 SQL 校验 | 替代手写 switch 与分散定义 |
| Pipeline | 解析、查数、渲染、输出、错误处理流程重复 | `parse -> resolve -> render -> output` 标准步骤 | 查曲/查卡/查活动先接入 |
| Hook | 日志、耗时、图片压缩、数据源 fallback 不应侵入业务函数 | lifecycle hook：`beforeParse`、`afterResolve`、`beforeRender`、`afterOutput`、`onError` | 日志、metrics、fallback、CQ 输出摘要 |
| Adapter | Bestdori/HHWX/本地静态修正接口风格不同 | provider adapter 统一 `getJson`、`getAsset`、`getTracker` | 档线与素材下载 |
| Repository | `mainAPI[...]` 到处直接取值，难 mock | `SongRepository`、`CardRepository`、`EventRepository` 包 mainAPI 和 patch | 搜索与详情渲染 |
| Specification | 模糊搜索字段匹配和关系表达式容易继续膨胀 | 每个条件实现 `matches(target)` | `_number`、`_relationStr`、`_all`、动态字段 |
| Factory | 输出图片和实体匹配器已有工厂雏形，仍不统一 | `createEntityMatcher`、`createImageOutput`、`createOperation` | 保留现有柯里化方向 |
| Builder | Canvas detail block 由数组手工 push，顺序难读 | `DetailBlockBuilder` 组合标题、字段、图片区块 | 卡牌/活动详情 |
| Template Method | 列表页、详情页、档线页流程相似 | 基类或高阶函数封装“准备数据 + 画区块 + 输出” | 列表类页面优先 |
| Decorator | 缓存、重试、耗时统计混在下载函数 | `withCache`、`withRetry`、`withTiming` 包 provider | `downloadFile`、`getJsonAndSave` |
| Facade | Nest service 不应知道 Tsugu 内部所有函数 | `TsuguApplicationService` 作为唯一入口 | `QqbotBangDreamRendererService` 变薄 |
| Policy | 国服预估、服务器优先级、档位、时区是规则，不是工具函数 | `BangDreamServerPolicy`、`CutoffPolicy`、`CnEventEstimatePolicy` | `render-blocks/list-time.ts`、`models/cutoff.ts` |

## 场景到模式选择

后续实现时按场景选择封装，而不是为了使用模式而使用模式。每个改动点只选择一个主模式，确实有横切能力时再叠加 hook/decorator。

| 场景 | 判断条件 | 主模式 | 封装形态 | 不使用时机 |
| --- | --- | --- | --- | --- |
| 增加或维护在线命令 | operation key、命令名、描述、SQL、执行函数必须一致 | Registry + Strategy | `TsuguOperationDefinition` 对象数组，handler 用函数或小对象 | 只有一个命令且不会扩展时，不建 registry |
| 多个命令共用同一执行流程 | 都经历解析参数、解析实体、渲染图片、输出 CQ、错误归一 | Pipeline | `TsuguOperationPipeline.run(definition, input)` | 只有两处简单重复时，先抽公共函数 |
| 同类命令只有中间渲染不同 | 查曲、查卡、查活动都是“搜索或 ID 详情” | Template Method | 高阶函数 `createSearchDetailOperation(options)` | 如果各命令分支差异大，不强行套模板 |
| 外部数据源格式不同 | Bestdori、HHWX、本地 patch、缓存文件接口不一致 | Adapter | `BestdoriProvider`、`HhwxTrackerProvider`、`StaticPatchProvider` 实现统一接口 | 只是同一个 API 的不同 URL，不建 adapter |
| 访问主数据或静态修正 | `mainAPI[...]`、`*-fix.json`、昵称表需要统一读取和 mock | Repository | `SongRepository`、`CardRepository`、`EventRepository` 封装数据入口 | 纯值对象内部字段读取不绕 repository |
| 判断某个对象是否符合规则 | 搜索关系式、发布服务器、活动状态、卡池类型过滤 | Specification | `matches(target)` 的小规则对象或纯函数集合 | 只有一行判断且不会复用时保留内联 |
| 业务策略会随服务器或环境变化 | 国服预估、服务器优先级、档位、时区、卡池选择 | Policy | `BangDreamServerPolicy`、`CutoffPolicy`、`GachaPolicy` | 纯格式化函数不放 policy |
| 创建复杂图片区块 | 详情页反复 push 标题、字段、图片区、spacer | Builder | `DetailBlockBuilder.addTitle().addField().addImage()` | 简单两三个 canvas 拼接不建 builder |
| 创建同类对象或输出收尾 | 实体 matcher、图片输出、operation 定义反复出现 | Factory | `createEntityMatcher`、`createImageOutput`、`createOperation` | 构造参数很少且只用一次时不用 factory |
| 给数据请求加缓存、重试、耗时 | 下载函数和 provider 都需要同样外层能力 | Decorator | `withCache(provider)`、`withRetry(fn)`、`withTiming(fn)` | 业务分支逻辑不能塞进 decorator |
| 记录日志、指标、fallback、输出摘要 | 横切多个 operation，且不改变主业务结果 | Hook | `beforeParse/afterResolve/beforeRender/afterOutput/onError` | 需要决定业务结果时不用 hook，交给 policy/strategy |
| Nest 边界需要变薄 | controller/plugin service 不应 import 大量 Tsugu 内部函数 | Facade | `TsuguApplicationService.execute(operationKey, input)` | Tsugu 内部模块之间不互相套 facade |
| 用户可维护的映射或文案 | 别名、标签、命令名、用户可见中文 | Dictionary Loader | 启动加载字典，内存缓存，默认值兜底 | 协议字段、布局像素、资源文件名不进字典 |
| 颜色、尺寸、字体、资源路径 | 渲染 token 散落，改视觉需要扫很多文件 | Theme/Spec/Manifest | `BangDreamTheme`、`layoutSpec`、`assetManifest` | 单个局部坐标且无复用价值时保留命名常量 |
| 纯计算和格式化 | 无外部依赖、无状态、无扩展点 | Pure Function | 具名函数 + 单测 | 不为了模式套 class |

## 选择顺序

1. 先判断它是不是用户可维护数据；是则走字典或 runtime options。
2. 再判断它是不是外部系统边界；是则走 provider/adapter/repository。
3. 再判断它是不是业务规则；是则走 policy/specification。
4. 再判断它是不是重复流程；是则走 pipeline/template/factory。
5. 再判断它是不是横切能力；是则走 hook/decorator。
6. 如果只是一次性局部逻辑，保留具名纯函数，不新增模式封装。

封装粒度默认用函数和对象配置。只有需要 Nest 注入、运行态状态、缓存生命周期或多实现接口时，才引入 class。

不建议使用的模式：Singleton、Abstract Factory、Event Sourcing、复杂插件热加载。当前问题不需要它们，强行使用会增加维护成本。

## Hook 设计

Hook 只做横切能力，不承载业务决策。

```ts
export interface TsuguHookContext {
  operationKey: QqbotBangDreamOperationKey;
  input: QqbotBangDreamCommandInput;
  options: TsuguRenderOptions;
  query?: string;
  entityIds?: number[];
  imageCount?: number;
  startedAt: number;
}

export interface TsuguHook {
  name: string;
  order?: number;
  beforeParse?(context: TsuguHookContext): void | Promise<void>;
  afterResolve?(context: TsuguHookContext): void | Promise<void>;
  beforeRender?(context: TsuguHookContext): void | Promise<void>;
  afterOutput?(context: TsuguHookContext): void | Promise<void>;
  onError?(context: TsuguHookContext, error: unknown): void | Promise<void>;
}
```

首批内置 hook：

- `TsuguLogHook`：记录 operation、query、耗时、图片数量、错误字符串。
- `TsuguDataSourceHook`：记录数据源命中、fallback 次数和切换原因。
- `TsuguOutputHook`：统一 CQ 图片输出摘要，避免超长消息污染发送日志。
- `TsuguDictionaryHook`：启动时加载字典，运行时只读缓存，避免每次命令查 DB。

## 字典与配置收口

字典表适合承接“运营会改、用户会看到、别名会增长”的内容，不适合承接协议字段和布局像素。

建议字典编码：

| 字典编码 | 内容 | 初始来源 |
| --- | --- | --- |
| `BANGDREAM_SERVER_ALIAS` | 服务器别名：国服、日服、cn、jp 等 | `BANGDREAM_SERVER_ALIASES` |
| `BANGDREAM_DIFFICULTY_ALIAS` | 难度别名：expert、ex、专家等 | `BANGDREAM_DIFFICULTY_ALIASES` |
| `BANGDREAM_COMMAND_ALIAS` | `/bd`、`/邦邦` 下具体命令别名 | `BANGDREAM_OPERATION_REGISTRY` 和在线命令 |
| `BANGDREAM_ENTITY_NICKNAME` | 歌曲、卡牌、活动昵称 | `nickname-*.xlsx`、`search/fuzzy-search-settings.json` |
| `BANGDREAM_LABEL` | 活动类型、卡牌类型、卡池类型、歌曲标签中文名 | `bangdream.enum.ts` 中 label 映射 |

保留代码配置：

- `BangDreamServerCode`、`BangDreamServerId`、`BangDreamDifficultyId`
- Bestdori API 返回字段名
- `BANGDREAM_ITEM_TYPE_PREFIXES` 这类资源协议前缀，除非后续确实需要后台维护
- `BANGDREAM_TIER_LIST_BY_SERVER` 可先保留 enum，确认运营维护需求后再迁字典

运行时 env/options：

- `BANGDREAM_TSUGU_CACHE_ROOT`
- `BANGDREAM_TSUGU_COMPRESS`
- `BANGDREAM_TSUGU_USE_EASY_BG`
- `BANGDREAM_TSUGU_DISPLAYED_SERVERS`
- `BANGDREAM_TSUGU_MAIN_SERVER`
- `BANGDREAM_TSUGU_BESTDORI_BASE_URL`
- `BANGDREAM_TSUGU_HHWX_BASE_URL`
- `BANGDREAM_TSUGU_REQUEST_TIMEOUT_MS`
- `BANGDREAM_TSUGU_RETRY_COUNT`

## 分阶段执行

### Phase 0：冻结行为和测试基线

目标：重构前先确认现有能力的稳定输出，不再靠线上报错倒逼。

任务：

- 为 15 个 operation 建立 registry 一致性测试。
- 固定查曲、查活动、查试炼、档线、抽卡模拟的 smoke 用例。
- 为 `fuzzySearch`、`createTsuguEntityMatcher`、服务器/难度解析补全边界测试。
- 保存关键图片命令的“图片数量 + 非空 Buffer + 尺寸范围”断言，不做像素级强绑定。

验证：

- `pnpm exec jest --runInBand test/qqbot/plugins/bangDream/**/*.spec.ts`
- `pnpm run typecheck`
- BangDream scoped ESLint

### Phase 1：命令和 operation registry

目标：去掉 `QqbotBangDreamRendererService.execute` 的 switch，命令能力以 registry 为单一来源。

任务：

- 新增 `TsuguOperationDefinition`：`key`、`name`、`description`、`aliases`、`inputSchema`、`execute`。
- 将现有 `BANGDREAM_OPERATION_DEFS` 与执行器合并为 `BANGDREAM_OPERATION_REGISTRY`。
- SQL 初始化和测试改从 registry 校验，避免在线命令漏配或脏数据。
- Renderer service 只保留 Nest 注入、健康检查和调用 facade。

验收：

- 15 个 operation key 不变。
- 在线命令 SQL 与 registry 一一对应。
- `/bd`、`/邦邦` 所有当前命令行为不变。

当前进度：

- 已新增 `runtime/operation-registry.ts`，收口 15 个 operation 的 key、name、description、handlerName、在线命令别名、冷却和备注。
- `QqbotBangDreamRendererService.execute` 已改为按 registry 查找 handler，不再维护 operation switch。
- `QqbotBangDreamPluginService` 和 SQL 一致性测试已改为直接读取 registry。

### Phase 2：配置、字典和协议常量分层

目标：把 `bangdream.enum.ts` 拆成协议常量、用户字典、运行策略。

任务：

- 建立 `models/bangdream-protocol.ts`：服务器 ID、难度 ID、Bestdori 字段和资源协议。
- 建立 `runtime/default-dictionary.ts`：默认 label/alias。
- 建立 `runtime/dictionary-loader.ts`：优先读取 API 字典缓存，失败回落默认字典。
- `renderer` 的服务器/难度解析改走 loader，不直接 import alias object。
- 为字典缓存加启动加载和按需刷新入口，避免每条命令查 DB。

验收：

- 删除 renderer 对 `BANGDREAM_SERVER_ALIASES`、`BANGDREAM_DIFFICULTY_ALIASES` 的直接依赖。
- 本地无 DB 时仍能使用默认字典。
- 字典项更新后可通过刷新入口生效。

当前进度：

- 已新增 `models/bangdream-protocol.ts` 收口服务器 ID、难度 ID、Bestdori API path、资源协议前缀和 API 枚举值。
- 已新增 `runtime/default-dictionary.ts` 收口默认服务器/难度别名和用户可见 label，`models/bangdream-constants.ts` 改为兼容 re-export。
- 已新增 `runtime/runtime-options.ts` 收口 env key、默认服务器策略、档线策略和布尔/list 解析工具。
- 已新增 `runtime/dictionary-loader.ts`，启动或按需刷新时合并 API 字典项，失败时回落默认字典，不在每条命令里查 DB。
- `QqbotBangDreamRendererService` 已移除对 server/difficulty alias object 的直接依赖，服务器、难度和 displayed server 解析统一走 loader。
- `sql/qqbot-init.sql` 已补 `BANGDREAM_SERVER_ALIAS`、`BANGDREAM_DIFFICULTY_ALIAS` 默认字典项，后台可直接维护别名。

### Phase 3：数据源 provider 和 repository

目标：数据下载、Bestdori、HHWX、静态修正不再散落在 `models` 中。

任务：

- 定义 `BangDreamDataProvider`：`getJson`、`getAsset`、`getTracker`。
- 在 `data-clients` 实现 `bestdori-provider.ts`、`hhwx-tracker-provider.ts`、`static-patch-provider.ts`。
- 用 `withCache`、`withRetry`、`withTiming` 包装 provider，不在业务函数里写重试循环。
- 在 `models` 建立 repository 文件：`song-repository.ts`、`card-repository.ts`、`event-repository.ts`、`gacha-repository.ts`、`player-repository.ts`。
- domain model 只承载字段和轻量行为，不直接拼 URL。

验收：

- `models/song.ts`、`models/card.ts`、`models/event.ts` 中 Bestdori URL 拼接明显减少。
- provider 可单测 mock。
- 档线数据源 fallback 有日志 evidence。

当前进度：

- 已新增 `data-clients/data-provider.ts`，定义 `BangDreamDataProvider`、JSON/Asset/Tracker 请求参数和 provider URL 解析。
- 已新增 `data-clients/provider-decorators.ts`，提供 `withCache`、`withRetry`、`withTiming`，缓存默认值、重试和耗时日志不再要求业务函数内手写循环。
- 已新增 `data-clients/bestdori-provider.ts`、`data-clients/hhwx-tracker-provider.ts`、`data-clients/static-patch-provider.ts`，主数据、素材、Tracker 和本地静态修正分别走 provider。
- `models/main-data-store.ts` 已改为通过 Bestdori provider 加载主数据，通过 static patch provider 读取 `cards-cn-fix.json`、`skills-cn-fix.json`、`area-item-fix.json` 和 `nickname-song.xlsx`。
- 已新增 `models/main-data-repository.ts`、`song-repository.ts`、`card-repository.ts`、`event-repository.ts`、`gacha-repository.ts`、`player-repository.ts`。
- `command-renderers/song-list.ts`、`event-list.ts`、`card-list.ts`、`gacha-detail.ts`、`player-detail.ts`、`cutoff-detail.ts` 已开始改走 repository 创建模型或读取主数据。
- `models/song.ts`、`card.ts`、`event.ts`、`gacha.ts`、`player.ts` 的 Bestdori API/素材请求已开始改走 Bestdori provider；`models/cutoff.ts` 的 Bestdori/HHWX Tracker fallback 已改走 provider，并在 fallback 时输出数据源切换日志。
- 已新增 `models/event-data-repository.ts` 收口活动详情、横幅、背景、轮播、Logo、奖励表情和装饰素材请求；`models/event.ts` 不再直接依赖 Bestdori provider 或 `loadImage`。
- `drawEventDetail` 的活动真实底图改为轻量图片背景，避免长图走模糊三角纹理导致超时；活动底图由 `bg_eventtop.png` 和 `trim_eventtop.png` 合成，避免只渲染模糊背景底图；活动搜索默认遵循 `BANGDREAM_TSUGU_USE_EASY_BG=false`，不再强制简易背景。
- 已接入 `BANGDREAM_TSUGU_REQUEST_TIMEOUT_MS` 和 `BANGDREAM_TSUGU_MAIN_DATA_READY_TIMEOUT_MS`，HTTP 请求和主数据首次 ready 等待都有硬超时，BangDream 命令执行前会等待关键主数据集合可用。
- 已新增 `scripts/bangdream-render-smoke.ps1`，BangDream 图片 smoke 通过父进程限时、子进程 PID 清理、生成后显式退出，避免本地调试命令卡住进程。
- 已新增 `test/qqbot/plugins/bangDream/tsugu/data-provider.spec.ts`，覆盖 provider URL 解析、Bestdori/HHWX mock 数据源、retry/cache wrapper。
- 本地图片烟测已生成查歌 `136`、查活动 `50` 简易背景和真实活动背景图片，证明 provider/repository 第一段迁移后仍能输出非空图片。

### Phase 4：搜索 specification 和 matcher

目标：模糊搜索规则可以新增/禁用，不再在一个文件里继续堆 if。

任务：

- 将 keyword parse、config hit、relation match、field match 拆成 specification。
- 建立 `FuzzySearchRuleRegistry`，每条规则只关心 `canHandle` 和 `match`。
- `search/fuzzy-search-settings.json` 与字典昵称统一成 `SearchDictionaryRepository`。
- `entity-list-matcher.ts` 只依赖 matcher 接口，不直接知道配置来源。

验收：

- `search/fuzzy-search.ts` 文件长度和分支继续下降。
- 新增昵称或难度别名无需改 matcher 代码。
- 旧 search/fuzzy-search 测试全部通过。

当前进度：

- 已新增 `search/fuzzy-search-types.ts`、`search/search-dictionary-repository.ts`、`search/relation-matcher.ts`、`search/fuzzy-search-rule-registry.ts`，把搜索类型、搜索字典读取、关系表达式和规则注册表从 `fuzzy-search.ts` 中拆出。
- `fuzzy-search.ts` 保留关键词拆分、结果校验和目标匹配的兼容入口，关键词解析改由 `FuzzySearchRuleRegistry` 按 number、level、relation、config、fallback 顺序处理，文件长度从 516 行降到 281 行。
- `entity-list-matcher.ts` 改为只依赖搜索结果类型和关系匹配器，并支持延迟读取 `source`，修复 mainAPI 异步加载前捕获空数据源导致查歌/查卡/查活动搜索不到的问题。
- `song-list.ts`、`card-list.ts`、`event-list.ts` 的实体列表匹配器已改为运行时读取 repository source，查歌 `夏祭り` 和查活动 `summer` 本地图片 smoke 均生成非空图片。

### Phase 5：渲染 theme、layout spec 和 section builder

目标：Canvas 绘制仍保留函数式性能，但颜色、尺寸、字体和区块顺序收口。

任务：

- 建立 `render-blocks/theme.ts`：颜色、字体、默认宽度、列表间距、背景配置。
- 建立 `render-blocks/*-spec.ts`：歌曲列表、活动列表、卡牌详情、谱面预览规格。
- `render-blocks/song-chart-preview.ts` 先拆 token，再拆音符策略，不直接改视觉结果。
- `DetailBlockBuilder` 统一 title、data block、image block、spacer。
- 资源路径由 `asset-manifest.ts` 管理，统一 `asset('Card.star')` 形式。

验收：

- `render-blocks/song-chart-preview.ts` 字面量数量显著下降，主函数仍低复杂度。
- 关键图片命令输出非空，尺寸在既有范围。
- 视觉 token 修改只改 theme/spec 文件。

当前进度：

- 已新增 `render-blocks/theme.ts`，先收口公共文字颜色、分割线颜色、简易背景色、图表背景/文字色和默认字体名。
- 已新增 `render-blocks/layout-spec.ts`，统一横向/纵向虚线分割规格，歌曲列表、活动列表、活动详情和通用列表框架不再重复维护分割线宽高/颜色。
- 已新增 `runtime/asset-manifest.ts`，收口本地 `BG`、`Card`、`Skill`、`SongChart`、字体和标题资源路径；`canvas/text.ts`、`canvas/rect.ts`、`canvas/output.ts`、`canvas/background.ts`、`card-art.ts`、`list-rarity.ts`、`skill-text.ts`、`title.ts`、`song-chart-preview.ts` 已改走 manifest。
- 已生成查曲、查活动和查谱面 smoke 图片，验证 theme/spec/manifest 第一段迁移后本地图片输出非空，谱面预览资源路径未断。
- 已新增 `render-blocks/detail-block-builder.ts`，活动详情页先接入 `DetailBlockBuilder` 统一 section、spacer 和 data block 拼装，去掉局部 `pushSection` 和手动分割线维护；`detail-block-builder.spec.ts` 覆盖 section 分割线与 spacer/data block 输出。
- 本地验证时发现 Jest 无法解析 `skia-canvas/lib/v6/index.node`，根因是 `moduleFileExtensions` 未包含 `node`；已把 `.node` 原生扩展解析固化进 Jest 配置，避免后续渲染单测重复卡在同类问题。
- 卡牌详情页已接入 `DetailBlockBuilder`，卡牌标题、插画、基础字段、缩略图和演出缩略图不再手写数组与分割线；`/查卡 472` 本地 smoke 输出非空长图。
- `scripts/bangdream-render-smoke.ps1` 已固化图片 smoke 完成判定：先删除旧目标图，轮询 stdout 成功 JSON 和新图片文件；如果 Tsugu 后台 handle 导致 Node 未自然退出，则在图片落盘后清理本次进程并返回成功，避免已成功出图仍卡到超时。
- 线上 `/qqbot/command/test` smoke 已固化为先按 `operationKey` 查询启用命令、传 `commandId`，并保留完整命令文本；避免默认 `preview` selfId 未绑定命令时误报“未匹配到命令”。
- 已新增 `render-blocks/song-chart-preview-spec.ts`，把谱面 BPM 时间计算、双押识别、滑条拆分、音符排序、展示/计数音符分类、难度颜色和布局规格从 `song-chart-preview.ts` 拆成可测纯策略；绘制文件改为消费 `createSongChartPreviewModel`，只保留资源加载和 canvas 绘制。
- 已新增 `song-chart-preview-spec.spec.ts`，覆盖 BPM 变速时间、十六分单点、双押、滑条 bar/tick/end、布局列数和音符分类；本地生成 `song-chart-preview-spec-136-expert.jpg`，验证谱面预览重构后图片输出非空且视觉结构正常。
- 已新增 `render-blocks/card-art-spec.ts`，收口卡牌图标/插画边框 URL 生成、icon/illustration 画布尺寸、属性/乐队/星级/突破/技能等级坐标；`card-art.ts` 改为消费 spec 和 URL factory，下载与绘制顺序保持不变。
- 已新增 `card-art-spec.spec.ts`，覆盖 rarity=1 属性边框、其他稀有度边框和关键尺寸；本地生成 `card-art-spec-card-472.jpg`，验证卡牌详情图在规格收口后仍能正常输出。
- 已新增 `render-blocks/detail-block-spec.ts`，收口歌曲详情、歌曲 meta、角色半身块和玩家详情头图的尺寸、间距、字号与相对分数舍入规则；`detail-blocks.ts` 改为消费 spec，数据查询和绘制顺序保持不变。
- 已新增 `detail-block-spec.spec.ts`，覆盖歌曲详情尺寸、角色/玩家详情尺寸和 meta 相对百分比舍入；本地生成 `detail-spec-song-136.jpg`、`detail-spec-event-50.jpg`、`detail-spec-character-1.jpg`，验证详情区块规格收口后查曲/查活动/查角色图片输出正常。
- 已新增 `render-blocks/list-frame-spec.ts`，收口通用列表行、tips、横向合并列、居中图片列表和左侧竖线的字号、间距、兜底尺寸与布局计算；`list-frame.ts` 改为消费 spec，服务器分组、换行和绘制顺序保持不变。
- 已新增 `list-frame-spec.spec.ts`，覆盖列表正文宽度、标签/tips 偏移、合并列宽、居中图片换行和左侧竖线尺寸；本地生成 `list-frame-spec-song-136.jpg`、`list-frame-spec-event-50.jpg`、`list-frame-spec-character-1.jpg`，验证列表框架规格收口后查曲/查活动/查角色图片输出正常。
- 已新增 `canvas/text-spec.ts`，收口文本默认字号、行高比例、baseline、空画布尺寸、混排间距和内联图片缩放计算；`canvas/text.ts` 改为消费 spec，原有文本换行和混排拆分逻辑保持不变。
- 已新增 `text-spec.spec.ts`，覆盖行高/间距比例、baseline、内联图片缩放和空/单行/多行画布尺寸；本地生成 `text-spec-song-136.jpg`、`text-spec-event-50.jpg`、`text-spec-character-1.jpg`，验证文本规格收口后查曲/查活动/查角色图片输出正常。
- 已新增 `render-blocks/gacha-simulate-spec.ts`，收口抽卡模拟网格宽度、单抽/汇总混排尺寸、重复卡叠层、数量右对齐和卡池横幅布局；`gacha-simulate.ts` 改为消费 spec，抽卡概率和卡池选择逻辑保持不变。
- 已新增 `gacha-simulate-spec.spec.ts`，覆盖 10 抽网格、汇总模式、重复卡叠层、计数字样和横幅尺寸；本地生成 `gacha-simulate-spec-10-259.jpg` 和 `gacha-simulate-spec-50-259-after-cache-fix.jpg`，验证抽卡模拟两种布局模式图片输出正常。
- 抽卡模拟 50 抽 smoke 暴露资源下载短时失败会把 URL 写入无过期错误缓存，导致后续重试直接输出 `asset error`；已改为只有 HTTP 404 进入错误缓存，超时/网络抖动不污染 URL，并新增 `file-cache-client.spec.ts` 覆盖瞬时失败后可再次下载、404 缓存缺失资源两种路径。
- 已新增 `render-blocks/event-stage-spec.ts`，收口试炼列表最大列高、歌曲单元格/封面/ID/难度条尺寸、试炼类型顶部文字规格和换列判断；`event-stage.ts` 与 `list-event-stage.ts` 改为消费 spec，活动/歌曲选择和输出结构保持不变。
- 线上 smoke 暴露 `/查试炼 310 -m` 将所有列横向拼成一张巨大 canvas 会触发 Pod `OOMKilled exit=137`；已改为按小批次绘制 stage、边分列边输出多张 CQ 图片，不再创建最终横向巨图，普通版和 meta 版均拆成 5 张输出，同时避免完全串行导致冷缓存首条命令耗时过长。
- 已新增 `event-stage-spec.spec.ts`，覆盖试炼歌曲行尺寸、类型顶部文字规格、换列判断和按列高拆分算法；本地生成 `event-stage-split-310*.jpg`、`event-stage-split-310-meta*.jpg`，验证 `/查试炼 310` 与 `/查试炼 310 -m` 图片输出正常。
- smoke/Jenkins/远程调试卡点继续按已固化规则处理：同一卡点第二次尝试前必须改变可验证变量；Jenkins 查询 URL 含方括号时用 `curl -g` 或改查 Jenkins home；线上图片 smoke 必须查询 `commandId`、拉回图片、展示图片、查日志并清理本轮临时目录；PowerShell 双引号 here-string 中不要写 JS `${...}` 模板字面量，避免被 PowerShell 提前插值；smoke 没有真实图片落盘时必须失败。

### Phase 6：策略 policy 和时间/档线规则

目标：服务器优先级、国服预估、档位、时区和活动状态从工具函数变成可测试规则。

任务：

- `BangDreamServerPolicy`：默认展示服、主服务器、优先级、时区。
- `CnEventEstimatePolicy`：国服预估起始活动、跳过活动、无邦日。
- `CutoffPolicy`：档位列表、预测线规则、近期活动选择规则。
- `GachaPolicy`：生日卡池过滤、抽卡次数默认值、概率选择。

验收：

- `render-blocks/list-time.ts` 不再持有国服预估常量。
- `models/cutoff.ts` 的请求、预测、展示规则分层。
- policy 均有纯函数测试。

当前进度：

- 已新增 `models/server-policy.ts`，收口服务器 UTC 偏移、服务器时区 Date 转换、时间戳规范化和档线日增 checkpoint 服务器规则；`render-blocks/list-time.ts` 保留兼容入口但不再维护时区 switch。
- 已新增 `models/cn-event-estimate-policy.ts`，把国服预估起始活动、跳过活动和无邦日规则从 `list-time.ts` 移出，提供 `calculateCnEventEstimateStartAt` 纯函数测试入口；`list-time.ts` 和 `event.ts` 改走 policy，不再让 Event 排序依赖渲染层预估实现。
- 已新增 `models/cutoff-policy.ts`，收口档位列表、档位支持判断、国服缺失活动时间预估、档线活动状态、预测窗口、日增天数和最近同类型活动选择规则；`models/cutoff.ts` 和 `cutoff-all.ts` 已接入。
- 已新增 `test/qqbot/plugins/bangDream/tsugu/policy.spec.ts`，覆盖服务器时区、国服预估纯计算、档位判断、状态/预测窗口、日增 checkpoint、活动天数和最近活动选择；policy 单测 mock `main-data-store`，避免纯测试启动主数据定时器。
- 已生成 `phase6-policy-event-50.jpg`、`phase6-policy-cutoff-detail-100-50-cn.jpg`、`phase6-policy-cutoff-recent-100-50-cn.jpg`，验证查活动、单档线和历史档线图片输出非空。
- 已新增 `models/gacha-policy.ts`，收口抽卡默认次数、上限、十连保底、稀有度概率、卡牌权重、生日/免费/日服常驻卡池过滤规则；`gacha-simulate.ts`、`gacha.ts`、`event-detail.ts` 和 renderer 当前卡池选择已接入。
- `policy.spec.ts` 已补抽卡策略纯函数测试，覆盖卡池类型分类、抽卡次数上限、十连保底和权重抽取；本地生成 `gacha-policy-simulate-10-259.jpg` 和 `gacha-policy-event-50.jpg`，验证抽卡模拟与活动详情图片输出非空。
- smoke 脚本和远程调试流程继续按已固化规则执行：图片落盘后清理本次 Node 进程并返回成功；远程命令测试必须按 `operationKey` 查询 `commandId`、传完整命令文本、外层设置 timeout，并在成功/失败分支显式退出。

### Phase 7：Facade 和 hook 接入

目标：Nest 边界稳定，Tsugu 内部可观测。

任务：

- `TsuguApplicationService` 作为唯一执行入口。
- `TsuguOperationPipeline` 串起 registry、parser、resolver、renderer、output。
- `TsuguHookRegistry` 注入日志、metrics、数据源 fallback、输出摘要 hook。
- 错误统一成字符串，保持前端/QQBot 链路可解析。

验收：

- `QqbotBangDreamRendererService` 只保留薄 facade 或被替代。
- 每次命令执行能记录 operation、耗时、图片数、错误。
- 线上日志能定位 BangDream 命令的具体失败阶段。

当前进度：

- 已新增 `tsugu/runtime/hook-registry.ts`，定义 `TsuguHookContext`、`TsuguHook`、`TsuguHookRegistry` 和默认 `TsuguLogHook`，命令执行日志包含 `operation`、`stage`、`handler`、`query`、`imageCount`、`durationMs` 和错误字符串。
- 已新增 `renderer/tsugu-application.service.ts` 作为 BangDream Tsugu 应用入口，统一执行主数据 ready 等待、operation registry 查找、handler 调度、hook 触发和错误字符串化。
- `QqbotBangDreamClientService` 已改为注入 `TsuguApplicationService`，不再直接调用 renderer；`QqbotBangDreamRendererService` 移除 operation key 调度，只保留字典刷新、健康检查、渲染选项解析和 15 个具体 handler。
- 已新增 `tsugu/runtime/operation-pipeline.ts`，把主数据 ready、operation resolve、handler render、output hook 和 error hook 固定为 `TsuguOperationPipeline.run`，`TsuguApplicationService.execute` 只负责调用 pipeline。
- `scripts/bangdream-render-smoke.ps1` 已切到 `TsuguApplicationService`，本地 smoke 继续走真实应用入口，避免 facade 改造后验证脚本回退到旧链路。
- 已新增 `hook-registry.spec.ts`、`operation-pipeline.spec.ts` 和 `tsugu-application.service.spec.ts`，覆盖 hook 顺序、错误 hook、pipeline 成功/未知 operation/handler 错误、应用入口执行、字典刷新和错误字符串化；本地 Phase 7 smoke 已生成 `phase7-hook-event-50.jpg`、`phase7-hook-cutoff-detail-100-50-cn.jpg`、`phase7-hook-cutoff-recent-100-50-cn.jpg`、`phase7-pipeline-event-50.jpg`、`phase7-pipeline-cutoff-detail-100-50-cn.jpg`、`phase7-pipeline-cutoff-recent-100-50-cn.jpg`。
- 线上 `qqbot/command/test` 复测时曾出现 `bangdream.event.search` 的 `Invalid URL`，根因按风险点固化为：缓存层不能假设所有调用方都已把 `/api`、`/assets` 相对路径解析成完整 Bestdori URL；已在 `data-clients/cache-path.ts` 增加 `resolveCacheUrl` 兜底，并新增 `cache-path.spec.ts` 覆盖相对资产路径、相对 API 路径和完整 URL。线上/远程临时 Node 调试脚本必须同时设置外层 `timeout`，并在成功和失败分支显式 `process.exit(...)`，避免 SSH 会话被后台 timer 卡住。

## 文件迁移优先级

| 优先级 | 文件/目录 | 原因 |
| --- | --- | --- |
| P0 | `renderer/qqbot-bangdream-renderer.service.ts` | 当前 operation 调度中心，影响在线命令一致性 |
| P0 | `commands/qqbot-bangdream-command.definitions.ts` | 命令定义和 SQL 校验源头 |
| P0 | `search/fuzzy-search.ts`、`search/entity-list-matcher.ts` | 搜索规则和查实体能力最容易继续膨胀 |
| P1 | `runtime/config.ts`、`models/bangdream-constants.ts` | 硬编码分层入口 |
| P1 | `data-clients/asset-cache-client.ts`、`data-clients/file-cache-client.ts`、`data-clients/api-cache-client.ts` | 缓存/重试/数据源切换横切能力 |
| P1 | `models/song.ts`、`models/card.ts`、`models/event.ts`、`models/gacha.ts` | URL 拼接、mainAPI、patch、模型行为耦合 |
| P2 | `render-blocks/song-chart-preview.ts` | 字面量最高，但视觉风险高，必须测试保护后再拆 |
| P2 | `render-blocks/list-frame.ts`、`render-blocks/detail-blocks.ts`、`canvas/text.ts` | theme/spec 收口收益大 |
| P3 | 其他 `command-renderers/*` | 等 builder/pipeline 稳定后逐个迁移 |

## 不做的事

- 不把所有常量都塞进数据库。布局像素、颜色 token、协议字段和资源文件名进入数据库只会降低可维护性。
- 不做动态脚本 hook。hook 只允许代码内注册，避免线上不可控执行。
- 不拆独立 Tsugu 服务。用户已明确不希望增加分离部署和管理成本。
- 不一次性重命名/移动 92 个文件。先建立边界，再按风险迁移。
- 不追求像素完全重画。当前需求是结构和硬编码治理，视觉只做等价保护。

## 最小可执行第一步

第一步建议只做三个文件级变更：

1. 新增 `runtime/operation-registry.ts`，把 15 个 operation 的 key/name/description/handler 统一。
2. 修改 `QqbotBangDreamRendererService.execute`，从 registry 查 handler，不改每个 handler 内部逻辑。
3. 新增 registry 一致性测试，保证 operation defs、SQL 初始化、TypeScript union 三者一致。

这一步收益明确，风险可控，也能为后续 hook/pipeline 打基础。

## 验证矩阵

| 阶段 | 必跑 |
| --- | --- |
| 文档/配置阶段 | `git diff --check`、global-review |
| registry/pipeline | operation registry Jest、BangDream command SQL Jest、typecheck |
| 字典/配置 | 字典加载单测、无 DB 回落单测、server/difficulty parse 单测 |
| data provider | provider mock 单测、真实 Bestdori smoke、缓存命中单测 |
| search | search/fuzzy-search 全量单测、查曲/查活动/查卡 smoke |
| render | 非空 Buffer、图片尺寸范围、关键命令 smoke |
| push 发布 | Jenkins 构建、K8s rollout、新 Pod 日志、真实 QQBot 命令 smoke |

## 成功标准

- `QqbotBangDreamRendererService` 不再承担 15 个 operation 的巨大 switch。
- 用户可维护的别名、文案和命令映射从源码硬编码中移出。
- 数据源、缓存、重试、fallback 和日志通过 provider/decorator/hook 接入。
- 搜索规则、服务器策略、档线规则、国服时间预估都有独立可测入口。
- 渲染层的颜色、尺寸、字体、资源路径有统一 token/spec/manifest。
- 现有 15 个在线命令保持兼容，查曲、查活动、查试炼、档线、抽卡模拟都能输出图片。
