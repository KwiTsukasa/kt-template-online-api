# QQBot BangDream 模块参考文档

生成日期：2026-06-07

## 文档定位

本文记录 QQBot BangDream 插件在文件结构重构完成后的稳定结构、入口链路、扩展点和验证方式。原 `tsugu` 子目录已经移除，内嵌 Tsugu 能力现在直接归入 `src/qqbot/plugins/bangDream`。

函数级用途以源码 JSDoc 为准；本文只维护模块边界、文件职责、命令入口、数据流、测试和发布验证入口。

## 覆盖范围

| 项 | 当前值 |
| --- | --- |
| 模块源码目录 | `src/qqbot/plugins/bangDream` |
| Nest 客户端入口 | `src/qqbot/plugins/bangDream/application/bangdream-client.service.ts` |
| 应用入口 | `src/qqbot/plugins/bangDream/application/bangdream-application.service.ts` |
| 渲染 Facade | `src/qqbot/plugins/bangDream/application/bangdream-renderer.facade.ts` |
| Operation 注册表 | `src/qqbot/plugins/bangDream/registry/operation-registry.ts` |
| 测试目录 | `test/qqbot/plugins/bangDream` |
| 资源目录 | `src/qqbot/plugins/bangDream/assets` |
| 静态配置目录 | `src/qqbot/plugins/bangDream/static-config` |

## 总体链路

```text
QQBot 在线命令
  -> QqbotBangDreamPluginService / command engine
  -> QqbotBangDreamClientService.execute(operationKey, input)
  -> TsuguApplicationService
  -> TsuguOperationPipeline
  -> QqbotBangDreamRendererService.executeOperationHandler(handlerName, input)
  -> song/card/event/gacha/player/cutoff 等模块 renderer
  -> provider + repository + search + theme/shared
  -> CQ image base64 reply
```

核心约束：

- `registry/operation-registry.ts` 是 15 个 BangDream operation、handlerName、在线命令别名和冷却配置的单一来源。
- `application/bangdream-application.service.ts` 是 Nest 边界，负责主数据 ready、字典刷新、pipeline 和错误字符串化。
- `application/bangdream-renderer.facade.ts` 只做 handler 分发、输入归一化、字典解析和 CQ 图片输出。
- 业务模块按领域聚合，例如歌曲文件集中在 `song`，卡牌文件集中在 `card`。
- 横切能力只放 `hook`、`provider`、`policy`、`registry`、`theme`、`search`、`shared`。
- 不再新增 `tsugu`、`models`、`render-blocks`、`command-renderers`、`data-clients`、`runtime`、`canvas` 顶层目录。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `application` | Nest 客户端、应用服务、渲染 facade、operation pipeline |
| `registry` | operation key、handlerName、在线命令别名、冷却和说明 |
| `hook` | 生命周期 hook 和命令执行日志 hook |
| `provider` | Bestdori、HHWX、静态修正、缓存、重试、URL 解析和文件缓存 |
| `policy` | 服务器策略、国服活动时间预估、档线规则、抽卡规则 |
| `theme` | Canvas 基础能力、布局 token、本地资源 manifest 和渲染主题 |
| `config` | 运行时配置、环境变量 key、服务器默认值和档线 tier |
| `dictionary` | 默认字典和 API 字典加载 |
| `search` | 模糊搜索、关系表达式、搜索字典和实体列表匹配 |
| `song` | 查曲、歌曲详情、随机曲、分数表、谱面图片、歌曲资源 repository |
| `card` | 查卡、卡面、卡牌图标、卡牌属性/稀有度/技能/综合力渲染 |
| `character` | 查角色、角色详情、角色列表和角色资源 repository |
| `event` | 查活动、活动详情、试炼、活动时间和活动数据 repository |
| `gacha` | 查卡池、抽卡模拟、卡池概率、Pick Up 和卡池资源 repository |
| `player` | 查玩家、玩家卡组、乐队等级、角色等级、难度完成情况和排名 |
| `cutoff` | 档线、全档线、近期档线、档线图表、时间线图表和预测算法 |
| `catalog` | 服务器、乐队、属性、区域道具、服装、称号、道具、技能、颜色 |
| `shared` | 协议常量、主数据 store/repository、通用详情块、数据块、列表框架 |
| `assets` | 本地图片、字体和静态视觉资源 |
| `static-config` | 搜索配置、昵称表、CN 修正表和玩家编号表 |

## Operation 注册表

| operation key | handler | 命令名 | 主要别名 |
| --- | --- | --- | --- |
| `bangdream.song.search` | `searchSong` | 查曲 | `查曲`、`bd`、`bangdream`、`bandori`、`邦邦` |
| `bangdream.song.chart` | `getSongChart` | 查谱面 | `查谱面`、`谱面`、`bd谱面` |
| `bangdream.song.random` | `randomSong` | 随机曲 | `随机曲`、`随机`、`bd随机` |
| `bangdream.song.meta` | `getSongMeta` | 查询分数表 | `查询分数表`、`查分数表`、`查询分数榜` |
| `bangdream.card.search` | `searchCard` | 查卡 | `查卡`、`查卡牌`、`bd查卡` |
| `bangdream.card.illustration` | `getCardIllustration` | 查卡面 | `查卡面`、`查卡插画`、`查插画` |
| `bangdream.character.search` | `searchCharacter` | 查角色 | `查角色`、`bd角色` |
| `bangdream.event.search` | `searchEvent` | 查活动 | `查活动`、`bd活动` |
| `bangdream.event.stage` | `getEventStage` | 查试炼 | `查试炼`、`查stage`、`查舞台`、`查5v5` |
| `bangdream.player.search` | `searchPlayer` | 查玩家 | `查玩家`、`查询玩家`、`bd玩家` |
| `bangdream.gacha.search` | `searchGacha` | 查卡池 | `查卡池`、`bd卡池` |
| `bangdream.gacha.simulate` | `simulateGacha` | 抽卡模拟 | `抽卡模拟`、`bd抽卡` |
| `bangdream.cutoff.detail` | `getCutoffDetail` | `ycx` | `ycx`、`预测线`、`查档线`、`bd档线` |
| `bangdream.cutoff.all` | `getCutoffAll` | `ycxall` | `ycxall`、`myycx`、`全部档线` |
| `bangdream.cutoff.recent` | `getCutoffRecent` | `lsycx` | `lsycx`、`历史档线`、`近期档线` |

新增或调整在线命令时先改 `registry/operation-registry.ts`，再跑 `test/qqbot/plugins/bangDream/registry/command-sql.spec.ts` 检查数据库初始化 SQL 与注册表是否一致。

## 扩展规则

- 新增歌曲能力：优先在 `song` 增加 model/repository/renderer/layout，不要回到横切目录堆文件。
- 新增卡牌能力：优先在 `card` 内聚合；只有静态目录实体才放 `catalog`。
- 新增活动、卡池、玩家、档线能力：分别放 `event`、`gacha`、`player`、`cutoff`。
- 新增外部数据源或缓存策略：放 `provider`。
- 新增跨模块业务规则：放 `policy`。
- 新增 Canvas 基础能力或视觉 token：放 `theme`。
- 新增通用渲染块：先确认是否真跨多个业务模块，才放 `shared`。
- 不建巨型 `index.ts` barrel，保持显式 import，降低循环依赖风险。

## 本地验证

常规结构或源码改动优先跑：

```powershell
pnpm run typecheck
pnpm exec jest --runInBand --runTestsByPath test/qqbot/plugins/bangDream/registry/operation-registry.spec.ts test/qqbot/plugins/bangDream/registry/command-sql.spec.ts
pnpm exec eslint src/qqbot/plugins/bangDream test/qqbot/plugins/bangDream
pnpm run build
```

图片 smoke 使用：

```powershell
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.song.search -Text "夏祭り" -OutFile ".kt-workspace/bangdream-smoke/song.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.event.search -Text "50" -OutFile ".kt-workspace/bangdream-smoke/event.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.event.stage -Text "310" -OutFile ".kt-workspace/bangdream-smoke/stage.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.gacha.simulate -Text "10 259" -OutFile ".kt-workspace/bangdream-smoke/gacha.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.cutoff.detail -Text "100 50 cn" -OutFile ".kt-workspace/bangdream-smoke/cutoff.jpg"
.\scripts\bangdream-render-smoke.ps1 -OperationKey bangdream.song.chart -Text "136 expert" -OutFile ".kt-workspace/bangdream-smoke/chart.jpg"
```

## 发布验证

推送 Jenkins/K8s backed 分支后必须观察发布闭环：

1. Jenkins 构建完成。
2. K8s deployment rollout 成功。
3. Pod 启动日志没有 BangDream module load error。
4. 线上 `/qqbot/command/test` 按 operationKey 查询 commandId 后真实调用。
5. 拉取线上 smoke 图片并目视检查。
6. 检查操作日志中对应 command/test 调用和 BangDream hook 日志。
7. 清理远程 smoke 临时目录。

## 常见风险

| 风险 | 处理方式 |
| --- | --- |
| 资源路径丢失 | 检查 `nest-cli.json` 的 `assets` include 是否指向 `qqbot/plugins/bangDream/assets` 和 `static-config` |
| Jest pattern 匹配不到 | Windows 下指定文件统一用 `pnpm exec jest --runInBand --runTestsByPath path/with/slash.spec.ts` |
| smoke 卡住 | 使用 `scripts/bangdream-render-smoke.ps1` 的 `TimeoutSeconds`，远程临时脚本也要有外层 timeout |
| commandId 查错 | 线上 smoke 必须先用 operationKey 查在线命令，不使用历史脏数据 |
| 大图 OOM 回归 | 优先验证 `bangdream.event.stage`，关注 `imageCount=5` 和图片大小 |
