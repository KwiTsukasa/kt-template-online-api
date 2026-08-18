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
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { QqbotAccountMessagePushService } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-account-message-push.service';
import { MessageSubscriptionService } from '../../../../src/modules/message-management/application/message-subscription.service';
import { QqbotMessageTargetOptionsService } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-target-options.service';
import { MessageTemplateService } from '../../../../src/modules/message-management/application/message-template.service';
import { MessageSubscriberRegistry } from '../../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { SystemMessageSourceRegistry } from '../../../../src/modules/message-management/application/system-message-source.registry';
import { QqbotAccountMessagePushController } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-account-message-push.controller';
import { MessageManagementController } from '../../../../src/modules/message-management/contract/message-management.controller';
import { MessageManagementPermissionGuard } from '../../../../src/modules/message-management/contract/message-management-permission.guard';
import { MessageManagementContractErrorInterceptor } from '../../../../src/modules/message-management/contract/message-management-contract-error.interceptor';
import { MESSAGE_MANAGEMENT_PERMISSION } from '../../../../src/modules/message-management/contract/message-management-permission.decorator';
import { SystemMessageContractError } from '../../../../src/modules/message-management/contract/message-management.types';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

const SOURCE_READ_PERMISSIONS = [
  'MessageManagement:Subscription:List',
  'MessageManagement:Subscription:Create',
  'MessageManagement:Subscription:Update',
  'MessageManagement:Template:List',
  'MessageManagement:Template:Create',
  'MessageManagement:Template:Update',
  'MessageManagement:Template:Preview',
];

const EXPECTED_ROUTE_PERMISSIONS: Record<string, string[]> = {
  'DELETE /message-management/subscribers/qqbot/accounts/:selfId/bindings/:id':
    ['MessageManagement:Push:Delete', 'QqBot:Account:MessagePush:Delete'],
  'DELETE /message-management/subscriptions/:id': [
    'MessageManagement:Subscription:Delete',
  ],
  'DELETE /message-management/templates/:id': [
    'MessageManagement:Template:Delete',
  ],
  'DELETE /qqbot/accounts/:selfId/message-push/bindings/:id': [
    'MessageManagement:Push:Delete',
    'QqBot:Account:MessagePush:Delete',
  ],
  'GET /message-management/sources': SOURCE_READ_PERMISSIONS,
  'GET /message-management/sources/:sourceKey': SOURCE_READ_PERMISSIONS,
  'GET /message-management/sources/:sourceKey/subscription-options': [
    'MessageManagement:Subscription:Create',
    'MessageManagement:Subscription:Update',
  ],
  'GET /message-management/subscribers': SOURCE_READ_PERMISSIONS,
  'GET /message-management/subscribers/qqbot/accounts/:selfId/bindings': [
    'MessageManagement:Push:List',
    'QqBot:Account:MessagePush:List',
  ],
  'GET /message-management/subscribers/qqbot/accounts/:selfId/targets': [
    'MessageManagement:Push:Create',
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'GET /message-management/subscriptions': [
    'MessageManagement:Subscription:List',
  ],
  'GET /message-management/templates': ['MessageManagement:Template:List'],
  'GET /qqbot/accounts/:selfId/message-push/bindings': [
    'MessageManagement:Push:List',
    'QqBot:Account:MessagePush:List',
  ],
  'GET /qqbot/accounts/:selfId/message-push/targets': [
    'MessageManagement:Push:Create',
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  ],
  'POST /message-management/subscribers/qqbot/accounts/:selfId/bindings': [
    'MessageManagement:Push:Create',
    'QqBot:Account:MessagePush:Create',
  ],
  'POST /message-management/subscriptions': [
    'MessageManagement:Subscription:Create',
  ],
  'POST /message-management/templates': ['MessageManagement:Template:Create'],
  'POST /message-management/templates/preview': [
    'MessageManagement:Template:Preview',
  ],
  'POST /qqbot/accounts/:selfId/message-push/bindings': [
    'MessageManagement:Push:Create',
    'QqBot:Account:MessagePush:Create',
  ],
  'PUT /message-management/subscribers/qqbot/accounts/:selfId/bindings/:id': [
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Update',
  ],
  'PUT /message-management/subscribers/qqbot/accounts/:selfId/bindings/:id/enabled':
    ['MessageManagement:Push:Toggle', 'QqBot:Account:MessagePush:Toggle'],
  'PUT /message-management/subscriptions/:id': [
    'MessageManagement:Subscription:Update',
  ],
  'PUT /message-management/subscriptions/:id/enabled': [
    'MessageManagement:Subscription:Toggle',
  ],
  'PUT /message-management/templates/:id': [
    'MessageManagement:Template:Update',
  ],
  'PUT /message-management/templates/:id/enabled': [
    'MessageManagement:Template:Toggle',
  ],
  'PUT /qqbot/accounts/:selfId/message-push/bindings/:id': [
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Update',
  ],
  'PUT /qqbot/accounts/:selfId/message-push/bindings/:id/enabled': [
    'MessageManagement:Push:Toggle',
    'QqBot:Account:MessagePush:Toggle',
  ],
};

const STRING_ID = '123456789012345678901234';
const FORBIDDEN_FIELD_FIXTURE = 'test-only-redacted-value';
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
  subscriberKey: 'qqbot',
  templateIds: ['1234567890123456789', '1234567890123456790'],
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
        accessToken: FORBIDDEN_FIELD_FIXTURE,
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
    subscriberKey: 'qqbot',
    subscriberName: 'QQBot',
    templates: [
      { id: '1234567890123456789', name: 'Template A', sortOrder: 0 },
      { id: '1234567890123456790', name: 'Template B', sortOrder: 1 },
    ],
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
    templates: [
      { id: '1234567890123456789', name: 'Template A', sortOrder: 0 },
      { id: '1234567890123456790', name: 'Template B', sortOrder: 1 },
    ],
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
  const subscriberRegistry = {
    listDefinitions: jest.fn().mockReturnValue([]),
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
        MessageManagementController,
        QqbotAccountMessagePushController,
      ],
      providers: [
        MessageManagementPermissionGuard,
        { provide: SystemMessageSourceRegistry, useValue: registry },
        { provide: MessageSubscriberRegistry, useValue: subscriberRegistry },
        { provide: MessageSubscriptionService, useValue: subscriptions },
        { provide: MessageTemplateService, useValue: templates },
        { provide: QqbotAccountMessagePushService, useValue: bindings },
        { provide: QqbotMessageTargetOptionsService, useValue: targets },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MessageManagementPermissionGuard)
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
    subscriberRegistry.listDefinitions.mockReturnValue([
      {
        credential: 'must-not-leak',
        description: 'QQ delivery',
        displayName: 'QQBot',
        subscriberKey: 'qqbot',
        version: 1,
      },
      {
        description: 'Station notice delivery',
        displayName: '站内信',
        subscriberKey: 'station-notice',
        version: 1,
      },
    ]);
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
            dependsOnValue: '1234567890123456789',
            disabled: false,
            disabledReasonCode: null,
            eligible: true,
            fqdn: 'example.test',
            id: STRING_ID,
            label: 'DDNS · example.test',
            name: 'DDNS',
            portForwardId: '1234567890123456789',
            value: STRING_ID,
          },
        ],
        portForwards: [
          {
            accessToken: FORBIDDEN_FIELD_FIXTURE,
            disabled: false,
            disabledReasonCode: null,
            eligible: true,
            externalPort: 10_000,
            id: '1234567890123456789',
            internalPort: 8211,
            label: 'STUN · UDP:10000',
            name: 'STUN',
            protocol: 'udp',
            value: '1234567890123456789',
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

  it('exposes exactly the approved protocol and QQBot adapter routes', () => {
    const routes = collectControllerRoutes([
      MessageManagementController,
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
        route.controllerName === MessageManagementController.name
          ? MessageManagementController
          : QqbotAccountMessagePushController;
      const handler = ControllerClass.prototype[route.handlerName];
      expect(
        Reflect.getMetadata(MESSAGE_MANAGEMENT_PERMISSION, handler),
      ).toEqual(EXPECTED_ROUTE_PERMISSIONS[routeKey(route)]);
    });
  });

  it('resolves dependent TCP NATMap options through the generic source endpoints', async () => {
    const definition = {
      description: 'TCP NATMap 端点变更',
      displayName: 'TCP NATMap 端点变更',
      sourceKey: 'network.tcp.natmap-endpoint-changed',
      subscriptionFields: [
        {
          key: 'tcpChannelId',
          label: 'TCP NATMap 通道',
          optionCollection: 'tcpChannels',
          required: true,
          type: 'select',
        },
        {
          dependsOn: 'tcpChannelId',
          key: 'ddnsRecordId',
          label: 'IPv4 DDNS 记录',
          optionCollection: 'ddnsRecords',
          required: true,
          type: 'select',
        },
      ],
      variables: [],
      version: 1,
    };
    registry.get.mockReturnValueOnce({
      definition,
      listSubscriptionOptions: jest.fn().mockResolvedValue({
        ddnsRecords: [
          {
            credential: 'must-not-leak',
            dependsOnValue: 'tcp-channel-1',
            disabled: false,
            disabledReasonCode: null,
            label: 'Pal TCP · pal.example.test',
            value: 'ddns-1',
          },
        ],
        tcpChannels: [
          {
            disabled: false,
            disabledReasonCode: null,
            label: '帕鲁新世界 / TCP NATMap',
            value: 'tcp-channel-1',
          },
        ],
      }),
    });
    const options = await request(apiUrl)
      .get(
        '/message-management/sources/network.tcp.natmap-endpoint-changed/subscription-options',
      )
      .expect(200);
    expect(options.body.data).toEqual({
      ddnsRecords: [
        {
          dependsOnValue: 'tcp-channel-1',
          disabled: false,
          disabledReasonCode: null,
          label: 'Pal TCP · pal.example.test',
          value: 'ddns-1',
        },
      ],
      tcpChannels: [
        {
          disabled: false,
          disabledReasonCode: null,
          label: '帕鲁新世界 / TCP NATMap',
          value: 'tcp-channel-1',
        },
      ],
    });

    subscriptions.page.mockResolvedValueOnce({
      items: [
        {
          ...(subscriptionView() as unknown as Record<string, unknown>),
          sourceConfig: {
            credential: 'must-not-leak',
            ddnsRecordId: 'ddns-1',
            tcpChannelId: 'tcp-channel-1',
          },
          sourceKey: definition.sourceKey,
          sourceName: definition.displayName,
        },
      ],
      total: 1,
    });
    registry.get.mockReturnValueOnce({ definition });
    const subscriptionsResponse = await request(apiUrl)
      .get('/message-management/subscriptions')
      .expect(200);
    expect(subscriptionsResponse.body.data.items[0].sourceConfig).toEqual({
      ddnsRecordId: 'ddns-1',
      tcpChannelId: 'tcp-channel-1',
    });
  });

  it('uses page wrappers only for subscription and template pages', async () => {
    const subscriberResponse = await request(apiUrl)
      .get('/message-management/subscribers')
      .expect(200);
    const sourceResponse = await request(apiUrl)
      .get('/message-management/sources')
      .expect(200);
    const subscriptionResponse = await request(apiUrl)
      .get('/message-management/subscriptions')
      .expect(200);
    const templateResponse = await request(apiUrl)
      .get('/message-management/templates')
      .expect(200);
    const bindingResponse = await request(apiUrl)
      .get('/qqbot/accounts/12345/message-push/bindings')
      .expect(200);

    expect(Array.isArray(subscriberResponse.body.data)).toBe(true);
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
      MessageManagementController,
      QqbotAccountMessagePushController,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, ControllerClass)).toEqual([
        JwtAuthGuard,
        MessageManagementPermissionGuard,
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
      MessageManagementController,
      QqbotAccountMessagePushController,
    ]) {
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, ControllerClass),
      ).toEqual([MessageManagementContractErrorInterceptor]);
    }
  });

  it('maps a synchronous unknown source registry error to a safe HTTP 404', async () => {
    registry.get.mockImplementationOnce(() => {
      throw new SystemMessageContractError('unknown_message_source');
    });

    const response = await request(apiUrl)
      .get('/message-management/sources/missing-source')
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
      .post('/message-management/templates/preview')
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
      .post('/message-management/templates/preview')
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
        .post('/message-management/subscriptions')
        .send(subscriptionBody())
        .expect(200),
      request(apiUrl)
        .post('/message-management/templates')
        .send(templateBody())
        .expect(200),
      request(apiUrl)
        .post('/message-management/templates/preview')
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
    ['/message-management/subscriptions', subscriptionBody()],
    ['/message-management/templates', templateBody()],
    [
      '/message-management/templates/preview',
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

  it('rejects unknown enabled and target fields plus non-string source config', async () => {
    await request(apiUrl)
      .put(`/message-management/subscriptions/${STRING_ID}/enabled`)
      .send({ enabled: false, secret: FORBIDDEN_FIELD_FIXTURE })
      .expect(400);
    await request(apiUrl)
      .post('/message-management/subscriptions')
      .send({
        ...subscriptionBody(),
        sourceConfig: {
          ...subscriptionBody().sourceConfig,
          credential: 123,
        },
      })
      .expect(400);
    const binding = bindingBody();
    binding.targets[0] = {
      ...binding.targets[0],
      accessToken: FORBIDDEN_FIELD_FIXTURE,
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
        .post('/message-management/subscriptions')
        .send(body)
        .expect(400);
    },
  );

  it('rejects numeric foreign IDs and preserves long decimal strings', async () => {
    await request(apiUrl)
      .post('/message-management/subscriptions')
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
      .post('/message-management/subscriptions')
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
        .delete(`/message-management/subscriptions/${id}`)
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
      .get('/message-management/subscriptions?enabled=false')
      .expect(200);
    expect(subscriptions.page).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );

    for (const value of ['0', 'yes', '']) {
      await request(apiUrl)
        .get(`/message-management/subscriptions?enabled=${value}`)
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
        .post('/message-management/subscriptions')
        .send(body)
        .expect(400);
    }
    await request(apiUrl)
      .post('/message-management/templates')
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
      accessToken: FORBIDDEN_FIELD_FIXTURE,
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
      request(apiUrl).get('/message-management/subscribers').expect(200),
      request(apiUrl).get('/message-management/sources').expect(200),
      request(apiUrl)
        .get('/message-management/sources/network.stun.mapping-port-changed')
        .expect(200),
      request(apiUrl)
        .get(
          '/message-management/sources/network.stun.mapping-port-changed/subscription-options',
        )
        .expect(200),
      request(apiUrl).get('/message-management/subscriptions').expect(200),
      request(apiUrl).get('/message-management/templates').expect(200),
      request(apiUrl)
        .post('/message-management/templates/preview')
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
      subscriberList,
      sourceList,
      sourceDetail,
      options,
      subscriptionPage,
      templatePage,
      preview,
      bindingList,
      targetOptions,
    ] = responses.map((response) => response.body.data);

    expect(Object.keys(subscriberList[0]).sort()).toEqual(
      ['description', 'displayName', 'subscriberKey', 'version'].sort(),
    );
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
        'dependsOnValue',
        'disabled',
        'disabledReasonCode',
        'label',
        'value',
      ].sort(),
    );
    expect(Object.keys(options.portForwards[0]).sort()).toEqual(
      ['disabled', 'disabledReasonCode', 'label', 'value'].sort(),
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
        'subscriberKey',
        'subscriberName',
        'templates',
        'updateTime',
        'valid',
      ].sort(),
    );
    expect(Object.keys(subscriptionPage.items[0].sourceConfig).sort()).toEqual([
      'ddnsRecordId',
      'portForwardId',
    ]);
    expect(Object.keys(subscriptionPage.items[0].templates[0]).sort()).toEqual(
      ['id', 'name', 'sortOrder'].sort(),
    );
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
        'templates',
        'updateTime',
      ].sort(),
    );
    expect(Object.keys(bindingList[0].templates[0]).sort()).toEqual(
      ['id', 'name', 'sortOrder'].sort(),
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
