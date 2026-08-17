import { BlockList, isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { portForwardActiveKey } from '@/modules/admin/platform-config/network-management/contract/network-management.types';
import { classifyTcpNatmapEndpointSource } from '../domain/network-tcp-natmap-source-eligibility';

const DEFAULT_AGENT_ID = 'nas-main';
const GATEWAY_PORT = 10443;
const GATEWAY_DDNS_ACTIVE_KEY = 'a:nas4.kwitsukasa.top';
const ENDPOINT_GENERATION_PATTERN = /^[0-9a-f]{64}$/u;
const NON_PUBLIC_IPV4 = new BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(address, prefix, 'ipv4');
}

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
  | {
      endpointGeneration: string;
      endpointIpv4: string;
      endpointValidUntil: string;
      location: string;
      status: 'found';
    }
  | { status: 'not_found' | 'unavailable' };

type NetworkOpenRedirectEndpoint = Readonly<{
  generation: string;
  ipv4: string;
  port: number;
  validUntil: string;
}>;

@Injectable()
export class NetworkOpenRedirectService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /** 解析网络打开重定向记录。 */
  async resolve(serviceKey: string): Promise<NetworkOpenRedirectResolution> {
    const target = this.target(serviceKey);
    if (!target) return { status: 'not_found' };

    const endpoint = await this.dataSource.transaction(
      'REPEATABLE READ',
      (manager) => this.resolveCurrentEndpoint(manager),
    );
    if (endpoint === null) return { status: 'unavailable' };

    return {
      endpointGeneration: endpoint.generation,
      endpointIpv4: endpoint.ipv4,
      endpointValidUntil: endpoint.validUntil,
      location: `https://${target.host}:${endpoint.port}${target.path}`,
      status: 'found',
    };
  }

  /** 返回目标。 */
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

  /** 解析当前端点。 */
  private async resolveCurrentEndpoint(
    manager: EntityManager,
  ): Promise<NetworkOpenRedirectEndpoint | null> {
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
    return {
      generation: mapping.currentEndpointIdentity as string,
      ipv4: mapping.currentPublicIpv4 as string,
      port: mapping.currentPublicPort as number,
      validUntil: mapping.currentValidUntil!.toISOString(),
    };
  }

  /** 返回映射是否就绪的。 */
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
      ENDPOINT_GENERATION_PATTERN.test(mapping.currentEndpointIdentity || '') &&
      this.isPublicIpv4(mapping.currentPublicIpv4 || '') &&
      Number.isInteger(mapping.currentPublicPort) &&
      Number(mapping.currentPublicPort) >= 1 &&
      Number(mapping.currentPublicPort) <= 65_535 &&
      this.leaseIsCurrent(mapping)
    );
  }

  /** 返回分组匹配结果。 */
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

  /** 返回DDNS匹配结果。 */
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

  /** 返回Agent匹配结果。 */
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

  /** 返回租约是否当前。 */
  private leaseIsCurrent(mapping: NetworkPortForward): boolean {
    return (
      mapping.currentValidUntil instanceof Date &&
      mapping.currentValidUntil.getTime() > Date.now()
    );
  }

  /** 判断公开的IPv4是否成立。 */
  private isPublicIpv4(address: string): boolean {
    return isIP(address) === 4 && !NON_PUBLIC_IPV4.check(address, 'ipv4');
  }

  /** 返回版本是否当前。 */
  private revisionIsCurrent(reported: string, desired: string): boolean {
    if (!/^(?:0|[1-9]\d*)$/u.test(reported)) return false;
    if (!/^[1-9]\d*$/u.test(desired)) return false;
    try {
      return BigInt(reported) >= BigInt(desired);
    } catch {
      return false;
    }
  }

  /** 返回Agent标识。 */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }
}
