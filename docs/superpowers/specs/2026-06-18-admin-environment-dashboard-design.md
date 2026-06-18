# Admin 多站点环境状态总览总控面板设计

## 背景

Admin 当前 `/dashboard/analytics` 仍是 Vben 示例分析页，展示用户量、访问量、下载量和图表等静态数据。它不能回答线上排障最常见的问题：

- 当前 API/Admin/QQBot/NapCat/插件平台是否真实可用。
- Jenkins 构建、K8s 发布和线上 Pod 是否对齐到目标提交。
- NAS、本地开发、腾讯云和 r4se 这些不同站点之间的 WireGuard、Caddy、OpenClash/Mihomo 等基础链路是否可观测。
- 哪些节点是健康、降级、隔离、未配置、无权限、只读可查或高风险禁用。

用户已确认采用 **A：Site Command Center** 作为页面布局与架构主线：左侧站点导航，中心环境拓扑，右侧证据/动作抽屉，底部事件流。目标不是“做一个漂亮图表页”，而是把多环境状态、证据来源、低风险只读动作和高风险边界集中到一个工作台。

本设计替换前序“单环境总览 + 安全总控”口径，保留 Jenkins/K8s 只读观测结论，并扩展到腾讯云和 r4se 远程环境。

## 官方依据

- Ant Design 设计规范提供企业级产品原型、布局、数据展示和组件使用原则；布局采用 8px grid，卡片数据展示需要控制信息密度和行数。
- Ant Design 提供企业级中后台设计规范；组件实现以当前 Admin 实际技术栈 `antdv-next` 为准。
- `antdv-next` 提供 Card、Statistic、Tag、Button、Tooltip、Drawer、Descriptions、Table 等中后台基础组件。
- Vben Admin 定位为 Vue3/Vite/TypeScript 的中后台工程方案，当前 Admin 已采用 Vben + `antdv-next`。
- Jenkins Remote Access API 支持只读获取 job/build 信息。
- Kubernetes API 支持读取 Deployment、Pod、Event 等资源，RBAC 可限制到 `get/list/watch`。
- Tencent Cloud CVM/Cloud Monitor API 可作为腾讯云主机状态和监控指标来源。
- Caddy Admin API 可读取当前配置和状态，但属于高权限配置 API，必须限制在内网/WireGuard 与只读路径。
- WireGuard 没有通用远程 HTTP 观测 API，只能通过本机 `wg`、隧道连通性或未来站点探针获得证据。
- OpenClash 本身不是稳定观测 API，底层 Mihomo/Clash external controller 可作为 r4se 只读观测来源。

参考链接：

- https://ant.design/docs/spec/introduce/
- https://ant.design/docs/spec/layout/
- https://ant.design/docs/spec/data-display/
- https://ant.design/components/overview/
- https://doc.vben.pro/en/
- https://www.jenkins.io/doc/book/using/remote-access-api/
- https://kubernetes.io/docs/concepts/overview/kubernetes-api/
- https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- https://www.tencentcloud.com/document/product/213/5165
- https://caddyserver.com/docs/api
- https://www.wireguard.com/quickstart/
- https://wiki.metacubex.one/en/api/

## 已确认决策

1. `/dashboard/analytics` 改造成“环境总览”工作台，不保留 Vben 示例静态图表。
2. 页面采用 A：Site Command Center。
3. 页面第一屏必须同时看到：
   - 全局状态条。
   - 左侧站点导航。
   - 中心环境拓扑。
   - 右侧证据与安全动作。
   - 底部最近事件。
4. 站点模型采用 `Site -> Node/Host -> Service -> Signal`，不再只围绕 NAS 单环境建模。
5. 第一版站点包含：
   - `nas-prod`：NAS/K8s/Jenkins/API/Admin/MySQL/Redis/Loki/MinIO/WordPress/QQBot/NapCat/插件平台。
   - `local-dev`：本地 API/Admin/dev proxy/本地 MySQL 或开发依赖。
   - `tencent-cloud`：腾讯云 CVM、WireGuard、Caddy。
   - `r4se`：WireGuard、OpenClash/Mihomo。
6. API 统一聚合，Admin 不直接访问 Jenkins、K8s、腾讯云、Caddy、Mihomo 或远程主机。
7. 第一版只允许低风险动作：刷新、只读自检、打开日志、跳转已有页面、打开外部只读入口。
8. 重启 Pod、触发 Jenkins 部署、DB 写入、重建 NapCat 容器、修改 Caddy/OpenClash、启停插件或定时任务等高风险动作，第一版必须显示为 disabled action，并写明原因。
9. Jenkins/K8s 必须接入只读观测；缺配置、403、超时或网络失败时显示失败证据，不能伪造成健康。
10. 腾讯云/r4se 第一版以只读观测为目标；无法直接观测的 WireGuard 全局 peer 状态必须明确显示证据缺口，不抓取私有 WebUI。
11. Figma 官方写入不作为本轮主链路；页面布局通过本地 visual companion 和中文 spec 收敛，避免 Figma 官方限流。

## 目标

- 将 `/dashboard/analytics` 改为多站点环境状态工作台。
- 提供统一 API 合同，输出站点、摘要卡、拓扑节点、拓扑边、动作目录和事件流。
- 每个节点必须带证据：来源、检查时间、实时/缓存/推导状态、失败原因、是否脱敏。
- 让 Jenkins/K8s、腾讯云、r4se 不再是“未接入健康假象”，而是明确展示只读证据或缺口。
- 后续可扩展远程站点探针，但第一版不引入写权限和高风险远程控制。

## 非目标

- 不在第一版执行部署、重启、数据库写入、插件启停、NapCat 容器重建、Caddy/OpenClash 修改。
- 不把 API Pod 暴露给 Docker socket、fnOS 私有 WebUI 或远程主机 root 权限。
- 不读取 K8s Secret、Jenkins console 全量日志、QQBot 大字段、原始 env、token、kubeconfig、SSH key。
- 不做营销式 hero、装饰图表、大面积单色主题或静态展示页。
- 不新增长期后台巡检表或历史趋势表，除非实施计划后续单独确认。

## 页面布局

### 桌面端第一屏

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 全局状态条：overall status / checkedAt / degraded / isolated / unknown / 刷新 │
├──────────┬───────────────────────────────────────────────┬───────────────────┤
│ 站点导航 │ 环境拓扑主视图                                  │ 证据 + 安全动作    │
│ NAS      │ 入口 -> 网关 -> Admin/API -> 数据/观测/业务       │ 当前选中节点        │
│ 本地     │ Jenkins -> K8s -> API Pod                       │ metrics/evidence   │
│ 腾讯云   │ Tencent CVM -> WireGuard -> Caddy                │ enabled/disabled   │
│ r4se     │ r4se WireGuard -> OpenClash/Mihomo               │ actions            │
├──────────┴───────────────────────────────────────────────┴───────────────────┤
│ 最近事件流：按严重度、站点、来源、时间排序                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 移动端/窄屏

- 全局状态条固定在顶部。
- 站点导航变为横向 segmented control。
- 拓扑按站点纵向分组。
- 证据抽屉改为底部 Drawer。
- 事件流位于拓扑之后，保留筛选与跳转。

### 视觉原则

- 工具型中后台，不做 hero。
- 8px spacing grid，固定节点尺寸，避免状态文案导致布局跳动。
- 使用 `antdv-next` 组件：Card、Statistic、Tag、Button、Tooltip、Drawer、Descriptions、Table、Timeline、Alert。
- 状态色克制一致：
  - `ok`：绿色。
  - `degraded`：橙色。
  - `down` / `blocked`：红色。
  - `isolated`：紫/蓝灰。
  - `unknown` / `unwired`：灰色。
- disabled 高风险动作必须可见，不隐藏。

## 信息架构

### 全局状态条

展示：

- 总体状态。
- 最近检查时间。
- 当前选择站点。
- `degraded/down/blocked/isolated/unknown/unwired` 计数。
- 刷新。
- 只读自检。
- 站点配置缺口提示。

### 左侧站点导航

每个站点展示：

- 站点名称。
- 站点状态。
- 核心服务短指标。
- 最近检查时间。
- 证据来源类型。

站点状态：

```ts
type EnvironmentSiteStatus =
  | 'online'
  | 'degraded'
  | 'isolated'
  | 'unknown';
```

语义：

- `online`：站点入口或核心服务读态成功，且关键节点没有阻断。
- `degraded`：站点可达，但部分服务异常或缺少观测。
- `isolated`：站点不可达，例如 WireGuard down、远程 Caddy/CVM 不可访问。
- `unknown`：缺配置、缺权限、超时或没有足够证据。

### 中心拓扑

拓扑必须支持两种层级：

- 全环境视图：四个站点并列展示关键链路。
- 单站点视图：展示该站点内部节点和依赖关系。

节点分组：

```ts
type EnvironmentNodeGroup =
  | 'entry'
  | 'network'
  | 'frontend'
  | 'service'
  | 'data'
  | 'observability'
  | 'qqbot'
  | 'deploy'
  | 'remote';
```

边关系：

```ts
type EnvironmentEdgeRelation =
  | 'routes-to'
  | 'depends-on'
  | 'observes'
  | 'deploys'
  | 'connects'
  | 'tunnels-to';
```

### 右侧证据与安全动作

点击任意站点、节点或边，右侧显示：

- 状态。
- 关键指标。
- 证据列表。
- 最后检查时间。
- 来源种类。
- 链接。
- enabled 安全动作。
- disabled 高风险动作与禁用原因。

证据抽屉不是日志正文区，只展示摘要和跳转入口。

### 底部事件流

事件来源：

- 系统日志摘要。
- Jenkins build 状态。
- K8s warning event。
- QQBot/NapCat runtime event。
- Plugin runtime/task event。
- 远程站点观测失败。

事件流必须支持：

- 按站点过滤。
- 按严重度过滤。
- 跳转相关页面。
- 脱敏摘要展示。

## API 合同

新增受保护接口：

```text
GET /system/environment/dashboard
POST /system/environment/self-check
```

`GET /system/environment/dashboard` 返回当前聚合状态。`POST /system/environment/self-check` 执行同一批只读检查，可以绕过 dashboard TTL，但不得触发任何写入、重启、部署、容器重建或远程配置变更。

建议目录：

```text
src/modules/admin/platform-config/environment-dashboard/
  contract/
    environment-dashboard.controller.ts
    dto/
      environment-dashboard.dto.ts
  application/
    environment-dashboard.service.ts
    environment-dashboard-site.mapper.ts
    environment-dashboard-status.mapper.ts
    environment-dashboard-action.catalog.ts
  domain/
    environment-dashboard.types.ts
  infrastructure/
    environment-dashboard-signal.collector.ts
    adapters/
      jenkins-readonly.adapter.ts
      kubernetes-readonly.adapter.ts
      tencent-cloud-readonly.adapter.ts
      caddy-readonly.adapter.ts
      mihomo-readonly.adapter.ts
      wireguard-reachability.adapter.ts
```

该模块属于 Admin Platform Config，因为它面向后台运维观测和安全总控，不属于 QQBot、Blog、Asset 任一业务域。

### DTO 语义

实现时应使用项目现有 class DTO 风格；下列 interface 仅定义合同语义。

```ts
type EnvironmentHealthStatus =
  | 'ok'
  | 'degraded'
  | 'down'
  | 'blocked'
  | 'isolated'
  | 'unknown'
  | 'unwired';

interface EnvironmentDashboardDto {
  checkedAt: string;
  checkRunId: string;
  overallStatus: EnvironmentHealthStatus;
  activeSiteKey: string;
  sites: EnvironmentSiteDto[];
  summaryCards: EnvironmentSummaryCardDto[];
  topology: EnvironmentTopologyDto;
  actions: EnvironmentActionDto[];
  recentEvents: EnvironmentEventDto[];
}

interface EnvironmentSiteDto {
  key: string;
  title: string;
  description: string;
  status: EnvironmentSiteStatus;
  region?: string;
  primaryEndpoint?: string;
  sourceKind: EnvironmentSignalSourceKind;
  metrics: EnvironmentMetricDto[];
  evidence: EnvironmentEvidenceDto[];
  lastCheckedAt?: string;
}

type EnvironmentSignalSourceKind =
  | 'live'
  | 'cached'
  | 'derived'
  | 'configured'
  | 'external-link'
  | 'unwired';

interface EnvironmentSummaryCardDto {
  key: string;
  siteKey?: string;
  title: string;
  status: EnvironmentHealthStatus;
  primaryMetric: string;
  secondaryMetric?: string;
  source: EnvironmentSignalSourceDto;
  route?: string;
}

interface EnvironmentTopologyDto {
  viewMode: 'global' | 'site';
  activeSiteKey?: string;
  nodes: EnvironmentNodeDto[];
  edges: EnvironmentEdgeDto[];
}

interface EnvironmentNodeDto {
  id: string;
  siteKey: string;
  label: string;
  group: EnvironmentNodeGroup;
  status: EnvironmentHealthStatus;
  sourceKind: EnvironmentSignalSourceKind;
  metrics: EnvironmentMetricDto[];
  evidence: EnvironmentEvidenceDto[];
  links: EnvironmentNodeLinkDto[];
  lastCheckedAt?: string;
}

interface EnvironmentEdgeDto {
  id: string;
  siteKey?: string;
  source: string;
  target: string;
  relation: EnvironmentEdgeRelation;
  status: EnvironmentHealthStatus;
  evidence: EnvironmentEvidenceDto[];
}

interface EnvironmentEvidenceDto {
  key: string;
  title: string;
  status: EnvironmentHealthStatus;
  source: string;
  checkedAt: string;
  summary: string;
  details?: Record<string, string | number | boolean | null>;
  isSensitiveRedacted: boolean;
  ttlMs?: number;
  isStale?: boolean;
}

interface EnvironmentActionDto {
  key: string;
  siteKey?: string;
  nodeId?: string;
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
  siteKey?: string;
  source: string;
  level: 'info' | 'warn' | 'error' | 'fatal';
  title: string;
  message: string;
  happenedAt: string;
  route?: string;
}
```

## 站点模型

### `nas-prod`

节点：

- Caddy / TLS / reverse proxy。
- Admin static site。
- API Runtime。
- Runtime Config。
- MySQL。
- Redis / BullMQ。
- Loki / System Logs。
- MinIO。
- WordPress。
- QQBot Core。
- OneBot Reverse WS。
- NapCat Accounts。
- Plugin Platform。
- Plugin Scheduled Tasks。
- Jenkins。
- K8s Deployment。
- API Pod。

主要证据：

- Runtime health service。
- 系统日志 status/summary。
- QQBot dashboard/account/runtime summary。
- NapCat runtime detail。
- 插件平台与定时任务状态。
- MinIO connection check。
- WordPress auth/theme config check。
- Jenkins Remote Access API。
- Kubernetes API。

### `local-dev`

节点：

- Local Admin dev server。
- Local API dev server。
- Local proxy / API base URL。
- Local MySQL / Redis if configured。

第一版可选读取：

- 如果 API 本地运行，则通过当前 Admin 配置的 API base URL 读取自身 runtime。
- 如果本地服务不可读，显示 `unknown`，并写明缺少本地 API 或 dev server 证据。

### `tencent-cloud`

节点：

- Tencent CVM。
- Tencent Cloud Monitor。
- WireGuard endpoint。
- Caddy service。
- Public gateway / domain route。

主要证据：

- Tencent Cloud Monitor / CVM API：实例状态、CPU、网络、磁盘等指标。
- WireGuard reachability：API 所在网络到腾讯云 WireGuard endpoint 的连通性。
- Caddy Admin API：只读读取 config/status；仅允许 loopback/WireGuard 地址。
- Public domain probe：可选 HTTPS HEAD/GET 健康探测。

边界：

- 不在 Admin/API 里修改 Caddyfile。
- 不 reload Caddy。
- 不通过腾讯云 API 执行重启实例、修改安全组、改 DNS。

### `r4se`

节点：

- WireGuard endpoint。
- OpenClash service。
- Mihomo/Clash external controller。
- 关键代理组/连接状态。

主要证据：

- WireGuard reachability：站点可达性和最近隧道连通性。
- Mihomo/Clash external controller：`/version`、`/traffic`、`/connections`、`/proxies` 只读摘要。

边界：

- 不抓取 OpenClash WebUI 私有接口。
- 不切换代理组。
- 不更新订阅。
- 不重启 OpenClash/Mihomo。
- 如果 external controller 未启用或无只读访问，节点显示 `unknown`，证据写明缺口。

## 状态归一规则

节点状态：

- `ok`：信号源明确可用，关键指标正常。
- `degraded`：信号源可读，但存在局部异常，例如 Pod restart、部分账号离线、日志查询降级。
- `down`：信号源明确不可用，例如 Deployment 不可用、MinIO check failed。
- `blocked`：存在阻断业务闭环的问题，例如 runtime 核心配置缺失、QQBot worker 阻塞。
- `isolated`：远程站点或网络链路不可达，例如 WireGuard/Caddy endpoint 不通。
- `unknown`：缺配置、缺权限、超时、API 错误或证据不足。
- `unwired`：设计中存在该节点，但当前版本未接入读取能力。

总体状态按严重度聚合：

```text
blocked > down > isolated > degraded > unknown/unwired > ok
```

站点状态由站点内节点聚合：

- 有 `blocked` 或核心入口 `down`：站点 `degraded` 或 `isolated`，由网络证据决定。
- WireGuard/入口不可达：站点 `isolated`。
- 核心入口可达但部分节点失败：站点 `degraded`。
- 只有配置缺失或证据不足：站点 `unknown`。
- 所有核心节点正常：站点 `online`。

`unknown` 和 `unwired` 必须单独计数，不得合并成健康。

## 信号源映射

### Runtime/API

来源：

- `RuntimeHealthService.getRuntimeHealth()`
- `RuntimeConfigService`

要求：

- 聚合服务直接调用 service，不 HTTP 调本 API。
- 只返回 configured/missing/ok/down 摘要。
- 不暴露 env、password、token、secret。

### 系统日志/Loki

来源：

- `SystemLogService`
- `/system/logs/status`
- `/system/logs/summary`

要求：

- 只返回摘要和跳转链接。
- 不返回大段原始日志。
- 不把 dashboard 自身请求刷成噪声事件。

### QQBot / NapCat

来源：

- `QqbotDashboardService.summary()`
- `QqbotAccountService` 或账号列表 runtime append。
- `QqbotNapcatAccountRuntimeService`

要求：

- 区分 OneBot reverse WS、容器/WebUI、QQ 登录态。
- OneBot 心跳不能被当作 QQ 登录成功。
- 不返回 `replyText`、base64 图片或长日志。
- NapCat/account runtime 使用短超时和并发限制。

### 插件平台与定时任务

来源：

- Plugin Platform installations/capabilities/operations/runtime events。
- Plugin Task service。

要求：

- 展示已安装、启用、operation 数、任务数、最近失败数。
- 第一版不执行插件 enable/disable、task run、cron 修改。
- 动作只跳转插件平台或插件任务页。

### MinIO / WordPress

来源：

- `MinioClientService.checkConnection(bucketName?)`
- `WordpressService.checkAuth()`
- WordPress/theme config read service。

要求：

- 不创建 bucket。
- 不执行 WordPress import/sync/write。
- 只显示连接、认证、主题配置读取摘要。

### Jenkins

来源：

- Jenkins Remote Access API `GET .../api/json`。

读取字段：

- jobPath。
- buildNumber。
- result。
- building。
- branch。
- commitSha。
- commitMessageSummary。
- startedAt。
- durationMs。
- buildUrl。

禁止：

- `/build`
- `/buildWithParameters`
- replay。
- configure。
- credential。
- console full log。

失败语义：

- token 缺失：`unknown`，evidence `jenkins-readonly-auth-missing`。
- 403：`unknown`，evidence `jenkins-readonly-forbidden`。
- 最近 build failed：若当前线上镜像不受影响则 `degraded`，若线上目标部署失败则 `down`。

### Kubernetes / K3s

来源：

- Kubernetes API。

读取资源：

- Deployment `get` / `status`。
- Pod `list` with labelSelector。
- ReplicaSet 可选。
- Event `list`。
- Metrics API 可选。

读取字段：

- namespace。
- deployment name。
- generation / observedGeneration。
- replicas / updatedReplicas / readyReplicas / availableReplicas。
- image。
- podName。
- phase。
- ready。
- restartCount。
- startedAt。
- warning event reason/message 摘要。

RBAC：

- 只允许 `get/list/watch`。
- 不允许 `create/update/patch/delete`。
- 不允许 `pods/exec`。
- 第一版不读取 `pods/log`，除非后续单独设计脱敏日志入口。
- 不允许读取 Secret。

失败语义：

- RBAC 403：`unknown`，evidence `k8s-readonly-rbac-forbidden`。
- Deployment 未就绪：`down`。
- Pod restartCount 增长或 warning event：`degraded`。

### Tencent Cloud

来源：

- Tencent Cloud CVM / Cloud Monitor read-only API。

读取字段：

- instanceId / instanceName。
- instanceState。
- region / zone。
- CPU、内存、磁盘、网络指标摘要。
- 公网/内网 IP 脱敏展示。

禁止：

- 重启实例。
- 修改安全组。
- 修改公网 IP、EIP、DNS。
- 修改云产品配置。

失败语义：

- credential missing：`unknown`。
- API forbidden：`unknown`。
- CVM stopped/unreachable：`down` 或站点 `isolated`。

### Caddy

来源：

- Caddy Admin API read-only paths。
- HTTPS public route probe。

要求：

- Caddy Admin API 只允许 loopback 或 WireGuard 私网地址。
- 不调用 config write、load、reload。
- 只显示当前配置摘要、route 可达性和证书/TLS 证据。

### WireGuard

来源：

- API 所在节点的 WireGuard 本地状态。
- 私网 endpoint reachability。
- 未来可选 site probe。

要求：

- 第一版不假装能读取远端所有 peer。
- 只展示 API 侧可证明的 tunnel reachability、handshake/endpoint 摘要或缺口。
- 如果缺少 site probe，远端 peer 细节显示 `unknown`。

### OpenClash / Mihomo

来源：

- Mihomo/Clash external controller read-only endpoints。

读取字段：

- `/version`
- `/traffic`
- `/connections`
- `/proxies` 摘要。

禁止：

- 切换代理。
- 修改配置。
- 重载配置。
- 更新订阅。
- 重启服务。

失败语义：

- external controller disabled：`unknown`。
- remote unreachable：站点 `isolated`。
- API 401/403：`unknown`。

## 安全总控 Action Catalog

第一版 enabled actions：

- `refresh-dashboard`：重新请求 dashboard。
- `run-readonly-self-check`：执行只读自检。
- `open-system-logs`：跳转系统日志页。
- `open-qqbot-dashboard`：跳转 QQBot Dashboard。
- `open-napcat-runtime`：跳转 NapCat runtime 或账号详情。
- `open-plugin-platform`：跳转插件平台页。
- `open-plugin-tasks`：跳转插件任务页。
- `open-asset-page`：跳转资产/MinIO 页面。
- `open-wordpress-page`：跳转 Blog/WordPress 管理页。
- `open-jenkins`：打开 Jenkins 只读入口。
- `open-k8s-dashboard`：打开 K8s Dashboard 只读入口。
- `open-tencent-cloud-console`：打开腾讯云控制台链接。
- `open-caddy-status`：打开 Caddy 只读状态链接。
- `open-mihomo-dashboard`：打开 r4se Mihomo/OpenClash 只读入口，如果已配置。

第一版 disabled actions：

- `restart-api-pod`
- `trigger-jenkins-deploy`
- `run-db-migration`
- `recreate-napcat-container`
- `plugin-enable-disable`
- `plugin-task-run-once`
- `minio-create-bucket`
- `wordpress-import`
- `reload-caddy`
- `edit-caddy-config`
- `switch-openclash-proxy`
- `restart-openclash`
- `restart-tencent-cvm`
- `modify-wireguard-peer`

每个 disabled action 必须返回：

- `riskLevel: 'high'`
- `enabled: false`
- `disabledReason`
- `requiredPermission`
- 后续安全条件，例如二次确认、审计日志、回滚路径、只读预检、最小权限凭据。

## 前端设计

改造位置：

```text
Vue/kt-template-admin/apps/web-antdv-next/src/views/dashboard/analytics/index.vue
Vue/kt-template-admin/apps/web-antdv-next/src/views/dashboard/analytics/components/
Vue/kt-template-admin/apps/web-antdv-next/src/api/system/environment.ts
```

路由：

- 保留 `/dashboard/analytics`，避免菜单和固定 tab 入口失效。
- 菜单文案改为“环境总览”或“环境状态”。

组件建议：

```text
EnvironmentDashboardPage
  EnvironmentStatusBar
  EnvironmentSiteRail
  EnvironmentTopologyCanvas
  EnvironmentEvidenceDrawer
  EnvironmentActionPanel
  EnvironmentEventStream
```

实现约束：

- 页面 root 必须是单一稳定元素，避免 Vben route transition 空白。
- 拓扑第一版使用 DOM + CSS grid + SVG edge overlay，不引入重量图表库。
- 节点固定宽高，长文本 ellipsis + Tooltip。
- 抽屉展示 Descriptions、metrics、evidence、links、actions。
- 事件流可用 Table 或 Timeline；如果需要排序/过滤，优先 Table。
- API 请求统一通过 Admin caller/request wrapper。

## 后端实现约束

- Controller 使用 `JwtAuthGuard`。
- 返回 `vbenSuccess(data)`。
- Aggregator 直接调用本地 service 或只读 adapter，不 HTTP 调本 API。
- 每个信号源独立 timeout、独立 `Promise.allSettled`。
- 单点失败变成节点 evidence，不让 dashboard 500。
- 只有鉴权、参数或系统级不可恢复错误才让接口失败。
- 新增或触碰函数、方法、handler、job 必须补 JSDoc，参数说明写来源和用途。
- 所有外部证据入库前、日志前、返回前都必须脱敏。
- Jenkins/K8s/Tencent/Caddy/Mihomo adapter 不得包含写路径。

## 缓存与成本

建议第一版采用短 TTL：

- Dashboard 聚合 TTL：10-30 秒。
- `self-check` 可绕过 dashboard TTL，但仍对每个信号源设置 timeout。
- QQBot/NapCat 复用现有 runtime TTL，不强制刷新所有账号。
- Jenkins/K8s/Tencent/Caddy/Mihomo 每个 adapter 独立短超时。
- 远程站点失败只降级对应站点，不拖垮整个接口。

证据必须标注：

- `checkedAt`
- `sourceKind`
- `ttlMs`
- `isStale`

## 验收标准

### 设计验收

- 用户确认本 spec 后，进入 Superpowers writing-plans。
- 实施计划必须拆 API 合同、API 聚合、远程只读 adapter、Admin 页面、测试/线上闭环五部分。

### API 验收

- `GET /system/environment/dashboard` 本地真实请求返回 Vben 包装。
- 响应包含 `sites`、`summaryCards`、`topology.nodes`、`topology.edges`、`actions`、`recentEvents`。
- NAS、local-dev、Tencent Cloud、r4se 至少有节点和状态。
- Jenkins/K8s 节点由只读 adapter 提供真实 build/deployment/pod 证据或失败证据。
- 腾讯云/Caddy/WireGuard/r4se/OpenClash/Mihomo 节点有只读证据或明确缺口。
- 任一信号源失败时接口仍 200，并将对应节点标为 `unknown` / `isolated` / `degraded` / `down`。
- 不返回敏感字段或 QQBot 大字段。

### Admin 验收

- `/dashboard/analytics` 不再展示 Vben 示例静态图表。
- 第一屏展示全局状态条、站点导航、拓扑、证据/动作、事件流。
- 点击站点切换拓扑范围。
- 点击节点打开证据抽屉。
- enabled action 可刷新、只读自检或跳转。
- disabled high-risk action 可见且说明禁用原因。
- 页面切换无 Vue `non-element root node` / transition 空白问题。

### 线上验收

- API/Admin 推送部署后，Jenkins/K8s 发布状态按现有 deploy observation 流程验证。
- 线上 Admin 页面可打开。
- 线上 dashboard 接口 200。
- 线上页面展示 NAS、local-dev、Tencent Cloud、r4se 四类站点。
- Jenkins/K8s 展示真实只读观测证据：Jenkins 最近 build/commit/result，K8s Deployment ready/updated、Pod image/restartCount。
- 腾讯云/Caddy/WireGuard/r4se/OpenClash/Mihomo 展示真实只读证据或明确缺口，不显示健康假象。
- 所有高风险动作 disabled，不能触发部署、重启 Pod、修改资源或读取 Secret。

## 测试计划方向

实施计划阶段应覆盖：

- API service 单测：状态严重度聚合、site 聚合、partial failure、isolated/unknown/unwired、action catalog。
- API adapter 单测：Jenkins/K8s/Tencent/Caddy/Mihomo/WireGuard 的 200、403、timeout、unreachable、failed/degraded mapping。
- API controller contract spec：鉴权路由、Vben response shape、self-check 只读行为。
- Admin API wrapper Vitest：请求路径和响应类型。
- Admin 页面组件测试：站点导航、拓扑节点、证据抽屉、disabled actions、事件流过滤。
- 本地真实接口请求：启动或复用 API 服务调用 dashboard 接口。
- 本地浏览器 smoke：打开 `/dashboard/analytics`，检查 console、首屏、抽屉和动作。
- 线上 smoke：部署后调用线上接口和页面。

## 后续扩展

后续可以在不破坏第一版合同的基础上增加：

- 远程 site probe，解决 WireGuard 远端 peer 和 OpenClash 主机本地服务观测盲区。
- deploy observation evidence 入库。
- 安全动作审计表。
- 二次确认和权限码控制的高风险动作。
- 环境变更历史趋势。
- 定时自检和告警推送。

这些扩展必须继续遵守：读态优先、动作分级、证据脱敏、失败局部降级、高风险动作有审计与回滚路径。
