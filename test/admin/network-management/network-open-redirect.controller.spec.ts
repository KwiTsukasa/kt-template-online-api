import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '../../../src/common';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { NetworkOpenRedirectController } from '../../../src/modules/admin/platform-config/network-management/presentation/network-open-redirect.controller';
import { NetworkOpenRedirectService } from '../../../src/modules/admin/platform-config/network-management/application/network-open-redirect.service';

describe('NetworkOpenRedirectController', () => {
  let app: INestApplication;
  const service = {
    resolve: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NetworkOpenRedirectController],
      providers: [{ provide: NetworkOpenRedirectService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.resolve.mockReset();
    service.resolve.mockImplementation(async (serviceKey: string) =>
      serviceKey === 'admin'
        ? {
            endpointGeneration: 'a'.repeat(64),
            endpointIpv4: '112.32.125.92',
            endpointValidUntil: '2026-08-11T12:00:00.000Z',
            location: 'https://nas4.kwitsukasa.top:52418/admin/',
            status: 'found',
          }
        : { status: 'not_found' },
    );
  });

  it.each(['get', 'head'] as const)(
    'returns an empty temporary redirect for %s with no-cache headers',
    async (method) => {
      const response = await request(app.getHttpServer())
        [method]('/network/open-redirect/admin?next=https://evil.example')
        .set('Host', 'open.kwitsukasa.top')
        .redirects(0)
        .expect(302)
        .expect('Location', 'https://nas4.kwitsukasa.top:52418/admin/')
        .expect('Cache-Control', 'no-store, private')
        .expect('Pragma', 'no-cache')
        .expect('Referrer-Policy', 'no-referrer')
        .expect('X-KT-Endpoint-IPv4', '112.32.125.92')
        .expect('X-KT-Endpoint-Generation', 'a'.repeat(64))
        .expect('X-KT-Endpoint-Valid-Until', '2026-08-11T12:00:00.000Z')
        .expect('X-Robots-Tag', 'noindex, nofollow');

      expect(response.text || '').toBe('');
      expect(service.resolve).toHaveBeenCalledWith('admin');
    },
  );

  it('returns a controlled unavailable response without a redirect target', async () => {
    service.resolve.mockResolvedValueOnce({ status: 'unavailable' });

    const response = await request(app.getHttpServer())
      .get('/network/open-redirect/admin')
      .set('Host', 'open.kwitsukasa.top')
      .expect(503)
      .expect('Retry-After', '30')
      .expect('Cache-Control', 'no-store, private');

    expect(response.headers).not.toHaveProperty('location');
    expect(response.headers).not.toHaveProperty('x-kt-endpoint-ipv4');
    expect(response.headers).not.toHaveProperty('x-kt-endpoint-generation');
    expect(response.headers).not.toHaveProperty('x-kt-endpoint-valid-until');
    expect(response.text).toBe('');
  });

  it('converts resolver failures to the same non-sensitive unavailable response', async () => {
    service.resolve.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await request(app.getHttpServer())
      .get('/network/open-redirect/admin')
      .set('Host', 'open.kwitsukasa.top')
      .expect(503)
      .expect('Retry-After', '30')
      .expect('Cache-Control', 'no-store, private');

    expect(response.headers).not.toHaveProperty('location');
    expect(response.text).toBe('');
  });

  it('returns 404 for the removed mcs alias without exposing a fallback target', async () => {
    service.resolve.mockResolvedValueOnce({ status: 'not_found' });

    const response = await request(app.getHttpServer())
      .get('/network/open-redirect/mcs')
      .set('Host', 'open.kwitsukasa.top')
      .expect(404);

    expect(response.headers).not.toHaveProperty('location');
    expect(response.text).toBe('');
  });

  it.each([
    [
      'foreign Host',
      'get',
      '/network/open-redirect/admin',
      'api.kwitsukasa.top',
      false,
    ],
    [
      'extra path',
      'get',
      '/network/open-redirect/admin/extra',
      'open.kwitsukasa.top',
      false,
    ],
    [
      'encoded slash',
      'get',
      '/network/open-redirect/admin%2fextra',
      'open.kwitsukasa.top',
      true,
    ],
    [
      'encoded backslash',
      'get',
      '/network/open-redirect/admin%5cextra',
      'open.kwitsukasa.top',
      true,
    ],
    [
      'double slash',
      'get',
      '/network/open-redirect//admin',
      'open.kwitsukasa.top',
      false,
    ],
    [
      'POST',
      'post',
      '/network/open-redirect/admin',
      'open.kwitsukasa.top',
      false,
    ],
    [
      'PUT',
      'put',
      '/network/open-redirect/admin',
      'open.kwitsukasa.top',
      false,
    ],
  ])(
    'does not redirect %s',
    async (_name, method, path, host, callsResolver) => {
      service.resolve.mockClear();

      await request(app.getHttpServer())
        [method as 'get'](path)
        .set('Host', host)
        .expect(404);

      if (callsResolver) {
        expect(service.resolve).toHaveBeenCalledTimes(1);
      } else {
        expect(service.resolve).not.toHaveBeenCalled();
      }
    },
  );

  it('marks both redirect handlers as explicit public reads', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        NetworkOpenRedirectController.prototype.head,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        NetworkOpenRedirectController.prototype.get,
      ),
    ).toBe(true);
  });
});
