# QQBot Plugin Platform 彻底解耦设计

## 背景

第三期 QQBot 插件平台已经完成目录收敛、worker runtime、定时任务和内置插件包化，但当前代码仍没有做到架构真实解耦。`plugin-platform` 仍直接认识四个具体插件：

- `src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service.ts` 直接 import `bangdream`、`ff14-market`、`fflogs`、`repeater` 的入口、类型和内部 helper，并在平台侧拼出每个插件的专用 host/options。
- `src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/builtin-plugin-worker.thread.ts` 直接 import 四个插件，在 worker 内按 `pluginKey` switch 创建具体插件实例和配置 key 列表。
- `QqbotBuiltinPluginWorkerRuntimeFactoryService` 依赖 `QqbotBuiltinPluginPackageLoaderService`，workerData 只传 `pluginKey`，迫使 worker 继续硬编码插件包路径。
- 现有结构测试只禁止 `plugin-platform/application` import 插件，没有覆盖 `infrastructure/integration` 和 worker thread；部分 DI/loader 测试还在固定旧耦合。

这类实现本质上仍是“平台内置插件转接层”，不满足第三期“统一插件平台、线上安装、热插拔、worker 隔离”的目标。用户已确认采用方案 A：强门禁彻底解耦，不保留平台到具体插件的转接行为。

## 已确认决策

1. `plugin-platform` 不得 import、switch、factory、配置白名单或 host-call 分支任何具体插件。
2. 内置插件只是预安装的普通插件包，和线上安装插件走同一 manifest、installation、runtime descriptor、worker entry 协议。
3. 平台只认识插件包协议：`plugin.json`、安装路径、入口文件、运行时声明、operation/event/task metadata、权限和 host capability。
4. 具体插件的业务适配全部放回各自插件包。BangDream、FF14 Market、FFLogs、Repeater 可以有自己的 package-local adapter，但不能由平台创建。
5. 旧 `QqbotBuiltinPluginPackageLoaderService` 和 `builtin-plugin-worker.thread.ts` 里的具体插件 import/switch 必须删除或改名为完全通用实现。
6. 测试必须先补硬门禁，让当前耦合明确失败；后续任何新增插件都不能要求改 `plugin-platform` 源码。

## 目标

- 平台源码中不再出现四个具体插件包的 import、路径、factory、switch 或 config key 专用逻辑。
- worker 通过 `pluginRoot + manifest.entry` 动态加载插件入口，而不是按 `pluginKey` import 包。
- registry、operation executor、event dispatcher、task runner 只依赖 manifest 和 installation runtime descriptor。
- host bridge 变成 capability-based 通用协议，不包含 `bangdreamRequestJson`、`ff14WorldCatalog` 这类插件专用方法。
- 四个现有插件能力保持一致：BangDream 15 个 operation 和 Bestdori 定时任务、FF14 Market 2 个 operation、FFLogs 1 个 operation、Repeater message event 不退化。
- Admin/API 既有插件管理、命令测试、定时任务和 worker 超时恢复语义不退化。

## 非目标

- 不重新设计整个第三期 QQBot 模块。
- 不重写 Admin 页面。
- 不改变 NapCat 登录链路。
- 不做线上插件市场功能扩展。
- 不为快速通过保留平台侧兼容 shim、具体插件 import map、具体插件 key switch 或纯 re-export 转接层。
- 不改变现有 operation key、handlerName、alias、权限码和 command SQL linkage。

## 边界规则

### Plugin Platform 允许依赖

`src/modules/qqbot/plugin-platform/**` 可以依赖：

- 插件 manifest 类型、manifest parser、manifest validator。
- 插件 installation/version/task/runtime event 实体和 repository。
- worker driver、queue、BullMQ、runtime evidence、HTTP/storage/dictionary/send 等宿主服务。
- 通用插件 SDK/host contract。
- 受控插件根目录配置和安装路径白名单。

### Plugin Platform 禁止依赖

`src/modules/qqbot/plugin-platform/**` 禁止：

- `@/modules/qqbot/plugins/**` import。
- 拼接 `src/modules/qqbot/plugins/bangdream`、`ff14-market`、`fflogs`、`repeater` 这类具体路径。
- `switch (pluginKey)` 或 `if (pluginKey === 'bangdream')` 这类具体插件分支。
- `createBangDreamPlugin`、`createFf14MarketPlugin`、`createFflogsPlugin`、`createRepeaterPlugin` 这类具体 factory。
- `BANGDREAM_TSUGU_ENV_KEYS`、FF14 world helper、FFLogs world resolver 等插件内部常量/helper。
- `bangdreamRequestJson`、`bangdreamRequestBuffer` 或其他插件命名 host call。

允许平台扫描一个受控目录下的 `*/plugin.json`。扫描行为只能基于 manifest 文件存在与否，不能把具体插件 key 写入平台源码。

## 目标架构

### 插件包来源

新增通用 package source，替代 built-in loader：

```text
plugin-platform/infrastructure/integration/package/
  plugin-package-source.service.ts
  plugin-package-manifest-reader.service.ts
  plugin-package-path-policy.service.ts
```

职责：

- 从一个或多个受控 root 扫描 `*/plugin.json`。
- 读取并校验 manifest。
- 生成 `PluginPackageDescriptor`：

```text
{
  pluginKey: manifest.pluginKey,
  version: manifest.version,
  packageRoot: <受控安装或内置包根目录>,
  entry: manifest.entry,
  manifest,
  sourceType: 'builtin' | 'installed',
}
```

内置插件 root 是一个平台配置项，例如 `src/modules/qqbot/plugins` 对应开发态源码目录，或构建后等价目录。平台可以知道“内置插件包目录根”，但不能知道根目录下有哪些具体插件。

### Runtime Descriptor

worker runtime 不再只接收 `pluginKey`。启动 worker 时传入完整 descriptor：

```text
{
  installationId,
  pluginKey,
  packageRoot,
  entry,
  manifest,
  runtimeOptions,
  configSnapshot,
}
```

`packageRoot + entry` 是唯一代码加载入口。`pluginKey` 只用于日志、状态、权限和 runtime event 归属，不用于选择具体代码分支。

### Worker Entry Loader

worker thread 改为通用加载器：

1. 校验 `packageRoot` 在 path policy 允许范围内。
2. resolve `entry`，确认入口仍在 `packageRoot` 内。
3. 使用动态 import 加载入口。
4. 校验入口导出 `createPlugin` 函数。
5. 调用统一协议：`createPlugin({ manifest, host, runtime, normalizeError, now })`。
6. 从返回对象读取 `operations`、`events`、`tasks`、`activate`、`dispose`、`healthCheck`。

worker thread 不再 import 任何具体插件包，也不再保存 config key switch。

### 通用 Host Bridge

平台提供 `QqbotPluginHostBridge`，向插件暴露 capability-based host：

- `getConfig(key)` / `getConfigMany(keys)`：读取插件配置快照。
- `getDictByKey(key)` / `getDictItemsByKey(key)`：读取平台字典。
- `relationTree(key)`：读取字典关系树。
- `requestJson(request)` / `requestBuffer(request)`：受控外部 HTTP。
- `readAssetFile(path)` / `readJsonFile(path)` / `readExcelRows(path)`：读取插件声明资产或缓存文件。
- `writeJsonFile(path, value)` / `renameFile(source, target)`：写入插件私有 storage。
- `sendText(context, text)`：走 QQBot send queue。
- `emitRuntimeEvent(event)`：记录插件运行事件。
- `sleep(ms)`：受控等待。
- `warn(message, context)`：结构化 warning。

host call 名称必须是通用能力名，不带插件 key 或业务名。插件如果需要 Bestdori、Universalis、FFLogs GraphQL、world resolver 等业务语义，必须在插件包内部通过这些通用能力组合出来。

### 插件入口协议

每个插件 `src/index.ts` 是唯一入口，只导出 `createPlugin`。统一入参：

```text
{
  manifest,
  host,
  runtime,
  normalizeError,
  now,
}
```

统一返回值：

```text
{
  pluginKey,
  operations?,
  events?,
  tasks?,
  activate?,
  dispose?,
  healthCheck?,
}
```

平台不关心插件内部如何从 `host` 组装业务 client。BangDream 可以在自己的入口里把通用 host 映射为 `configReader`、`dictionaryReader`、`io`；FFLogs 可以在自己的包内实现 world resolver；Repeater 可以在自己的包内组装 event API。

### 配置 key 来源

删除 `getConfigKeysForPlugin()`。worker 需要预加载配置时，配置 key 必须来自 manifest：

- `configSchema.properties` 的 key。
- 或 manifest `runtime.configKeys`。

如果某插件配置无法静态声明，入口必须使用 async host 配置读取，不能让平台新增插件 key 分支。

### Registry 和 Lifecycle

`QqbotPluginRegistryService`、`QqbotEventPluginRegistryService` 和 task scheduler 只从 installation/runtime summary 获得能力：

1. 平台启动时扫描 package descriptor。
2. 同步或修复 built-in installation/version/manifest 元数据。
3. 对 enabled installation 启动 worker。
4. worker load/activate 后返回 operation/event/task runtime summaries。
5. registry 只注册 active summaries，不持有具体插件实例。
6. 禁用、卸载、升级时通过 installation 状态驱动 registry 移除或替换。

旧的 `loadCommandPlugins()`、`loadEventPlugins()` 和 `loadBuiltinManifests()` 不再返回具体插件实例；manifest 同步和 runtime 启动分离。

## 插件包侧调整

### BangDream

BangDream 入口负责把通用 host 映射为自身需要的 `configReader`、`dictionaryReader`、`io` 和 Bestdori/cache adapter。Bestdori 主数据同步 task 仍属于 BangDream 包内部，只通过 host HTTP/storage 能力读写缓存。

BangDream 包不得要求平台提供 `BangDreamRuntimeIo` 或 `BANGDREAM_TSUGU_ENV_KEYS`。需要的配置 key 写入 manifest。

### FF14 Market

FF14 world catalog、region/data center/world 解析留在插件包内。平台只提供字典、relation tree 和 HTTP 能力。

### FFLogs

FFLogs 不再通过平台导入 FF14 helper 解析世界。它可以在包内复用 FF14 插件暴露的纯数据文件，或通过通用字典 host 解析 known world；选择必须在插件包内完成。

### Repeater

Repeater event API 留在插件包内。平台只负责把 message event 交给 active event runtime，并通过 host send queue 发送文本。

## 测试策略

必须先写 RED 测试，让当前耦合失败：

1. 扩展 `test/modules/qqbot/architecture/qqbot-plugin-package-boundary.spec.ts`，扫描整个 `src/modules/qqbot/plugin-platform/**/*.ts`，禁止具体插件 import、路径、factory、switch 和 config key switch。
2. 更新 `test/modules/qqbot/plugin-platform/plugin-lifecycle-runtime.spec.ts`，不再期待 runtime factory 依赖 `QqbotBuiltinPluginPackageLoaderService`；改为期待通用 package source / host bridge / runtime descriptor。
3. 替换 `test/modules/qqbot/plugin-platform/builtin-plugin-package-loader.spec.ts`，使用临时 demo plugin package 验证 manifest 扫描和 descriptor 生成，不再传 `bangdream`。
4. 新增 worker generic loading 测试：临时插件入口通过 manifest entry 动态加载，worker source 不含具体插件 import/switch。
5. 新增 package entry contract 测试：四个现有插件均可通过同一 `createPlugin({ manifest, host, runtime, normalizeError, now })` fake host 创建 runtime。
6. 保留并复跑 BangDream package entry、Repeater plugin、plugin task manifest、worker timeout/recovery 相关测试，证明行为没有退化。

实现完成后的验证：

- `pnpm exec jest --runInBand --runTestsByPath` 跑插件平台结构、lifecycle、loader、worker、task、四个插件 entry 的聚焦用例。
- `pnpm run typecheck`。
- changed-file ESLint 或聚焦 lint。
- `pnpm run build`，因为 worker 动态 import 和构建路径容易漂移。
- 本地接口 smoke 覆盖 `/qqbot/plugin-platform/*`、`/qqbot/plugin/operation/page`、`/qqbot/command/test` 和插件定时任务页面相关 API。

## 完成标准

- `rg "@/modules/qqbot/plugins|src/modules/qqbot/plugins" src/modules/qqbot/plugin-platform` 不再命中具体插件 import 或具体插件路径。
- `rg "QqbotBuiltinPluginPackageLoaderService|BUILTIN_PLUGIN_KEYS|getConfigKeysForPlugin|createBangDreamPlugin|createFf14MarketPlugin|createFflogsPlugin|createRepeaterPlugin" src/modules/qqbot/plugin-platform` 不再命中旧耦合实现。
- workerData 包含 `packageRoot`、`entry`、`manifest`，worker 通过动态 import 加载入口。
- `plugin-platform` 源码中不包含 `pluginKey === 'bangdream'`、`case 'ff14-market'`、`case 'fflogs'`、`case 'repeater'` 等具体插件分支。
- 四个内置插件仍从各自 `plugin.json` 同步 operation/event/task metadata。
- BangDream Bestdori 同步 task、命令执行、图片渲染、Repeater event、FF14/FFLogs 查询不因解耦退化。
- 新增结构测试能防止后续重新引入平台到具体插件的耦合。

## 风险和控制

- 动态 import 在源码态和构建态路径不同：通过 package path policy 和 build 后 smoke 覆盖。
- BangDream 当前入口参数和其他插件不完全一致：允许 package-local adapter，但 adapter 必须在 BangDream 包内。
- 同步配置 key 从代码 switch 迁入 manifest 可能遗漏：用四个插件 entry contract 测试和 worker runtime 测试覆盖。
- 旧 direct registry 行为可能影响命令测试：先用 runtime summary 保持 active registry 语义，再移除 direct plugin instance。
- FFLogs world resolver 依赖 FF14 helper：迁回 FFLogs 包内或改用通用字典 host，禁止平台代为转接。

## Spec 自检

- 无空白占位：本文没有空段落、临时标记或未定字段。
- 范围明确：本设计只覆盖 QQBot Plugin Platform 到具体插件的解耦，不扩展 Admin/NapCat/线上市场。
- 边界明确：平台允许处理插件包协议，禁止认识具体插件实现。
- 验收可验证：完成标准均可通过源码扫描、聚焦测试、typecheck/build 和本地 smoke 验证。
