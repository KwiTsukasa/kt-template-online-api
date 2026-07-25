import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PIPES_METADATA,
} from '@nestjs/common/constants';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { PinoLogger } from 'nestjs-pino';
import { ApiExceptionFilter } from '../../../../src/common/filters/api-exception.filter';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotAccountMessagePushService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-account-message-push.service';
import { QqbotMessageSubscriptionService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-subscription.service';
import { QqbotMessageTargetOptionsService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-target-options.service';
import { QqbotMessageTemplateService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-template.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { QqbotAccountMessagePushController } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-account-message-push.controller';
import { QqbotMessagePushController } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.controller';
import { QqbotMessagePushPermissionGuard } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-permission.guard';
import { QqbotMessagePushContractErrorInterceptor } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-contract-error.interceptor';
import { QQBOT_MESSAGE_PUSH_PERMISSION } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push-permission.decorator';
import { SystemMessageContractError } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

const SOURCE_READ_PERMISSIONS = [
  'QqBot:MessageSubscription:List',
  'QqBot:MessageSubscription:Create',
  'QqBot:MessageSubscription:Update',
  'QqBot:MessageTemplate:List',
  'QqBot:MessageTemplate:Create',
  'QqBot:MessageTemplate:Update',
  'QqBot:MessageTemplate:Preview',
  'QqBot:Account:MessagePush:List',
  'QqBot:Account:MessagePush:Create',
  'QqBot:Account:MessagePush:Update',
];

const EXPECTED_ROUTE_PERMISSIONS: Record<string, string[]> = {
  'DELETE /qqbot/accounts/:selfId/message-push/bindings/:id': [
    'QqBot:Account:MessagePush:Delete',
  ],
  'DELETE /qqbot/message-push/subscriptions/:id': [
    'QqBot:MessageSubscription:Delete',
  ],
  'DELETE /qqbot/message-push/templates/:id': ['QqBot:MessageTemplate:Delete'],
  'GET /qqbot/accounts/:selfId/message-push/bindings': [
    'QqBot:Account:MessagePush:List',
  ],
  'GET /qqbot/accounts/:selfId/message-push/targets': [
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'GET /qqbot/message-push/sources': SOURCE_READ_PERMISSIONS,
  'GET /qqbot/message-push/sources/:sourceKey': SOURCE_READ_PERMISSIONS,
  'GET /qqbot/message-push/sources/network.stun.mapping-port-changed/options': [
    'QqBot:MessageSubscription:Create',
    'QqBot:MessageSubscription:Update',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'GET /qqbot/message-push/subscriptions': [
    'QqBot:MessageSubscription:List',
    'QqBot:Account:MessagePush:List',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'GET /qqbot/message-push/templates': [
    'QqBot:MessageTemplate:List',
    'QqBot:Account:MessagePush:List',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'POST /qqbot/accounts/:selfId/message-push/bindings': [
    'QqBot:Account:MessagePush:Create',
  ],
  'POST /qqbot/message-push/subscriptions': [
    'QqBot:MessageSubscription:Create',
  ],
  'POST /qqbot/message-push/templates': ['QqBot:MessageTemplate:Create'],
  'POST /qqbot/message-push/templates/preview': [
    'QqBot:MessageTemplate:Preview',
  ],
  'PUT /qqbot/accounts/:selfId/message-push/bindings/:id': [
    'QqBot:Account:MessagePush:Update',
  ],
  'PUT /qqbot/accounts/:selfId/message-push/bindings/:id/enabled': [
    'QqBot:Account:MessagePush:Toggle',
  ],
  'PUT /qqbot/message-push/subscriptions/:id': [
    'QqBot:MessageSubscription:Update',
  ],
  'PUT /qqbot/message-push/subscriptions/:id/enabled': [
    'QqBot:MessageSubscription:Toggle',
  ],
  'PUT /qqbot/message-push/templates/:id': ['QqBot:MessageTemplate:Update'],
  'PUT /qqbot/message-push/templates/:id/enabled': [
    'QqBot:MessageTemplate:Toggle',
  ],
};

const STRING_ID = '123456789012345678901234';
const SELF_ID = '12345';

const pinoLogger = {
  error: jest.fn(),
  setContext: jest.fn(),
  warn: jest.fn(),
};

const subscriptionBody = () => ({
  enabled: true,
  name: 'STUN port changed',
  remark: 'local test',
  sourceConfig: {
    ddnsRecordId: STRING_ID,
    portForwardId: '1234567890123456789',
  },
  sourceKey: 'network.stun.mapping-port-changed',
});

const templateBody = () => ({
  content: 'Endpoint: ${{endpoint}}',
  enabled: true,
  name: 'STUN template',
  remark: 'local test',
  sourceKey: 'network.stun.mapping-port-changed',
});

const bindingBody = (targetCount = 1) => ({
  enabled: true,
  subscriptionId: STRING_ID,
  targets: Array.from({ length: targetCount }, (_, index) => ({
    targetId: `${10000 + index}`,
    targetName: `Target ${index}`,
    targetType: index % 2 === 0 ? 'group' : 'private',
  })),
  templateId: '1234567890123456789',
});

const sourceDefinition = () =>
  ({
    credential: 'must-not-leak',
    description: 'STUN endpoint port change',
    displayName: 'STUN port changed',
    sourceKey: 'network.stun.mapping-port-changed',
    subscriptionFields: [
      {
        credential: 'must-not-leak',
        key: 'portForwardId',
        label: 'Port forward',
        optionCollection: 'portForwards',
        required: true,
        type: 'select',
      },
      {
        dependsOn: 'portForwardId',
        key: 'ddnsRecordId',
        label: 'DDNS',
        optionCollection: 'ddnsRecords',
        required: true,
        type: 'select',
      },
    ],
    variables: [
      {
        accessToken: 'must-not-leak',
        description: 'Endpoint',
        example: 'example.test:10000',
        key: 'endpoint',
        label: 'Endpoint',
        type: 'string',
      },
    ],
    version: 1,
  }) as never;

const subscriptionView = () =>
  ({
    activeKey: 'must-not-leak',
    createTime: '2026-07-24T00:00:00.000Z',
    enabled: true,
    id: STRING_ID,
    invalidReasonCode: null,
    isDeleted: false,
    name: 'STUN port changed',
    remark: null,
    sourceConfig: {
      credential: 'must-not-leak',
      ddnsRecordId: STRING_ID,
      portForwardId: '1234567890123456789',
    },
    sourceConfigDigest: 'must-not-leak',
    sourceKey: 'network.stun.mapping-port-changed',
    sourceName: 'STUN port changed',
    sourceSummary: 'summary',
    updateTime: '2026-07-24T00:00:00.000Z',
    valid: true,
  }) as never;

const templateView = () =>
  ({
    activeKey: 'must-not-leak',
    content: 'Endpoint: ${{endpoint}}',
    createTime: '2026-07-24T00:00:00.000Z',
    enabled: true,
    id: STRING_ID,
    isDeleted: false,
    name: 'STUN template',
    referenceCount: 1,
    remark: null,
    sourceKey: 'network.stun.mapping-port-changed',
    sourceName: 'STUN port changed',
    updateTime: '2026-07-24T00:00:00.000Z',
  }) as never;

const bindingView = () =>
  ({
    accountId: 'must-not-leak',
    activeKey: 'must-not-leak',
    available: true,
    createTime: '2026-07-24T00:00:00.000Z',
    enabled: true,
    id: STRING_ID,
    invalidReasonCode: null,
    selfId: SELF_ID,
    sourceKey: 'network.stun.mapping-port-changed',
    sourceName: 'STUN port changed',
    subscriptionId: STRING_ID,
    subscriptionName: 'STUN port changed',
    targets: [
      {
        activeKey: 'must-not-leak',
        bindingId: STRING_ID,
        enabled: true,
        id: '1234567890123456789',
        targetId: '10000',
        targetName: 'Target',
        targetType: 'group',
      },
    ],
    templateId: '1234567890123456789',
    templateName: 'STUN template',
    updateTime: '2026-07-24T00:00:00.000Z',
  }) as never;

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
};

describe('QQBot message-push management controllers', () => {
  let app: INestApplication;
  let apiUrl: string;

  const registry = {
    get: jest.fn(),
    list: jest.fn(),
  };
  const subscriptions = {
    create: jest.fn(),
    page: jest.fn(),
    remove: jest.fn(),
    setEnabled: jest.fn(),
    update: jest.fn(),
  };
  const templates = {
    create: jest.fn(),
    page: jest.fn(),
    preview: jest.fn(),
    remove: jest.fn(),
    setEnabled: jest.fn(),
    update: jest.fn(),
  };
  const bindings = {
    createBinding: jest.fn(),
    listBindings: jest.fn(),
    removeBinding: jest.fn(),
    setBindingEnabled: jest.fn(),
    updateBinding: jest.fn(),
  };
  const targets = {
    listTargetOptions: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        QqbotMessagePushController,
        QqbotAccountMessagePushController,
      ],
      providers: [
        QqbotMessagePushPermissionGuard,
        { provide: SystemMessageSourceRegistry, useValue: registry },
        { provide: QqbotMessageSubscriptionService, useValue: subscriptions },
        { provide: QqbotMessageTemplateService, useValue: templates },
        { provide: QqbotAccountMessagePushService, useValue: bindings },
        { provide: QqbotMessageTargetOptionsService, useValue: targets },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(QqbotMessagePushPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(
      new ApiExceptionFilter(pinoLogger as unknown as PinoLogger),
    );
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const definition = sourceDefinition();
    registry.list.mockReturnValue([definition]);
    registry.get.mockReturnValue({
      credential: 'must-not-leak',
      definition,
      listSubscriptionOptions: jest.fn().mockResolvedValue({
        credential: 'must-not-leak',
        ddnsRecords: [
          {
            credential: 'must-not-leak',
            disabledReasonCode: null,
            eligible: true,
            fqdn: 'example.test',
            id: STRING_ID,
            name: 'DDNS',
            portForwardId: '1234567890123456789',
          },
        ],
        portForwards: [
          {
            accessToken: 'must-not-leak',
            disabledReasonCode: null,
            eligible: true,
            externalPort: 10000,
            id: '1234567890123456789',
            internalPort: 10000,
            name: 'STUN',
            protocol: 'udp',
          },
        ],
      }),
    });
    subscriptions.page.mockResolvedValue({
      items: [subscriptionView()],
      total: 1,
    });
    subscriptions.create.mockResolvedValue(subscriptionView());
    subscriptions.update.mockResolvedValue(subscriptionView());
    subscriptions.setEnabled.mockResolvedValue(subscriptionView());
    subscriptions.remove.mockResolvedValue(true);
    templates.page.mockResolvedValue({ items: [templateView()], total: 1 });
    templates.create.mockResolvedValue(templateView());
    templates.update.mockResolvedValue(templateView());
    templates.setEnabled.mockResolvedValue(templateView());
    templates.remove.mockResolvedValue(true);
    templates.preview.mockReturnValue({
      payload: 'must-not-leak',
      renderedMessage: 'Endpoint: example.test:10000',
      variables: { endpoint: 'example.test:10000' },
    });
    bindings.listBindings.mockResolvedValue([bindingView()]);
    bindings.createBinding.mockResolvedValue(bindingView());
    bindings.updateBinding.mockResolvedValue(bindingView());
    bindings.setBindingEnabled.mockResolvedValue(bindingView());
    bindings.removeBinding.mockResolvedValue(true);
    targets.listTargetOptions.mockResolvedValue({
      available: false,
      options: [],
      reasonCode: 'onebot_unavailable',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes exactly the approved 20 routes with exact permission metadata', () => {
    const routes = collectControllerRoutes([
      QqbotMessagePushController,
      QqbotAccountMessagePushController,
    ]);
    const routeKeys = routes.map(routeKey);

    expect(routeKeys).toEqual(Object.keys(EXPECTED_ROUTE_PERMISSIONS).sort());
    expect(
      routeKeys.some((route) =>
        /\/(?:publish|events|deliveries|fanout|retry)(?:\/|$)/.test(route),
      ),
    ).toBe(false);

    routes.forEach((route) => {
      const ControllerClass =
        route.controllerName === QqbotMessagePushController.name
          ? QqbotMessagePushController
          : QqbotAccountMessagePushController;
      const handler = ControllerClass.prototype[route.handlerName];
      expect(
        Reflect.getMetadata(QQBOT_MESSAGE_PUSH_PERMISSION, handler),
      ).toEqual(EXPECTED_ROUTE_PERMISSIONS[routeKey(route)]);
    });
  });

  it('uses page wrappers only for subscription and template pages', async () => {
    const sourceResponse = await request(apiUrl)
      .get('/qqbot/message-push/sources')
      .expect(200);
    const subscriptionResponse = await request(apiUrl)
      .get('/qqbot/message-push/subscriptions')
      .expect(200);
    const templateResponse = await request(apiUrl)
      .get('/qqbot/message-push/templates')
      .expect(200);
    const bindingResponse = await request(apiUrl)
      .get('/qqbot/accounts/12345/message-push/bindings')
      .expect(200);

    expect(Array.isArray(sourceResponse.body.data)).toBe(true);
    expect(subscriptionResponse.body.data).toMatchObject({ total: 1 });
    expect(Array.isArray(subscriptionResponse.body.data.items)).toBe(true);
    expect(templateResponse.body.data).toMatchObject({ total: 1 });
    expect(Array.isArray(templateResponse.body.data.items)).toBe(true);
    expect(Array.isArray(bindingResponse.body.data)).toBe(true);
  });

  it('keeps unavailable target lookup at HTTP 200 with an exact safe shape', async () => {
    const response = await request(apiUrl)
      .get('/qqbot/accounts/12345/message-push/targets')
      .expect(200);

    expect(response.body.data).toEqual({
      available: false,
      options: [],
      reasonCode: 'onebot_unavailable',
    });
  });

  it('attaches both guards and a strict controller-local ValidationPipe', () => {
    for (const ControllerClass of [
      QqbotMessagePushController,
      QqbotAccountMessagePushController,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, ControllerClass)).toEqual([
        JwtAuthGuard,
        QqbotMessagePushPermissionGuard,
      ]);
      const pipes = Reflect.getMetadata(PIPES_METADATA, ControllerClass);
      expect(pipes).toHaveLength(1);
      expect(pipes[0]).toBeInstanceOf(ValidationPipe);
      expect(pipes[0].validatorOptions).toMatchObject({
        forbidNonWhitelisted: true,
        whitelist: true,
      });
      expect(pipes[0].isTransformEnabled).toBe(true);
    }
  });

  it('shares one contract-error boundary across both message-push controllers', () => {
    for (const ControllerClass of [
      QqbotMessagePushController,
      QqbotAccountMessagePushController,
    ]) {
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, ControllerClass),
      ).toEqual([QqbotMessagePushContractErrorInterceptor]);
    }
  });

  it('maps a synchronous unknown source registry error to a safe HTTP 404', async () => {
    registry.get.mockImplementationOnce(() => {
      throw new SystemMessageContractError('unknown_message_source');
    });

    const response = await request(apiUrl)
      .get('/qqbot/message-push/sources/missing-source')
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      err: 'unknown_message_source',
      msg: 'unknown_message_source',
    });
  });

  it('maps template contract errors to a safe HTTP 400', async () => {
    templates.preview.mockImplementationOnce(() => {
      throw new SystemMessageContractError('template_invalid');
    });

    const response = await request(apiUrl)
      .post('/qqbot/message-push/templates/preview')
      .send({
        content: 'Endpoint: ${{endpoint}}',
        sourceKey: 'network.stun.mapping-port-changed',
      })
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      err: 'template_invalid',
      msg: 'template_invalid',
    });
  });

  it.each(['account_unavailable', 'ddns_not_synced'])(
    'maps async account binding contract error %s to a safe HTTP 409',
    async (code) => {
      bindings.createBinding.mockRejectedValueOnce(
        new SystemMessageContractError(code),
      );

      const response = await request(apiUrl)
        .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
        .send(bindingBody())
        .expect(409);

      expect(response.body).toEqual({
        code: 409,
        err: code,
        msg: code,
      });
    },
  );

  it('leaves ordinary failures at HTTP 500 without leaking their detail', async () => {
    templates.preview.mockImplementationOnce(() => {
      throw new Error('database password must-not-leak');
    });

    const response = await request(apiUrl)
      .post('/qqbot/message-push/templates/preview')
      .send({
        content: 'Endpoint: ${{endpoint}}',
        sourceKey: 'network.stun.mapping-port-changed',
      })
      .expect(500);

    expect(response.body).toEqual({
      code: 500,
      err: 'Internal server error',
      msg: 'Internal server error',
    });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  });

  it('returns HTTP 200 and a Vben wrapper for every POST route', async () => {
    const responses = await Promise.all([
      request(apiUrl)
        .post('/qqbot/message-push/subscriptions')
        .send(subscriptionBody())
        .expect(200),
      request(apiUrl)
        .post('/qqbot/message-push/templates')
        .send(templateBody())
        .expect(200),
      request(apiUrl)
        .post('/qqbot/message-push/templates/preview')
        .send({
          content: 'Endpoint: ${{endpoint}}',
          sourceKey: 'network.stun.mapping-port-changed',
        })
        .expect(200),
      request(apiUrl)
        .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
        .send(bindingBody())
        .expect(200),
    ]);
    responses.forEach((response) => {
      expect(response.body).toEqual(
        expect.objectContaining({ code: 200, msg: expect.any(String) }),
      );
    });
  });

  it.each([
    ['/qqbot/message-push/subscriptions', subscriptionBody()],
    ['/qqbot/message-push/templates', templateBody()],
    [
      '/qqbot/message-push/templates/preview',
      {
        content: 'Endpoint: ${{endpoint}}',
        sourceKey: 'network.stun.mapping-port-changed',
      },
    ],
    [`/qqbot/accounts/${SELF_ID}/message-push/bindings`, bindingBody()],
  ])('rejects unknown root request keys on POST %s', async (path, body) => {
    await request(apiUrl)
      .post(path)
      .send({ ...body, credential: 'must-reject' })
      .expect(400);
  });

  it('rejects unknown enabled, sourceConfig, and target fields', async () => {
    await request(apiUrl)
      .put(`/qqbot/message-push/subscriptions/${STRING_ID}/enabled`)
      .send({ enabled: false, secret: 'must-reject' })
      .expect(400);
    await request(apiUrl)
      .post('/qqbot/message-push/subscriptions')
      .send({
        ...subscriptionBody(),
        sourceConfig: {
          ...subscriptionBody().sourceConfig,
          credential: 'must-reject',
        },
      })
      .expect(400);
    const binding = bindingBody();
    binding.targets[0] = {
      ...binding.targets[0],
      accessToken: 'must-reject',
    } as never;
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(binding)
      .expect(400);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['array', []],
  ])(
    'rejects %s sourceConfig instead of skipping nested validation',
    async (_label, sourceConfig) => {
      const body = subscriptionBody() as Record<string, unknown>;
      if (sourceConfig === undefined) {
        delete body.sourceConfig;
      } else {
        body.sourceConfig = sourceConfig;
      }
      await request(apiUrl)
        .post('/qqbot/message-push/subscriptions')
        .send(body)
        .expect(400);
    },
  );

  it('rejects numeric foreign IDs and preserves long decimal strings', async () => {
    await request(apiUrl)
      .post('/qqbot/message-push/subscriptions')
      .send({
        ...subscriptionBody(),
        sourceConfig: {
          ddnsRecordId: 123,
          portForwardId: '1234567890123456789',
        },
      })
      .expect(400);
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send({ ...bindingBody(), subscriptionId: 123 })
      .expect(400);

    await request(apiUrl)
      .post('/qqbot/message-push/subscriptions')
      .send(subscriptionBody())
      .expect(200);
    expect(subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfig: expect.objectContaining({ ddnsRecordId: STRING_ID }),
      }),
    );
    expect(
      typeof subscriptions.create.mock.calls[0][0].sourceConfig.ddnsRecordId,
    ).toBe('string');
  });

  it.each(['0', '-1', '1.5', '1e5', '%20123', '1234567890123456789012345'])(
    'rejects invalid Snowflake path id %s',
    async (id) => {
      await request(apiUrl)
        .delete(`/qqbot/message-push/subscriptions/${id}`)
        .expect(400);
    },
  );

  it.each(['0', '1234', '-12345', '1.2345', '1e9999', '123456789012345678901'])(
    'rejects invalid selfId %s',
    async (selfId) => {
      await request(apiUrl)
        .get(`/qqbot/accounts/${selfId}/message-push/bindings`)
        .expect(400);
    },
  );

  it('transforms only literal query booleans', async () => {
    await request(apiUrl)
      .get('/qqbot/message-push/subscriptions?enabled=false')
      .expect(200);
    expect(subscriptions.page).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );

    for (const value of ['0', 'yes', '']) {
      await request(apiUrl)
        .get(`/qqbot/message-push/subscriptions?enabled=${value}`)
        .expect(400);
    }
  });

  it.each([
    ['target type', { targetType: 'channel' }],
    ['short target id', { targetId: '1234' }],
    ['zero target id', { targetId: '01234' }],
    ['numeric target id', { targetId: 12345 }],
  ])('rejects invalid %s', async (_label, override) => {
    const body = bindingBody();
    body.targets[0] = { ...body.targets[0], ...override } as never;
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(body)
      .expect(400);
  });

  it('enforces target count 1..100 with nested transformation', async () => {
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(bindingBody(0))
      .expect(400);
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(bindingBody(101))
      .expect(400);
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(bindingBody(1))
      .expect(200);
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(bindingBody(100))
      .expect(200);
    expect(bindings.createBinding.mock.calls.at(-1)?.[1].targets).toHaveLength(
      100,
    );
  });

  it('enforces name, remark, target name, and content boundaries', async () => {
    for (const body of [
      { ...subscriptionBody(), name: ' '.repeat(2) },
      { ...subscriptionBody(), name: 'x'.repeat(101) },
      { ...subscriptionBody(), remark: 'x'.repeat(501) },
    ]) {
      await request(apiUrl)
        .post('/qqbot/message-push/subscriptions')
        .send(body)
        .expect(400);
    }
    await request(apiUrl)
      .post('/qqbot/message-push/templates')
      .send({ ...templateBody(), content: '😀'.repeat(2001) })
      .expect(400);
    const binding = bindingBody();
    binding.targets[0].targetName = 'x'.repeat(121);
    await request(apiUrl)
      .post(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
      .send(binding)
      .expect(400);
  });

  it('returns only exact public response fields and recursively excludes secrets', async () => {
    targets.listTargetOptions.mockResolvedValueOnce({
      accessToken: 'must-not-leak',
      available: true,
      options: [
        {
          credential: 'must-not-leak',
          label: 'Target (10000)',
          targetId: '10000',
          targetType: 'group',
        },
      ],
      reasonCode: null,
    });
    const responses = await Promise.all([
      request(apiUrl).get('/qqbot/message-push/sources').expect(200),
      request(apiUrl)
        .get('/qqbot/message-push/sources/network.stun.mapping-port-changed')
        .expect(200),
      request(apiUrl)
        .get(
          '/qqbot/message-push/sources/network.stun.mapping-port-changed/options',
        )
        .expect(200),
      request(apiUrl).get('/qqbot/message-push/subscriptions').expect(200),
      request(apiUrl).get('/qqbot/message-push/templates').expect(200),
      request(apiUrl)
        .post('/qqbot/message-push/templates/preview')
        .send({
          content: 'Endpoint: ${{endpoint}}',
          sourceKey: 'network.stun.mapping-port-changed',
        })
        .expect(200),
      request(apiUrl)
        .get(`/qqbot/accounts/${SELF_ID}/message-push/bindings`)
        .expect(200),
      request(apiUrl)
        .get(`/qqbot/accounts/${SELF_ID}/message-push/targets`)
        .expect(200),
    ]);
    const [
      sourceList,
      sourceDetail,
      options,
      subscriptionPage,
      templatePage,
      preview,
      bindingList,
      targetOptions,
    ] = responses.map((response) => response.body.data);

    expect(Object.keys(sourceList[0]).sort()).toEqual(
      [
        'description',
        'displayName',
        'sourceKey',
        'subscriptionFields',
        'variables',
        'version',
      ].sort(),
    );
    expect(Object.keys(sourceDetail).sort()).toEqual(
      Object.keys(sourceList[0]).sort(),
    );
    expect(Object.keys(sourceList[0].subscriptionFields[0]).sort()).toEqual(
      ['key', 'label', 'optionCollection', 'required', 'type'].sort(),
    );
    expect(Object.keys(sourceList[0].subscriptionFields[1]).sort()).toEqual(
      [
        'dependsOn',
        'key',
        'label',
        'optionCollection',
        'required',
        'type',
      ].sort(),
    );
    expect(Object.keys(sourceList[0].variables[0]).sort()).toEqual(
      ['description', 'example', 'key', 'label', 'type'].sort(),
    );
    expect(Object.keys(options).sort()).toEqual([
      'ddnsRecords',
      'portForwards',
    ]);
    expect(Object.keys(options.ddnsRecords[0]).sort()).toEqual(
      [
        'disabledReasonCode',
        'eligible',
        'fqdn',
        'id',
        'name',
        'portForwardId',
      ].sort(),
    );
    expect(Object.keys(options.portForwards[0]).sort()).toEqual(
      [
        'disabledReasonCode',
        'eligible',
        'externalPort',
        'id',
        'internalPort',
        'name',
        'protocol',
      ].sort(),
    );
    expect(Object.keys(subscriptionPage.items[0]).sort()).toEqual(
      [
        'createTime',
        'enabled',
        'id',
        'invalidReasonCode',
        'name',
        'remark',
        'sourceConfig',
        'sourceKey',
        'sourceName',
        'sourceSummary',
        'updateTime',
        'valid',
      ].sort(),
    );
    expect(Object.keys(subscriptionPage.items[0].sourceConfig).sort()).toEqual([
      'ddnsRecordId',
      'portForwardId',
    ]);
    expect(Object.keys(templatePage.items[0]).sort()).toEqual(
      [
        'content',
        'createTime',
        'enabled',
        'id',
        'name',
        'referenceCount',
        'remark',
        'sourceKey',
        'sourceName',
        'updateTime',
      ].sort(),
    );
    expect(Object.keys(preview).sort()).toEqual([
      'renderedMessage',
      'variables',
    ]);
    expect(Object.keys(bindingList[0]).sort()).toEqual(
      [
        'available',
        'createTime',
        'enabled',
        'id',
        'invalidReasonCode',
        'sourceKey',
        'sourceName',
        'subscriptionId',
        'subscriptionName',
        'targets',
        'templateId',
        'templateName',
        'updateTime',
      ].sort(),
    );
    expect(Object.keys(bindingList[0].targets[0]).sort()).toEqual(
      ['enabled', 'id', 'targetId', 'targetName', 'targetType'].sort(),
    );
    expect(Object.keys(targetOptions).sort()).toEqual(
      ['available', 'options', 'reasonCode'].sort(),
    );
    expect(Object.keys(targetOptions.options[0]).sort()).toEqual(
      ['label', 'targetId', 'targetType'].sort(),
    );

    const forbiddenKeys =
      /accessToken|credential|secret|password|activeKey|sourceConfigDigest|payload|accountId|selfId|bindingId|isDeleted/i;
    responses.forEach((response) => {
      expect(collectKeys(response.body).join('\n')).not.toMatch(forbiddenKeys);
    });
  });
});
