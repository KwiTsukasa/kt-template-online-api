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

  /**
   * 将`value`规范为Ip，使等价输入得到一致表示；当 `isIP(normalized)` 成立时返回 `normalized.toLowerCase()`。
   * @param value - 待转换为Ip的原始值。
   * @returns Ip；无法解析或未命中时为 `null`。
   */
  normalizeIp(value: string | undefined | null): string | null {
    const candidate = `${value || ''}`.trim();
    if (!candidate) return null;

    const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    const normalized = mappedIpv4?.[1] || candidate;
    if (isIP(normalized)) {
      return normalized.toLowerCase();
    }
    return null;
  }

  /**
   * 根据`value`与当前约束判定可信的代理；当 `normalized` 成立时返回 `this.trustedProxyIps.has(normalized)`。
   * @param value - 待判定是否满足可信的代理约束的候选值。
   * @returns 满足可信的代理约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isTrustedProxy(value: string | undefined | null): boolean {
    const normalized = this.normalizeIp(value);
    if (normalized) {
      return this.trustedProxyIps.has(normalized);
    }
    return false;
  }

  /**
   * 按`request`读取客户端IP；从 `readForwardedFor` 读取客户端IP。
   * @param request - 用于客户端IP的当前 HTTP 请求，包含 `socket` 字段。
   * @returns 当前状态对应的客户端IP，取值为 `'unknown'`。
   */
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

  /**
   * 按`request`读取公开的来源；先通过 `assertForwardedPortConsistency` 校验输入边界。
   * @param request - 用于公开的来源的当前 HTTP 请求，包含 `socket` 字段。
   * @returns 按参数编码并拼接完成的公开的来源。
   */
  getPublicOrigin(request: Request): string {
    const trustedPeer = this.isTrustedProxy(request.socket?.remoteAddress);
    const scheme = (() => {
      if (trustedPeer) {
        return this.readTrustedForwardedProto(request) ||
        this.readSocketScheme(request);
      }
      return this.readSocketScheme(request);
    })();
    const authority = this.readOriginalAuthority(request, scheme);

    if (trustedPeer) {
      this.assertForwardedPortConsistency(request, authority.port, scheme);
    }

    return `${scheme}://${authority.host}`;
  }

  /**
   * 按当前运行态读取可信的代理IP 地址；从 `configService.get` 读取可信的代理IP 地址。
   * @returns 按输入顺序得到的可信的代理IP 地址列表；没有匹配项时为空数组。
   * @throws 当 `normalized.some((value) => !value)` 成立时拒绝当前输入并抛出 `Error`；当 `this.configService.get('NODE_ENV') === 'production' && normalized.lengt…` 成立时拒绝当前输入并抛出 `Error`。
   */
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

  /**
   * 仅在直连地址属于可信代理时解析 `X-Forwarded-For` 链，并按代理跳数保留规范化后的客户端地址。
   * @param request - 用于Forwarded的当前 HTTP 请求。
   * @returns 返回规范化后的转发地址链；请求头缺失时为 `null`。
   */
  private readForwardedFor(request: Request): string[] | null {
    const raw = this.readHeader(request, 'x-forwarded-for');
    if (!raw) return null;

    const values = raw.split(',').map((value) => this.normalizeIp(value));
    if (!values.length || values.some((value) => !value)) return null;

    return values as string[];
  }

  /**
   * 按`request`读取可信的转发的协议；当 `value === 'http' || value === 'https'` 成立时返回 `value`。
   * @param request - 用于可信的转发的协议的当前 HTTP 请求。
   * @returns 可信的转发的协议；无法解析或未命中时为 `null`。
   */
  private readTrustedForwardedProto(request: Request): 'http' | 'https' | null {
    const value = this.readHeader(request, 'x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      .toLowerCase();
    if (value === 'http' || value === 'https') {
      return value;
    }
    return null;
  }

  /**
   * 按`request`读取套接字方案；当 `(request.socket as Request['socket'] & { encrypted?: boolean…` 成立时返回 `'https'`。
   * @param request - 用于套接字方案的当前 HTTP 请求，包含 `socket` 字段。
   * @returns 当前状态对应的套接字方案，取值为 `'https'`、`'http'`。
   */
  private readSocketScheme(request: Request): 'http' | 'https' {
    if ((request.socket as Request['socket'] & { encrypted?: boolean })
      ?.encrypted) {
      return 'https';
    }
    return 'http';
  }

  /**
   * 从可信转发请求读取原始 Host 与端口，并拒绝缺失、包含路径或格式非法的权威信息。
   * @param request - 用于OriginalAuthority的当前 HTTP 请求。
   * @param scheme - 决定OriginalAuthority内容、边界或目标的 `scheme` 值。
   * @returns 包含 `host`、`port` 字段的OriginalAuthority。
   * @throws 当 `!host || /[\s/?#@\\]/.test(host)` 成立时拒绝当前输入并抛出 `BadRequestException`；当 `!parsed.hostname` 成立时拒绝当前输入并抛出 `Error`；
   *   当 `host.match` 或 `host.toLowerCase` 调用失败时拒绝当前输入并抛出 `BadRequestException`。
   */
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
        port: explicitPort || ((() => {
          if (scheme === 'https') {
            return '443';
          }
          return '80';
        })()),
      };
    } catch {
      throw new BadRequestException('Host 请求头无效');
    }
  }

  /**
   * 校验`request`、`authorityPort`、`scheme`是否满足转发的端口一致性约束，并拒绝不合法输入；从 `readHeader` 读取转发的端口一致性。
   * @param request - 用于转发的端口一致性的当前 HTTP 请求。
   * @param authorityPort - 决定转发的端口一致性内容、边界或目标的 `authorityPort` 值。
   * @param scheme - 决定转发的端口一致性内容、边界或目标的 `scheme` 值。
   * @throws 当 `values.length !== 1 || !Number.isInteger(forwardedPort) || forwardedPor…` 成立时拒绝当前输入并抛出 `BadRequestException`。
   */
  private assertForwardedPortConsistency(
    request: Request,
    authorityPort: string,
    scheme: 'http' | 'https',
  ) {
    const raw = this.readHeader(request, 'x-forwarded-port');
    if (!raw) return;

    const values = raw.split(',').map((value) => value.trim());
    const expectedPort = Number(
      authorityPort || ((() => {
        if (scheme === 'https') {
          return 443;
        }
        return 80;
      })()),
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

  /**
   * 按请求头名读取首个字符串值；数组仅取第一项，缺失或非字符串输入保留空值。
   * @param request - 用于按请求头名读取首个字符串值的当前 HTTP 请求，包含 `headers` 字段。
   * @param name - 决定按请求头名读取首个字符串值内容、边界或目标的 `name` 值。
   * @returns 按请求头名读取首个字符串值。
   */
  private readHeader(request: Request, name: string): string | undefined {
    const value = request.headers?.[name];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
