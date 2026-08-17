import { isIP } from 'node:net';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const TRUSTED_PROXY_CONFIG_KEY = 'PUBLIC_SECURITY_TRUSTED_PROXY_IPS';

@Injectable()
export class ClientIpService {
  private readonly trustedProxyIps: ReadonlySet<string>;

  constructor(private readonly configService: ConfigService) {
    this.trustedProxyIps = new Set(this.readTrustedProxyIps());
  }

  /** 规范化IP。 */
  normalizeIp(value: string | undefined | null): string | null {
    const candidate = `${value || ''}`.trim();
    if (!candidate) return null;

    const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    const normalized = mappedIpv4?.[1] || candidate;
    return isIP(normalized) ? normalized.toLowerCase() : null;
  }

  /** 判断可信的代理是否成立。 */
  isTrustedProxy(value: string | undefined | null): boolean {
    const normalized = this.normalizeIp(value);
    return normalized ? this.trustedProxyIps.has(normalized) : false;
  }

  /** 读取客户端IP。 */
  getClientIp(request: Request): string {
    const immediatePeer = this.normalizeIp(request.socket?.remoteAddress);
    if (!immediatePeer) return 'unknown';
    if (!this.isTrustedProxy(immediatePeer)) return immediatePeer;

    const forwardedChain = this.readForwardedFor(request);
    if (!forwardedChain) return immediatePeer;

    let currentHop = immediatePeer;
    for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
      if (!this.isTrustedProxy(currentHop)) break;
      currentHop = forwardedChain[index];
    }

    return currentHop;
  }

  /** 读取公开的来源。 */
  getPublicOrigin(request: Request): string {
    const trustedPeer = this.isTrustedProxy(request.socket?.remoteAddress);
    const scheme = trustedPeer
      ? this.readTrustedForwardedProto(request) ||
        this.readSocketScheme(request)
      : this.readSocketScheme(request);
    const authority = this.readOriginalAuthority(request, scheme);

    if (trustedPeer) {
      this.assertForwardedPortConsistency(request, authority.port, scheme);
    }

    return `${scheme}://${authority.host}`;
  }

  /** 读取可信的代理IP 地址。 */
  private readTrustedProxyIps(): string[] {
    const raw = `${this.configService.get(TRUSTED_PROXY_CONFIG_KEY) || ''}`;
    const values = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const normalized = values.map((value) => this.normalizeIp(value));

    if (normalized.some((value) => !value)) {
      throw new Error(
        `${TRUSTED_PROXY_CONFIG_KEY} 只能包含逗号分隔的精确 IP 地址`,
      );
    }
    if (
      this.configService.get('NODE_ENV') === 'production' &&
      normalized.length === 0
    ) {
      throw new Error(`${TRUSTED_PROXY_CONFIG_KEY} 在生产环境不能为空`);
    }

    return normalized as string[];
  }

  /** 读取转发的用于。 */
  private readForwardedFor(request: Request): string[] | null {
    const raw = this.readHeader(request, 'x-forwarded-for');
    if (!raw) return null;

    const values = raw.split(',').map((value) => this.normalizeIp(value));
    if (!values.length || values.some((value) => !value)) return null;

    return values as string[];
  }

  /** 读取可信的转发的协议。 */
  private readTrustedForwardedProto(request: Request): 'http' | 'https' | null {
    const value = this.readHeader(request, 'x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      .toLowerCase();
    return value === 'http' || value === 'https' ? value : null;
  }

  /** 读取套接字方案。 */
  private readSocketScheme(request: Request): 'http' | 'https' {
    return (request.socket as Request['socket'] & { encrypted?: boolean })
      ?.encrypted
      ? 'https'
      : 'http';
  }

  /** 读取原始的权威状态。 */
  private readOriginalAuthority(
    request: Request,
    scheme: 'http' | 'https',
  ): {
    host: string;
    port: string;
  } {
    const host = this.readHeader(request, 'host')?.trim();
    if (!host || /[\s/?#@\\]/.test(host)) {
      throw new BadRequestException('Host 请求头无效');
    }

    try {
      const parsed = new URL(`${scheme}://${host}`);
      if (!parsed.hostname) throw new Error('missing hostname');
      const explicitPort = host.match(/:(\d+)$/)?.[1];
      return {
        host: host.toLowerCase(),
        port: explicitPort || (scheme === 'https' ? '443' : '80'),
      };
    } catch {
      throw new BadRequestException('Host 请求头无效');
    }
  }

  /** 断言转发的端口一致性。 */
  private assertForwardedPortConsistency(
    request: Request,
    authorityPort: string,
    scheme: 'http' | 'https',
  ) {
    const raw = this.readHeader(request, 'x-forwarded-port');
    if (!raw) return;

    const values = raw.split(',').map((value) => value.trim());
    const expectedPort = Number(
      authorityPort || (scheme === 'https' ? 443 : 80),
    );
    const forwardedPort = Number(values[0]);
    if (
      values.length !== 1 ||
      !Number.isInteger(forwardedPort) ||
      forwardedPort < 1 ||
      forwardedPort > 65535 ||
      forwardedPort !== expectedPort
    ) {
      throw new BadRequestException('X-Forwarded-Port 与 Host 不一致');
    }
  }

  /** 读取请求头。 */
  private readHeader(request: Request, name: string): string | undefined {
    const value = request.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
