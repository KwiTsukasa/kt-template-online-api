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
    const value = mutation as Partial<{
      after: TcpReleaseState;
      before: TcpReleaseState;
      current: TcpReleaseState;
      kind: TcpReleaseMutation['kind'];
    }>;
    switch (value.kind) {
      case 'create':
        if (value.after) return;
        break;
      case 'update':
      case 'natmap-disable':
      case 'protocol-shrink':
        if (value.before && value.after) return;
        break;
      case 'retry':
      case 'natmap-enable':
      case 'delete':
        if (value.current) return;
        break;
    }
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap mutation');
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
    if (mutation.kind === 'natmap-disable') {
      const valid =
        this.hasTcp(mutation.before) &&
        mutation.before.protocolMode === mutation.after.protocolMode &&
        this.portsUnchanged(mutation.before, mutation.after) &&
        mutation.before.natmapDesiredEnabled &&
        !mutation.after.natmapDesiredEnabled;
      if (!valid) {
        throw new NetworkTcpReleasePolicyError(
          'Invalid TCP NATMap disable mutation',
        );
      }
      return true;
    }
    if (mutation.kind === 'protocol-shrink') {
      const valid =
        mutation.before.protocolMode === 'tcp_udp' &&
        mutation.after.protocolMode === 'udp' &&
        this.portsUnchanged(mutation.before, mutation.after) &&
        !mutation.after.natmapDesiredEnabled;
      if (!valid) {
        throw new NetworkTcpReleasePolicyError(
          'Invalid TCP NATMap protocol shrink',
        );
      }
      return true;
    }
    return false;
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

  private invalidCanaryPorts(): never {
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap canary ports');
  }
}
