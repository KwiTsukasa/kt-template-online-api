# QQBot NapCat WebUI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent NapCat WebUI Gateway service and an Admin second-level route that opens the selected QQBot account's original NapCat WebUI with full operation capability and route-bound session cleanup.

**Architecture:** The API service remains the Admin-authenticated authority that resolves a QQBot account to its active NapCat container and requests a short-lived Gateway session. The new `kt-napcat-webui-gateway` process owns session storage, one-time bootstrap tickets, NapCat WebUI credential exchange, HTTP/static/API/WebSocket proxying, and audit events. Admin opens `/qqbot/account/:accountId/napcat-webui`, creates a route-bound session, heartbeats while mounted, and revokes on route leave.

**Tech Stack:** NestJS 11, Express adapter, TypeORM/MySQL, Redis through `@nestjs-modules/ioredis` + `ioredis`, `http-proxy-middleware` for Express/WebSocket proxying, Vue 3 TSX, VueUse `useIntervalFn`, Vben Admin, antdv-next, K8s, Jenkins, Caddy/Admin domain route.

---

## Source References

- Spec: `docs/superpowers/specs/2026-06-24-qqbot-napcat-webui-gateway-design.md`
- Chinese spec: `docs/superpowers/specs/2026-06-24-qqbot-napcat-webui-gateway-design.zh-CN.md`
- `http-proxy-middleware` supports Express proxy middleware and WebSocket upgrades through `ws: true` and upgrade handling: <https://github.com/chimurai/http-proxy-middleware>
- `http-proxy-middleware` WebSocket recipe documents `ws: true`, manual `server.on('upgrade', proxy.upgrade)`, multiple targets, and path rewriting: <https://github.com/chimurai/http-proxy-middleware/blob/master/recipes/websocket.md>
- `@nestjs-modules/ioredis` provides Nest `RedisModule.forRoot` and `@InjectRedis()` over `ioredis`: <https://github.com/nest-modules/ioredis>
- `connect-redis` is intentionally not used because it is an Express session store, while this Gateway needs API-created sessions, one-time tickets, target metadata, concurrent-session revocation, Credential cache, and audit events: <https://github.com/tj/connect-redis>
- VueUse `useIntervalFn` wraps `setInterval` with pause/resume controls and is already available in Admin: <https://vueuse.org/shared/useintervalfn/>

## Scope Check

This is one deployable workstream even though it spans API, Gateway, Admin, and deployment files. The pieces are not independently useful: Admin cannot load a WebUI route without API session creation, API session creation cannot pass online smoke without Gateway, and Gateway cannot be safely exposed without the route lifecycle and deploy route.

## File Structure

### API repository: `D:\MyFiles\KT\Node\kt-template-online-api`

- Modify `package.json` and `pnpm-lock.yaml`: add `@nestjs-modules/ioredis`, `ioredis`, and `http-proxy-middleware`, plus gateway start scripts.
- Create `src/apps/napcat-webui-gateway/main.ts`: standalone Nest bootstrap on port `48086`.
- Create `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts`: Gateway module imports config, logger, TypeORM, `RedisModule`, and gateway providers/controllers.
- Create `src/apps/napcat-webui-gateway/config/napcat-webui-gateway-config.service.ts`: reads Gateway env with bounded defaults.
- Create `src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types.ts`: session, audit, target, and proxy types.
- Create `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-redis.store.ts`: Redis-backed session and ticket store.
- Create `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service.ts`: one-time bootstrap ticket generation and redemption.
- Create `src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client.ts`: server-side WebUI token to Credential exchange.
- Create `src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts`: HTTP, header, redirect, cookie, and WebSocket proxy assembly.
- Create `src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service.ts`: session create, active mark, heartbeat, revoke, expire, and concurrent-session policy.
- Create `src/apps/napcat-webui-gateway/presentation/internal-session.controller.ts`: internal service-to-service session API.
- Create `src/apps/napcat-webui-gateway/presentation/public-webui.controller.ts`: bootstrap and public iframe/proxy entry.
- Create `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`: Admin-facing DTOs.
- Create `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller.ts`: Admin endpoints under `/qqbot/napcat/webui`.
- Create `src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service.ts`: account authorization, target resolution, and Gateway client orchestration.
- Create `src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client.ts`: internal Gateway HTTP client.
- Create `src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity.ts`: MySQL audit entity.
- Modify `src/modules/qqbot/napcat/qqbot-napcat.module.ts`: register controller, service, client, and audit entity.
- Modify `sql/qqbot-init.sql` and `sql/refactor-v3/01-seed-core.sql`: add `QqBot:Account:WebUI` hidden route/menu and row-action permission.
- Modify `sql/refactor-v3/99-verify.sql`: assert the new permission and audit table exist.
- Create `dockerfile.gateway`: production image entry for `dist/apps/napcat-webui-gateway/main`.
- Modify `Jenkinsfile`: build, push, and deploy API image plus Gateway image.
- Modify `k8s/prod/api.yaml`: add Gateway Deployment/Service and API env for Gateway base URL/public base URL/internal secret.
- Modify `README.md` and `API.md`: document Gateway env, route, and validation commands.

### Admin repository: `D:\MyFiles\KT\Vue\kt-template-admin`

- Modify `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`: add hidden second-level WebUI route.
- Modify `apps/web-antdv-next/src/api/qqbot/napcat.ts`: add WebUI session contracts and callers.
- Modify `apps/web-antdv-next/src/views/qqbot/account/list.tsx`: add WebUI row action.
- Create `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.tsx`: remote console page.
- Create `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.scss`: layout and theme-aware console styles.
- Create `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/useNapcatWebuiGatewaySession.ts`: route-bound session lifecycle.
- Modify `apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts`: keep WebUI session code out of account list.
- Create `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx`: page lifecycle tests.
- Modify `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`: WebUI session caller tests.

---

### Task 1: Add Contracts, Permission Seeds, and Red Tests

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts`
- Modify: `sql/qqbot-init.sql`
- Modify: `sql/refactor-v3/01-seed-core.sql`
- Modify: `sql/refactor-v3/99-verify.sql`

- [ ] **Step 1: Write the failing structural test**

Create `test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts`:

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

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
```

Expected: FAIL because `QqBot:Account:WebUI` and `qqbot_napcat_webui_gateway_audit` are not present.

- [ ] **Step 3: Add SQL seed rows**

Add these rows next to existing QQBot account rows in both `sql/qqbot-init.sql` and `sql/refactor-v3/01-seed-core.sql`:

```sql
(2041700000000100412, 2041700000000100400, 'QqBotAccountNapcatWebui', '/qqbot/account/:accountId/napcat-webui', '/qqbot/account/napcat-webui/index', NULL, 'QqBot:Account:WebUI', 'menu', '{"activePath":"/qqbot/account","hideInMenu":true,"title":"NapCat WebUI"}', 1, 0),
(2041700000000120407, 2041700000000100402, 'QqBotAccountWebUI', NULL, NULL, NULL, 'QqBot:Account:WebUI', 'button', '{"title":"NapCat WebUI"}', 1, 0),
```

Keep IDs unique and do not modify unrelated menu rows.

- [ ] **Step 4: Add schema verification SQL**

In `sql/refactor-v3/99-verify.sql`, add assertions using the existing verify style:

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

The current menu table is `admin_menu`, and the permission column is `auth_code`; use those exact names in the verification SQL.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts sql/qqbot-init.sql sql/refactor-v3/01-seed-core.sql sql/refactor-v3/99-verify.sql
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI权限契约"
```

---

### Task 2: Build API Session Endpoints and Audit Entity

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client.ts`
- Create: `src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity.ts`
- Modify: `src/modules/qqbot/napcat/qqbot-napcat.module.ts`
- Modify: `src/modules/qqbot/napcat/infrastructure/persistence/index.ts`

- [ ] **Step 1: Write the failing API service test**

Create `test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts`:

```ts
import { QqbotNapcatWebuiGatewayService } from '../../../../src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service';

const account = {
  id: 'account-1',
  name: 'Mirror',
  selfId: '1914728559',
};

const redactedWebuiToken = ['redacted', 'webui', 'token'].join('-');

const container = {
  id: 'container-1',
  name: 'kt-qqbot-napcat-1',
  webuiPort: 6100,
  webuiStatus: 'online',
  webuiToken: redactedWebuiToken,
};

describe('QqbotNapcatWebuiGatewayService', () => {
  it('creates a safe Admin session response without leaking NapCat secrets', async () => {
    const service = new QqbotNapcatWebuiGatewayService(
      { findById: jest.fn().mockResolvedValue(account) } as any,
      { findPrimaryContainerByAccountId: jest.fn().mockResolvedValue(container) } as any,
      {
        createSession: jest.fn().mockResolvedValue({
          expiresAt: 1782268000000,
          iframeUrl: '/napcat-webui/session/session-1/bootstrap?ticket=ticket-1',
          sessionId: 'session-1',
        }),
        heartbeat: jest.fn(),
        revoke: jest.fn(),
      } as any,
      { record: jest.fn() } as any,
    );

    const result = await service.createSession({
      accountId: 'account-1',
      adminUserId: '2041700000000000002',
      clientIp: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result).toMatchObject({
      account: { id: 'account-1', selfId: '1914728559' },
      container: {
        id: 'container-1',
        name: 'kt-qqbot-napcat-1',
        webuiStatus: 'online',
      },
      iframeUrl: '/napcat-webui/session/session-1/bootstrap?ticket=ticket-1',
      sessionId: 'session-1',
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('6100');
  });

  it('rejects accounts without an online WebUI target before calling Gateway', async () => {
    const gatewayClient = { createSession: jest.fn() };
    const service = new QqbotNapcatWebuiGatewayService(
      { findById: jest.fn().mockResolvedValue(account) } as any,
      {
        findPrimaryContainerByAccountId: jest
          .fn()
          .mockResolvedValue({ ...container, webuiStatus: 'offline' }),
      } as any,
      gatewayClient as any,
      { record: jest.fn() } as any,
    );

    await expect(
      service.createSession({
        accountId: 'account-1',
        adminUserId: '2041700000000000002',
        clientIp: '127.0.0.1',
        userAgent: 'vitest',
      }),
    ).rejects.toThrow('NapCat WebUI 不在线');
    expect(gatewayClient.createSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the service test and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts --runInBand
```

Expected: FAIL because the service and DTOs do not exist.

- [ ] **Step 3: Create DTOs**

Create `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class QqbotNapcatWebuiSessionCreateDto {
  @ApiProperty({ description: 'QQBot account id selected from the account list' })
  accountId!: string;
}

export class QqbotNapcatWebuiSessionResponseDto {
  account!: {
    id: string;
    name?: string;
    selfId: string;
  };
  container!: {
    id: string;
    name: string;
    webuiStatus: string;
  };
  expiresAt!: number;
  iframeUrl!: string;
  sessionId!: string;
}
```

- [ ] **Step 4: Create the audit entity**

Create `src/modules/qqbot/napcat/webui-gateway/infrastructure/persistence/napcat-webui-gateway-audit.entity.ts`:

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { KtCreateDateColumn, KtDateTime } from '@/common';

@Entity('qqbot_napcat_webui_gateway_audit')
export class NapcatWebuiGatewayAudit {
  @PrimaryColumn({ length: 32 })
  id!: string;

  @Column({ length: 64, name: 'session_id' })
  sessionId!: string;

  @Column({ length: 32, name: 'admin_user_id' })
  adminUserId!: string;

  @Column({ length: 32, name: 'account_id' })
  accountId!: string;

  @Column({ length: 32, name: 'self_id' })
  selfId!: string;

  @Column({ length: 32, name: 'container_id' })
  containerId!: string;

  @Column({ length: 64, name: 'event_type' })
  eventType!: string;

  @Column({ length: 128, name: 'client_ip', nullable: true })
  clientIp?: null | string;

  @Column({ length: 512, name: 'user_agent', nullable: true })
  userAgent?: null | string;

  @Column({ name: 'detail_json', nullable: true, type: 'json' })
  detailJson?: null | Record<string, unknown>;

  @KtCreateDateColumn()
  createTime!: KtDateTime;
}
```

Use the existing ID generation helper used by nearby services when recording rows.

- [ ] **Step 5: Create the Gateway internal client**

Create `src/modules/qqbot/napcat/webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client.ts` with methods:

```ts
export interface CreateGatewaySessionInput {
  accountId: string;
  adminUserId: string;
  clientIp?: string;
  containerId: string;
  containerName: string;
  selfId: string;
  upstreamBaseUrl: string;
  userAgent?: string;
  webuiToken: string;
}

export interface CreateGatewaySessionResult {
  expiresAt: number;
  iframeUrl: string;
  sessionId: string;
}

export class QqbotNapcatWebuiGatewayClient {
  /**
   * Creates a Gateway session through the internal service endpoint.
   * @param input Account, container, and server-side WebUI credential material resolved by API.
   * @returns The browser-safe iframe URL and session lifetime returned by Gateway.
   */
  async createSession(
    input: CreateGatewaySessionInput,
  ): Promise<CreateGatewaySessionResult> {
    // Implement with axios or Node fetch using NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL
    // and NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET. Do not log webuiToken.
    throw new Error('NapCat WebUI Gateway client not implemented');
  }

  /**
   * Forwards a route-bound heartbeat to Gateway.
   * @param sessionId Gateway session id returned to Admin.
   * @returns Updated session lifetime.
   */
  async heartbeat(sessionId: string) {
    throw new Error('NapCat WebUI Gateway heartbeat not implemented');
  }

  /**
   * Revokes an active Gateway session.
   * @param sessionId Gateway session id returned to Admin.
   */
  async revoke(sessionId: string) {
    throw new Error('NapCat WebUI Gateway revoke not implemented');
  }
}
```

Replace the throwing bodies in the implementation step with bounded HTTP calls and sanitized errors.

- [ ] **Step 6: Create the API service**

Create `src/modules/qqbot/napcat/webui-gateway/application/qqbot-napcat-webui-gateway.service.ts` with these public methods:

```ts
export interface CreateAdminWebuiSessionInput {
  accountId: string;
  adminUserId: string;
  clientIp?: string;
  userAgent?: string;
}

export class QqbotNapcatWebuiGatewayService {
  /**
   * Creates a browser-safe NapCat WebUI Gateway session for one QQBot account.
   * @param input Admin user id, selected account id, and client evidence for audit.
   * @returns Safe session metadata for Admin route iframe loading.
   */
  async createSession(input: CreateAdminWebuiSessionInput) {
    const account = await this.accountService.findById(input.accountId);
    if (!account) throw new Error('QQBot 账号不存在');

    const container =
      await this.napcatRuntimeService.findPrimaryContainerByAccountId(
        input.accountId,
      );
    if (!container) throw new Error('账号未绑定 NapCat 容器');
    if (container.webuiStatus === 'offline') {
      throw new Error('NapCat WebUI 不在线');
    }
    if (!container.webuiToken || !container.webuiPort) {
      throw new Error('NapCat WebUI 配置不完整');
    }

    const gateway = await this.gatewayClient.createSession({
      accountId: account.id,
      adminUserId: input.adminUserId,
      clientIp: input.clientIp,
      containerId: container.id,
      containerName: container.name,
      selfId: account.selfId,
      upstreamBaseUrl: this.buildContainerWebuiUrl(container.webuiPort),
      userAgent: input.userAgent,
      webuiToken: container.webuiToken,
    });

    return {
      account: { id: account.id, name: account.name, selfId: account.selfId },
      container: {
        id: container.id,
        name: container.name,
        webuiStatus: container.webuiStatus || 'unknown',
      },
      ...gateway,
    };
  }
}
```

Add `findPrimaryContainerByAccountId(accountId: string)` to `QqbotNapcatContainerService` with JSDoc and a focused unit test, then use that method from `QqbotNapcatWebuiGatewayService`.

- [ ] **Step 7: Create the API controller**

Create `src/modules/qqbot/napcat/webui-gateway/contract/qqbot-napcat-webui-gateway.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { vbenSuccess } from '@/common';
import { QqbotNapcatWebuiGatewayService } from '../application/qqbot-napcat-webui-gateway.service';
import { QqbotNapcatWebuiSessionCreateDto } from './qqbot-napcat-webui-gateway.dto';

@ApiTags('QQBot - NapCat WebUI Gateway')
@Controller('qqbot/napcat/webui')
@UseGuards(JwtAuthGuard)
export class QqbotNapcatWebuiGatewayController {
  /**
   * Initializes the Admin-facing NapCat WebUI Gateway controller.
   * @param service Gateway session application service.
   */
  constructor(private readonly service: QqbotNapcatWebuiGatewayService) {}

  /**
   * Creates one route-bound NapCat WebUI session.
   * @param body Selected QQBot account id from Admin.
   * @param req Authenticated request carrying Admin user and client evidence.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建 NapCat WebUI Gateway 会话' })
  async createSession(@Body() body: QqbotNapcatWebuiSessionCreateDto, @Req() req: any) {
    return vbenSuccess(
      await this.service.createSession({
        accountId: body.accountId,
        adminUserId: `${req.user?.sub || req.user?.id || ''}`,
        clientIp: req.ip,
        userAgent: req.headers?.['user-agent'],
      }),
    );
  }

  @Post('session/:sessionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Param('sessionId') sessionId: string) {
    return vbenSuccess(await this.service.heartbeat(sessionId));
  }

  @Post('session/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('sessionId') sessionId: string) {
    return vbenSuccess(await this.service.revoke(sessionId));
  }
}
```

- [ ] **Step 8: Register providers and entities**

Modify `src/modules/qqbot/napcat/qqbot-napcat.module.ts` to include:

```ts
import { QqbotNapcatWebuiGatewayController } from './webui-gateway/contract/qqbot-napcat-webui-gateway.controller';
import { QqbotNapcatWebuiGatewayService } from './webui-gateway/application/qqbot-napcat-webui-gateway.service';
import { QqbotNapcatWebuiGatewayClient } from './webui-gateway/infrastructure/qqbot-napcat-webui-gateway.client';
```

Add the controller to `QQBOT_NAPCAT_CONTROLLERS` and the service/client to `QQBOT_NAPCAT_PROVIDERS`.

Modify `src/modules/qqbot/napcat/infrastructure/persistence/index.ts` to include `NapcatWebuiGatewayAudit` in `NAPCAT_RUNTIME_ENTITIES` and add `qqbot_napcat_webui_gateway_audit` to `NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables`.

- [ ] **Step 9: Run API tests and typecheck**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 10: Commit Task 2**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/modules/qqbot/napcat/webui-gateway src/modules/qqbot/napcat/qqbot-napcat.module.ts src/modules/qqbot/napcat/infrastructure/persistence/index.ts test/modules/qqbot/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI会话接口"
```

---

### Task 3: Build Gateway App, Session Store, and Bootstrap Tickets

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

- [ ] **Step 1: Add dependencies**

Run:

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api add @nestjs-modules/ioredis ioredis http-proxy-middleware
```

Expected: `package.json` and `pnpm-lock.yaml` update. Keep `ws` unchanged because it already exists. Do not add `connect-redis` because Gateway sessions are domain sessions, not Express login sessions.

- [ ] **Step 2: Add package scripts**

Modify `package.json` scripts:

```json
{
  "start:gateway:prod": "cross-env NODE_ENV=production node dist/apps/napcat-webui-gateway/main",
  "start:gateway:dev": "ts-node -r tsconfig-paths/register src/apps/napcat-webui-gateway/main.ts"
}
```

The API repo already depends on `ts-node` and `tsconfig-paths`, so the dev script uses the direct TypeScript entrypoint and the production script keeps the compiled `dist/apps/napcat-webui-gateway/main` entrypoint.

- [ ] **Step 3: Write the failing session lifecycle test**

Create `test/apps/napcat-webui-gateway/session-store.spec.ts`:

```ts
import { NapcatWebuiGatewaySessionService } from '../../../src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service';
import type { NapcatWebuiGatewaySessionStore } from '../../../src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types';

class MemoryStore implements NapcatWebuiGatewaySessionStore {
  readonly sessions = new Map<string, any>();

  async create(session: any) {
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async find(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async findActiveByUserAndAccount(adminUserId: string, accountId: string) {
    return [...this.sessions.values()].find(
      (item) =>
        item.adminUserId === adminUserId &&
        item.accountId === accountId &&
        item.status !== 'revoked',
    );
  }

  async update(sessionId: string, patch: any) {
    const current = this.sessions.get(sessionId);
    const next = { ...current, ...patch };
    this.sessions.set(sessionId, next);
    return next;
  }
}

describe('NapcatWebuiGatewaySessionService', () => {
  it('revokes an older same-user same-account session when creating a new one', async () => {
    const store = new MemoryStore();
    const service = new NapcatWebuiGatewaySessionService(store as any, {
      now: () => 1000,
      ttlMs: () => 60000,
    } as any);

    const first = await service.create({
      accountId: 'account-1',
      adminUserId: 'admin-1',
      containerId: 'container-1',
      containerName: 'container',
      selfId: '1914728559',
      upstreamBaseUrl: 'http://127.0.0.1:6100',
      webuiToken: ['redacted', 'webui', 'token'].join('-'),
    });
    const second = await service.create({
      accountId: 'account-1',
      adminUserId: 'admin-1',
      containerId: 'container-1',
      containerName: 'container',
      selfId: '1914728559',
      upstreamBaseUrl: 'http://127.0.0.1:6100',
      webuiToken: ['redacted', 'webui', 'token'].join('-'),
    });

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await store.find(first.sessionId)).toMatchObject({
      status: 'revoked',
    });
    expect(await store.find(second.sessionId)).toMatchObject({
      status: 'created',
    });
  });

  it('extends active sessions on heartbeat and rejects revoked sessions', async () => {
    const store = new MemoryStore();
    let now = 1000;
    const service = new NapcatWebuiGatewaySessionService(store as any, {
      now: () => now,
      ttlMs: () => 60000,
    } as any);

    const session = await service.create({
      accountId: 'account-1',
      adminUserId: 'admin-1',
      containerId: 'container-1',
      containerName: 'container',
      selfId: '1914728559',
      upstreamBaseUrl: 'http://127.0.0.1:6100',
      webuiToken: ['redacted', 'webui', 'token'].join('-'),
    });

    now = 5000;
    await service.markActive(session.sessionId);
    const heartbeat = await service.heartbeat(session.sessionId);
    expect(heartbeat).toMatchObject({
      sessionId: session.sessionId,
      status: 'active',
    });
    expect(heartbeat.expiresAt).toBe(65000);

    await service.revoke(session.sessionId);
    await expect(service.heartbeat(session.sessionId)).rejects.toThrow(
      'Gateway session is not active',
    );
  });
});
```

- [ ] **Step 4: Run the test and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts --runInBand
```

Expected: FAIL because Gateway app types and service do not exist.

- [ ] **Step 5: Create Gateway domain types**

Create `src/apps/napcat-webui-gateway/domain/napcat-webui-gateway.types.ts`:

```ts
export type NapcatWebuiGatewaySessionStatus =
  | 'active'
  | 'created'
  | 'expired'
  | 'failed'
  | 'revoked';

export interface NapcatWebuiGatewaySession {
  accountId: string;
  activeAt?: number;
  adminUserId: string;
  clientIp?: string;
  containerId: string;
  containerName: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  selfId: string;
  sessionId: string;
  status: NapcatWebuiGatewaySessionStatus;
  upstreamBaseUrl: string;
  userAgent?: string;
  webuiToken: string;
}

export interface NapcatWebuiGatewaySessionStore {
  create(session: NapcatWebuiGatewaySession): Promise<NapcatWebuiGatewaySession>;
  find(sessionId: string): Promise<NapcatWebuiGatewaySession | undefined>;
  findActiveByUserAndAccount(
    adminUserId: string,
    accountId: string,
  ): Promise<NapcatWebuiGatewaySession | undefined>;
  update(
    sessionId: string,
    patch: Partial<NapcatWebuiGatewaySession>,
  ): Promise<NapcatWebuiGatewaySession>;
}
```

- [ ] **Step 6: Implement session service**

Create `src/apps/napcat-webui-gateway/application/napcat-webui-gateway-session.service.ts` with `create`, `markActive`, `heartbeat`, `revoke`, `requireBootstrapSession`, and `requireProxySession`. Every method needs JSDoc. Use `crypto.randomUUID()` for `sessionId`.

The `create()` implementation must:

```ts
const older = await this.store.findActiveByUserAndAccount(
  input.adminUserId,
  input.accountId,
);
if (older) {
  await this.store.update(older.sessionId, {
    revokedAt: now,
    status: 'revoked',
  });
}
```

The `heartbeat()` implementation must extend active sessions only. It must reject `created`, `revoked`, `expired`, `failed`, missing sessions, and sessions whose user/account index no longer points at the requested `sessionId`. `requireBootstrapSession()` accepts only non-terminal, non-expired, currently indexed sessions for one-time ticket bootstrap. `markActive()` is the only method that may promote a `created` session to `active`. `requireProxySession()` accepts only `active`, non-expired, currently indexed sessions.

- [ ] **Step 7: Implement Redis store and ticket service**

Create `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-redis.store.ts`. Inject Redis through `@nestjs-modules/ioredis`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';

@Injectable()
export class NapcatWebuiGatewayRedisStore
  implements NapcatWebuiGatewaySessionStore
{
  /**
   * Initializes the Redis-backed Gateway session store.
   * @param redis Shared Gateway Redis client managed by Nest RedisModule.
   */
  constructor(@InjectRedis() private readonly redis: Redis) {}
}
```

Use Redis `set(key, value, 'PX', ttlMs)`, `get`, and a secondary index key:

```text
napcat:webui:session:{sessionId}
napcat:webui:user-account:{adminUserId}:{accountId}
```

Create `src/apps/napcat-webui-gateway/infrastructure/session/napcat-webui-gateway-ticket.service.ts`. Ticket keys:

```text
napcat:webui:ticket:{ticket}
```

Ticket TTL must be 60 seconds or less. Redemption deletes the ticket key before returning the session id.

- [ ] **Step 8: Add Gateway module and internal controller**

Create `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts` and `presentation/internal-session.controller.ts`. The module must use the community Redis module rather than a custom Redis provider:

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

Internal controller paths:

```text
POST /internal/sessions
POST /internal/sessions/:sessionId/heartbeat
POST /internal/sessions/:sessionId/revoke
GET /internal/health
```

Check the `x-kt-gateway-secret` header against `NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` before accepting mutating internal calls.

- [ ] **Step 9: Add Gateway bootstrap**

Create `src/apps/napcat-webui-gateway/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { json, urlencoded } from 'express';
import { NapcatWebuiGatewayModule } from './napcat-webui-gateway.module';

/**
 * Starts the standalone NapCat WebUI Gateway process.
 */
async function bootstrap() {
  const app = await NestFactory.create(NapcatWebuiGatewayModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  await app.listen(Number(process.env.NAPCAT_WEBUI_GATEWAY_PORT || 48086));
}

bootstrap();
```

- [ ] **Step 10: Run Gateway session tests and typecheck**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 11: Commit Task 3**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add package.json pnpm-lock.yaml src/apps/napcat-webui-gateway test/apps/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 增加NapCat WebUI Gateway会话服务"
```

---

### Task 4: Add Gateway Credential Exchange and Proxy

**Files:**
- Create: `test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client.ts`
- Create: `src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts`
- Create: `src/apps/napcat-webui-gateway/presentation/public-webui.controller.ts`
- Modify: `src/apps/napcat-webui-gateway/main.ts`
- Modify: `src/apps/napcat-webui-gateway/napcat-webui-gateway.module.ts`

- [ ] **Step 1: Write proxy rewrite tests**

Create `test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts`:

```ts
import {
  buildGatewayCookiePathRewrite,
  rewriteNapcatLocationHeader,
  sanitizeGatewayProxyPath,
} from '../../../src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service';

describe('NapCat WebUI Gateway proxy rewriting', () => {
  it('rejects upstream URL injection and path traversal', () => {
    expect(() => sanitizeGatewayProxyPath('https://evil.test/api')).toThrow(
      'Invalid NapCat WebUI proxy path',
    );
    expect(() => sanitizeGatewayProxyPath('../api/auth/login')).toThrow(
      'Invalid NapCat WebUI proxy path',
    );
    expect(sanitizeGatewayProxyPath('api/QQLogin/CheckLoginStatus')).toBe(
      '/api/QQLogin/CheckLoginStatus',
    );
  });

  it('rewrites redirects under the session proxy prefix', () => {
    expect(
      rewriteNapcatLocationHeader('/webui/login', {
        sessionId: 'session-1',
      }),
    ).toBe('/napcat-webui/session/session-1/webui/webui/login');
  });

  it('delegates cookie path rewriting to http-proxy-middleware options', () => {
    expect(buildGatewayCookiePathRewrite({ sessionId: 'session-1' })).toEqual({
      '*': '/napcat-webui/session/session-1',
    });
  });
});
```

- [ ] **Step 2: Run proxy test and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts --runInBand
```

Expected: FAIL because proxy helpers do not exist.

- [ ] **Step 3: Implement credential client**

Create `src/apps/napcat-webui-gateway/infrastructure/napcat-webui-credential.client.ts`. Use the same NapCat WebUI contract as `NapcatWebuiHttpClient`: hash `webuiToken + ".napcat"`, POST `/api/auth/login`, and cache Credential per session until session revoke/expire.

Do not log `webuiToken`, hash, or Credential.

- [ ] **Step 4: Implement proxy helpers**

Create pure helper exports in `src/apps/napcat-webui-gateway/infrastructure/proxy/napcat-webui-proxy.service.ts`. Keep cookie rewriting as a `http-proxy-middleware` option instead of rewriting `Set-Cookie` by hand:

```ts
export function sanitizeGatewayProxyPath(rawPath: string): string {
  const decoded = decodeURIComponent(rawPath || '');
  if (/^https?:\/\//i.test(decoded) || decoded.includes('..')) {
    throw new Error('Invalid NapCat WebUI proxy path');
  }
  return `/${decoded.replace(/^\/+/, '')}`;
}

export function rewriteNapcatLocationHeader(
  location: string,
  input: { sessionId: string },
) {
  if (/^https?:\/\//i.test(location)) return location;
  return `/napcat-webui/session/${input.sessionId}/webui/${location.replace(/^\/+/, '')}`;
}

export function buildGatewayCookiePathRewrite(input: { sessionId: string }) {
  return {
    '*': `/napcat-webui/session/${input.sessionId}`,
  };
}
```

- [ ] **Step 5: Implement proxy service**

Use `createProxyMiddleware` from `http-proxy-middleware` with:

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

Before proxying:

- resolve an active session by `sessionId` through `sessionService.requireProxySession(sessionId)`;
- reject non-active, stale, terminal, expired, or missing sessions with 410;
- redeem Credential through `NapcatWebuiCredentialClient`;
- add `Authorization: Bearer ${credential}` upstream;
- never forward API/Admin cookies upstream;
- never allow the browser to override `target`.

Do not mark sessions active from the proxy path; bootstrap activates the session before redirecting into the proxied WebUI.

For WebSocket upgrade, do not tunnel frames through MQTT and do not hand-roll a WebSocket bridge. Expose a method on `NapcatWebuiProxyService` and bind HPM's upgrade handler from `main.ts`:

```ts
/**
 * Binds NapCat WebUI WebSocket upgrades to the same proxy middleware.
 * @param server HTTP server created by Nest's Express adapter.
 */
bindWebSocketUpgrade(server: import('http').Server) {
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/napcat-webui/session/')) return;
    this.proxy.upgrade(req, socket, head);
  });
}
```

Modify `src/apps/napcat-webui-gateway/main.ts` after `app.listen()`:

```ts
  const server = app.getHttpServer();
  app.get(NapcatWebuiProxyService).bindWebSocketUpgrade(server);
```

- [ ] **Step 6: Implement public controller**

Create `src/apps/napcat-webui-gateway/presentation/public-webui.controller.ts`:

```text
GET /napcat-webui/session/:sessionId/bootstrap
ALL /napcat-webui/session/:sessionId/webui/*
```

Bootstrap must redeem `ticket`, validate the redeemed session through `sessionService.requireBootstrapSession(sessionId)`, call `sessionService.markActive(sessionId)`, set an HttpOnly gateway cookie scoped to `/napcat-webui/session/:sessionId`, and redirect to `/napcat-webui/session/:sessionId/webui/webui`.

Proxy route delegates to `NapcatWebuiProxyService`. The proxy service remains responsible for path sanitization, active-only session validation, Credential injection, HPM `cookiePathRewrite`, HPM HTTP proxying, and HPM WebSocket upgrade handling.

- [ ] **Step 7: Run tests and typecheck**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/apps/napcat-webui-gateway/session-store.spec.ts test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add src/apps/napcat-webui-gateway test/apps/napcat-webui-gateway
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 代理NapCat WebUI流量"
```

---

### Task 5: Wire Build, Docker, K8s, and API Gateway Env

**Files:**
- Create: `test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts`
- Create: `dockerfile.gateway`
- Modify: `Jenkinsfile`
- Modify: `k8s/prod/api.yaml`
- Modify: `README.md`
- Modify: `API.md`

- [ ] **Step 1: Write deployment structural tests**

Create `test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('NapCat WebUI Gateway deployment wiring', () => {
  it('has a dedicated production dockerfile entry', () => {
    const dockerfile = read('dockerfile.gateway');

    expect(dockerfile).toContain('dist/apps/napcat-webui-gateway/main');
    expect(dockerfile).toContain('EXPOSE 48086');
  });

  it('deploys Gateway as a separate K8s Deployment and Service', () => {
    const manifest = read('k8s/prod/api.yaml');

    expect(manifest).toContain('name: kt-napcat-webui-gateway');
    expect(manifest).toContain('containerPort: 48086');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET');
    expect(manifest).toContain('NAPCAT_WEBUI_GATEWAY_REDIS_HOST');
  });

  it('builds and pushes a separate Gateway image in Jenkins', () => {
    const jenkinsfile = read('Jenkinsfile');

    expect(jenkinsfile).toContain('GATEWAY_IMAGE_NAME');
    expect(jenkinsfile).toContain('dockerfile.gateway');
    expect(jenkinsfile).toContain('kt-napcat-webui-gateway');
  });
});
```

- [ ] **Step 2: Run deployment test and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
```

Expected: FAIL because deployment files are not wired yet.

- [ ] **Step 3: Add `dockerfile.gateway`**

Create `dockerfile.gateway` by mirroring `dockerfile`, changing:

```dockerfile
ENV APP_PORT=48086
ENV LOG_APP_NAME=kt-napcat-webui-gateway
EXPOSE 48086
CMD ["node", "dist/apps/napcat-webui-gateway/main"]
```

Keep font and production dependency installation consistent with the API image.

- [ ] **Step 4: Update Jenkins**

Add parameter:

```groovy
string(name: 'GATEWAY_IMAGE_NAME', defaultValue: 'kt-napcat-webui-gateway', description: 'NapCat WebUI Gateway 镜像名称')
```

In `Prepare`, compute:

```groovy
env.GATEWAY_DOCKER_IMAGE = registry ? "${registry}/${params.GATEWAY_IMAGE_NAME}:${env.IMAGE_TAG_FINAL}" : "${params.GATEWAY_IMAGE_NAME}:${env.IMAGE_TAG_FINAL}"
env.GATEWAY_DOCKER_IMAGE_LATEST = registry ? "${registry}/${params.GATEWAY_IMAGE_NAME}:latest" : "${params.GATEWAY_IMAGE_NAME}:latest"
```

In Docker Build, after API image build:

```groovy
docker build -f dockerfile.gateway -t ${env.GATEWAY_DOCKER_IMAGE} .
if [ '${env.GATEWAY_DOCKER_IMAGE}' != '${env.GATEWAY_DOCKER_IMAGE_LATEST}' ]; then
  docker tag ${env.GATEWAY_DOCKER_IMAGE} ${env.GATEWAY_DOCKER_IMAGE_LATEST}
fi
```

In Docker Push, push both Gateway tags. In K8s Deploy, set the Gateway deployment image:

```groovy
kubectl ${kubeConfigArg} ${namespaceArg} set image deployment/kt-napcat-webui-gateway gateway=${env.GATEWAY_DOCKER_IMAGE}
```

Check rollout for both API and Gateway deployments.

- [ ] **Step 5: Update K8s manifest**

Add Gateway Deployment and Service in `k8s/prod/api.yaml`:

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kt-napcat-webui-gateway
  namespace: kt-prod
  labels:
    app: kt-napcat-webui-gateway
spec:
  replicas: 1
  revisionHistoryLimit: 3
  selector:
    matchLabels:
      app: kt-napcat-webui-gateway
  template:
    metadata:
      labels:
        app: kt-napcat-webui-gateway
    spec:
      containers:
        - name: gateway
          image: k3d-kt-registry.localhost:5000/kt-napcat-webui-gateway:latest
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 48086
          env:
            - name: NODE_ENV
              value: production
            - name: TZ
              value: Asia/Shanghai
            - name: NAPCAT_WEBUI_GATEWAY_PORT
              value: "48086"
            - name: NAPCAT_WEBUI_GATEWAY_REDIS_HOST
              value: kt-qqbot-plugin-redis
            - name: NAPCAT_WEBUI_GATEWAY_REDIS_PORT
              value: "6379"
            - name: NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL
              value: /napcat-webui
          envFrom:
            - secretRef:
                name: kt-template-online-api-env
          readinessProbe:
            httpGet:
              path: /internal/health
              port: 48086
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 6
---
apiVersion: v1
kind: Service
metadata:
  name: kt-napcat-webui-gateway
  namespace: kt-prod
  labels:
    app: kt-napcat-webui-gateway
spec:
  type: NodePort
  selector:
    app: kt-napcat-webui-gateway
  ports:
    - name: http
      port: 48086
      targetPort: 48086
      nodePort: 30086
```

Add API env:

```yaml
- name: NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL
  value: http://kt-napcat-webui-gateway:48086
- name: NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL
  value: /napcat-webui
```

Ensure `NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET` is read from the existing production env secret, not committed.

- [ ] **Step 6: Update docs**

Add to `README.md` and `API.md`:

```text
NapCat WebUI Gateway:
- API creates route-bound sessions through /qqbot/napcat/webui/session.
- Gateway listens on 48086 and proxies /napcat-webui/session/:sessionId/*.
- Required env: NAPCAT_WEBUI_GATEWAY_INTERNAL_BASE_URL, NAPCAT_WEBUI_GATEWAY_PUBLIC_BASE_URL, NAPCAT_WEBUI_GATEWAY_INTERNAL_SECRET, NAPCAT_WEBUI_GATEWAY_REDIS_HOST, NAPCAT_WEBUI_GATEWAY_REDIS_PORT.
- Browser responses must not contain webuiToken, Credential, Docker host ports, or NAS SSH paths.
```

- [ ] **Step 7: Run deployment tests and build checks**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run build
```

Expected: tests PASS, typecheck PASS, build PASS, and `dist/apps/napcat-webui-gateway/main.js` exists.

- [ ] **Step 8: Commit Task 5**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api add dockerfile.gateway Jenkinsfile k8s/prod/api.yaml README.md API.md test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts
git -C D:\MyFiles\KT\Node\kt-template-online-api commit -m "feat: 部署NapCat WebUI Gateway"
```

---

### Task 6: Add Admin API Client, Route, and Account Action

**Files:**
- Modify: `apps/web-antdv-next/src/api/qqbot/napcat.ts`
- Modify: `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts`
- Modify: `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`
- Modify: `apps/web-antdv-next/src/views/qqbot/account/list.tsx`
- Modify: `apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts`

- [ ] **Step 1: Add failing Admin API tests**

Extend `apps/web-antdv-next/src/api/qqbot/napcat.spec.ts` with:

```ts
it('calls NapCat WebUI Gateway session endpoints', async () => {
  await createQqbotNapcatWebuiSession('account-1');
  await heartbeatQqbotNapcatWebuiSession('session-1');
  await revokeQqbotNapcatWebuiSession('session-1');

  expect(postMock).toHaveBeenCalledWith('/qqbot/napcat/webui/session', {
    accountId: 'account-1',
  });
  expect(postMock).toHaveBeenCalledWith(
    '/qqbot/napcat/webui/session/session-1/heartbeat',
  );
  expect(postMock).toHaveBeenCalledWith(
    '/qqbot/napcat/webui/session/session-1/revoke',
  );
});
```

Import the new functions at the top of the spec.

- [ ] **Step 2: Add failing boundary test**

Extend `apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts`:

```ts
it('keeps WebUI route lifecycle outside the account list page', () => {
  const source = readAccountSource('list.tsx');

  expect(source).toContain('QqBotAccountNapcatWebui');
  expect(source).not.toContain('createQqbotNapcatWebuiSession');
  expect(source).not.toContain('heartbeatQqbotNapcatWebuiSession');
  expect(source).not.toContain('iframe');
});
```

- [ ] **Step 3: Run Admin tests and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
```

Expected: FAIL because functions and route action are missing.

- [ ] **Step 4: Add Admin API functions**

Modify `apps/web-antdv-next/src/api/qqbot/napcat.ts`:

```ts
export namespace QqbotNapcatApi {
  export interface WebuiGatewaySession {
    account: { id: string; name?: string; selfId: string };
    container: { id: string; name: string; webuiStatus: string };
    expiresAt: number;
    iframeUrl: string;
    sessionId: string;
  }
}

export function createQqbotNapcatWebuiSession(accountId: string) {
  return requestClient.post<QqbotNapcatApi.WebuiGatewaySession>(
    '/qqbot/napcat/webui/session',
    { accountId },
  );
}

export function heartbeatQqbotNapcatWebuiSession(sessionId: string) {
  return requestClient.post<Pick<QqbotNapcatApi.WebuiGatewaySession, 'expiresAt' | 'sessionId'> & { status: 'active' }>(
    `/qqbot/napcat/webui/session/${sessionId}/heartbeat`,
  );
}

export function revokeQqbotNapcatWebuiSession(sessionId: string) {
  return requestClient.post<boolean>(
    `/qqbot/napcat/webui/session/${sessionId}/revoke`,
  );
}
```

- [ ] **Step 5: Add hidden Admin route**

Modify `apps/web-antdv-next/src/router/routes/modules/qqbot.ts`:

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

- [ ] **Step 6: Add account row action**

Modify `apps/web-antdv-next/src/views/qqbot/account/list.tsx`:

```ts
{
  disabled: (row) => !row.napcat?.containerName || getWebuiStatus(row) === 'offline',
  key: 'napcatWebui',
  label: 'WebUI',
  onClick: openNapcatWebui,
  permissionCodes: ['QqBot:Account:WebUI'],
}
```

Add:

```ts
function openNapcatWebui(row: QqbotApi.Account) {
  void router.push({
    name: 'QqBotAccountNapcatWebui',
    params: { accountId: row.id },
  });
}
```

- [ ] **Step 7: Run Admin API and boundary tests**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
```

Expected: tests PASS.

- [ ] **Step 8: Commit Task 6**

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/api/qqbot/napcat.ts apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/router/routes/modules/qqbot.ts apps/web-antdv-next/src/views/qqbot/account/list.tsx apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加NapCat WebUI入口"
```

---

### Task 7: Build Admin Route Page and Lifecycle Composable

**Files:**
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.tsx`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/index.scss`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/useNapcatWebuiGatewaySession.ts`
- Create: `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx`

- [ ] **Step 1: Write route lifecycle tests**

Create `apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import NapcatWebuiPage from './index';

const createSession = vi.fn();
const heartbeat = vi.fn();
const revoke = vi.fn();

vi.mock('#/api/qqbot/napcat', () => ({
  createQqbotNapcatWebuiSession: createSession,
  heartbeatQqbotNapcatWebuiSession: heartbeat,
  revokeQqbotNapcatWebuiSession: revoke,
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { accountId: 'account-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}));

describe('NapcatWebuiPage', () => {
  it('creates a Gateway session on mount and revokes on unmount', async () => {
    createSession.mockResolvedValue({
      account: { id: 'account-1', selfId: '1914728559' },
      container: {
        id: 'container-1',
        name: 'kt-qqbot-napcat-1',
        webuiStatus: 'online',
      },
      expiresAt: Date.now() + 60000,
      iframeUrl: '/napcat-webui/session/session-1/bootstrap?ticket=ticket-1',
      sessionId: 'session-1',
    });
    heartbeat.mockResolvedValue({
      expiresAt: Date.now() + 60000,
      sessionId: 'session-1',
      status: 'active',
    });

    const wrapper = mount(NapcatWebuiPage);
    await flushPromises();

    expect(createSession).toHaveBeenCalledWith('account-1');
    expect(wrapper.find('iframe').attributes('src')).toContain(
      '/napcat-webui/session/session-1/bootstrap',
    );

    wrapper.unmount();
    await flushPromises();

    expect(revoke).toHaveBeenCalledWith('session-1');
  });
});
```

- [ ] **Step 2: Run route page test and verify RED**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement lifecycle composable**

Create `useNapcatWebuiGatewaySession.ts` with:

```ts
import { useIntervalFn } from '@vueuse/core';
import { onBeforeUnmount, ref } from 'vue';
import {
  createQqbotNapcatWebuiSession,
  heartbeatQqbotNapcatWebuiSession,
  revokeQqbotNapcatWebuiSession,
  type QqbotNapcatApi,
} from '#/api/qqbot/napcat';

export type NapcatWebuiSessionState = 'error' | 'idle' | 'loading' | 'ready' | 'revoked';

/**
 * Owns one route-bound NapCat WebUI Gateway session.
 *
 * @param accountId QQBot account id from the current route.
 * @returns Reactive session state and lifecycle commands for the WebUI page.
 */
export function useNapcatWebuiGatewaySession(accountId: string) {
  const errorMessage = ref('');
  const session = ref<QqbotNapcatApi.WebuiGatewaySession>();
  const state = ref<NapcatWebuiSessionState>('idle');

  const { pause: pauseHeartbeat, resume: resumeHeartbeat } = useIntervalFn(
    () => {
      const sessionId = session.value?.sessionId;
      if (!sessionId) return;
      void heartbeatQqbotNapcatWebuiSession(sessionId).catch(() => {
        errorMessage.value = 'NapCat WebUI 会话心跳失败，请重新打开';
        state.value = 'error';
        pauseHeartbeat();
      });
    },
    20_000,
    { immediate: false },
  );

  /**
   * Creates a Gateway session and starts the route-bound heartbeat.
   */
  async function open() {
    state.value = 'loading';
    errorMessage.value = '';
    try {
      session.value = await createQqbotNapcatWebuiSession(accountId);
      state.value = 'ready';
      resumeHeartbeat();
    } catch (error: any) {
      errorMessage.value = error?.message || 'NapCat WebUI 会话创建失败';
      state.value = 'error';
      pauseHeartbeat();
    }
  }

  /**
   * Revokes the current Gateway session and stops heartbeat traffic.
   */
  async function revoke() {
    pauseHeartbeat();
    const sessionId = session.value?.sessionId;
    if (!sessionId) return;
    await revokeQqbotNapcatWebuiSession(sessionId).catch(() => undefined);
    state.value = 'revoked';
  }

  onBeforeUnmount(() => {
    void revoke();
  });

  return { errorMessage, open, revoke, session, state };
}
```

- [ ] **Step 4: Implement route page**

Create `index.tsx` using `Page`, `Button`, `Alert`, `Spin`, and `Typography` from existing UI libraries. The iframe must only render when `state === 'ready'` and `session.iframeUrl` exists.

Use one stable root element. Include top controls:

- back to account list;
- reopen session;
- close session;
- display selfId and container name.

- [ ] **Step 5: Add SCSS**

Create `index.scss`:

```scss
.qqbot-napcat-webui-page {
  display: flex;
  flex-direction: column;
  height: var(--vben-content-height);
  min-height: 0;
  overflow: hidden;

  &__bar {
    align-items: center;
    border-bottom: 1px solid hsl(var(--border));
    display: flex;
    flex: 0 0 auto;
    gap: 12px;
    justify-content: space-between;
    padding: 10px 12px;
  }

  &__frame-wrap {
    background: hsl(var(--background));
    flex: 1 1 auto;
    min-height: 0;
  }

  &__frame {
    border: 0;
    display: block;
    height: 100%;
    width: 100%;
  }
}
```

- [ ] **Step 6: Run Admin tests and typecheck**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next run typecheck
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 7: Commit Task 7**

```powershell
git -C D:\MyFiles\KT\Vue\kt-template-admin add apps/web-antdv-next/src/views/qqbot/account/napcat-webui
git -C D:\MyFiles\KT\Vue\kt-template-admin commit -m "feat: 增加NapCat WebUI二级页面"
```

---

### Task 8: Local End-to-End Smoke

**Files:**
- No planned source changes. Validation fixes must be applied to the failing files from Tasks 1-7 and committed with the related repo.

- [ ] **Step 1: Confirm repo types and package managers**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short --branch
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\.node-version
Get-Content D:\MyFiles\KT\Node\kt-template-online-api\package.json | Select-String '"packageManager"'
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short --branch
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\.node-version
Get-Content D:\MyFiles\KT\Vue\kt-template-admin\package.json | Select-String '"packageManager"'
```

Expected: both repos are Git; API uses pnpm 9.15.9; Admin uses pnpm 10.28.2.

- [ ] **Step 2: Run focused API validation**

```powershell
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api jest --runTestsByPath test/modules/qqbot/napcat-webui-gateway/webui-gateway-contract.spec.ts test/modules/qqbot/napcat-webui-gateway/api-session.service.spec.ts test/apps/napcat-webui-gateway/session-store.spec.ts test/apps/napcat-webui-gateway/proxy-rewrite.spec.ts test/modules/qqbot/napcat-webui-gateway/gateway-deployment.spec.ts --runInBand
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run typecheck
pnpm --dir D:\MyFiles\KT\Node\kt-template-online-api run build
```

Expected: focused tests PASS, typecheck PASS, build PASS.

- [ ] **Step 3: Run focused Admin validation**

```powershell
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next vitest run apps/web-antdv-next/src/api/qqbot/napcat.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-boundary.spec.ts apps/web-antdv-next/src/views/qqbot/account/napcat-webui/napcat-webui.spec.tsx
pnpm --dir D:\MyFiles\KT\Vue\kt-template-admin --filter @vben/web-antdv-next run typecheck
```

Expected: focused tests PASS and typecheck PASS.

- [ ] **Step 4: Start local API and Gateway**

Use existing local env conventions. Start API and Gateway in bounded terminals:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Node\kt-template-online-api; pnpm run start:dev *> .kt-workspace\logs\api-webui-gateway-api.log'
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Node\kt-template-online-api; pnpm run start:gateway:dev *> .kt-workspace\logs\api-webui-gateway-service.log'
```

Expected: API listens on `48085`; Gateway listens on `48086`.

- [ ] **Step 5: Call the API session endpoint against local service**

Use an existing local Admin token. If a token is not available, log into the local Admin UI and copy the token from the tracked local workflow. Then call:

```powershell
curl.exe -sS -X POST "http://127.0.0.1:48085/qqbot/napcat/webui/session" -H "authorization: Bearer <local-admin-token>" -H "content-type: application/json" --data "{\"accountId\":\"<local-account-id>\"}"
```

Expected: JSON contains `sessionId`, `iframeUrl`, `account`, and `container`, and does not contain `webuiToken`, `Credential`, `6100`, or Docker/NAS host paths.

- [ ] **Step 6: Open the Admin route locally**

Start Admin for the route smoke:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoLogo','-Command','cd D:\MyFiles\KT\Vue\kt-template-admin; pnpm -F @vben/web-antdv-next run dev *> .kt-workspace\logs\admin-webui-gateway.log'
```

Open:

```text
http://127.0.0.1:5999/#/qqbot/account/<local-account-id>/napcat-webui
```

Expected: page renders the route console, creates a session, loads iframe shell, and revokes when navigating back to `/qqbot/account`.

- [ ] **Step 7: Clean local processes**

Stop Node processes started from these project paths:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*kt-template-online-api*start:dev*' -or $_.CommandLine -like '*kt-template-online-api*start:gateway:dev*' -or $_.CommandLine -like '*kt-template-admin*web-antdv-next*dev*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

- [ ] **Step 8: Commit local validation fixes**

If validation required fixes, commit the touched repo separately:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api status --short
git -C D:\MyFiles\KT\Vue\kt-template-admin status --short
```

Commit only files related to this feature.

---

### Task 9: Documentation, Review, Push, Deploy, and Online Closure

**Files:**
- Modify: `D:\MyFiles\KT\TASKS.md`

- [ ] **Step 1: Update `TASKS.md`**

Add a recent record with:

```text
范围：API Gateway service、Admin WebUI 二级页面、K8s/Jenkins Gateway 发布。
关键词：/qqbot/account/:accountId/napcat-webui、kt-napcat-webui-gateway、route-bound session、heartbeat/revoke、完整 WebUI 操作、token/Credential 不下发浏览器。
验证：列出 API focused tests、Admin focused tests、typecheck/build、本地 iframe smoke、线上 Gateway health 与账号 1914728559 iframe smoke。
```

- [ ] **Step 2: Run final local gates**

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api diff --check
git -C D:\MyFiles\KT\Vue\kt-template-admin diff --check
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project api --changed-files <comma-separated-api-files>
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run global-review -- --project admin --changed-files <comma-separated-admin-files>
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run cleanup-history -- --dry-run
```

Expected: diff checks PASS, global-review findings=[], cleanup dry-run deleted=[].

- [ ] **Step 3: Commit remaining docs**

```powershell
git -C D:\MyFiles\KT add TASKS.md
git -C D:\MyFiles\KT commit -m "docs: 记录NapCat WebUI Gateway实施"
```

- [ ] **Step 4: Push when explicitly requested**

Push API and Admin only after user asks:

```powershell
git -C D:\MyFiles\KT\Node\kt-template-online-api push origin main
git -C D:\MyFiles\KT\Vue\kt-template-admin push origin main
```

- [ ] **Step 5: Observe Jenkins/K8s**

Use deploy observation for API:

```powershell
pnpm --dir D:\MyFiles\KT\mcp\ktWorkflow run deploy-observation -- --project api --job KT-Template/KT-Template-API/main --commit <api-commit> --execute
```

Manually verify Gateway because the current deploy-observation script targets API deployment by default:

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

Expected: API and Gateway deployments Running/Ready, restartCount 0, Gateway image tag matches the Jenkins build.

- [ ] **Step 6: Configure Caddy/Admin route if not already routed**

On Tencent Cloud Caddy, follow the stabilized Caddy rule: backup `/opt/nas-gateway/caddy/Caddyfile`, add `/napcat-webui/*` reverse proxy to the Gateway NodePort or service route, run `caddy validate`, reload, then verify:

```powershell
curl.exe -I https://admin.kwitsukasa.top/napcat-webui/
```

Expected: public route reaches Gateway and does not expose upstream host details.

- [ ] **Step 7: Online functional smoke**

Open:

```text
https://admin.kwitsukasa.top/#/qqbot/account
```

For account `1914728559`:

1. Click `WebUI`.
2. Confirm route becomes `/#/qqbot/account/<account-id>/napcat-webui`.
3. Confirm iframe loads the original NapCat WebUI shell.
4. Open a safe WebUI page such as login status or settings.
5. Confirm browser URL does not contain `webuiToken`, `Credential`, `6100`, Docker container IP, NAS host path, or SSH route.
6. Navigate back to account list.
7. Verify Gateway logs or audit table contain revoke or heartbeat-timeout cleanup.

- [ ] **Step 8: Final report**

Report:

- API commit(s), Admin commit(s), root TASKS commit.
- Tests and typecheck/build evidence.
- Jenkins/K8s evidence.
- Online smoke evidence.
- Any remaining blocker with exact next command.

---

## Self-Review

- Spec coverage: covered Admin row action, second-level route, route-bound session lifecycle, independent Gateway process, full WebUI operation, no token/credential/browser leak, Redis session state, MySQL audit, K8s/Jenkins deployment, and online smoke.
- Placeholder scan: no forbidden placeholder words or cross-task shorthand remain in the plan body.
- Type consistency: all plan tasks use `QqBot:Account:WebUI`, `/qqbot/napcat/webui/session`, `/napcat-webui/session/:sessionId`, `kt-napcat-webui-gateway`, `48086`, and `QqbotNapcatWebuiGatewayService`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-qqbot-napcat-webui-gateway-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
