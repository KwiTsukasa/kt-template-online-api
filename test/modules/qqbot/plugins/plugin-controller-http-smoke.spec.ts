jest.mock('@/modules/admin/identity/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    canActivate() {
      return true;
    }
  },
}));
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ToolsService } from '../../../../src/common';
import { QqbotPluginController } from '../../../../src/modules/qqbot/plugin-platform/contract/qqbot-plugin.controller';
import { QqbotEventPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service';
import type { QqbotIntegrationPlugin } from '../../../../src/modules/qqbot/core/contract/qqbot.types';

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
        ToolsService,
        {
          provide: QqbotPluginRegistryService,
          useValue: {
            health: jest.fn(async () => []),
            listOperations: jest.fn((pluginKey?: string) => {
              const plugins = [
                createPlugin('bangdream', ['bangDream']),
                createPlugin('ff14-market', ['ff14Market']),
                createPlugin('fflogs'),
              ];
              const resolvedPluginKey =
                pluginKey === 'bangDream'
                  ? 'bangdream'
                  : pluginKey === 'ff14Market'
                    ? 'ff14-market'
                    : pluginKey;
              return plugins
                .filter((plugin) => !resolvedPluginKey || plugin.key === resolvedPluginKey)
                .flatMap((plugin) =>
                  plugin.operations.map((operation) => ({
                    key: operation.key,
                    name: operation.name,
                    pluginKey: plugin.key,
                    triggerMode: 'command',
                  })),
                );
            }),
            listPlugins: jest.fn(() =>
              [
                createPlugin('bangdream', ['bangDream']),
                createPlugin('ff14-market', ['ff14Market']),
                createPlugin('fflogs'),
              ].map((plugin) => ({
                key: plugin.key,
                name: plugin.name,
                operationCount: plugin.operations.length,
                triggerMode: 'command',
                version: plugin.version,
              })),
            ),
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

  it('returns paged plugin operations for KtTable pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/qqbot/plugin/operation/page')
      .query({ pageNo: 2, pageSize: 1, triggerMode: 'command' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      pageNo: 2,
      pageSize: 1,
      total: 3,
    });
    expect(response.body.data.list).toEqual([
      expect.objectContaining({
        key: 'ff14-market.operation',
        pluginKey: 'ff14-market',
        triggerMode: 'command',
      }),
    ]);
  });
});
