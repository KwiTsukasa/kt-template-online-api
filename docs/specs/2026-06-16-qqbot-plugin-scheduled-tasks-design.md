# QQBot 插件平台定时任务桥设计

日期：2026-06-16

状态：用户已确认方向，进入设计文档审阅。

## 背景

QQBot 第三期重构已经让 Plugin Platform 接管插件 manifest、安装生命周期、worker runtime、operation、event、运行事件和插件管理接口。但插件还没有统一的定时任务能力：如果某个插件需要周期同步数据，只能把定时逻辑藏进插件自身 `activate()` 或业务代码里。这会导致启停不可控、运行记录不可见、cron 不能在线修改，也无法复用于后续插件。

本轮要把“插件暴露的定时任务能力”升级为平台能力，并先用 BangDream 落地：定期同步 Bestdori JSON 主数据到服务端缓存，降低 `查分数表`、`查卡` 等重命令冷启动成本。

相关当前事实：

- API 已使用 `@nestjs/bullmq` + `bullmq` 管理 QQBot 插件 worker 请求队列。
- Admin 当前技术栈是 `antdv-next`，不是传统 `ant-design-vue`。
- BangDream 当前通过 `waitForBangDreamCatalogReady()` 懒加载 catalog；`remote-resource.client` 已具备 cache 路径参数形态，但当前文件缓存还未真正落地为“服务端预同步主数据”。
- 现有插件 manifest 没有 `tasks` 能力，`QqbotPluginWorkerRuntime` 也没有 `executeTask` RPC。

## 目标

1. Plugin Platform 统一管理插件暴露的定时任务能力。
2. 插件通过 manifest 声明定时任务，平台解析、持久化、展示、调度和执行。
3. 支持 Admin 在线启停任务、修改 cron 表达式、手动运行一次、查看运行记录。
4. 调度层使用 BullMQ Redis-backed 调度，不手写内存定时器，也不让插件自己 `setInterval`。
5. Admin cron 编辑不手写 cron 解析/生成算法，不引入 `ant-design-vue`；使用 `@vue-js-cron/core`，以现有 `antdv-next` 控件做薄适配。
6. BangDream 第一阶段只同步 Bestdori JSON 主数据；图片资源继续按需缓存。

## 非目标

- 本轮不做 Bestdori 全量图片镜像。
- 本轮不做所有插件的实际定时任务，只建立平台能力并完成 BangDream 参考实现。
- 本轮不做复杂任务依赖编排、分布式工作流 DAG、用户自定义脚本。
- 本轮不把 task 管理塞回现有“插件能力”页面，而是新增专门页面。

## 外部技术选择

### 后端调度

选择 BullMQ Job Scheduler / repeatable job 抽象作为平台调度实现。BullMQ v5 文档说明 Job Schedulers 是新版本对 repeatable jobs 的推荐能力，可按 fixed interval 或 cron 生成任务；当前 API 已引入 BullMQ，因此新增平台 task queue 不需要再引入另一套队列系统。

Nest 官方 `@nestjs/schedule` 支持动态 cron，但它是进程内调度。考虑线上 K8s、后续多副本和重启恢复，本轮不选 `@nestjs/schedule` 作为核心调度器。

### 前端 cron 编辑

选择 `@vue-js-cron/core`。它是 renderless Vue cron editor core，可以提供 cron 表达式生成/校验基础能力。Admin 侧新增 `CronEditorAntdvNext` 适配组件，只负责把现有 `antdv-next` 控件连接到 core 状态，不引入 `@vue-js-cron/ant`，因为该包依赖 `ant-design-vue`，会和当前 Admin 的 `antdv-next` 技术栈冲突。

参考来源：

- Nest task scheduling 文档：https://docs.nestjs.com/techniques/task-scheduling
- BullMQ Job Schedulers 文档：https://docs.bullmq.io/guide/job-schedulers
- Vue JS Cron 文档：https://abichinger.github.io/vue-js-cron/guide/getting-started-ant
- `@vue-js-cron/core` npm 信息：https://www.npmjs.com/package/@vue-js-cron/core

## Manifest 契约

`plugin.json` 新增 `tasks` 数组。旧插件不声明 `tasks` 时解析为 `[]`，保持兼容。

示例：

```json
{
  "tasks": [
    {
      "key": "bangdream.bestdori.sync-main-data",
      "name": "同步 Bestdori 主数据",
      "handlerName": "syncBestdoriMainData",
      "description": "同步 BangDream 重命令依赖的 Bestdori JSON 主数据。",
      "defaultCron": "0 */6 * * *",
      "enabled": true,
      "timeoutMs": 120000,
      "permissions": ["runtime.http", "plugin.storage.read", "plugin.storage.write"]
    }
  ]
}
```

字段规则：

- `key`：平台能力 key，使用现有 operation/event capability key 规则。
- `handlerName`：插件 worker 内部处理器名。
- `defaultCron`：标准 5 段 cron 表达式，平台存储前校验并规范化。
- `enabled`：安装时默认启用状态。管理员后续启停以数据库配置为准。
- `timeoutMs`：单次任务执行预算。
- `permissions`：任务需要的 host 权限，沿用 manifest 权限白名单。

Manifest parser 新增校验：

- task key 不合法时报 `INVALID_CAPABILITY_KEY`。
- task key 重复时报 `DUPLICATE_TASK_KEY`。
- handlerName 缺失时报 `MISSING_TASK_HANDLER`。
- cron 缺失或不合法时报 `INVALID_TASK_CRON`。
- timeoutMs 缺失时报 `MISSING_TASK_TIMEOUT`。
- permission 不在白名单内时报 `UNKNOWN_PERMISSION`。

## 数据模型

新增两张平台表。表结构仍遵循第三期规则：Snowflake `BIGINT` 主键、lower snake case、可查询字段结构化、日志表追加写。

### `qqbot_plugin_task`

表示插件安装实例暴露的一条可管理定时任务。

核心字段：

- `id`
- `plugin_id`
- `installation_id`
- `task_key`
- `task_name`
- `handler_name`
- `description`
- `default_cron`
- `cron_expression`
- `enabled`
- `timeout_ms`
- `runtime_status`：`idle | scheduled | running | failed | disabled`
- `last_run_id`
- `last_run_at`
- `last_status`
- `last_error`
- `last_duration_ms`
- `next_run_at`
- `create_time`
- `update_time`

唯一约束：`installation_id + task_key`。

### `qqbot_plugin_task_run`

表示一次任务运行记录。

核心字段：

- `id`
- `task_id`
- `plugin_id`
- `installation_id`
- `task_key`
- `trigger_type`：`schedule | manual | bootstrap`
- `status`：`running | success | failed | skipped`
- `job_id`
- `started_at`
- `finished_at`
- `duration_ms`
- `safe_summary`
- `error_message`
- `create_time`

索引：

- `task_id + create_time`
- `plugin_id + create_time`
- `status + create_time`

## 后端架构

新增 `plugin-platform/application/task` 能力域，职责与现有 operation/event/lifecycle 分开。

主要组件：

- `QqbotPluginTaskService`：任务查询、启停、cron 更新、手动运行、运行记录分页。
- `QqbotPluginTaskSchedulerService`：把 DB 中 enabled task 同步到 BullMQ scheduler，处理 enable/disable/update cron 的重建。
- `QqbotPluginTaskWorkerProcessor`：消费调度 job，创建 task run 记录，调用 active worker 的 `executeTask`，写回状态。
- `QqbotPluginTaskManifestSynchronizer`：安装、启用、升级插件时，将 manifest tasks 同步到 `qqbot_plugin_task`。
- `QqbotPluginTaskCronValidator`：后端统一校验 5 段 cron，拒绝空值、秒级 6/7 段表达式和过高频表达式。

调度语义：

- 插件启用后，平台同步任务记录，并为 enabled task 注册 BullMQ scheduler。
- 插件禁用或卸载后，平台暂停或移除该安装实例下的 scheduler。
- Admin 修改 cron 后，数据库先更新，再重建 scheduler；失败时回滚数据库更新或返回明确错误。
- 任务运行通过 worker RPC `executeTask`，不直接调用插件内部函数。
- 同一 `installationId + taskKey` 禁止重叠运行：上一轮未结束时，新一轮标记 `skipped`，不并发进入插件。
- 手动运行允许管理员显式触发；即使 schedule disabled，也可手动运行，但插件安装实例必须 enabled。
- 首次启用且没有成功运行记录的 enabled task，可触发一次 `bootstrap` run，用于预热缓存，但不阻塞 API 启动。

运行事件：

- task start/success/failed/skipped 同步写 `qqbot_plugin_task_run`。
- 摘要事件也写入 `qqbot_plugin_runtime_event`，eventType 使用 `task-started`、`task-finished`、`task-failed`、`task-skipped`。
- `safe_summary` 只存 taskKey、triggerType、resourceCounts、durationMs、outputKeys 等安全字段，不存大 JSON、不存图片、不存外部响应全文。

## Worker RPC

`QqbotPluginWorkerRequestType` 新增 `executeTask`。

请求字段：

- `taskId`
- `taskKey`
- `taskHandlerName`
- `triggerType`
- `input`
- `timeoutMs`
- `safeInputSummary`

worker thread 处理流程：

1. `load` 阶段创建插件实例。
2. `activate` 阶段完成插件基础预热。
3. `executeTask` 时按 `handlerName` 找到插件暴露的 task handler。
4. handler 返回结构化结果，例如 `{ syncedKeys, updatedFiles, cacheRoot, source }`。
5. worker 将错误序列化返回，平台记录 run 和 runtime event。

插件入口约定：

```ts
type QqbotIntegrationPlugin = {
  tasks?: Array<{
    key: string;
    handlerName: string;
    execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  }>;
};
```

具体类型实现时应落到 plugin-platform contract，避免每个插件自己定义一套。

## BangDream 同步设计

新增 task：

- key：`bangdream.bestdori.sync-main-data`
- handlerName：`syncBestdoriMainData`
- defaultCron：`0 */6 * * *`
- timeoutMs：`120000`
- 默认 enabled：`true`

同步范围只包括 Bestdori JSON 主数据：

- `songs`
- `meta`
- `cards`
- `skills`
- `events`
- `gacha`
- `costumes`
- `bands`
- `characters`
- `areaItems`
- 后续如 operation catalog keys 明确需要，可追加 `items`、`degrees` 等 JSON 集合，但仍不含图片资源。

同步流程：

1. 读取 BangDream runtime config：`BANGDREAM_TSUGU_CACHE_ROOT`、Bestdori base url、请求超时和 retry。
2. 对目标 JSON key 逐个计算 Bestdori URL 和服务端缓存路径。
3. 使用 host HTTP 能力下载 JSON。
4. 写入插件服务端缓存目录，采用临时文件 + rename，避免半文件污染缓存。
5. 下载失败时保留上一份成功缓存，不删除旧文件。
6. 同步完成后刷新 worker 内存 catalog，让后续命令优先使用已同步数据。
7. 返回安全摘要：同步 key 数、成功数、失败数、缓存根路径是否存在、耗时。

缓存路径：

- 本地默认仍可使用 `.kt-workspace/cache/bangdream`。
- 生产应通过 env 配置到持久目录，例如 `BANGDREAM_TSUGU_CACHE_ROOT=/data/qqbot/plugins/bangdream/cache`。
- K8s 上需要为该目录配置持久卷或可复用 hostPath，否则重建 Pod 后缓存会丢失，定时同步只能降低运行期冷启动，不能跨发布保留。

命令 fallback：

- 若定时同步未完成或失败，BangDream 命令仍保留现有按需拉取逻辑。
- 命令读取缓存失败时可以继续请求 Bestdori，不因为预同步失败完全不可用。

## API 接口

新增接口均走 Vben 成功/错误响应包装，受 Admin auth 保护。

- `GET /qqbot/plugin-platform/tasks/page`
  - 支持 `pageNo/pageSize/pluginId/pluginKey/taskKey/enabled/status`
- `GET /qqbot/plugin-platform/tasks/:id`
- `POST /qqbot/plugin-platform/tasks/:id/enable`
- `POST /qqbot/plugin-platform/tasks/:id/disable`
- `POST /qqbot/plugin-platform/tasks/:id/cron`
  - body：`{ cronExpression: string }`
- `POST /qqbot/plugin-platform/tasks/:id/run`
  - body：`{ input?: Record<string, unknown> }`
- `GET /qqbot/plugin-platform/tasks/:id/runs`
  - 支持 `pageNo/pageSize/status/triggerType/startTime/endTime`

返回任务列表字段：

- `id`
- `pluginId`
- `pluginKey`
- `pluginName`
- `installationId`
- `taskKey`
- `taskName`
- `description`
- `cronExpression`
- `defaultCron`
- `enabled`
- `runtimeStatus`
- `lastStatus`
- `lastRunAt`
- `lastDurationMs`
- `lastError`
- `nextRunAt`

## Admin 页面

新增 QQBot 下的专门页面：插件定时任务。

建议路径：

- route path：`/qqbot/plugin-task`
- view root：`apps/web-antdv-next/src/views/qqbot/plugin-task`
- API caller：`apps/web-antdv-next/src/api/qqbot/plugin.ts` 扩展 task 方法，或拆 `plugin-task.ts` 并从 qqbot API index 暴露。

页面能力：

- KtTable 分页列表。
- 筛选：插件、任务 key、启用状态、运行状态。
- 操作：启用、停用、修改 cron、手动运行、查看运行记录。
- 状态列：enabled、runtimeStatus、lastStatus、lastRunAt、nextRunAt、duration。
- 运行记录 Drawer：展示最近运行状态、触发类型、耗时、安全摘要和错误。
- Cron 编辑 Modal：使用 `CronEditorAntdvNext`。

Cron 组件设计：

- 新增 `components/CronEditorAntdvNext.vue`。
- 内部使用 `@vue-js-cron/core` 管理 cron state/校验。
- UI 控件全部来自 `antdv-next`，例如 `RadioGroup`、`Select`、`Input`、`Segmented`、`Space`、`Alert`。
- 组件只输出标准 5 段 cron 表达式。
- Modal 保存前调用后端校验；前端校验只做即时反馈，后端仍是最终真相源。

依赖策略：

- 在 Admin workspace catalog 增加 `@vue-js-cron/core`。
- `apps/web-antdv-next` 依赖 `@vue-js-cron/core`。
- 不添加 `@vue-js-cron/ant`、`ant-design-vue` 或 `vue3-cron-antd`。

## 权限与菜单

新增 Admin 权限建议：

- `QqBot:PluginTask:List`
- `QqBot:PluginTask:UpdateCron`
- `QqBot:PluginTask:Enable`
- `QqBot:PluginTask:Disable`
- `QqBot:PluginTask:Run`
- `QqBot:PluginTask:RunLog`

菜单新增在 QQBot 管理分组下，标题“插件定时任务”。现有“插件平台”页继续负责安装、manifest、operation、runtime events 等；新页面只负责 scheduled task 管理。

## 错误处理

- cron 不合法：接口返回可读中文错误，不更新调度器。
- 插件未启用：手动运行返回“插件运行时未启用”。
- 任务禁用：scheduler 不触发；手动运行仍可触发，但要写 `triggerType=manual`。
- 上一轮未结束：新 schedule tick 写 `skipped`，不并发执行。
- worker 崩溃：任务 run 标记 failed，平台复用现有 worker recovery 机制；不删除上一次成功缓存。
- BullMQ/Redis 不可用：任务页展示 degraded，operation/event 命令仍按现有插件 runtime 能力运行，不因为调度器不可用整体停摆。
- BangDream 单个 JSON key 下载失败：记录失败 key，保留旧缓存，整体 run 可标记 failed 或 partial failed；第一版使用 failed，避免虚报成功。

## 验证计划

后端 TDD：

- Manifest parser：解析 `tasks`，拒绝重复 key、非法 cron、缺 handler、缺 timeout、未知权限。
- Persistence/schema：`qqbot_plugin_task`、`qqbot_plugin_task_run` 与 full schema SQL 对齐。
- Scheduler service：enable/disable/update cron 能同步 BullMQ scheduler，重复同步幂等。
- Worker runtime：`executeTask` RPC 进入 worker thread 并按 handlerName 分发。
- Platform service：安装/启用/升级插件时同步 task 能力，禁用插件时暂停 scheduler。
- BangDream：mock Bestdori JSON，验证 sync task 写入缓存、刷新 catalog、失败保留旧缓存。

Admin TDD：

- API caller：任务分页、启停、改 cron、手动运行、运行记录接口路径和参数正确。
- Cron component：不依赖 `ant-design-vue`，输出 5 段 cron，非法值展示错误。
- 页面状态：列表操作触发对应 caller，运行记录 Drawer 可打开。

集成验证：

- 本地 API 启动后真实请求：
  - `GET /qqbot/plugin-platform/tasks/page`
  - `POST /qqbot/plugin-platform/tasks/:id/cron`
  - `POST /qqbot/plugin-platform/tasks/:id/run`
  - `GET /qqbot/plugin-platform/tasks/:id/runs`
- 本地 Admin 页面 route smoke：`/qqbot/plugin-task` 能加载，cron modal 能打开并保存。
- BangDream 手动运行 task 后，缓存目录出现目标 JSON 文件，`/查分数表 cn` 或 `/查卡 472` 走热缓存不再每次重新拉全量主数据。
- 上线后验证 Jenkins/K8s、Redis/BullMQ、task 手动 run、BangDream 命令 smoke。

## 实施边界

实现计划应拆成后端平台能力、BangDream 任务、Admin 页面和上线闭环四段。每段都必须有独立 RED/GREEN 检查，不能先写 UI 再补接口，也不能让 BangDream 直接绕过平台调度。

本 spec 通过后，下一步进入 KT workflow `KT plan writing`。
