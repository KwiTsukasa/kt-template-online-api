import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { NetworkPortForwardGroupController } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.controller';
import { NetworkPortForwardGroupService } from '../../../src/modules/admin/platform-config/network-management/network-port-forward-group.service';

describe('NetworkPortForwardGroupController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const service = {
    create: jest.fn(),
    disableKeeper: jest.fn(),
    disableNatmap: jest.fn(),
    enableKeeper: jest.fn(),
    enableNatmap: jest.fn(),
    endpointHistory: jest.fn(),
    list: jest.fn(),
    probe: jest.fn(),
    remove: jest.fn(),
    retry: jest.fn(),
    update: jest.fn(),
  };
  const authGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const requestValue = context.switchToHttp().getRequest();
      const roleCode = requestValue.headers['x-test-role'] || 'super';
      requestValue.adminUser = {
        roles: [{ isDeleted: false, roleCode, status: 1 }],
      };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NetworkPortForwardGroupController],
      providers: [
        AdminSuperGuard,
        { provide: NetworkPortForwardGroupService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.list.mockResolvedValue({ items: [], total: 0 });
    service.create.mockResolvedValue({
      appliedProtocolMode: null,
      channels: { tcp: { id: '100' }, udp: { id: '101' } },
      id: '90071992547409930',
      protocolMode: 'tcp_udp',
    });
    service.update.mockResolvedValue({ id: '90071992547409930' });
    service.remove.mockResolvedValue({ id: '90071992547409930' });
    service.retry.mockResolvedValue({ id: '100' });
    service.enableNatmap.mockResolvedValue({ id: '100' });
    service.disableNatmap.mockResolvedValue({ id: '100' });
    service.enableKeeper.mockResolvedValue({ id: '101' });
    service.disableKeeper.mockResolvedValue({ id: '101' });
    service.probe.mockResolvedValue({ id: '101' });
    service.endpointHistory.mockResolvedValue({
      items: [{ mechanism: 'tcp_natmap', portForwardId: '100' }],
      total: 1,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves exact v2 CRUD routes with strict DTO validation and string IDs over real HTTP', async () => {
    await request(apiUrl)
      .get(
        '/system/network/port-forward-group/list?pageNo=1&pageSize=20&protocolMode=tcp_udp',
      )
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const invalidProtocol = await request(apiUrl)
      .post('/system/network/port-forward-group')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: 'dual',
        protocolMode: 'icmp',
      })
      .expect(400);
    expectChineseVbenValidation(invalidProtocol.body);
    const forbiddenField = await request(apiUrl)
      .post('/system/network/port-forward-group')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: 'dual',
        protocolMode: 'tcp_udp',
        routerPassword: 'forbidden',
      })
      .expect(400);
    expectChineseVbenValidation(forbiddenField.body);
    expect(JSON.stringify(forbiddenField.body)).not.toContain('forbidden');
    expect(JSON.stringify(forbiddenField.body)).not.toContain('routerPassword');

    const created = await request(apiUrl)
      .post('/system/network/port-forward-group')
      .send({
        externalPort: 9000,
        internalPort: 9000,
        name: 'dual',
        protocolMode: 'tcp_udp',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(created.body.data.id).toBe('90071992547409930');
    expect(typeof created.body.data.id).toBe('string');
    await request(apiUrl)
      .put('/system/network/port-forward-group/90071992547409930')
      .send({ remark: 'updated' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(apiUrl)
      .delete('/system/network/port-forward-group/90071992547409930')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(service.update).toHaveBeenCalledWith(
      '90071992547409930',
      expect.objectContaining({ remark: 'updated' }),
    );
  });

  it('serves every protocol-scoped action and history route over real HTTP', async () => {
    const groupId = '90071992547409930';
    await request(apiUrl)
      .post(`/system/network/port-forward-group/${groupId}/channels/tcp/retry`)
      .expect(200);
    await request(apiUrl)
      .post(`/system/network/port-forward-group/${groupId}/channels/udp/retry`)
      .expect(200);
    await request(apiUrl)
      .post(
        `/system/network/port-forward-group/${groupId}/channels/tcp/natmap/enable`,
      )
      .expect(200);
    await request(apiUrl)
      .post(
        `/system/network/port-forward-group/${groupId}/channels/tcp/natmap/disable`,
      )
      .expect(200);
    await request(apiUrl)
      .post(
        `/system/network/port-forward-group/${groupId}/channels/udp/keeper/enable`,
      )
      .expect(200);
    await request(apiUrl)
      .post(
        `/system/network/port-forward-group/${groupId}/channels/udp/keeper/disable`,
      )
      .expect(200);
    await request(apiUrl)
      .post(
        `/system/network/port-forward-group/${groupId}/channels/udp/keeper/probe`,
      )
      .expect(200);
    const tcpHistory = await request(apiUrl)
      .get(
        `/system/network/port-forward-group/${groupId}/channels/tcp/endpoint-history`,
      )
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const udpHistory = await request(apiUrl)
      .get(
        `/system/network/port-forward-group/${groupId}/channels/udp/endpoint-history`,
      )
      .expect(200);
    expect(tcpHistory.body.data.items[0].mechanism).toBe('tcp_natmap');
    expect(service.retry).toHaveBeenNthCalledWith(1, groupId, 'tcp');
    expect(service.retry).toHaveBeenNthCalledWith(2, groupId, 'udp');
    expect(service.endpointHistory).toHaveBeenNthCalledWith(
      1,
      groupId,
      'tcp',
      expect.any(Object),
    );
    expect(service.endpointHistory).toHaveBeenNthCalledWith(
      2,
      groupId,
      'udp',
      expect.any(Object),
    );
    expect(udpHistory.body.data.total).toBe(1);
  });

  it('enforces super-admin permission and maps service 400/409 errors to Chinese Vben msg', async () => {
    await request(apiUrl)
      .get('/system/network/port-forward-group/list')
      .set('X-Test-Role', 'member')
      .expect(403);

    service.enableNatmap.mockRejectedValueOnce(
      new HttpException(
        { code: HttpStatus.BAD_REQUEST, msg: 'TCP NATMap 状态不允许启用' },
        HttpStatus.BAD_REQUEST,
      ),
    );
    const badRequest = await request(apiUrl)
      .post('/system/network/port-forward-group/200/channels/tcp/natmap/enable')
      .expect(400);
    expect(badRequest.body.msg).toMatch(/TCP NATMap/);

    service.update.mockRejectedValueOnce(
      new HttpException(
        { code: HttpStatus.CONFLICT, msg: '逻辑组正在协调中' },
        HttpStatus.CONFLICT,
      ),
    );
    const conflict = await request(apiUrl)
      .put('/system/network/port-forward-group/200')
      .send({ protocolMode: 'udp' })
      .expect(409);
    expect(conflict.body.msg).toMatch(/协调/);
  });

  it('rejects invalid group IDs and protocols before calling the service', async () => {
    const invalidId = await request(apiUrl)
      .post(
        '/system/network/port-forward-group/not-a-number/channels/tcp/retry',
      )
      .expect(400);
    expectChineseVbenValidation(invalidId.body);
    const invalidProtocol = await request(apiUrl)
      .post('/system/network/port-forward-group/200/channels/icmp/retry')
      .expect(400);
    expectChineseVbenValidation(invalidProtocol.body);
    expect(service.retry).not.toHaveBeenCalled();
  });
});

function expectChineseVbenValidation(body: unknown): void {
  expect(body).toEqual({
    err: expect.any(String),
    msg: expect.any(String),
  });
  const response = body as { err: string; msg: string };
  expect(response.msg).toMatch(/[\u4e00-\u9fff]/);
  expect(response.err).toMatch(/[\u4e00-\u9fff]/);
}
