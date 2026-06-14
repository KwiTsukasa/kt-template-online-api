jest.mock('@/admin/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    canActivate() {
      return true;
    }
  },
}));
jest.mock('@/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin', () => ({
  QqbotBangDreamPluginService: class {},
}));
jest.mock(
  '@/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin',
  () => ({
    QqbotFf14MarketPluginService: class {},
  }),
);
jest.mock('@/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin', () => ({
  QqbotFflogsPluginService: class {},
}));

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { QqbotBangDreamPluginService } from '../../../../src/modules/qqbot/plugins/bangDream/qqbot-bangdream.plugin';
import { QqbotFf14MarketPluginService } from '../../../../src/modules/qqbot/plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsPluginService } from '../../../../src/modules/qqbot/plugins/fflogs/qqbot-fflogs.plugin';
import { QqbotEventPluginRegistryService } from '../../../../src/qqbot/plugin/qqbot-event-plugin-registry.service';
import { QqbotPluginController } from '../../../../src/qqbot/plugin/qqbot-plugin.controller';
import { QqbotPluginRegistryService } from '../../../../src/qqbot/plugin/qqbot-plugin-registry.service';
import type { QqbotIntegrationPlugin } from '../../../../src/qqbot/qqbot.types';

const createPlugin = (
  key: string,
  legacyKeys: string[] = [],
): QqbotIntegrationPlugin => ({
  key,
  legacyKeys,
  name: key,
  operations: [
    {
      execute: jest.fn(async () => ({ ok: true })),
      key: `${key}.operation`,
      name: `${key} operation`,
    },
  ],
  version: '1.0.0',
});

describe('QQBot plugin controller local HTTP smoke', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotPluginController],
      providers: [
        QqbotPluginRegistryService,
        {
          provide: QqbotBangDreamPluginService,
          useValue: {
            getPlugin: () => createPlugin('bangdream', ['bangDream']),
          },
        },
        {
          provide: QqbotFf14MarketPluginService,
          useValue: {
            getPlugin: () => createPlugin('ff14-market', ['ff14Market']),
          },
        },
        {
          provide: QqbotFflogsPluginService,
          useValue: {
            getPlugin: () => createPlugin('fflogs'),
          },
        },
        {
          provide: QqbotEventPluginRegistryService,
          useValue: {
            health: jest.fn(async () => []),
            listDefinitions: jest.fn(() => []),
            listOperations: jest.fn(() => []),
            listPlugins: jest.fn(async () => []),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns platform keys and resolves legacy plugin key through HTTP routes', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/qqbot/plugin/list')
      .query({ triggerMode: 'command' })
      .expect(200);

    expect(listResponse.body.data.map((plugin) => plugin.key)).toEqual([
      'bangdream',
      'ff14-market',
      'fflogs',
    ]);

    const operationResponse = await request(app.getHttpServer())
      .get('/qqbot/plugin/operation/list')
      .query({ pluginKey: 'bangDream', triggerMode: 'command' })
      .expect(200);

    expect(operationResponse.body.data[0]).toMatchObject({
      key: 'bangdream.operation',
      pluginKey: 'bangdream',
      triggerMode: 'command',
    });
  });
});
