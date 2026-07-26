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

  isTcpVisibleToAdmin(): boolean {
    return this.readMode() === 'on';
  }

  mayAutomaticallyActivateV2(): boolean {
    const mode = this.readMode();
    return mode === 'canary' || mode === 'on';
  }

  mayExplicitlyDowngradeToV1(): boolean {
    const mode = this.readMode();
    return mode === 'draining' || mode === 'off';
  }

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

  private hasTcp(value?: TcpReleaseState): boolean {
    return value?.protocolMode === 'tcp' || value?.protocolMode === 'tcp_udp';
  }

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

  private touchesTcp(mutation: TcpReleaseMutation): boolean {
    if ('current' in mutation) return this.hasTcp(mutation.current);
    return (
      this.hasTcp(mutation.after) ||
      ('before' in mutation && this.hasTcp(mutation.before))
    );
  }

  private isSafeCleanup(mutation: TcpReleaseMutation): boolean {
    if (mutation.kind === 'delete') {
      return mutation.current.protocolMode === 'tcp';
    }
    return (
      mutation.kind === 'natmap-disable' ||
      mutation.kind === 'protocol-shrink'
    );
  }

  private mutationPort(mutation: TcpReleaseMutation): number {
    if ('after' in mutation) return mutation.after.externalPort;
    return mutation.current.externalPort;
  }

  private portsUnchanged(
    before: TcpReleaseState,
    after: TcpReleaseState,
  ): boolean {
    return (
      before.externalPort === after.externalPort &&
      before.internalPort === after.internalPort
    );
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.invalidMutation();
    }
    return value as Record<string, unknown>;
  }

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

  private isPort(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    );
  }

  private invalidMutation(): never {
    throw new NetworkTcpReleasePolicyError(INVALID_MUTATION_MESSAGE);
  }

  private invalidCanaryPorts(): never {
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap canary ports');
  }
}
