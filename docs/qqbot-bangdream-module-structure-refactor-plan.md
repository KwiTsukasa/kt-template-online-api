# QQBot BangDream 模块化文件结构重构方案

生成日期：2026-06-07

## 目标

基于 `docs/qqbot-bangdream-tsugu-reference.md` 的重构后现状，继续推进文件结构治理。本方案已落地为源码、测试、脚本和文档迁移记录。

目标是：

- 去掉 `src/qqbot/plugins/bangDream/tsugu` 这一层目录，BangDream 内嵌能力直接归入 `src/qqbot/plugins/bangDream`。
- 不再按 `models`、`render-blocks`、`command-renderers`、`canvas` 这类技术能力横向堆文件。
- 改成按 BangDream 业务模块聚合文件，例如 `song`、`card`、`event`、`gacha`、`player`、`cutoff`。
- 对真正跨模块的大能力单独抽出，例如 `hook`、`provider`、`policy`、`registry`、`theme`。
- 控制单个文件夹文件数，避免再次出现 `render-blocks=66`、`models=46` 的大桶目录。
- 保持现有 15 个在线命令兼容，迁移期间不改变用户命令文本、返回图片数量和线上 smoke 方式。

## 迁移前问题

迁移前 `tsugu` 源码 168 个 TS 文件分布如下：

| 目录 | 文件数 | 问题 |
| --- | ---: | --- |
| `render-blocks` | 66 | 渲染规格、列表块、详情块、图表和资源 repository 混在一起，目录过大 |
| `models` | 46 | 领域模型、resource repository、policy、protocol、主数据 store 混在一起 |
| `command-renderers` | 19 | 以命令输出能力聚合，但和业务模块、模型、渲染块分离太远 |
| `canvas` | 11 | 底层画布能力独立存在合理，但和 theme/asset manifest 分散 |
| `data-clients` | 10 | provider 能力已经清晰，可以作为横切大能力保留 |
| `runtime` | 9 | registry、hook、dictionary、config、asset manifest 混在同一目录 |
| `search` | 6 | 跨模块搜索能力清晰，可以作为横切能力保留 |
| `calculations` | 1 | 只有档线预测，适合归入 `cutoff` 或 `calculation` |

迁移前最大的问题不是层级太深，而是“按技术能力横切后文件越来越多”。例如歌曲相关文件散落在 `models/song.ts`、`song-resource-repository.ts`、`command-renderers/song-*`、`render-blocks/list-song-*`、`render-blocks/song-chart-preview-*`。后续维护查歌或谱面时需要跨多个目录来回跳。

## 设计原则

1. `bangDream` 插件目录即模块根目录，不再保留 `tsugu` 子目录。
2. 业务域模块按用户和上游数据实体命名，不按技术能力命名。
3. 横切能力只有在多个业务模块共享时才单独成目录。
4. 每个业务模块内文件直接平铺，默认不再建 `model/render/repository` 子目录。
5. 单个目录建议不超过 20 个 TS 文件，超过时优先拆业务子模块，不回退到 `models` 或 `render-blocks` 大桶。
6. 文件名用职责后缀表达角色，例如 `song.model.ts`、`song.repository.ts`、`song-search.renderer.ts`、`song-chart.layout.ts`。
7. Jest 测试仍放在 `test/qqbot/plugins/bangDream`，按源码目标模块同步改路径，不放回源码目录。
8. 静态资源和静态配置保留 `assets`、`static-config`，不跟 TS 源码迁移节奏绑定。

## 实际落地结构

完整文件职责以 `docs/qqbot-bangdream-tsugu-reference.md` 为准，当前源码已经去掉 `tsugu` 子目录，实际顶层结构如下：

```text
src/qqbot/plugins/bangDream/
  application/    Nest 客户端、应用服务、渲染 facade、operation pipeline
  registry/       operation key、handlerName、在线命令别名、冷却和说明
  hook/           生命周期 hook 和命令执行日志 hook
  provider/       Bestdori、HHWX、静态修正、缓存、重试和 URL 解析
  policy/         服务器、国服活动时间、档线、抽卡等跨模块规则
  theme/          Canvas 基础能力、布局 token、资源 manifest 和视觉主题
  config/         运行时配置、环境变量 key、服务器默认值和档线 tier
  dictionary/     默认字典和 API 字典加载
  search/         模糊搜索、关系表达式、搜索字典和实体列表匹配
  song/           查曲、谱面、随机曲、分数表、歌曲资源 repository
  card/           查卡、卡面、卡牌图标、稀有度、技能、综合力渲染
  character/      查角色、角色详情、角色列表和角色资源 repository
  event/          查活动、活动详情、试炼、活动时间和活动数据 repository
  gacha/          查卡池、抽卡模拟、卡池概率、Pick Up 和卡池资源 repository
  player/         查玩家、卡组、乐队等级、角色等级、难度完成和排名
  cutoff/         档线、全档线、近期档线、图表和预测算法
  catalog/        服务器、乐队、属性、区域道具、服装、称号、道具、技能、颜色
  shared/         协议常量、主数据、通用详情块、数据块、列表框架
  commands/       QQBot 在线命令定义桥接
  assets/         本地图片、字体和静态视觉资源
  static-config/  搜索配置、昵称表、CN 修正表和玩家编号表
```

测试目录按源码模块同步拆分：

```text
test/qqbot/plugins/bangDream/
  application/ card/ catalog/ character/ cutoff/ dictionary/ event/
  gacha/ hook/ player/ policy/ provider/ registry/ search/ shared/ song/ theme/
```

资源和静态配置同步从旧层级上移，Nest 构建复制路径已改为 `qqbot/plugins/bangDream/assets/**/*` 和 `qqbot/plugins/bangDream/static-config/**/*`。

## 横切能力说明

### `application`

承接 Nest 边界和插件内部 facade：

- `bangdream-client.service.ts`：替代当前根部 `qqbot-bangdream-client.service.ts`，只暴露 `execute`、`checkHealth` 和少量明确 API。
- `bangdream-application.service.ts`：替代 `renderer/tsugu-application.service.ts`，唯一应用入口。
- `bangdream-renderer.facade.ts`：替代 `renderer/qqbot-bangdream-renderer.service.ts`，只做 handler 分发、输入归一化、字典解析和 CQ 输出。

### `registry`

只放注册表和注册表类型：

- operation key
- handlerName
- 在线命令别名
- 冷却
- 命令说明

不放字典、hook、provider 或 renderer。

### `hook`

只放生命周期 hook：

- hook context
- hook registry
- log hook
- 后续 metrics/output summary hook

业务决策不放 hook。会改变业务结果的逻辑放 `policy` 或模块 renderer。

### `provider`

只放外部数据源和缓存下载能力：

- Bestdori provider
- HHWX tracker provider
- static patch provider
- cache path/policy/client
- retry/cache/timing decorator

任何模块需要外部 JSON、asset 或 tracker 数据，都通过 provider 或本模块 repository 调用，不直接拼完整 URL。

### `policy`

只放跨模块业务规则：

- 服务器时区和优先级
- 国服活动时间预估
- 档线预测窗口和档位规则
- 抽卡概率和卡池过滤

单模块私有规则可以先留在模块文件，只有跨模块复用或会独立测试时才移动到 `policy`。

### `theme`

承接视觉基础能力：

- 渲染主题 token
- 本地 asset manifest
- 通用 layout token
- Canvas 基础工具

不再使用 `canvas` 和 `render-blocks` 作为顶层大桶。各业务模块自己的布局文件放回模块内部，例如 `song/song-chart-preview.layout.ts`、`card/card-stat.layout.ts`。

## 业务模块说明

### `song`

聚合查曲、歌曲详情、随机曲、分数表和谱面预览。现有散落来源：

- `models/song.ts`
- `models/song-repository.ts`
- `models/song-resource-repository.ts`
- `command-renderers/song-*`
- `render-blocks/list-song*`
- `render-blocks/list-difficulty*`
- `render-blocks/song-chart-preview*`

### `card`

聚合查卡、卡牌详情、卡面、卡牌图标、插画、稀有度、综合力、技能文字和 SD 缩略图。现有散落来源：

- `models/card.ts`
- `models/card-repository.ts`
- `models/card-resource-repository.ts`
- `command-renderers/card-*`
- `render-blocks/card-*`
- `render-blocks/list-card-*`
- `render-blocks/list-rarity*`
- `render-blocks/list-stat*`
- `render-blocks/skill-text*`

### `character`

聚合角色查询、角色详情、角色列表和玩家详情里的角色等级列表。现有散落来源：

- `models/character.ts`
- `models/character-resource-repository.ts`
- `command-renderers/character-*`
- `render-blocks/list-character*`

### `event`

聚合查活动、活动详情、活动列表、试炼和活动时间展示。现有散落来源：

- `models/event.ts`
- `models/event-repository.ts`
- `models/event-data-repository.ts`
- `models/event-stage.ts`
- `models/event-stage-data-repository.ts`
- `command-renderers/event-*`
- `render-blocks/event-stage*`
- `render-blocks/list-event-stage.ts`
- `render-blocks/list-time*`

### `gacha`

聚合查卡池、抽卡模拟、卡池列表、概率和 pick up 展示。抽卡规则本身放 `policy/gacha.policy.ts`，模块只消费 policy。

### `player`

聚合玩家详情、玩家数据 repository、玩家卡组、乐队等级、角色等级、难度完成情况和排名展示。

### `cutoff`

聚合档线模型、前十榜、单档线、全档线、历史档线、档线图表、时间线图表和预测算法。档线规则本身放 `policy/cutoff.policy.ts`，模块只消费 policy。

### `catalog`

聚合不直接对应一个 QQBot 命令、但多个模块共享的静态目录实体：

- 服务器
- 乐队
- 属性
- 区域道具
- 服装
- 称号
- 道具
- 技能
- 颜色

这些不再放进 `models` 大桶。

### `shared`

只放真正跨多个模块的轻量工具、协议和通用渲染块：

- Bestdori 协议枚举和兼容常量
- 主数据 store/repository
- 模型工具函数
- 通用详情块、数据块、列表框架
- 图片栈工具

`shared` 不能成为新的大桶。超过 20 个 TS 文件时必须继续拆模块。

## 当前到目标迁移映射

| 当前路径 | 目标路径 |
| --- | --- |
| `tsugu/runtime/operation-registry.ts` | `registry/operation-registry.ts` |
| `tsugu/runtime/hook-registry.ts` | `hook/hook-registry.ts`、`hook/log-hook.ts` |
| `tsugu/runtime/config.ts` | `config/runtime-config.ts` |
| `tsugu/runtime/runtime-options.ts` | `config/runtime-options.ts` |
| `tsugu/runtime/default-dictionary.ts` | `dictionary/default-dictionary.ts` |
| `tsugu/runtime/dictionary-loader.ts` | `dictionary/dictionary-loader.ts` |
| `tsugu/runtime/asset-manifest.ts` | `theme/asset-manifest.ts` |
| `tsugu/data-clients/*` | `provider/*` |
| `tsugu/models/*-policy.ts` | `policy/*.policy.ts` |
| `tsugu/search/*` | `search/*` |
| `tsugu/canvas/*` | `theme/canvas-*.ts` |
| `tsugu/models/song*`、`command-renderers/song-*`、`render-blocks/*song*`、`render-blocks/*difficulty*` | `song/*` |
| `tsugu/models/card*`、`command-renderers/card-*`、`render-blocks/card-*`、`render-blocks/list-card-*`、`render-blocks/list-rarity*`、`render-blocks/list-stat*`、`render-blocks/skill-text*` | `card/*` |
| `tsugu/models/character*`、`command-renderers/character-*`、`render-blocks/list-character*` | `character/*` |
| `tsugu/models/event*`、`command-renderers/event-*`、`render-blocks/event-stage*`、`render-blocks/list-event-stage.ts`、`render-blocks/list-time*` | `event/*` |
| `tsugu/models/gacha*`、`command-renderers/gacha-*`、`render-blocks/gacha-*`、`render-blocks/list-gacha-*` | `gacha/*` |
| `tsugu/models/player*`、`command-renderers/player-detail.ts`、`render-blocks/list-player-*`、`render-blocks/deck-rank-*` | `player/*` |
| `tsugu/models/cutoff*`、`command-renderers/cutoff-*`、`render-blocks/*cutoff*`、`render-blocks/timeline-chart*`、`calculations/cutoff-predictor.ts` | `cutoff/*` |
| `tsugu/models/attribute*`、`band*`、`area-item*`、`costume*`、`degree*`、`item*`、`server*`、`skill*`、`color.ts` | `catalog/*` |
| `tsugu/render-blocks/detail-block*`、`data-block*`、`list-frame*`、`list-entity*`、`image-stack.ts` | `shared/*` |

## 命名规则

| 后缀 | 含义 | 示例 |
| --- | --- | --- |
| `.model.ts` | 领域实体和值对象 | `song.model.ts` |
| `.repository.ts` | 主数据、资源或外部数据读取 | `song-resource.repository.ts` |
| `.renderer.ts` | 生成图片或组合图片区块 | `song-chart.renderer.ts` |
| `.layout.ts` | 视觉布局规格、纯布局计算 | `song-chart-preview.layout.ts` |
| `.policy.ts` | 跨模块业务规则 | `cutoff.policy.ts` |
| `.provider.ts` | 外部数据源实现 | `bestdori.provider.ts` |
| `.client.ts` | 缓存、下载或外部客户端 | `asset-cache.client.ts` |
| `.registry.ts` | 注册表 | `operation-registry.ts` |
| `.types.ts` | 类型集合 | `fuzzy-search.types.ts` |

不再新增：

- `*-spec.ts` 作为源码布局文件后缀。后续使用 `.layout.ts`，避免和 Jest `*.spec.ts` 语义混淆。
- `models/`、`render-blocks/`、`command-renderers/`、`data-clients/`、`runtime/`、`canvas/` 顶层目录。
- 巨型 `index.ts` barrel。只允许模块内少量显式 re-export，避免循环依赖。

## 迁移批次

### Phase 0：结构迁移准备

目标：只建立可验证的迁移边界，不移动文件。

任务：

- 用脚本生成当前文件清单和 import 图。
- 冻结 15 个 operation 的 smoke 用例。
- 新增结构守卫脚本：禁止新增 `tsugu/` 引用，统计目标目录文件数。
- 在文档里确认目录预算和命名规则。

验证：

- 文件清单 168 个 TS 文件全部有目标位置。
- operation 表 15/15 保持一致。
- `git diff --check`、global-review。

### Phase 1：横切能力先迁移

目标：先迁移不会改变业务输出的共享能力。

迁移：

- `runtime/operation-registry.ts` -> `registry/operation-registry.ts`
- `runtime/hook-registry.ts` -> `hook/*`
- `runtime/config.ts`、`runtime/runtime-options.ts` -> `config/*`
- `runtime/default-dictionary.ts`、`runtime/dictionary-loader.ts` -> `dictionary/*`
- `runtime/asset-manifest.ts`、`canvas/*`、`render-blocks/theme.ts`、`render-blocks/layout-spec.ts` -> `theme/*`
- `data-clients/*` -> `provider/*`
- `models/*-policy.ts` -> `policy/*`
- `search/*` -> `search/*`

验证：

- `pnpm run typecheck`
- registry、hook、dictionary、provider、policy、search 相关 Jest
- 本地 `/查谱面 136 expert` 和 `/ycx 100 50 cn` smoke

### Phase 2：低耦合业务模块迁移

目标：迁移文件数量可控、依赖较清晰的模块。

建议顺序：

1. `song`
2. `character`
3. `gacha`
4. `cutoff`

验证：

- 每迁移一个模块跑对应 Jest 和一条图片 smoke。
- 不推远程，等本批模块全部完成后一次性提交、构建、线上验证。

### Phase 3：高耦合业务模块迁移

目标：迁移涉及共享块较多的模块。

建议顺序：

1. `card`
2. `event`
3. `player`
4. `catalog`
5. `shared`

验证：

- `card`：`/查卡 472`
- `event`：`/查活动 50`、`/查试炼 310`
- `player`：`/查玩家 26591455 jp`
- `catalog/shared`：跑上面三类 smoke 复验

### Phase 4：删除旧层级

目标：彻底去掉 `tsugu` 目录和旧大桶目录。

任务：

- 删除空的 `tsugu` 目录。
- 全局替换 import。
- 更新 `scripts/bangdream-render-smoke.ps1`。
- 更新测试路径。
- 更新 reference 文档。
- 更新本方案迁移结果。

验收：

```powershell
rg -n "plugins/bangDream/tsugu|\\.\\/tsugu|\\.\\.\\/tsugu" src test scripts docs
```

源码、测试、脚本不能再依赖 `tsugu` 路径。历史文档允许在“旧路径说明”中出现，但必须明确是旧路径。

### Phase 5：完整发布验证

目标：只在批量迁移完成后做一次发布闭环。

必跑：

- `git diff --check`
- `pnpm run typecheck`
- BangDream scoped ESLint
- BangDream 全量 Jest
- `pnpm run build`
- local smoke：查曲、查卡、查活动、查试炼、抽卡、档线、谱面
- global-review
- push 后 Jenkins/K8s rollout
- 线上 `/qqbot/command/test` smoke 拉图、展示图片、查 operation 日志、清理远程临时目录

## 目录预算

| 目录 | 预算 | 超过后的处理 |
| --- | ---: | --- |
| `song` | 16 | 拆出 `song-chart` 作为业务子模块，不回退到 `render-blocks` |
| `card` | 20 | 拆出 `card-art` 或 `card-detail` 作为业务子模块 |
| `event` | 18 | 拆出 `event-stage` 作为业务子模块 |
| `gacha` | 14 | 保持单模块 |
| `player` | 16 | 拆出 `player-ranking` 作为业务子模块 |
| `cutoff` | 16 | 保持单模块 |
| `catalog` | 20 | 拆出 `catalog-degree` 或 `catalog-server` |
| `shared` | 20 | 能归业务模块就归业务模块，不能扩成新大桶 |
| `provider` | 14 | cache client 可拆 `provider-cache` |
| `theme` | 18 | canvas 基础可拆 `theme-canvas` |

预算不是硬编译规则，但用于 review：如果一个目录继续增长，先问“这是业务模块太大，还是又按能力堆成大桶了”。

## 风险点

| 风险 | 影响 | 控制方式 |
| --- | --- | --- |
| import 路径大规模替换出错 | typecheck/Jest 失败 | 分批迁移，每批只移动一个边界或少数模块 |
| 循环依赖被 barrel 放大 | 运行时 undefined | 不建巨型 `index.ts`，保留显式 import |
| layout 文件改名导致测试误判 | Jest pattern 或 import 失败 | 源码布局后缀改 `.layout.ts`，测试仍 `.spec.ts` |
| smoke 卡进程 | 验证耗时不可控 | 继续使用 bounded smoke 脚本 |
| 线上命令误匹配 | preview selfId 未绑定命令 | 线上 smoke 必须按 operationKey 查 commandId |
| 大图 OOM 回归 | `/查试炼 310` 风险最高 | 保留分页拆图测试和线上 imageCount=5 验证 |

## 不做的事

- 不拆独立 Tsugu 服务。
- 不引入新仓库。
- 不为了目录漂亮改业务逻辑。
- 不把布局像素、资源文件名和协议字段放进字典表。
- 不把 `shared`、`theme` 或 `catalog` 变成新的 `models/render-blocks` 大桶。
- 不在结构迁移之外改 BangDream 命令文本、返回图片数量或业务结果。

## 完成标准

本次闭环完成时按以下标准验收：

- `src/qqbot/plugins/bangDream/tsugu` 不再存在。
- `models`、`render-blocks`、`command-renderers`、`data-clients`、`runtime`、`canvas` 不再作为 BangDream 顶层源码目录存在。
- 15 个 operation key、在线命令别名和 handler 绑定保持一致。
- 每个业务模块能在一个目录内看到模型、repository、renderer 和 layout。
- `hook`、`provider`、`policy`、`registry`、`theme` 是明确横切能力，不包含业务命令编排。
- 没有目录明显超过预算且未解释。
- 本地全量验证和线上 smoke 均通过。
