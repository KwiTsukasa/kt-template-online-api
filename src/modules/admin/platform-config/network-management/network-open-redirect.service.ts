import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { NetworkAgentState } from './network-agent-state.entity';
import { NetworkDdnsRecord } from './network-ddns.entity';
import { NetworkPortForwardGroup } from './network-port-forward-group.entity';
import { NetworkPortForward } from './network-management.entity';
import { portForwardActiveKey } from './network-management.types';
import { classifyTcpNatmapEndpointSource } from './network-tcp-natmap-source-eligibility';

const DEFAULT_AGENT_ID = 'nas-main';
const GATEWAY_PORT = 10443;
const GATEWAY_DDNS_ACTIVE_KEY = 'a:nas4.kwitsukasa.top';

type NetworkOpenRedirectTarget = Readonly<{
  host: string;
  path: `/${string}`;
}>;

export const NETWORK_OPEN_REDIRECT_TARGETS = Object.freeze({
  admin: { host: 'nas4.kwitsukasa.top', path: '/admin/' },
  alist: { host: 'fnos.nas4.kwitsukasa.top', path: '/alist/' },
  api: { host: 'nas4.kwitsukasa.top', path: '/api/' },
  blog: { host: 'nas4.kwitsukasa.top', path: '/blog/' },
  fnos: { host: 'fnos.nas4.kwitsukasa.top', path: '/' },
  jenkins: { host: 'nas4.kwitsukasa.top', path: '/jenkins/' },
  kestra: { host: 'nas4.kwitsukasa.top', path: '/kestra/' },
  mcd: { host: 'nas4.kwitsukasa.top', path: '/mcd/' },
  mcsm: { host: 'nas4.kwitsukasa.top', path: '/mcsm/' },
  minio: { host: 'minio.nas4.kwitsukasa.top', path: '/' },
  nas: { host: 'nas4.kwitsukasa.top', path: '/' },
  portfolio: { host: 'nas4.kwitsukasa.top', path: '/portfolio/' },
  s3: { host: 's3.nas4.kwitsukasa.top', path: '/' },
} as const satisfies Record<string, NetworkOpenRedirectTarget>);

export type NetworkOpenRedirectResolution =
  | { location: string; status: 'found' }
  | { status: 'not_found' | 'unavailable' };

@Injectable()
export class NetworkOpenRedirectService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async resolve(serviceKey: string): Promise<NetworkOpenRedirectResolution> {
    const target = this.target(serviceKey);
    if (!target) return { status: 'not_found' };

    const publicPort = await this.dataSource.transaction(
      'REPEATABLE READ',
      (manager) => this.resolveCurrentPublicPort(manager),
    );
    if (publicPort === null) return { status: 'unavailable' };

    return {
      location: `https://${target.host}:${publicPort}${target.path}`,
      status: 'found',
    };
  }

  private target(serviceKey: string): NetworkOpenRedirectTarget | undefined {
    if (
      !Object.prototype.hasOwnProperty.call(
        NETWORK_OPEN_REDIRECT_TARGETS,
        serviceKey,
      )
    ) {
      return undefined;
    }
    return NETWORK_OPEN_REDIRECT_TARGETS[
      serviceKey as keyof typeof NETWORK_OPEN_REDIRECT_TARGETS
    ];
  }

  private async resolveCurrentPublicPort(
    manager: EntityManager,
  ): Promise<null | number> {
    const mapping = await manager.getRepository(NetworkPortForward).findOne({
      where: { activeKey: portForwardActiveKey('tcp', GATEWAY_PORT) },
    });
    if (!mapping || !this.mappingIsReady(mapping)) return null;

    const group = await manager
      .getRepository(NetworkPortForwardGroup)
      .findOne({ where: { id: mapping.groupId } });
    if (!group || !this.groupMatches(group, mapping)) return null;

    const ddns = await manager.getRepository(NetworkDdnsRecord).findOne({
      where: { activeKey: GATEWAY_DDNS_ACTIVE_KEY },
    });
    if (!ddns || !this.ddnsMatches(ddns, mapping)) return null;

    const agent = await manager.getRepository(NetworkAgentState).findOne({
      where: { agentId: this.agentId() },
    });
    if (!agent || !this.agentMatches(agent, mapping)) return null;

    if (!this.leaseIsCurrent(mapping)) return null;
    return mapping.currentPublicPort as number;
  }

  private mappingIsReady(mapping: NetworkPortForward): boolean {
    return (
      mapping.activeKey === portForwardActiveKey('tcp', GATEWAY_PORT) &&
      mapping.externalPort === GATEWAY_PORT &&
      mapping.internalPort === GATEWAY_PORT &&
      classifyTcpNatmapEndpointSource(mapping).eligible &&
      mapping.syncStatus === 'synced' &&
      mapping.natmapStatus === 'active' &&
      this.revisionIsCurrent(
        mapping.reportedRevision,
        mapping.desiredRevision,
      ) &&
      Boolean(mapping.currentEndpointIdentity?.trim()) &&
      isIP(mapping.currentPublicIpv4 || '') === 4 &&
      Number.isInteger(mapping.currentPublicPort) &&
      Number(mapping.currentPublicPort) >= 1 &&
      Number(mapping.currentPublicPort) <= 65_535 &&
      this.leaseIsCurrent(mapping)
    );
  }

  private groupMatches(
    group: NetworkPortForwardGroup,
    mapping: NetworkPortForward,
  ): boolean {
    return (
      !group.isDeleted &&
      group.id === mapping.groupId &&
      group.externalPort === GATEWAY_PORT &&
      group.internalPort === GATEWAY_PORT &&
      (group.protocolMode === 'tcp' || group.protocolMode === 'tcp_udp') &&
      group.targetIpv4 === mapping.targetIpv4
    );
  }

  private ddnsMatches(
    ddns: NetworkDdnsRecord,
    mapping: NetworkPortForward,
  ): boolean {
    return (
      !ddns.isDeleted &&
      ddns.activeKey === GATEWAY_DDNS_ACTIVE_KEY &&
      ddns.enabled &&
      ddns.recordType === 'A' &&
      ddns.sourceType === 'port_forward_ipv4' &&
      ddns.portForwardId === mapping.id &&
      ddns.syncStatus === 'synced' &&
      ddns.sourceAddress === mapping.currentPublicIpv4 &&
      ddns.appliedAddress === mapping.currentPublicIpv4
    );
  }

  private agentMatches(
    agent: NetworkAgentState,
    mapping: NetworkPortForward,
  ): boolean {
    return (
      agent.agentId === this.agentId() &&
      agent.online &&
      agent.targetIpv4 === mapping.targetIpv4
    );
  }

  private leaseIsCurrent(mapping: NetworkPortForward): boolean {
    return (
      mapping.currentValidUntil instanceof Date &&
      mapping.currentValidUntil.getTime() > Date.now()
    );
  }

  private revisionIsCurrent(reported: string, desired: string): boolean {
    if (!/^(?:0|[1-9]\d*)$/u.test(reported)) return false;
    if (!/^[1-9]\d*$/u.test(desired)) return false;
    try {
      return BigInt(reported) >= BigInt(desired);
    } catch {
      return false;
    }
  }

  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }
}
