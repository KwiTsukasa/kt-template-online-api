# QQBot NapCat WebUI Gateway 实施计划

> **给 agent worker：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 实现独立 NapCat WebUI Gateway 微服务，并在 Admin 二级页面中打开指定 QQBot 账号的原版 NapCat WebUI，支持完整操作和页面生命周期清理。

**架构：** API 继续作为 Admin 鉴权和 QQBot 账号绑定解析的权威，只负责创建短期 Gateway session。新增 `kt-napcat-webui-gateway` 进程负责 session 存储、一次性 bootstrap ticket、NapCat WebUI Credential 交换、HTTP/静态资源/API/WebSocket 代理和审计。Admin 打开 `/qqbot/account/:accountId/napcat-webui`，页面 mounted 创建 session，mounted 期间 heartbeat，路由离开时 revoke。

**技术栈：** NestJS 11、Express adapter、TypeORM/MySQL、Redis via `@nestjs-modules/ioredis` + `ioredis`、`http-proxy-middleware` 代理 Express/WebSocket、Vue 3 TSX、VueUse `useIntervalFn`、Vben Admin、antdv-next、K8s、Jenkins、Caddy/Admin 域路由。

---

## 来源参考

- 设计文档：`docs/superpowers/specs/2026-06-24-qqbot-napcat-webui-gateway-design.md`
- 中文设计：`docs/superpowers/specs/2026-06-24-qqbot-napcat-webui-gateway-design.zh-CN.md`
- `http-proxy-middleware` 支持 Express proxy middleware 和 WebSocket upgrade：<https://github.com/chimurai/http-proxy-middleware>
- `http-proxy-middleware` WebSocket recipe 说明了 `ws: true`、手动 `server.on('upgrade', proxy.upgrade)`、多 target 和 path rewrite：<https://github.com/chimurai/http-proxy-middleware/blob/master/recipes/websocket.md>
- `@nestjs-modules/ioredis` 提供 Nest `RedisModule.forRoot` 和 `@InjectRedis()`，底层使用 `ioredis`：<https://github.com/nest-modules/ioredis>
- 明确不使用 `connect-redis`，因为它是 Express session store，而 Gateway 需要 API 预创建 session、一次性 ticket、target 元数据、同账号并发撤销、Credential 缓存和审计事件：<https://github.com/tj/connect-redis>
- VueUse `useIntervalFn` 是带 pause/resume 控制的 `setInterval` wrapper，Admin 已有该依赖：<https://vueuse.org/shared/useintervalfn/>

## 范围检查

这是一条完整可交付链路，虽然跨 API、Gateway、Admin 和部署，但不能拆成互不依赖的计划。Admin 页面没有 API session 不能加载，API session 没有 Gateway 不能 smoke，Gateway 没有 Admin 生命周期和部署路由也不能安全上线。

## 文件结构

### API 仓库：`D:\MyFiles\KT\Node\kt-template-online-api`

- 修改 `package.json` 和 `pnpm-lock.yaml`：加入 `@nestjs-modules/ioredis`、`ioredis`、`http-proxy-middleware` 和 Gateway 启动脚本。
- 新增 `src/apps/napcat-webui-gateway/main.ts`：Gateway 独立 Nest bootstrap，端口 `48086`。
- 新增 `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts`：Gateway module，导入配置、日志、TypeORM、`RedisModule` 和 Gateway provider/controller。
- 新增 `src/apps/napcat-webui-gateway/config/napcat-webui-gateway-config.service.ts`：读取 Gateway env 和安全默认值。
- 新增 `src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types.ts`：session、audit、target、proxy 类型。
- 新增 `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-redis.store.ts`：Redis session/ticket store。
- 新增 `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service.ts`：一次性 bootstrap ticket。
- 新增 `src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client.ts`：服务端 WebUI token 换 Credential。
- 新增 `src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts`：HTTP、header、redirect、cookie、WebSocket 代理。
- 新增 `src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service.ts`：create、active、heartbeat、revoke、expire、同账号并发策略。
- 新增 `src/apps/napcat-webui-gateway/presentation/internal-session.controller.ts`：Gateway 内部服务接口。
- 新增 `src/apps/napcat-webui-gateway/presentation/public-webui.controller.ts`：bootstrap 和公开 iframe/proxy 入口。
- 新增 `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`：Admin-facing DTO。
- 新增 `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller.ts`：`/qqbot/napcat/webui` Admin 接口。
- 新增 `src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service.ts`：账号鉴权、容器解析、Gateway client 编排。
- 新增 `src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client.ts`：Gateway 内部 HTTP client。
- 新增 `src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity.ts`：MySQL audit entity。
- 修改 `src/modules/qqbot/napcat/qqbot-napcat.module.ts`：注册 controller、service、client、audit entity。
- 修改 `sql/qqbot-init.sql` 和 `sql/refactor-v3/01-seed-core.sql`：加入 `QqBot:Account:WebUI` hidden route/menu 和按钮权限。
- 修改 `sql/refactor-v3/99-verify.sql`：校验新权限和审计表。
- 新增 `dockerfile.gateway`：生产镜像入口 `dist/apps/napcat-webui-gateway/main`。
- 修改 `Jenkinsfile`：构建、推送和部署 API 镜像与 Gateway 镜像。
- 修改 `k8s/prod/api.yaml`：新增 Gateway Deployment/Service，给 API 增加 Gateway base URL/public base URL/internal secret。
- 修改 `README.md` 和 `API.md`：记录 Gateway env、路由和验证命令。

### Admin 仓库：`D:\MyFiles\KT\Vue\kt-template-admin`

- 修改 `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`：新增隐藏二级 WebUI 路由。
- 修改 `apps/web-antdv-next/src/api/qqbot/napcat.ts`：新增 WebUI session 类型和 caller。
- 修改 `apps/web-antdv-next/src/views/qqbot/account/list.tsx`：新增 WebUI 行操作。
- 新增 `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.tsx`：远程控制台页面。
- 新增 `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.scss`：主题化布局。
- 新增 `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/useNapcatWebuiGatewaySession.ts`：页面生命周期 session。
- 修改 `apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts`：保证 account list 不承载 WebUI 生命周期。
- 新增 `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx`：页面生命周期测试。
- 修改 `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`：WebUI session caller 测试。

---

### Task 1：增加契约、权限种子和 RED 测试

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts`
- Modify: `sql/qqbot-init.sql`
- Modify: `sql/refactor-v3/01-seed-core.sql`
- Modify: `sql/refactor-v3/99-verify.sql`

- [ ] **Step 1：写失败的结构测试**

创建 `test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts`：

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoRoot = resolve(__dirname, '../../../..');

const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

describe('NapCat WebUI Gateway contract seeds', () => {
  it('registers a dedicated Admin permission for full NapCat WebUI access', () => {
    const coreSeed = read('sql/refactor-v3/01-seed-core.sql');
    const qqbotSeed = read('sql/qqbot-init.sql');

    expect(coreSeed).toContain('QqBot:Account:WebUI');
    expect(coreSeed).toContain('QqBotAccountNapcatWebui');
    expect(qqbotSeed).toContain('QqBot:Account:WebUI');
    expect(qqbotSeed).toContain('QqBotAccountNapcatWebui');
  });

  it('verifies the gateway audit table during full schema checks', () => {
    const verifySql = read('sql/refactor-v3/99-verify.sql');

    expect(verifySql).toContain('qqbot_napcat_webui_gateway_audit');
    expect(verifySql).toContain('QqBot:Account:WebUI');
  });
});
```

- [ ] **Step 2：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
```

期望：失败，提示 `QqBot:Account:WebUI` 和 `qqbot_napcat_webui_gateway_audit` 不存在。

- [ ] **Step 3：增加 SQL 种子**

在 `sql/qqbot-init.sql` 和 `sql/refactor-v3/01-seed-core.sql` 的 QQBot account 菜单附近加入：

```sql
(2041700000000100412, 2041700000000100400, 'QqBotAccountNapcatWebui', '/qqbot/account/:accountId/napcat-webui', '/qqbot/account/napcat-webui/index', NULL, 'QqBot:Account:WebUI', 'menu', '{"activePath":"/qqbot/account","hideInMenu":true,"title":"NapCat WebUI"}', 1, 0),
(2041700000000120407, 2041700000000100402, 'QqBotAccountWebUI', NULL, NULL, NULL, 'QqBot:Account:WebUI', 'button', '{"title":"NapCat WebUI"}', 1, 0),
```

保持 ID 唯一，不改无关菜单。

- [ ] **Step 4：增加 schema 校验 SQL**

在 `sql/refactor-v3/99-verify.sql` 按现有风格加入：

```sql
SELECT 'qqbot_napcat_webui_gateway_audit table exists' AS check_name,
       COUNT(*) AS matched
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'qqbot_napcat_webui_gateway_audit';

SELECT 'QqBot Account WebUI permission exists' AS check_name,
       COUNT(*) AS matched
FROM admin_menu
WHERE auth_code = 'QqBot:Account:WebUI';
```

当前菜单表是 `admin_menu`，权限字段是 `auth_code`；校验 SQL 固定使用这两个名称。

- [ ] **Step 5：运行契约测试确认 GREEN**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
```

期望：PASS。

- [ ] **Step 6：提交 Task 1**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts sql/qqbot-init.sql sql/refactor-v3/01-seed-core.sql sql/refactor-v3/99-verify.sql
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI权限契约"
```

---

### Task 2：实现 API session 接口和审计实体

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity.ts`
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/persistence/index.ts`

- [ ] **Step 1：写失败的 API service 测试**

创建 `test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts`，测试必须断言 Admin 响应不含 `webuiToken`、Credential、端口或容器拓扑，并且 WebUI 离线时不会调用 Gateway。

- [ ] **Step 2：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts --runInBand
```

期望：失败，因为 service 和 DTO 尚不存在。

- [ ] **Step 3：创建 DTO**

创建 `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`，包含 `QqbotNapcatWebuiSessionCreateDto` 和 `QqbotNapcatWebuiSessionResponseDto`，字段与英文计划一致。

- [ ] **Step 4：创建审计实体**

创建 `NapcatWebuiGatewayAudit`，表名 `qqbot_napcat_webui_gateway_audit`，字段包含 `sessionId/adminUserId/accountId/selfId/containerId/eventType/clientIp/userAgent/detailJson/createTime`，禁止保存 token、Credential、密码、验证码或二维码内容。

- [ ] **Step 5：创建 Gateway 内部 client**

创建 `QqbotNapcatWebuiGatewayClient`，提供 `createSession`、`heartbeat`、`revoke`，从 `NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL` 和 `NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` 调 Gateway 内部接口，错误信息必须脱敏。

- [ ] **Step 6：创建 API service**

创建 `QqbotNapcatWebuiGatewayService`：

- `createSession()` 校验账号存在。
- 解析主 NapCat container。
- WebUI 离线或 token/port 不完整时拒绝。
- 调 Gateway client 创建 session。
- 返回安全字段：`account/container/sessionId/iframeUrl/expiresAt`。

在 `QqbotNapcatContainerService` 新增 `findPrimaryContainerByAccountId(accountId: string)`，补 JSDoc 和聚焦单测，然后由 `QqbotNapcatWebuiGatewayService` 调用该方法。

- [ ] **Step 7：创建 API controller**

创建 `QqbotNapcatWebuiGatewayController`，路径：

```text
POST /qqbot/napcat/webui/session
POST /qqbot/napcat/webui/session/:sessionId/heartbeat
POST /qqbot/napcat/webui/session/:sessionId/revoke
```

使用 `JwtAuthGuard`，通过 `vbenSuccess` 返回。

- [ ] **Step 8：注册 provider 和 entity**

修改 `qqbot-napcat.module.ts` 与 `napcat/infrastructure/persistence/index.ts`，注册 controller、service、client 和 audit entity。

- [ ] **Step 9：运行 API 测试和类型检查**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

期望：测试 PASS，typecheck PASS。

- [ ] **Step 10：提交 Task 2**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/napcat/webui-gateway src/modules/qqbot/napcat/qqbot-napcat.module.ts src/modules/qqbot/napcat/infrastructure/persistence/index.ts test/modules/qqbot/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI会话接口"
```

---

### Task 3：实现 Gateway App、Session Store 和 Bootstrap Ticket

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `test/apps/napcat-webui-gateway/session-store.spec.ts`
- Create: `src/apps/napcat-webui-gateway/main.ts`
- Create: `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts`
- Create: `src/apps/napcat-webui-gateway/config/napcat-webui-gateway-config.service.ts`
- Create: `src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-redis.store.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service.ts`
- Create: `src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service.ts`
- Create: `src/apps/napcat-webui-gateway/presentation/internal-session.controller.ts`

- [ ] **Step 1：增加依赖**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api add @nestjs-modules/ioredis ioredis http-proxy-middleware
```

期望：更新 `package.json` 和 `pnpm-lock.yaml`。保留已有 `ws`。不要加 `connect-redis`，因为 Gateway session 是领域 session，不是 Express 登录 session。

- [ ] **Step 2：增加启动脚本**

在 `package.json` scripts 增加：

```json
{
  "start:gateway:prod": "cross-env NODE_ENV=production node dist/apps/napcat-webui-gateway/main",
  "start:gateway:dev": "ts-node -r tsconfig-paths/register src/apps/napcat-webui-gateway/main.ts"
}
```

API 仓库已有 `ts-node` 和 `tsconfig-paths`，dev script 固定使用 TypeScript entrypoint，生产脚本固定使用编译后的 `dist/apps/napcat-webui-gateway/main`。

- [ ] **Step 3：写 session 生命周期测试**

创建 `test/apps/napcat-webui-gateway/session-store.spec.ts`，覆盖：

- 同一 Admin 用户 + 同一账号创建新 session 时撤销旧 session。
- heartbeat 延长 active session。
- revoked session 不允许 heartbeat。

- [ ] **Step 4：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts --runInBand
```

期望：失败，因为 Gateway 类型和 service 不存在。

- [ ] **Step 5：创建 Gateway domain types**

创建 `NapcatWebuiGatewaySessionStatus`、`NapcatWebuiGatewaySession`、`NapcatWebuiGatewaySessionStore`，字段与英文计划一致。

- [ ] **Step 6：实现 session service**

创建 `NapcatWebuiGatewaySessionService`，包含 `create`、`markActive`、`heartbeat`、`revoke`、`requireBootstrapSession`、`requireProxySession`。每个方法必须有 JSDoc。`create()` 必须撤销同用户同账号旧 session。`requireBootstrapSession()` 只接受非终态、未过期且 user/account index 仍指向当前 `sessionId` 的 session；`requireProxySession()` 只接受 `active`、未过期且 index 仍指向当前 `sessionId` 的 session。

- [ ] **Step 7：实现 Redis store 和 ticket service**

使用 `@nestjs-modules/ioredis` 的 `@InjectRedis()` 注入 Redis client，不自写 Redis provider。Redis key：

```text
napcat:webui:session:{sessionId}
napcat:webui:user-account:{adminUserId}:{accountId}
napcat:webui:ticket:{ticket}
```

ticket TTL 不超过 60 秒，redeem 时先删除 ticket 再返回 session id。

- [ ] **Step 8：增加 Gateway module 和内部 controller**

`napcat-webui-gateway.module.ts` 必须通过 `RedisModule.forRootAsync` 接入 Redis：

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'single',
        url:
          config.get<string>('NAPCAT_WEBUI_GATEWAY_REDIS_URL') ||
          `redis://${config.get<string>('NAPCAT_WEBUI_GATEWAY_REDIS_HOST') || '127.0.0.1'}:${config.get<number>('NAPCAT_WEBUI_GATEWAY_REDIS_PORT') || 6379}`,
      }),
    }),
  ],
})
export class NapcatWebuiGatewayModule {}
```

内部路径：

```text
POST /internal/sessions
POST /internal/sessions/:sessionId/heartbeat
POST /internal/sessions/:sessionId/revoke
GET /internal/health
```

所有 mutating internal call 必须校验 `x-kt-gateway-secret`。

- [ ] **Step 9：增加 Gateway bootstrap**

创建 `src/apps/napcat-webui-gateway/main.ts`，监听 `NAPCAT_WEBUI_GATEWAY_PORT || 48086`，使用 `Logger`、`json`、`urlencoded`，写明 JSDoc。

- [ ] **Step 10：运行测试和类型检查**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

期望：测试 PASS，typecheck PASS。

- [ ] **Step 11：提交 Task 3**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add package.json pnpm-lock.yaml src/apps/napcat-webui-gateway test/apps/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI Gateway会话服务"
```

---

### Task 4：增加 Credential 交换和 WebUI 代理

**Files:**
- Create: `test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts`
- Create: `src/apps/napcat-webui-gateway/presentation/public-webui.controller.ts`
- Modify: `src/apps/napcat-webui-gateway/main.ts`
- Modify: `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts`

- [ ] **Step 1：写代理重写测试**

创建 `proxy-rewrite.spec.ts`，覆盖：

- 禁止 `https://evil.test/api`。
- 禁止 `../api/auth/login`。
- `api/QQLogin/CheckLoginStatus` 规范化成 `/api/QQLogin/CheckLoginStatus`。
- `Location: /webui/login` 重写到 `/napcat-webui/session/:sessionId/webui/webui/login`。
- `buildGatewayCookiePathRewrite({ sessionId })` 返回 `http-proxy-middleware` 的 `cookiePathRewrite` 配置，把 cookie path 限定到当前 session。

- [ ] **Step 2：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts --runInBand
```

期望：失败，因为 proxy helper 不存在。

- [ ] **Step 3：实现 Credential client**

按现有 `NapcatWebuiHttpClient` 契约实现：`sha256(webuiToken + ".napcat")`，POST `/api/auth/login`，每个 session 缓存 Credential 到 revoke/expire。不要记录 token、hash 或 Credential。

- [ ] **Step 4：实现 proxy helper**

导出 `sanitizeGatewayProxyPath`、`rewriteNapcatLocationHeader`、`buildGatewayCookiePathRewrite`，逻辑与英文计划一致。Cookie path 改写交给 `http-proxy-middleware` 的 `cookiePathRewrite`，不要手写 `Set-Cookie` 字符串替换。

- [ ] **Step 5：实现 proxy service**

使用 `createProxyMiddleware`：

```ts
{
  changeOrigin: true,
  cookiePathRewrite: buildGatewayCookiePathRewrite({ sessionId }),
  on: {
    proxyReq: handleProxyReq,
    proxyReqWs: handleProxyReqWs,
    proxyRes: handleProxyRes,
  },
  pathRewrite: (_path, req) => sanitizeGatewayProxyPath(req.params[0] || ''),
  secure: false,
  ws: true,
  selfHandleResponse: false,
}
```

代理前必须通过 `sessionService.requireProxySession(sessionId)` 解析 active session，拒绝非 active、stale、终态、过期或缺失 session，换取 Credential，注入 `Authorization: Bearer <credential>`，删除浏览器传入的 API/Admin cookies，不允许浏览器改变 target。Proxy 路径不要再调用 `markActive()`；session 必须在 bootstrap redirect 前完成激活。

WebSocket upgrade 必须仍走 `http-proxy-middleware`，不能通过 MQTT 搬运 WebUI 数据帧，也不要手写 WebSocket tunnel。`NapcatWebuiProxyService` 暴露 `bindWebSocketUpgrade(server)`，内部用 HPM 的 `proxy.upgrade(req, socket, head)`；`main.ts` 在 `app.listen()` 后调用：

```ts
const server = app.getHttpServer();
app.get(NapcatWebuiProxyService).bindWebSocketUpgrade(server);
```

- [ ] **Step 6：实现公开 controller**

公开路径：

```text
GET /napcat-webui/session/:sessionId/bootstrap
ALL /napcat-webui/session/:sessionId/webui/*
```

bootstrap 兑换一次性 ticket，通过 `sessionService.requireBootstrapSession(sessionId)` 校验 bootstrap session，调用 `sessionService.markActive(sessionId)`，设置 HttpOnly session cookie，跳转到 `/napcat-webui/session/:sessionId/webui/webui`。Proxy route 委托给 `NapcatWebuiProxyService`，由该服务统一负责 path sanitize、active-only session 校验、Credential 注入、HPM `cookiePathRewrite`、HTTP proxy 和 WebSocket upgrade。

- [ ] **Step 7：运行测试和类型检查**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

期望：测试 PASS，typecheck PASS。

- [ ] **Step 8：提交 Task 4**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/apps/napcat-webui-gateway test/apps/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 代理NapCat WebUI流量"
```

---

### Task 5：接入构建、Docker、K8s 和 API Gateway env

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts`
- Create: `dockerfile.gateway`
- Modify: `Jenkinsfile`
- Modify: `k8s/prod/api.yaml`
- Modify: `README.md`
- Modify: `API.md`

- [ ] **Step 1：写部署结构测试**

创建 `gateway-deployment.spec.ts`，断言：

- `dockerfile.gateway` 包含 `dist/apps/napcat-webui-gateway/main` 和 `EXPOSE 48086`。
- `k8s/prod/api.yaml` 包含 `kt-napcat-webui-gateway`、`containerPort: 48086`、`NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET`、`NAPCAT_WEBUI_GATEWAY_REDIS_HOST`。
- `Jenkinsfile` 包含 `GATEWAY_IMAGE_NAME`、`dockerfile.gateway`、`kt-napcat-webui-gateway`。

- [ ] **Step 2：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
```

期望：失败，因为部署文件尚未接入。

- [ ] **Step 3：新增 `dockerfile.gateway`**

以现有 `dockerfile` 为基线，改：

```dockerfile
ENV APP_PORT=48086
ENV LOG_APP_NAME=kt-napcat-webui-gateway
EXPOSE 48086
CMD ["node", "dist/apps/napcat-webui-gateway/main"]
```

- [ ] **Step 4：修改 Jenkins**

新增 `GATEWAY_IMAGE_NAME` 参数，计算 `GATEWAY_DOCKER_IMAGE` 和 `GATEWAY_DOCKER_IMAGE_LATEST`，Docker Build 阶段构建 `dockerfile.gateway`，Docker Push 阶段推送 Gateway 镜像，K8s Deploy 阶段对 API 和 Gateway 两个 Deployment 分别 set image 和 rollout status。

- [ ] **Step 5：修改 K8s manifest**

在 `k8s/prod/api.yaml` 中新增 `kt-napcat-webui-gateway` Deployment/Service，容器端口 `48086`，Redis 指向 `kt-qqbot-plugin-redis:6379`，Gateway env secret 复用 `kt-template-online-api-env`。给 API Deployment 增加：

```yaml
- name: NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL
  value: http://kt-napcat-webui-gateway:48086
- name: NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL
  value: /napcat-webui
```

`NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` 只从线上私有 env secret 读取，不写入 Git。

- [ ] **Step 6：更新 README/API 文档**

记录 Gateway env、端口、公开路由、内部路由、验证命令和“浏览器不出现 token/Credential/容器端口”的验收条件。

- [ ] **Step 7：运行部署测试和构建检查**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run build
```

期望：测试 PASS，typecheck PASS，build PASS，`dist/apps/napcat-webui-gateway/main.js` 存在。

- [ ] **Step 8：提交 Task 5**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add dockerfile.gateway Jenkinsfile k8s/prod/api.yaml README.md API.md test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 部署NapCat WebUI Gateway"
```

---

### Task 6：增加 Admin API Client、路由和账号操作

**Files:**
- Modify: `apps/web-antdv-next/src/api/qqbot/napcat.ts`
- Modify: `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`
- Modify: `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`
- Modify: `apps/web-antdv-next/src/views/qqbot/account/list.tsx`
- Modify: `apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts`

- [ ] **Step 1：增加 Admin API RED 测试**

在 `napcat.spec.ts` 中测试 `createQqbotNapcatWebuiSession`、`heartbeatQqbotNapcatWebuiSession`、`revokeQqbotNapcatWebuiSession` 调用正确 URL。

- [ ] **Step 2：增加 boundary RED 测试**

在 `napcat-boundary.spec.ts` 中断言 `list.tsx` 只包含路由名 `QqBotAccountNapcatWebui`，不包含 create/heartbeat/revoke caller 和 iframe。

- [ ] **Step 3：运行 Admin 测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
```

期望：失败。

- [ ] **Step 4：增加 Admin API 函数**

在 `napcat.ts` 增加 `WebuiGatewaySession` 类型，以及 create/heartbeat/revoke 三个函数，路径分别是：

```text
/qqbot/napcat/webui/session
/qqbot/napcat/webui/session/:sessionId/heartbeat
/qqbot/napcat/webui/session/:sessionId/revoke
```

- [ ] **Step 5：增加隐藏路由**

在 `qqbot.ts` 增加：

```ts
{
  component: () => import('#/views/qqbot/account/napcat-webui'),
  meta: {
    activePath: '/qqbot/account',
    hideInMenu: true,
    title: 'NapCat WebUI',
  },
  name: 'QqBotAccountNapcatWebui',
  path: '/qqbot/account/:accountId/napcat-webui',
}
```

- [ ] **Step 6：增加账号行操作**

在 `list.tsx` 的 `rowActions` 中加入 WebUI 动作：

```ts
{
  disabled: (row) => !row.napcat?.containerName || getWebuiStatus(row) === 'offline',
  key: 'napcatWebui',
  label: 'WebUI',
  onClick: openNapcatWebui,
  permissionCodes: ['QqBot:Account:WebUI'],
}
```

`openNapcatWebui(row)` 通过 router push 到 `QqBotAccountNapcatWebui`。

- [ ] **Step 7：运行 Admin API 和 boundary 测试**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
```

期望：PASS。

- [ ] **Step 8：提交 Task 6**

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot/napcat.ts apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/router/routes/modules/qqbot.ts apps/web-antdv-next/src/views/qqbot/account/list.tsx apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加NapCat WebUI入口"
```

---

### Task 7：实现 Admin 二级页面和生命周期 composable

**Files:**
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.tsx`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.scss`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/useNapcatWebuiGatewaySession.ts`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx`

- [ ] **Step 1：写页面生命周期测试**

创建 `napcat-webui.spec.tsx`，测试 mounted 调 create session，iframe src 使用返回的 `iframeUrl`，unmount 调 revoke。

- [ ] **Step 2：运行测试确认 RED**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx
```

期望：失败，因为页面不存在。

- [ ] **Step 3：实现生命周期 composable**

创建 `useNapcatWebuiGatewaySession.ts`，状态为 `idle/loading/ready/error/revoked`。使用 Admin 已有的 `@vueuse/core` `useIntervalFn(callback, 20_000, { immediate: false })` 管理 heartbeat，不手写原生定时器。`open()` 创建 session，ready 后 `resumeHeartbeat()`；heartbeat 失败进入 error 并 `pauseHeartbeat()`；`revoke()` 先 `pauseHeartbeat()` 再调 revoke endpoint；`onBeforeUnmount` 自动 revoke。每个函数补 JSDoc。

- [ ] **Step 4：实现 route 页面**

创建 `index.tsx`：

- 单一稳定 root。
- 顶部控制栏：返回账号列表、重新打开、关闭 session、展示 selfId/container。
- `state=loading` 显示 Spin。
- `state=error/revoked` 显示 Alert 和重新打开按钮。
- `state=ready` 且有 `iframeUrl` 时显示 iframe。

- [ ] **Step 5：增加 SCSS**

创建 `index.scss`，使用 `height: var(--vben-content-height)`、`overflow: hidden`、`hsl(var(--background))`、`hsl(var(--border))`，iframe 占满剩余高度。

- [ ] **Step 6：运行 Admin 测试和 typecheck**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next run typecheck
```

期望：测试 PASS，typecheck PASS。

- [ ] **Step 7：提交 Task 7**

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/views/qqbot/account/napcat-webui
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加NapCat WebUI二级页面"
```

---

### Task 8：本地端到端 smoke

**Files:**
- 无计划内源码改动。验证发现的问题必须回到 Task 1-7 对应失败文件中修复，并在对应仓库提交。

- [ ] **Step 1：确认仓库类型和包管理器**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\.node-version
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\package.json | Select-String '"packageManager"'
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\.node-version
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\package.json | Select-String '"packageManager"'
```

期望：两个仓库都是 Git；API 使用 pnpm 9.15.9；Admin 使用 pnpm 10.28.2。

- [ ] **Step 2：运行 API 聚焦验证**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts test/apps/napcat-webui-gateway/session-store.spec.ts test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run build
```

期望：测试 PASS，typecheck PASS，build PASS。

- [ ] **Step 3：运行 Admin 聚焦验证**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next run typecheck
```

期望：测试 PASS，typecheck PASS。

- [ ] **Step 4：启动本地 API 和 Gateway**

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Node\kt-template-online-api; pnpm run start:dev *> .kt-workspace\logs\api-webui-gateway-api.log'
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Node\kt-template-online-api; pnpm run start:gateway:dev *> .kt-workspace\logs\api-webui-gateway-service.log'
```

期望：API 监听 `48085`，Gateway 监听 `48086`。

- [ ] **Step 5：本地调用 API session endpoint**

使用本地 Admin token 调用：

```powershell
curl.exe -sS -X POST "http://127.0.0.1:48085/qqbot/napcat/webui/session" -H "authorization: Bearer <local-admin-token>" -H "content-type: application/json" --data "{\"accountId\":\"<local-account-id>\"}"
```

期望：返回 `sessionId/iframeUrl/account/container`，不包含 `webuiToken`、`Credential`、`6100`、Docker/NAS 路径。

- [ ] **Step 6：本地打开 Admin 路由**

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Vue\kt-template-admin; pnpm -F @vben/web-antdv-next run dev *> .kt-workspace\logs\admin-webui-gateway.log'
```

打开：

```text
http://127.0.0.1:5999/#/qqbot/account/<local-account-id>/napcat-webui
```

期望：二级页面渲染，创建 session，iframe shell 加载，返回账号列表时 revoke。

- [ ] **Step 7：清理本地进程**

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*kt-template-online-api*start:dev*' -or $_.CommandLine -like '*kt-template-online-api*start:gateway:dev*' -or $_.CommandLine -like '*kt-template-admin*web-antdv-next*dev*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

- [ ] **Step 8：提交验证修复**

验证过程若发现缺陷，分别提交 API/Admin 仓库，只提交本功能相关文件。

---

### Task 9：文档、Review、Push、部署和线上闭环

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1：更新 `TASKS.md`**

记录范围、关键词和验证证据：API Gateway service、Admin WebUI 二级页面、K8s/Jenkins Gateway 发布、`/qqbot/account/:accountId/napcat-webui`、route-bound session、heartbeat/revoke、完整 WebUI 操作、token/Credential 不下发浏览器。

- [ ] **Step 2：运行最终本地门禁**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
git -C D:\MyFiles\KT\Vue\kt-template-admin diff --check
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --changed-files <comma-separated-api-files>
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project admin --changed-files <comma-separated-admin-files>
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

期望：diff check PASS，global-review findings=[]，cleanup dry-run deleted=[]。

- [ ] **Step 3：提交剩余文档**

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录NapCat WebUI Gateway实施"
```

- [ ] **Step 4：用户明确要求后再 push**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api push origin main
git -C D:\MyFiles\KT\Vue\kt-template-admin push origin main
```

- [ ] **Step 5：观察 Jenkins/K8s**

API 仍用 deploy observation：

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --commit <api-commit> --execute
```

Gateway 用 NAS 只读命令补充验证：

```powershell
$script = @'
set -eu
KUBECONFIG_PATH='/vol1/docker/kt-k8s/kubeconfig/kt-nas.jenkins.yaml'
kubectl --kubeconfig "$KUBECONFIG_PATH" -n kt-prod get deployment kt-napcat-webui-gateway -o wide
kubectl --kubeconfig "$KUBECONFIG_PATH" -n kt-prod get pod -l app=kt-napcat-webui-gateway
kubectl --kubeconfig "$KUBECONFIG_PATH" -n kt-prod logs -l app=kt-napcat-webui-gateway --tail=80
'@
$script | ssh nas "tr -d '\015' | bash -s"
```

期望：API/Gateway Running/Ready，restartCount 0，Gateway 镜像 tag 与 Jenkins build 匹配。

- [ ] **Step 6：配置 Caddy/Admin 路由**

按稳定 Caddy 规则备份 `/opt/nas-gateway/caddy/Caddyfile`，加入 `/napcat-webui/*` 到 Gateway 的反代，执行 `caddy validate` 和 reload，再验证：

```powershell
curl.exe -I https://admin.kwitsukasa.top/napcat-webui/
```

期望：公网路由能到 Gateway，响应不暴露 upstream host。

- [ ] **Step 7：线上功能 smoke**

打开：

```text
https://admin.kwitsukasa.top/#/qqbot/account
```

对账号 `1914728559`：

1. 点击 `WebUI`。
2. 确认路由进入 `/#/qqbot/account/<account-id>/napcat-webui`。
3. 确认 iframe 加载原版 NapCat WebUI。
4. 执行安全 WebUI 操作，例如读取登录状态或打开设置页。
5. 确认浏览器 URL 不包含 `webuiToken`、`Credential`、`6100`、容器 IP、NAS 路径或 SSH 路由。
6. 返回账号列表。
7. 验证 Gateway 日志或审计表出现 revoke 或 heartbeat timeout cleanup。

- [ ] **Step 8：最终报告**

报告 API commit、Admin commit、root TASKS commit、测试/typecheck/build 证据、Jenkins/K8s 证据、线上 smoke 证据和剩余 blocker。

---

## 自检

- 覆盖设计：已覆盖账号行入口、二级路由、页面生命周期 session、独立 Gateway、完整 WebUI 操作、浏览器不泄漏 token/Credential、Redis session、MySQL 审计、K8s/Jenkins 部署和线上 smoke。
- 禁止词扫描：计划正文没有保留禁止词或跨任务简写。
- 类型一致性：统一使用 `QqBot:Account:WebUI`、`/qqbot/napcat/webui/session`、`/napcat-webui/session/:sessionId`、`kt-napcat-webui-gateway`、`48086`、`QqbotNapcatWebuiGatewayService`。

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-06-24-qqbot-napcat-webui-gateway-implementation-plan.zh-CN.md`。

两个执行选项：

1. **Subagent-Driven（推荐）**：每个任务派一个新 subagent，任务之间主线程 review，迭代更快。
2. **Inline Execution**：在当前会话用 executing-plans 执行，按批次检查。

你选哪个？
