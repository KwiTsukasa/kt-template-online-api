import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TcpReleaseMode = 'canary' | 'draining' | 'off' | 'on';
export type TcpProtocolMode = 'tcp' | 'tcp_udp' | 'udp';

export type TcpReleaseState = {
  externalPort: number;
  natmapDesiredEnabled: boolean;
  protocolMode: TcpProtocolMode;
};

export type TcpReleaseMutation = {
  after?: TcpReleaseState;
  before?: TcpReleaseState;
};

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
    const before = mutation.before;
    const after = mutation.after;
    if (!this.hasTcp(before) && !this.hasTcp(after)) return;

    const mode = this.readMode();
    if (mode === 'on') return;
    if (mode === 'canary') {
      const port = after?.externalPort ?? before?.externalPort;
      if (port !== undefined && this.readCanaryPorts().has(port)) return;
      throw new NetworkTcpReleasePolicyError('TCP NATMap release policy rejects this port');
    }
    if (this.isSafeCleanup(before, after)) return;
    throw new NetworkTcpReleasePolicyError('TCP NATMap release policy permits cleanup only');
  }

  private hasTcp(value?: TcpReleaseState): boolean {
    return value?.protocolMode === 'tcp' || value?.protocolMode === 'tcp_udp';
  }

  private isSafeCleanup(
    before?: TcpReleaseState,
    after?: TcpReleaseState,
  ): boolean {
    if (!before) return false;
    if (!after) return before.protocolMode === 'tcp';
    if (
      before.protocolMode === 'tcp_udp' &&
      after.protocolMode === 'udp'
    ) {
      return true;
    }
    return (
      before.protocolMode === after.protocolMode &&
      before.externalPort === after.externalPort &&
      before.natmapDesiredEnabled &&
      !after.natmapDesiredEnabled
    );
  }

  private invalidCanaryPorts(): never {
    throw new NetworkTcpReleasePolicyError('Invalid TCP NATMap canary ports');
  }
}
