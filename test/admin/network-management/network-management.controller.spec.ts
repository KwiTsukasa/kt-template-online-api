import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Observable, of } from 'rxjs';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { NetworkManagementController } from '../../../src/modules/admin/platform-config/network-management/network-management.controller';
import { NetworkDdnsService } from '../../../src/modules/admin/platform-config/network-management/network-ddns.service';
import {
  NetworkManagementEventStreamService,
  type NetworkManagementStreamEvent,
} from '../../../src/modules/admin/platform-config/network-management/network-management-event-stream.service';
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
  const eventStream = {
    stream: jest.fn<
      Observable<NetworkManagementStreamEvent>,
      [lastEventId?: string]
    >(() =>
      of<NetworkManagementStreamEvent>({
        data: {
          eventId: 'network-event-1',
          observedAt: '2026-07-23T00:00:00.000Z',
          source: 'reported',
        },
        id: 'network-event-1',
        type: 'network-state-changed',
      }),
    ),
  };
  const ddnsService = {
    create: jest.fn(),
    getProviderStatus: jest.fn(),
    list: jest.fn(),
    remove: jest.fn(),
    retry: jest.fn(),
    sourceOptions: jest.fn(),
    update: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NetworkManagementController],
      providers: [
        AdminSuperGuard,
        { provide: NetworkManagementService, useValue: service },
        { provide: NetworkDdnsService, useValue: ddnsService },
        {
          provide: NetworkManagementEventStreamService,
          useValue: eventStream,
        },
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
    ddnsService.list.mockResolvedValue({ items: [], total: 0 });
    ddnsService.sourceOptions.mockResolvedValue([]);
    ddnsService.getProviderStatus.mockReturnValue({
      configured: true,
      enabled: true,
      provider: 'dnspod',
    });
    ddnsService.create.mockResolvedValue({
      id: '200',
      recordType: 'AAAA',
      syncStatus: 'pending',
    });
    ddnsService.update.mockResolvedValue({ id: '200' });
    ddnsService.remove.mockResolvedValue({ id: '200' });
    ddnsService.retry.mockResolvedValue({ id: '200' });
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

  it('streams committed MQTT updates through a real SSE HTTP request', async () => {
    await request(apiUrl)
      .get('/system/network/events/stream?lastEventId=query-event')
      .set('Last-Event-ID', 'header-event')
      .buffer(true)
      .parse((response, callback) => {
        response.once('data', () => callback(null, 'ok'));
      })
      .expect('content-type', /text\/event-stream/)
      .expect(200);

    expect(eventStream.stream).toHaveBeenCalledWith('header-event');
    expect(service.list).not.toHaveBeenCalled();
    expect(service.agentStatus).not.toHaveBeenCalled();
  });

  it('exposes strict dual-stack DDNS CRUD without provider credentials', async () => {
    await request(apiUrl)
      .get('/system/network/ddns/list?pageNo=1&pageSize=20&recordType=AAAA')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const sources = await request(apiUrl)
      .get('/system/network/ddns/source-options?recordType=AAAA')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(sources.body.data).toEqual({ items: [] });
    const provider = await request(apiUrl)
      .get('/system/network/ddns/provider-status')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(provider.body.data).toEqual({
      configured: true,
      enabled: true,
      provider: 'dnspod',
    });
    expect(JSON.stringify(provider.body)).not.toMatch(
      /secret|credential|token/i,
    );

    await request(apiUrl)
      .post('/system/network/ddns')
      .send({
        domain: 'kwitsukasa.top',
        enabled: true,
        name: 'NAS IPv6',
        recordType: 'AAAA',
        secretKey: 'must-not-be-accepted',
        sourceType: 'agent_ipv6',
        subDomain: 'nas6',
      })
      .expect(400);
    expect(ddnsService.create).not.toHaveBeenCalled();

    await request(apiUrl)
      .post('/system/network/ddns')
      .send({
        domain: 'kwitsukasa.top',
        enabled: true,
        name: 'NAS IPv4',
        recordType: 'A',
        sourceType: 'port_forward_ipv4',
        subDomain: 'nas',
      })
      .expect(400);

    const created = await request(apiUrl)
      .post('/system/network/ddns')
      .send({
        domain: 'kwitsukasa.top',
        enabled: true,
        name: 'NAS IPv6',
        recordType: 'AAAA',
        sourceType: 'agent_ipv6',
        subDomain: 'nas6',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      id: '200',
      recordType: 'AAAA',
    });
    expect(ddnsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'AAAA',
        sourceType: 'agent_ipv6',
      }),
    );

    await request(apiUrl)
      .put('/system/network/ddns/200')
      .send({
        domain: 'kwitsukasa.top',
        enabled: false,
        name: 'NAS IPv6',
        recordType: 'AAAA',
        sourceType: 'agent_ipv6',
        subDomain: 'nas6',
      })
      .expect(200);
    await request(apiUrl).post('/system/network/ddns/200/retry').expect(200);
    await request(apiUrl).delete('/system/network/ddns/200').expect(200);
  });

  it.each([123, '', '100'])(
    'rejects an AAAA request that supplies portForwardId=%p',
    async (portForwardId) => {
      await request(apiUrl)
        .post('/system/network/ddns')
        .send({
          domain: 'kwitsukasa.top',
          enabled: true,
          name: 'NAS IPv6',
          portForwardId,
          recordType: 'AAAA',
          sourceType: 'agent_ipv6',
          subDomain: 'nas6',
        })
        .expect(400);

      expect(ddnsService.create).not.toHaveBeenCalled();
    },
  );

  it('keeps an empty heartbeat cursor instead of accepting a Nest-generated ID', async () => {
    let parsed = false;
    let serialized = '';
    eventStream.stream.mockReturnValueOnce(
      of({
        data: {
          message: 'alive',
          observedAt: '2026-07-23T00:00:00.000Z',
        },
        id: '',
        type: 'heartbeat',
      }),
    );

    await request(apiUrl)
      .get('/system/network/events/stream')
      .buffer(true)
      .parse((response, callback) => {
        response.on('data', (chunk) => {
          serialized += chunk.toString('utf8');
          if (!parsed && serialized.includes('event: heartbeat')) {
            parsed = true;
            callback(null, 'ok');
          }
        });
      })
      .expect(200);

    expect(serialized).toContain('event: heartbeat\nid: \n');
    expect(serialized).not.toContain('id: 1\n');
  });
});
