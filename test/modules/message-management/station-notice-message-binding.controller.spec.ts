import { GUARDS_METADATA } from '@nestjs/common/constants';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { StationNoticeMessageBindingController } from '@/modules/admin/platform-config/notice/station-notice-message-binding.controller';
import { StationNoticeMessageBindingService } from '@/modules/admin/platform-config/notice/station-notice-message-binding.service';
import { MESSAGE_MANAGEMENT_PERMISSION } from '@/modules/message-management/contract/message-management-permission.decorator';
import { MessageManagementPermissionGuard } from '@/modules/message-management/contract/message-management-permission.guard';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';

const BINDING_ID = '2041700000000300001';
const SUBSCRIPTION_ID = '2041700000000200001';

const bindingView = () => ({
  available: true,
  createTime: '2026-08-18 10:00:00',
  enabled: true,
  id: BINDING_ID,
  invalidReasonCode: null,
  notifyRoleCode: 'super',
  sourceKey: 'network.stun.mapping-port-changed',
  sourceName: 'STUN 端点变化',
  subscriptionId: SUBSCRIPTION_ID,
  subscriptionName: '网络端点订阅',
  templates: [
    { id: '2041700000000100001', name: '简短模板', sortOrder: 0 },
    { id: '2041700000000100002', name: '详细模板', sortOrder: 1 },
  ],
  title: '网络连接状态变化',
  updateTime: '2026-08-18 10:00:00',
});

describe('StationNoticeMessageBindingController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const bindingService = {
    create: jest.fn(),
    list: jest.fn(),
    remove: jest.fn(),
    setEnabled: jest.fn(),
    update: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StationNoticeMessageBindingController],
      providers: [
        MessageManagementPermissionGuard,
        {
          provide: StationNoticeMessageBindingService,
          useValue: bindingService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MessageManagementPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    bindingService.list.mockResolvedValue([bindingView()]);
    bindingService.create.mockResolvedValue(bindingView());
    bindingService.update.mockResolvedValue(bindingView());
    bindingService.setEnabled.mockResolvedValue(bindingView());
    bindingService.remove.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('owns five station-notice adapter routes outside the message core', () => {
    const expectedPermissions: Record<string, string[]> = {
      'DELETE /message-management/subscribers/station-notice/bindings/:id': [
        'MessageManagement:Push:Delete',
      ],
      'GET /message-management/subscribers/station-notice/bindings': [
        'MessageManagement:Push:List',
      ],
      'POST /message-management/subscribers/station-notice/bindings': [
        'MessageManagement:Push:Create',
      ],
      'PUT /message-management/subscribers/station-notice/bindings/:id': [
        'MessageManagement:Push:Update',
      ],
      'PUT /message-management/subscribers/station-notice/bindings/:id/enabled':
        ['MessageManagement:Push:Toggle'],
    };
    const routes = collectControllerRoutes([
      StationNoticeMessageBindingController,
    ]);

    expect(routes.map(routeKey)).toEqual(
      Object.keys(expectedPermissions).sort(),
    );
    for (const route of routes) {
      const handler =
        StationNoticeMessageBindingController.prototype[route.handlerName];
      expect(
        Reflect.getMetadata(MESSAGE_MANAGEMENT_PERMISSION, handler),
      ).toEqual(expectedPermissions[routeKey(route)]);
    }
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        StationNoticeMessageBindingController,
      ),
    ).toEqual([JwtAuthGuard, MessageManagementPermissionGuard]);
  });

  it('returns every template attached to the selected station-notice subscription', async () => {
    const response = await request(apiUrl)
      .get('/message-management/subscribers/station-notice/bindings')
      .expect(200);

    expect(response.body.data[0].templates).toEqual([
      { id: '2041700000000100001', name: '简短模板', sortOrder: 0 },
      { id: '2041700000000100002', name: '详细模板', sortOrder: 1 },
    ]);
  });

  it('creates a station-notice adapter binding without accepting template ownership', async () => {
    const body = {
      enabled: true,
      notifyRoleCode: 'super',
      subscriptionId: SUBSCRIPTION_ID,
      title: '网络连接状态变化',
    };
    await request(apiUrl)
      .post('/message-management/subscribers/station-notice/bindings')
      .send(body)
      .expect(200);

    expect(bindingService.create).toHaveBeenCalledWith(body);
    await request(apiUrl)
      .post('/message-management/subscribers/station-notice/bindings')
      .send({ ...body, templateIds: ['2041700000000100001'] })
      .expect(400);
  });

  it('validates the subscription id and station-notice private fields', async () => {
    const path = '/message-management/subscribers/station-notice/bindings';
    await request(apiUrl)
      .post(path)
      .send({
        enabled: true,
        notifyRoleCode: 'super',
        subscriptionId: 123,
        title: '标题',
      })
      .expect(400);
    await request(apiUrl)
      .post(path)
      .send({
        enabled: true,
        notifyRoleCode: '',
        subscriptionId: SUBSCRIPTION_ID,
        title: '',
      })
      .expect(400);
  });
});
