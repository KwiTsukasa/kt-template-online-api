import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ClientIpService } from '../../../src/common/security/client-ip.service';

function createService(
  trustedProxyIps = '127.0.0.1,::1,10.66.66.1',
  nodeEnv = 'test',
) {
  return new ClientIpService(
    new ConfigService({
      NODE_ENV: nodeEnv,
      PUBLIC_SECURITY_TRUSTED_PROXY_IPS: trustedProxyIps,
    }),
  );
}

function createRequest(input: {
  forwardedHost?: string;
  forwardedFor?: string;
  forwardedPort?: string;
  forwardedProto?: string;
  host?: string;
  remoteAddress: string;
}) {
  return {
    headers: {
      host: input.host || 'nas4.kwitsukasa.top:45231',
      'x-forwarded-for': input.forwardedFor,
      'x-forwarded-host': input.forwardedHost,
      'x-forwarded-port': input.forwardedPort,
      'x-forwarded-proto': input.forwardedProto,
    },
    socket: {
      encrypted: false,
      remoteAddress: input.remoteAddress,
    },
  } as unknown as Request;
}

describe('ClientIpService', () => {
  it('normalizes IPv4-mapped IPv6 addresses', () => {
    const service = createService();

    expect(service.normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(service.normalizeIp('2001:db8::7')).toBe('2001:db8::7');
    expect(service.normalizeIp('invalid')).toBeNull();
  });

  it('trusts only exact configured peer addresses', () => {
    const service = createService('10.66.66.1,127.0.0.1');

    expect(service.isTrustedProxy('10.66.66.1')).toBe(true);
    expect(service.isTrustedProxy('10.66.66.2')).toBe(false);
    expect(service.isTrustedProxy('::ffff:127.0.0.1')).toBe(true);
  });

  it.each(['10.66.66.0/24', '*', 'true', 'gateway.local'])(
    'rejects non-exact trusted proxy configuration: %s',
    (value) => {
      expect(() => createService(value)).toThrow(
        'PUBLIC_SECURITY_TRUSTED_PROXY_IPS',
      );
    },
  );

  it('rejects an empty production trusted proxy list', () => {
    expect(() => createService('', 'production')).toThrow(
      'PUBLIC_SECURITY_TRUSTED_PROXY_IPS',
    );
  });

  it('keeps direct NATMap client address and ignores spoofed XFF', () => {
    const service = createService();
    const request = createRequest({
      forwardedFor: '198.51.100.200',
      remoteAddress: '203.0.113.9',
    });

    expect(service.getClientIp(request)).toBe('203.0.113.9');
  });

  it('walks a trusted Tencent/WireGuard proxy chain toward the client', () => {
    const service = createService();
    const request = createRequest({
      forwardedFor: '198.51.100.21, 10.66.66.1',
      remoteAddress: '127.0.0.1',
    });

    expect(service.getClientIp(request)).toBe('198.51.100.21');
  });

  it('stops at the first untrusted forwarded hop', () => {
    const service = createService();
    const request = createRequest({
      forwardedFor: '192.0.2.88, 198.51.100.91',
      remoteAddress: '127.0.0.1',
    });

    expect(service.getClientIp(request)).toBe('198.51.100.91');
  });

  it('ignores a malformed forwarded chain as a whole', () => {
    const service = createService();
    const request = createRequest({
      forwardedFor: '198.51.100.21, forged-value',
      remoteAddress: '127.0.0.1',
    });

    expect(service.getClientIp(request)).toBe('127.0.0.1');
  });

  it('derives the public origin from trusted proto and original Host', () => {
    const service = createService();
    const request = createRequest({
      forwardedHost: 'evil.example:443',
      forwardedPort: '45231',
      forwardedProto: 'https',
      host: 'nas4.kwitsukasa.top:45231',
      remoteAddress: '127.0.0.1',
    });

    expect(service.getPublicOrigin(request)).toBe(
      'https://nas4.kwitsukasa.top:45231',
    );
  });

  it('does not honor forwarded proto from an untrusted peer', () => {
    const service = createService();
    const request = createRequest({
      forwardedProto: 'https',
      remoteAddress: '203.0.113.9',
    });

    expect(service.getPublicOrigin(request)).toBe(
      'http://nas4.kwitsukasa.top:45231',
    );
  });

  it('uses forwarded port only as a consistency check', () => {
    const service = createService();
    const request = createRequest({
      forwardedPort: '443',
      forwardedProto: 'https',
      host: 'nas4.kwitsukasa.top:45231',
      remoteAddress: '127.0.0.1',
    });

    expect(() => service.getPublicOrigin(request)).toThrow(BadRequestException);
  });

  it('preserves an explicitly supplied default port in the original Host', () => {
    const service = createService();
    const request = createRequest({
      forwardedPort: '443',
      forwardedProto: 'https',
      host: 'nas4.kwitsukasa.top:443',
      remoteAddress: '127.0.0.1',
    });

    expect(service.getPublicOrigin(request)).toBe(
      'https://nas4.kwitsukasa.top:443',
    );
  });
});
