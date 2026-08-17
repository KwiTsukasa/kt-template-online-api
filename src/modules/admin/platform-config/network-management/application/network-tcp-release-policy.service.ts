import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TcpReleaseMode = 'canary' | 'draining' | 'off' | 'on';
export type TcpProtocolMode = 'tcp' | 'tcp_udp' | 'udp';

export type TcpReleaseState = {
  externalPort: number;
  internalPort: number;
  natmapDesiredEnabled: boolean;
  protocolMode: TcpProtocolMode;
};

export type TcpReleaseMutation =
  | { after: TcpReleaseState; kind: 'create' }
  | { after: TcpReleaseState; before: TcpReleaseState; kind: 'update' }
  | { current: TcpReleaseState; kind: 'retry' }
  | { current: TcpReleaseState; kind: 'natmap-enable' }
  | {
      after: TcpReleaseState;
      before: TcpReleaseState;
      kind: 'natmap-disable';
    }
  | {
      after: TcpReleaseState;
      before: TcpReleaseState;
      kind: 'protocol-shrink';
    }
  | { current: TcpReleaseState; kind: 'delete' };

export class NetworkTcpReleasePolicyError extends Error {}

const INVALID_MUTATION_MESSAGE = 'Invalid TCP NATMap mutation';
const RELEASE_STATE_KEYS = [
  'externalPort',
  'internalPort',
  'natmapDesiredEnabled',
  'protocolMode',
] as const;

@Injectable()
export class NetworkTcpReleasePolicyService {
  constructor(private readonly configService: ConfigService) {}

  /** 读取模式。 */
  readMode(): TcpReleaseMode {
    const configured = this.configService.get<string>(
      'NETWORK_TCP_NATMAP_RELEASE_MODE',
    );
    if (!configured) return 'off';
    if (
      configured === 'canary' ||
      configured === 'draining' ||
      configured === 'off' ||
      configured === 'on'
    ) {
      return configured;
    }
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap release mode');
  }

  /** 读取金丝雀端口。 */
  readCanaryPorts(): ReadonlySet<number> {
    const configured = this.configService.get<string>(
      'NETWORK_TCP_NATMAP_CANARY_PORTS',
    );
    if (!configured) return new Set();
    const ports = configured.split(',');
    const result = new Set<number>();
    for (const port of ports) {
      if (!/^[1-9]\d*$/.test(port)) this.invalidCanaryPorts();
      const value = Number(port);
      if (value > 65_535 || value === 8213 || result.has(value)) {
        this.invalidCanaryPorts();
      }
      result.add(value);
    }
    return result;
  }

  /** 判断TCP可见的到管理端是否成立。 */
  isTcpVisibleToAdmin(): boolean {
    return this.readMode() === 'on';
  }

  /** 返回可以自动激活v2。 */
  mayAutomaticallyActivateV2(): boolean {
    const mode = this.readMode();
    return mode === 'canary' || mode === 'on';
  }

  /** 返回可以显式降级到v1。 */
  mayExplicitlyDowngradeToV1(): boolean {
    const mode = this.readMode();
    return mode === 'draining' || mode === 'off';
  }

  /** 断言变更允许的。 */
  assertMutationAllowed(mutation: TcpReleaseMutation): void {
    this.assertMutationShape(mutation);
    const safeCleanup = this.isSafeCleanup(mutation);
    if (!this.touchesTcp(mutation)) return;

    const mode = this.readMode();
    if (mode === 'on') return;
    if (safeCleanup) return;
    if (mode === 'canary') {
      if (this.readCanaryPorts().has(this.mutationPort(mutation))) return;
      throw new NetworkTcpReleasePolicyError('TCP NATMap release policy rejects this port');
    }
    throw new NetworkTcpReleasePolicyError('TCP NATMap release policy permits cleanup only');
  }

  /** 判断TCP是否存在。 */
  private hasTcp(value?: TcpReleaseState): boolean {
    return value?.protocolMode === 'tcp' || value?.protocolMode === 'tcp_udp';
  }

  /** 断言变更结构。 */
  private assertMutationShape(mutation: TcpReleaseMutation): void {
    const value = this.record(mutation);
    switch (value.kind) {
      case 'create': {
        this.assertExactKeys(value, ['after', 'kind']);
        this.releaseState(value.after);
        return;
      }
      case 'update': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        this.releaseState(value.before);
        this.releaseState(value.after);
        return;
      }
      case 'retry':
      case 'delete': {
        this.assertExactKeys(value, ['current', 'kind']);
        this.releaseState(value.current);
        return;
      }
      case 'natmap-enable': {
        this.assertExactKeys(value, ['current', 'kind']);
        const current = this.releaseState(value.current);
        if (!this.hasTcp(current) || !current.natmapDesiredEnabled) {
          this.invalidMutation();
        }
        return;
      }
      case 'natmap-disable': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        const before = this.releaseState(value.before);
        const after = this.releaseState(value.after);
        if (
          !this.hasTcp(before) ||
          before.protocolMode !== after.protocolMode ||
          !this.portsUnchanged(before, after) ||
          !before.natmapDesiredEnabled ||
          after.natmapDesiredEnabled
        ) {
          this.invalidMutation();
        }
        return;
      }
      case 'protocol-shrink': {
        this.assertExactKeys(value, ['after', 'before', 'kind']);
        const before = this.releaseState(value.before);
        const after = this.releaseState(value.after);
        if (
          before.protocolMode !== 'tcp_udp' ||
          after.protocolMode !== 'udp' ||
          !this.portsUnchanged(before, after) ||
          after.natmapDesiredEnabled
        ) {
          this.invalidMutation();
        }
        return;
      }
    }
    this.invalidMutation();
  }

  /** 判断变更是否涉及 TCP。 */
  private touchesTcp(mutation: TcpReleaseMutation): boolean {
    if ('current' in mutation) return this.hasTcp(mutation.current);
    return (
      this.hasTcp(mutation.after) ||
      ('before' in mutation && this.hasTcp(mutation.before))
    );
  }

  /** 判断安全清理是否成立。 */
  private isSafeCleanup(mutation: TcpReleaseMutation): boolean {
    if (mutation.kind === 'delete') {
      return mutation.current.protocolMode === 'tcp';
    }
    return (
      mutation.kind === 'natmap-disable' ||
      mutation.kind === 'protocol-shrink'
    );
  }

  /** 返回变更端口。 */
  private mutationPort(mutation: TcpReleaseMutation): number {
    if ('after' in mutation) return mutation.after.externalPort;
    return mutation.current.externalPort;
  }

  /** 判断端口是否未变更。 */
  private portsUnchanged(
    before: TcpReleaseState,
    after: TcpReleaseState,
  ): boolean {
    return (
      before.externalPort === after.externalPort &&
      before.internalPort === after.internalPort
    );
  }

  /** 记录网络TCP发布策略记录。 */
  private record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.invalidMutation();
    }
    return value as Record<string, unknown>;
  }

  /** 断言精确键。 */
  private assertExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
  ): void {
    const expectedKeys = new Set(expected);
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.length !== expected.length ||
      actualKeys.some(
        (key) => typeof key !== 'string' || !expectedKeys.has(key),
      ) ||
      expected.some(
        (key) => !Object.prototype.hasOwnProperty.call(value, key),
      )
    ) {
      this.invalidMutation();
    }
  }

  /** 释放状态。 */
  private releaseState(value: unknown): TcpReleaseState {
    const state = this.record(value);
    this.assertExactKeys(state, RELEASE_STATE_KEYS);
    const protocolMode = state.protocolMode;
    const externalPort = state.externalPort;
    const internalPort = state.internalPort;
    const natmapDesiredEnabled = state.natmapDesiredEnabled;
    if (
      (protocolMode !== 'tcp' &&
        protocolMode !== 'tcp_udp' &&
        protocolMode !== 'udp') ||
      !this.isPort(externalPort) ||
      !this.isPort(internalPort) ||
      typeof natmapDesiredEnabled !== 'boolean' ||
      (protocolMode === 'udp' && natmapDesiredEnabled)
    ) {
      this.invalidMutation();
    }
    return state as TcpReleaseState;
  }

  /** 判断端口是否成立。 */
  private isPort(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    );
  }

  /** 返回无效的变更。 */
  private invalidMutation(): never {
    throw new NetworkTcpReleasePolicyError(INVALID_MUTATION_MESSAGE);
  }

  /** 返回无效的金丝雀端口。 */
  private invalidCanaryPorts(): never {
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap canary ports');
  }
}
