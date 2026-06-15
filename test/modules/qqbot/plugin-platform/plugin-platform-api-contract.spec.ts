import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotPluginPlatformController } from '../../../../src/modules/qqbot/plugin-platform/plugin-platform.controller';
import { QqbotPluginPlatformModule } from '../../../../src/modules/qqbot/plugin-platform/plugin-platform.module';
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/plugin-platform.service';
import {
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
  QqbotPlugin,
  QqbotPluginAccountBinding,
  QqbotPluginAsset,
  QqbotPluginConfig,
  QqbotPluginEventHandler,
  QqbotPluginInstallation,
  QqbotPluginOperation,
  QqbotPluginRuntimeEvent,
  QqbotPluginVersion,
} from '../../../../src/modules/qqbot/plugin-platform/persistence';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

const createRepositoryMock = () => ({
  find: jest.fn(async () => []),
  save: jest.fn(async (value) => value),
  update: jest.fn(async () => ({ affected: 1 })),
});

const createManifest = () => ({
  assets: [],
  configSchema: {
    type: 'object',
  },
  entry: 'src/index.ts',
  events: [],
  minApiSdkVersion: '1.0.0',
  name: 'Demo Plugin',
  operations: [
    {
      handlerName: 'echo',
      key: 'demo-plugin.echo',
      name: 'Echo',
      permissions: ['qqbot.send'],
      timeoutMs: 3000,
    },
  ],
  permissions: ['qqbot.send'],
  pluginKey: 'demo-plugin',
  runtime: {
    maxConcurrency: 1,
    memoryMb: 128,
    timeoutMs: 5000,
    workerType: 'node-worker',
  },
  version: '0.1.0',
});

describe('QQBot plugin platform API contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotPluginPlatformController],
      providers: [
        QqbotPluginPlatformService,
        ...[
          QqbotPlugin,
          QqbotPluginVersion,
          QqbotPluginInstallation,
          QqbotPluginOperation,
          QqbotPluginEventHandler,
          QqbotPluginAccountBinding,
          QqbotPluginConfig,
          QqbotPluginAsset,
          QqbotPluginRuntimeEvent,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useFactory: createRepositoryMock,
        })),
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers plugin-platform as a first-class AppModule import', () => {
    const source = readFileSync(
      join(__dirname, '../../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('QqbotPluginPlatformModule');
  });

  it('loads plural entity files into the TypeORM datasource', () => {
    const source = readFileSync(
      join(__dirname, '../../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('*.entities{.ts,.js}');
  });

  it('exposes plugin-platform management routes', () => {
    expect(routeKey).toBeDefined();
    expect(
      collectControllerRoutes([QqbotPluginPlatformController]).map(routeKey),
    ).toEqual(
      expect.arrayContaining([
        'GET /qqbot/plugin-platform/installations',
        'POST /qqbot/plugin-platform/upload',
        'POST /qqbot/plugin-platform/validate',
        'POST /qqbot/plugin-platform/install',
        'POST /qqbot/plugin-platform/install-local',
        'POST /qqbot/plugin-platform/enable',
        'POST /qqbot/plugin-platform/disable',
        'POST /qqbot/plugin-platform/upgrade',
        'POST /qqbot/plugin-platform/uninstall',
        'POST /qqbot/plugin-platform/config',
        'GET /qqbot/plugin-platform/runtime-events',
        'GET /qqbot/plugin-platform/account-bindings',
      ]),
    );
  });

  it('validates manifests through the real HTTP wrapper', async () => {
    const response = await request(app.getHttpServer())
      .post('/qqbot/plugin-platform/validate')
      .send({
        manifest: createManifest(),
      })
      .expect(200);

    expect(response.body).toMatchObject({
      code: 200,
      data: {
        manifest: {
          pluginKey: 'demo-plugin',
          runtime: {
            timeoutMs: 5000,
          },
        },
        valid: true,
      },
    });
  });

  it('keeps TypeORM entity registration aligned with the persistence contract', () => {
    expect(QqbotPluginPlatformModule).toBeDefined();
    expect(QQBOT_PLUGIN_PLATFORM_ENTITIES).toHaveLength(9);
  });
});
