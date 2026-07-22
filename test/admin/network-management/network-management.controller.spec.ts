import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { NetworkManagementController } from '../../../src/modules/admin/platform-config/network-management/network-management.controller';
import { NetworkManagementService } from '../../../src/modules/admin/platform-config/network-management/network-management.service';

describe('NetworkManagementController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const service = {
    agentStatus: jest.fn(),
    create: jest.fn(),
    disableKeeper: jest.fn(),
    enableKeeper: jest.fn(),
    endpointHistory: jest.fn(),
    list: jest.fn(),
    probe: jest.fn(),
    remove: jest.fn(),
    retry: jest.fn(),
    update: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NetworkManagementController],
      providers: [
        AdminSuperGuard,
        { provide: NetworkManagementService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().adminUser = {
            roles: [{ isDeleted: false, roleCode: 'super', status: 1 }],
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.list.mockResolvedValue({ items: [], total: 0 });
    service.create.mockResolvedValue({ id: '100', syncStatus: 'pending' });
    service.agentStatus.mockResolvedValue({
      agentId: 'nas-main',
      online: false,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes the persisted CRUD surface and rejects non-whitelisted fields', async () => {
    await request(apiUrl)
      .get('/system/network/port-forward/list?pageNo=1&pageSize=20')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(apiUrl)
      .post('/system/network/port-forward')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: 'Game Server',
        protocol: 'udp',
        routerPassword: 'must-not-be-accepted',
      })
      .expect(400);
    await request(apiUrl)
      .post('/system/network/port-forward')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: '   ',
        protocol: 'udp',
      })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('accepts legal desired state while returning pending immediately', async () => {
    const response = await request(apiUrl)
      .post('/system/network/port-forward')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: 'Game Server',
        protocol: 'udp',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data).toMatchObject({
      id: '100',
      syncStatus: 'pending',
    });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'udp' }),
    );
  });

  it('exposes asynchronous actions, history, and agent status routes', async () => {
    service.retry.mockResolvedValue({ id: '100' });
    service.enableKeeper.mockResolvedValue({ id: '100' });
    service.disableKeeper.mockResolvedValue({ id: '100' });
    service.probe.mockResolvedValue({ id: '100' });
    service.endpointHistory.mockResolvedValue({
      items: [
        {
          eventId: 'event-1',
          id: '300',
          occurredAt: '2026-07-22T01:02:05.000Z',
          portForwardId: '100',
          withdrawalReason: 'keeper_disabled',
        },
      ],
      total: 1,
    });
    service.agentStatus.mockResolvedValue({
      agentId: 'nas-main',
      lastErrorCode: 'router_conflict',
      lastErrorMessage: 'router conflict',
      online: false,
    });

    await request(apiUrl)
      .post('/system/network/port-forward/100/retry')
      .expect(200);
    await request(apiUrl)
      .post('/system/network/port-forward/100/keeper/enable')
      .expect(200);
    await request(apiUrl)
      .post('/system/network/port-forward/100/keeper/disable')
      .expect(200);
    await request(apiUrl)
      .post('/system/network/port-forward/100/probe')
      .expect(200);
    const historyResponse = await request(apiUrl)
      .get('/system/network/port-forward/100/endpoint-history')
      .expect(200);
    expect(historyResponse.body.data.items[0]).toMatchObject({
      portForwardId: '100',
      withdrawalReason: 'keeper_disabled',
    });
    const statusResponse = await request(apiUrl)
      .get('/system/network/agent/status')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(statusResponse.body.data).toMatchObject({
      lastErrorCode: 'router_conflict',
      lastErrorMessage: 'router conflict',
    });
  });
});
