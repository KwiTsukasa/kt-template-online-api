import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MediaCodexAgentGatewayConfigService } from '../../../src/apps/media-codex-agent-gateway/config/media-codex-agent-gateway-config.service';
import { MediaCodexAgentApiClient } from '../../../src/apps/media-codex-agent-gateway/infrastructure/media-codex-agent-api.client';
import { MediaGovernanceAgentInternalController } from '../../../src/modules/admin/media-governance/presentation/media-governance-agent-internal.controller';
import { MediaGovernanceAgentInternalGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-agent-internal.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceAgentInternalController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const internalSecret = 'api-callback-secret-value-at-least-32-bytes';
  const callbackHealth = jest.fn(() => ({
    persistenceMode: 'database',
    status: 'ready',
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaGovernanceAgentInternalController],
      providers: [
        MediaGovernanceAgentInternalGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'MEDIA_CODEX_AGENT_INTERNAL_SECRET'
                ? internalSecret
                : undefined,
          },
        },
        {
          provide: MediaGovernanceService,
          useValue: {
            agentCallbackHealth: callbackHealth,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails closed without the internal secret', async () => {
    await request(app.getHttpServer())
      .get('/internal/media-governance/agent/health')
      .expect(403);
  });

  it('returns only bounded callback readiness with internal authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/media-governance/agent/health')
      .set('x-kt-media-agent-secret', internalSecret)
      .expect(200);

    expect(response.body).toEqual({
      persistenceMode: 'database',
      status: 'ready',
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|token|cookie/i);
  });

  it('is accepted by the real gateway callback client', async () => {
    const config = {
      apiBaseUrl: () => apiUrl,
      internalSecret: () => internalSecret,
      timeoutMs: () => 2_000,
    } as MediaCodexAgentGatewayConfigService;

    await expect(
      new MediaCodexAgentApiClient(config).health(),
    ).resolves.toEqual({
      persistenceMode: 'database',
      status: 'ready',
    });
  });

  it('is rejected by the gateway client while the API still uses process-only state', async () => {
    callbackHealth.mockReturnValueOnce({
      persistenceMode: 'process-simulator',
      status: 'not-ready',
    });
    const config = {
      apiBaseUrl: () => apiUrl,
      internalSecret: () => internalSecret,
      timeoutMs: () => 2_000,
    } as MediaCodexAgentGatewayConfigService;

    await expect(new MediaCodexAgentApiClient(config).health()).rejects.toThrow(
      'media-codex-agent-api-health-invalid',
    );
  });
});
