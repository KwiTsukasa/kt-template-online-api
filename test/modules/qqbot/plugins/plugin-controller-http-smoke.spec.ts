jest.mock('@/modules/admin/identity/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    /**
     * 判断 测试断言条件。
     */
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
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';
import { QqbotEventPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service';
import type { QqbotIntegrationPlugin } from '../../../../src/modules/qqbot/core/contract/qqbot.types';

/**
 * 创建 测试断言对象或配置。
 * @param key - 键名；生成 测试对象。
 * @param legacyKeys - 测试列表；生成 测试对象。
 * @returns 创建后的 测试断言对象或配置。
 */
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

/**
 * 列出Operation Summaries。
 * @param pluginKey - pluginKey 输入；限定 测试查询范围。
 */
const listOperationSummaries = (pluginKey?: string) => {
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
};

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
            listOperations: jest.fn(listOperationSummaries),
            listPlugins: jest.fn(() => []),
          },
        },
        {
          provide: QqbotPluginPlatformService,
          useValue: {
            listPluginHealth: jest.fn(async () =>
              [
                createPlugin('bangdream', ['bangDream']),
                createPlugin('ff14-market', ['ff14Market']),
                createPlugin('fflogs'),
              ].map((plugin) => ({
                checkedAt: '2026-06-18 00:00:00',
                name: plugin.name,
                pluginKey: plugin.key,
                status: 'healthy',
                triggerMode: 'command',
              })),
            ),
            listPluginSummaries: jest.fn(async () =>
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
            listOperationSummaries: jest.fn(async (query) =>
              listOperationSummaries(query?.pluginKey),
            ),
            pageOperationSummaries: jest.fn(async (query) => {
              const pageNo = Number(query?.pageNo || 1);
              const pageSize = Number(query?.pageSize || 10);
              const operations = listOperationSummaries(query?.pluginKey);
              const skip = (pageNo - 1) * pageSize;
              return {
                list: operations.slice(skip, skip + pageSize),
                pageNo,
                pageSize,
                total: operations.length,
              };
            }),
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

  it('returns command plugin health through platform runtime summaries', async () => {
    const response = await request(app.getHttpServer())
      .get('/qqbot/plugin/health')
      .query({ triggerMode: 'command' })
      .expect(200);

    expect(response.body.data.map((plugin) => plugin.pluginKey)).toEqual([
      'bangdream',
      'ff14-market',
      'fflogs',
    ]);
    expect(
      response.body.data.every((plugin) => plugin.status === 'healthy'),
    ).toBe(true);
  });
});
