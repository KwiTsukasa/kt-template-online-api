import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { NetworkWireGuardEndpointService } from '../../../src/modules/admin/platform-config/network-management/application/network-wireguard-endpoint.service';
import { NetworkWireGuardEndpointController } from '../../../src/modules/admin/platform-config/network-management/presentation/network-wireguard-endpoint.controller';
import { NetworkWireGuardEndpointGuard } from '../../../src/modules/admin/platform-config/network-management/presentation/network-wireguard-endpoint.guard';

const TEST_RELAY_HEADER = 'r'.repeat(32);

describe('NetworkWireGuardEndpointService', () => {
  it('returns only the unique fresh managed UDP NATMap endpoint', async () => {
    const repository = {
      find: jest.fn(async () => [
        {
          currentEndpointIdentity: 'a'.repeat(64),
          currentPublicIpv4: '112.32.126.33',
          currentPublicPort: 51654,
          currentValidUntil: new Date(Date.now() + 60_000),
          desiredRevision: '9',
          id: '30',
          natmapStatus: 'active',
          reportedRevision: '9',
          syncStatus: 'synced',
        },
      ]),
    };
    const service = new NetworkWireGuardEndpointService(repository as never);
    await expect(service.current()).resolves.toMatchObject({
      channelId: '30',
      endpointIdentity: 'a'.repeat(64),
      mechanism: 'udp_natmap',
      publicIpv4: '112.32.126.33',
      publicPort: 51654,
      reportedRevision: '9',
    });
    expect(repository.find).toHaveBeenCalledWith({
      take: 2,
      where: expect.objectContaining({
        externalPort: 51825,
        internalPort: 51820,
        natmapDesiredEnabled: true,
        protocol: 'udp',
      }),
    });
  });

  it.each([
    ['missing', []],
    ['ambiguous', [{}, {}]],
    [
      'stale',
      [
        {
          currentEndpointIdentity: 'a'.repeat(64),
          currentPublicIpv4: '112.32.126.33',
          currentPublicPort: 51654,
          currentValidUntil: new Date(Date.now() - 1),
          desiredRevision: '9',
          id: '30',
          natmapStatus: 'active',
          reportedRevision: '9',
          syncStatus: 'synced',
        },
      ],
    ],
  ])('fails closed for %s endpoint state', async (_, rows) => {
    const service = new NetworkWireGuardEndpointService({
      find: jest.fn(async () => rows),
    } as never);
    await expect(service.current()).rejects.toMatchObject({ status: 503 });
  });
});

describe('NetworkWireGuardEndpointGuard', () => {
  const context = (secret: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          header: (name: string) =>
            name === 'x-kt-relay-secret' ? secret : undefined,
        }),
      }),
    }) as never;

  it('accepts only the existing PC Relay shared secret', () => {
    const guard = new NetworkWireGuardEndpointGuard({
      get: () => TEST_RELAY_HEADER,
    } as never);
    expect(guard.canActivate(context(TEST_RELAY_HEADER))).toBe(true);
    expect(() => guard.canActivate(context(`${TEST_RELAY_HEADER}x`))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(context(''))).toThrow(UnauthorizedException);
  });
});

describe('NetworkWireGuardEndpointController', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('serves the narrow endpoint over real HTTP only with the Relay secret', async () => {
    const current = jest.fn(async () => ({
      channelId: '30',
      endpointIdentity: 'a'.repeat(64),
      mechanism: 'udp_natmap',
      publicIpv4: '112.32.126.33',
      publicPort: 51654,
      reportedRevision: '9',
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    }));
    const module = await Test.createTestingModule({
      controllers: [NetworkWireGuardEndpointController],
      providers: [
        NetworkWireGuardEndpointGuard,
        {
          provide: ConfigService,
          useValue: { get: () => TEST_RELAY_HEADER },
        },
        { provide: NetworkWireGuardEndpointService, useValue: { current } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get('/system/network/wireguard/endpoint')
      .set('x-kt-relay-secret', TEST_RELAY_HEADER)
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 200,
          data: { mechanism: 'udp_natmap', publicPort: 51654 },
        });
      });
    await request(app.getHttpServer())
      .get('/system/network/wireguard/endpoint')
      .set('x-kt-relay-secret', 'wrong')
      .expect(401);
    expect(current).toHaveBeenCalledTimes(1);
  });
});
