# Admin 全环境状态总览总控面板设计

## 背景

Admin 当前 `/dashboard/analytics` 仍是 Vben 示例页，展示用户量、访问量、下载量和图表等静态演示数据。它没有反映线上真实环境，也不能帮助判断 API、QQBot、NapCat、插件平台、系统日志、MinIO、WordPress、Jenkins/K8s 等链路的当前状态。

用户已确认将分析页改造成线上全环境状态总览总控面板，并选择方案 B：**总览 + 安全总控**，同时增加**环境拓扑**作为主视图。这个页面的目标不是“再做一个漂亮 Dashboard”，而是把线上环境状态、证据来源、可执行的低风险动作和高风险动作边界集中展示出来，让后续排障、上线观察和 QQBot 闭环不再靠散落入口。

本设计基于主线程和两个只读 subagent 的盘点结果：

- Admin `/dashboard/analytics` 当前是静态页面，可整体替换。
- Admin 已有 QQBot、插件任务、系统日志、Blog/Asset 等 API wrapper，但没有统一环境状态 wrapper。
- API 已有 runtime health、系统日志、QQBot 汇总、NapCat runtime、插件平台、插件任务、MinIO 和 WordPress 信号源。
- API 源码内没有 Jenkins/K8s/部署状态 Controller 或 Service；实时部署观察目前主要靠 `mcp/ktWorkflow` 与 NAS/K8s 外部命令。

因此第一版必须采用“API 统一聚合合同 + Admin 拓扑消费”的结构：页面不散拼多个旧接口；API 不伪造未接入的环境状态；高风险动作先显式禁用或跳转，不直接执行。

## 已确认决策

1. `/dashboard/analytics` 改造成环境状态总览总控面板，不继续保留 Vben 示例图表。
2. 采用方案 B：顶部总览、环境拓扑、右侧安全总控、底部最近事件/证据。
3. 环境拓扑必须是第一屏核心区域，展示从入口、网关、Admin、API、数据层、对象存储、日志、WordPress、QQBot、NapCat、插件平台、定时任务到 Jenkins/K8s 的链路。
4. 第一版只允许低风险动作：刷新、执行只读自检、打开日志、跳转到已有管理页、打开外部只读入口。
5. 重启 Pod、触发 Jenkins 部署、DB 写入、重建 NapCat 容器、启停插件或定时任务等高风险动作，第一版只能作为 disabled action 展示原因和未来入口。
6. API 聚合接口必须受 Admin JWT 保护，返回 Vben 统一响应，不泄露密钥、token、原始 env、QQBot 大字段或未脱敏日志。
7. Jenkins/K8s 如果暂时没有可由 API 安全读取的凭据或适配器，也必须在拓扑中显示为 `unknown` / `unwired`，不能从页面消失或伪造成正常。

## 目标

- 将 Admin 分析页变成可用于线上日常观察的环境总览入口。
- 提供统一 API 合同，输出状态卡片、拓扑节点、拓扑边、操作目录和最近事件。
- 把现有分散信号源收敛到一个只读聚合服务，保持每个信号源可独立降级。
- 在 UI 上明确区分 `ok`、`degraded`、`down`、`blocked`、`unknown`、`unwired`。
- 用证据字段解释每个状态来自哪里、何时检查、是否实时、是否缓存、失败原因是什么。
- 为后续接入 Jenkins/K8s 只读观测、部署记录、任务运行历史和自动化恢复留出合同扩展点。

## 非目标

- 不在第一版执行部署、重启、数据库写入、插件启停、NapCat 容器重建等高风险动作。
- 不把 Admin 页面做成营销式图表页或静态展示页。
- 不绕过现有 QQBot、NapCat、插件平台、WordPress、MinIO 的业务边界。
- 不要求 API Pod 内直接持有生产 kubeconfig、Jenkins 写权限或 NAS SSH 写权限。
- 不把外部不可读的 Jenkins/K8s 状态假装成健康。
- 不在本轮新增长期运行的后台巡检任务或历史表，除非后续实施计划明确需要。

## 信息架构

页面仍使用 `/dashboard/analytics` 路由，但语义改为“环境总览”。布局从上到下为：

1. **全局状态条**
   - 当前环境总体状态。
   - 最近检查时间。
   - 降级节点数量。
   - 阻断节点数量。
   - 未接入节点数量。
   - 一键刷新和只读自检入口。

2. **核心指标卡**
   - API Runtime。
   - 日志/Loki。
   - QQBot 在线账号与发送状态。
   - NapCat 登录态/容器态。
   - 插件平台与定时任务。
   - 存储/WordPress。
   - 部署链路。

3. **环境拓扑主视图**
   - 使用横向分层拓扑，不使用营销图表。
   - 节点展示状态、短指标、来源标识和最近检查时间。
   - 边展示调用关系、依赖关系或部署关系。
   - 点击节点打开右侧证据抽屉。

4. **安全总控面板**
   - 展示 action catalog。
   - 可执行项仅限刷新、只读自检、打开日志、跳转页面、打开外链。
   - 高风险项以 disabled 状态展示原因、所需权限和后续实施条件。

5. **最近事件/证据流**
   - 聚合系统日志状态、插件 runtime event、QQBot/NapCat 关键错误摘要。
   - 不展示 QQBot `replyText`、base64 图片、大段日志正文或敏感配置。

## 环境拓扑

第一版拓扑节点按区域分组：

```text
入口层
  admin.kwitsukasa.top / blog / API public route
  -> Caddy / TLS / reverse proxy

前端层
  -> Admin static site
  -> Blog public frontend

服务层
  -> API Runtime
  -> Runtime Config
  -> Auth/Admin Platform Config

数据与观测层
  -> MySQL
  -> Redis / BullMQ
  -> Loki / System Logs
  -> MinIO
  -> WordPress

QQBot 层
  -> QQBot Core
  -> OneBot Reverse WS
  -> NapCat Accounts
  -> Plugin Platform
  -> Plugin Scheduled Tasks

部署层
  -> Jenkins
  -> K8s Deployment
  -> API Pod
```

节点的状态来源分为：

- `live`：API 当前请求中实时读取。
- `cached`：API 使用已有缓存或短 TTL 运行态证据。
- `derived`：从其他信号推导，例如 QQBot 汇总推导 bus 状态。
- `configured`：只知道配置存在或缺失。
- `external-link`：只能提供外部入口，API 不能直接读取。
- `unwired`：设计中必须存在，但当前未接入真实信号。

拓扑节点不得因为没有接入真实读取就隐藏。未接入的 Jenkins/K8s 节点第一版应显示为 `unknown` 或 `unwired`，并在证据抽屉写明“API 当前没有只读观测适配器”。

## API 合同

新增受保护接口：

```text
GET /system/environment/dashboard
POST /system/environment/self-check
```

`GET /system/environment/dashboard` 返回当前聚合状态。`POST /system/environment/self-check` 只执行同一批只读检查，不执行写入、重启、部署或容器重建；它可以返回新的检查结果和本次 `checkRunId`，但第一版不要求落库。

建议目录：

```text
src/modules/admin/platform-config/environment-dashboard/
  contract/
    environment-dashboard.controller.ts
    dto/
      environment-dashboard.dto.ts
  application/
    environment-dashboard.service.ts
    environment-dashboard-status.mapper.ts
    environment-dashboard-action.catalog.ts
  domain/
    environment-dashboard.types.ts
  infrastructure/
    environment-dashboard-signal.collector.ts
```

该模块属于 Admin Platform Config，因为它面向后台环境观测和安全总控，不属于 QQBot、Blog、Asset 任一业务域。

### DTO

```ts
type EnvironmentHealthStatus =
  | 'ok'
  | 'degraded'
  | 'down'
  | 'blocked'
  | 'unknown'
  | 'unwired';

interface EnvironmentDashboardDto {
  checkedAt: string;
  checkRunId: string;
  overallStatus: EnvironmentHealthStatus;
  summaryCards: EnvironmentSummaryCardDto[];
  topology: EnvironmentTopologyDto;
  actions: EnvironmentActionDto[];
  recentEvents: EnvironmentEventDto[];
}

interface EnvironmentSummaryCardDto {
  key: string;
  title: string;
  status: EnvironmentHealthStatus;
  primaryMetric: string;
  secondaryMetric?: string;
  source: EnvironmentSignalSourceDto;
  route?: string;
}

interface EnvironmentTopologyDto {
  nodes: EnvironmentNodeDto[];
  edges: EnvironmentEdgeDto[];
}

interface EnvironmentNodeDto {
  id: string;
  label: string;
  group: 'entry' | 'frontend' | 'service' | 'data' | 'observability' | 'qqbot' | 'deploy';
  status: EnvironmentHealthStatus;
  sourceKind: 'live' | 'cached' | 'derived' | 'configured' | 'external-link' | 'unwired';
  metrics: EnvironmentMetricDto[];
  evidence: EnvironmentEvidenceDto[];
  links: EnvironmentNodeLinkDto[];
  lastCheckedAt?: string;
}

interface EnvironmentEdgeDto {
  id: string;
  source: string;
  target: string;
  relation: 'routes-to' | 'depends-on' | 'observes' | 'deploys' | 'connects';
  status: EnvironmentHealthStatus;
}

interface EnvironmentActionDto {
  key: string;
  label: string;
  description: string;
  kind: 'refresh' | 'self-check' | 'open-route' | 'open-url' | 'disabled-future';
  riskLevel: 'safe' | 'medium' | 'high';
  enabled: boolean;
  targetRoute?: string;
  targetUrl?: string;
  disabledReason?: string;
  requiredPermission?: string;
}

interface EnvironmentEventDto {
  id: string;
  source: string;
  level: 'info' | 'warn' | 'error' | 'fatal';
  title: string;
  message: string;
  happenedAt: string;
  route?: string;
}
```

实现时应使用项目现有 class DTO 风格，不需要逐字照搬 interface；上述结构是合同语义。

### 状态归一规则

- `ok`：信号源明确可用，关键指标正常。
- `degraded`：信号源可读，但存在局部异常，例如少量账号离线、日志查询降级、插件部分失败。
- `down`：信号源明确不可用，例如 MinIO 检查失败、WordPress auth check 失败。
- `blocked`：存在会阻断业务闭环的问题，例如 API runtime 配置缺失、QQBot worker 阻塞。
- `unknown`：检查失败、超时或没有足够证据判断。
- `unwired`：设计上存在该节点，但当前版本尚未接入读取能力。

总体状态按严重度聚合：

```text
blocked > down > degraded > unknown/unwired > ok
```

`unknown` 和 `unwired` 不应覆盖真实 `down` 或 `blocked`，但必须在 UI 上单独计数，避免被误认为健康。

## 信号源映射

### Runtime/API

来源：

- `RuntimeHealthService.getRuntimeHealth()`
- `RuntimeConfigService` 配置检查结果

节点：

- API Runtime
- Runtime Config
- MySQL
- Loki configured
- MinIO configured
- WordPress configured
- QQBot/NapCat configured

注意：

- `/health/runtime` 是无鉴权 plain JSON，新的 Admin 聚合接口不能直接 HTTP 调自己，应直接调用 service。
- 返回给 Admin 的证据必须脱敏，保留 configured/missing 语义即可。

### 系统日志/Loki

来源：

- `SystemLogService`
- `/system/logs/status`
- `/system/logs/summary`

节点：

- Loki / System Logs

事件：

- 最近错误等级摘要。
- 日志查询状态。

注意：

- 不返回大段原始日志。
- 页面跳转到现有系统日志页面时可附带 level/source filter。

### QQBot Core / NapCat

来源：

- `QqbotDashboardService.summary()`
- `QqbotAccountService` 或账号列表已有 runtime append 结果
- `QqbotNapcatAccountRuntimeService`
- NapCat runtime detail 现有摘要

节点：

- QQBot Core
- OneBot Reverse WS
- NapCat Accounts

指标：

- 账号总数。
- 在线账号数。
- 启用账号数。
- 发送成功/失败。
- bus/runtime 状态。
- NapCat 容器/WebUI/QQ 登录态分布。

注意：

- 账号列表可能触发 runtime TTL 检查，聚合服务需要短超时和并发限制。
- OneBot reverse WS 心跳不能被当作 QQ 登录成功，拓扑证据必须区分容器、OneBot、WebUI、QQ 登录态。

### 插件平台与定时任务

来源：

- Plugin Platform installations/capabilities/operations/runtime events。
- Plugin Task page/status service。

节点：

- Plugin Platform
- Plugin Operations
- Plugin Scheduled Tasks

指标：

- 已安装插件数量。
- enabled 插件数量。
- operation 数量。
- worker/runtime event 最近异常。
- 定时任务总数、启用数、最近失败数。

注意：

- 第一版面板不执行插件 enable/disable、task run、cron 修改。
- 相关操作只跳转到插件管理或插件任务页。

### MinIO / Asset

来源：

- `MinioClientService.checkConnection(bucketName?)`
- `/minio/check` 现有能力对应的 service。

节点：

- MinIO

指标：

- bucket 名称。
- bucket 是否存在。
- 连接检查状态。

注意：

- 不在 Dashboard 创建 bucket。
- `createAssetBucket`、上传、删除都不是第一版安全动作。

### WordPress / Blog

来源：

- `WordpressService.checkAuth()`
- WordPress theme/blog theme config 读取能力。

节点：

- WordPress
- Blog Frontend

指标：

- WordPress auth check。
- theme config 读取状态。
- public blog route 可用性如果 API 内有 service 可读，则作为 live；否则第一版仅展示 configured/external-link。

注意：

- 不执行 WordPress import、sync 或写入。

### Jenkins / K8s / NAS

来源：

- 第一版默认 `unwired` / `external-link`。
- 如果后续配置只读 Jenkins token、只读 K8s service account 或 deploy-observation evidence 文件，才能升级为 `live` 或 `cached`。

节点：

- Jenkins
- K8s Deployment
- API Pod
- NAS Runtime

第一版行为：

- 拓扑上显示节点。
- 提供外部链接或“未配置只读观测适配器”的证据。
- 高风险动作如“触发部署”“重启 Pod”“查看敏感 Secret”全部 disabled。

后续扩展：

- 新增只读 deploy evidence adapter。
- 读取最近 Jenkins build number、commit、result。
- 读取 K8s deployment generation/ready/updated/pod restartCount。
- 只读证据仍必须脱敏，不暴露 kubeconfig、token、Secret。

## 安全总控 Action Catalog

第一版 enabled actions：

- `refresh-dashboard`：重新请求 dashboard。
- `run-readonly-self-check`：调用 `POST /system/environment/self-check`，只执行只读检查。
- `open-system-logs`：跳转系统日志页。
- `open-qqbot-dashboard`：跳转 QQBot Dashboard。
- `open-napcat-runtime`：跳转 NapCat runtime/账号详情相关页面。
- `open-plugin-platform`：跳转插件平台页。
- `open-plugin-tasks`：跳转插件任务页。
- `open-asset-page`：跳转资产/MinIO 相关页面。
- `open-wordpress-page`：跳转 Blog/WordPress 管理页。
- `open-jenkins`：如果配置外链则打开 Jenkins。
- `open-k8s-dashboard`：如果配置外链则打开 K8s Dashboard。

第一版 disabled actions：

- `restart-api-pod`
- `trigger-jenkins-deploy`
- `run-db-migration`
- `recreate-napcat-container`
- `plugin-enable-disable`
- `plugin-task-run-once`
- `minio-create-bucket`
- `wordpress-import`

每个 disabled action 必须返回：

- `riskLevel: 'high'`
- `enabled: false`
- `disabledReason`
- `requiredPermission`
- 后续所需安全条件，例如二次确认、审计日志、回滚路径、只读预检。

## 前端设计

改造位置：

```text
apps/web-antdv-next/src/views/dashboard/analytics/index.vue
apps/web-antdv-next/src/views/dashboard/analytics/components/
apps/web-antdv-next/src/api/system/environment.ts
```

路由：

- 保留 `/dashboard/analytics`，避免菜单和固定 tab 入口失效。
- 菜单文案可改为“环境总览”或“环境状态”。
- 如果后台菜单组件选择依赖 `componentKeys`，需要补齐 `/dashboard/` 组件扫描。

页面结构：

- 使用 `Page autoContentHeight`。
- 使用 Ant Design Vue Next 的 `Card`、`Statistic`、`Tag`、`Button`、`Tooltip`、`Drawer`、`Timeline`、`Alert`、`Descriptions`。
- 拓扑可使用 DOM + CSS grid/SVG edge overlay 实现，不引入重量图表库。
- 每个拓扑节点使用固定尺寸，避免状态文字变化导致布局跳动。
- 节点点击打开证据抽屉，抽屉展示 metrics、evidence、links、lastCheckedAt。
- 安全总控按钮必须用图标 + tooltip；高风险 disabled action 不隐藏。
- 页面禁止使用旧示例中的营销图表和静态数据。

视觉原则：

- 运维工具风格，信息密度高、层级清晰、颜色克制。
- 不做 hero，不做装饰渐变，不做大面积单色主题。
- `ok/degraded/down/blocked/unknown/unwired` 使用一致的状态色和文字。
- 拓扑主视图必须在桌面第一屏可见；移动端可纵向分组堆叠。

## 后端实现约束

- Controller 使用 `JwtAuthGuard`。
- 返回 `vbenSuccess(data)`。
- Aggregator 通过 service 直接调用现有能力，不通过 HTTP 请求本 API。
- 每个信号源独立 timeout、独立 `Promise.allSettled`，单点失败不能拖垮整个 dashboard。
- 信号源失败必须变成节点 evidence，而不是抛出 500。
- 只有认证、参数、系统级不可恢复错误才让接口失败。
- 新增或触碰函数、方法、handler、job 必须补 JSDoc，参数说明要写来源和用途。
- 不泄露 secrets、token、password、raw env、kubeconfig、SSH 信息、QQBot 大字段。
- QQBot 摘要不得返回 `replyText`、base64 图片或过长日志。
- Jenkins/K8s 未接入时返回 `unwired`，不得伪造健康。

## 缓存与成本

建议第一版采用短 TTL 聚合缓存：

- 默认 dashboard TTL：10-30 秒。
- `self-check` 可绕过 dashboard TTL，但仍给单个信号源设置 timeout。
- NapCat/account runtime 读取复用现有 TTL，不强制刷新所有账号。
- WordPress/MinIO 外部探测设置独立短超时。
- Loki summary 查询失败时只降级日志节点。

缓存返回需要在 evidence 中标注：

- `checkedAt`
- `sourceKind`
- `ttlMs`
- `isStale`

## 验收标准

### 设计验收

- 用户确认本 spec 后，进入 Superpowers writing-plans。
- 实施计划必须拆 API 合同、API 聚合、Admin 页面、测试/线上闭环四部分。

### API 验收

- `GET /system/environment/dashboard` 本地真实请求返回 Vben 包装。
- 响应中包含 summaryCards、topology.nodes、topology.edges、actions、recentEvents。
- Jenkins/K8s 未配置时显示 `unwired` 或 `external-link`，不导致接口失败。
- 任一可模拟信号源失败时接口仍 200，并将对应节点标为 `unknown` / `degraded` / `down`。
- 不返回敏感字段或 QQBot 大字段。

### Admin 验收

- `/dashboard/analytics` 不再展示 Vben 示例静态图表。
- 第一屏展示总体状态、拓扑和安全总控。
- 节点点击能打开证据抽屉。
- enabled action 可执行刷新、只读自检或跳转。
- disabled high-risk action 可见且说明禁用原因。
- 页面切换无 Vue `non-element root node` / transition 空白问题。

### 线上验收

- API/Admin 推送部署后，Jenkins/K8s 发布状态需按现有 deploy observation 流程验证。
- 线上 Admin 页面可打开。
- 线上 dashboard 接口 200。
- 线上页面至少展示 API Runtime、System Logs、QQBot、NapCat、Plugin Platform、MinIO、WordPress、Jenkins/K8s 节点。
- 对未接入的 Jenkins/K8s 节点，页面明确展示未接入证据而非健康假象。

## 测试计划方向

实施计划阶段应覆盖：

- API service 单测：状态严重度聚合、partial failure、unwired 节点、action catalog。
- API controller contract spec：鉴权路由、Vben response shape、self-check 只读行为。
- Admin API wrapper Vitest：请求路径和响应类型。
- Admin 页面组件测试：拓扑节点、证据抽屉、disabled actions。
- 本地真实接口请求：启动或复用 API 服务调用 dashboard 接口。
- 本地浏览器 smoke：打开 `/dashboard/analytics`，检查 console、首屏、抽屉和动作。
- 线上 smoke：部署后调用线上接口和页面。

## 后续扩展

后续可以在不破坏第一版合同的基础上增加：

- 只读 Jenkins build adapter。
- 只读 K8s deployment/pod adapter。
- deploy observation evidence 入库或文件读取。
- 安全动作审计表。
- 二次确认和权限码控制的高风险动作。
- 环境变更历史趋势。
- 定时自检和告警推送。

这些扩展必须继续遵守：读态优先、动作分级、证据脱敏、失败局部降级、高风险动作有审计与回滚路径。
