import { isIP } from 'node:net';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemMessageSourceRegistry } from '@/modules/qqbot/core/application/message-push/system-message-source.registry';
import {
  SystemMessageContractError,
  type SystemMessageDeliveryReadiness,
  type SystemMessageScalar,
  type SystemMessageSourceAdapter,
  type SystemMessageSourceDefinition,
  type SystemMessageSourceOptionsResponse,
} from '@/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import {
  classifyTcpNatmapEndpointSource,
  type TcpNatmapEndpointSourceDisabledReason,
} from '../../domain/network-tcp-natmap-source-eligibility';

const SOURCE_KEY = 'network.tcp.natmap-endpoint-changed';
const SNOWFLAKE_ID_PATTERN = /^[1-9]\d{0,23}$/;
const SUBSCRIPTION_KEYS = ['ddnsRecordId', 'tcpChannelId'];
const EVENT_KEYS = [
  'previousPublicIpv4',
  'previousPublicPort',
  'publicIpv4',
  'publicPort',
  'tcpChannelId',
];

type TcpNatmapSubscriptionConfig = {
  ddnsRecordId: string;
  tcpChannelId: string;
};

type TcpNatmapEventPayload = {
  previousPublicIpv4: string;
  previousPublicPort: number;
  publicIpv4: string;
  publicPort: number;
  tcpChannelId: string;
};

type ResolvedSubscription = {
  config: TcpNatmapSubscriptionConfig;
  ddnsRecord: NetworkDdnsRecord;
  group: NetworkPortForwardGroup;
  mapping: NetworkPortForward;
  sourceSummary: string;
};

@Injectable()
export class NetworkTcpNatmapMessageSourceAdapter
  implements OnModuleDestroy, OnModuleInit, SystemMessageSourceAdapter
{
  private registered = false;

  readonly definition: SystemMessageSourceDefinition = {
    description: '当 TCP NATMap 公网端点变更且 IPv4 DDNS 已同步时发送消息。',
    displayName: 'TCP NATMap 端点变更',
    sourceKey: SOURCE_KEY,
    subscriptionFields: [
      {
        key: 'tcpChannelId',
        label: 'TCP NATMap 通道',
        optionCollection: 'tcpChannels',
        required: true,
        type: 'select',
      },
      {
        dependsOn: 'tcpChannelId',
        key: 'ddnsRecordId',
        label: 'IPv4 DDNS 记录',
        optionCollection: 'ddnsRecords',
        required: true,
        type: 'select',
      },
    ],
    variables: [
      {
        description: '服务端组合的域名与公网端口',
        example: 'pal.kwitsukasa.top:38213',
        key: 'endpoint',
        label: '访问端点',
        type: 'string',
      },
      {
        description: '所选 DDNS 完整域名',
        example: 'pal.kwitsukasa.top',
        key: 'fqdn',
        label: '域名',
        type: 'string',
      },
      {
        description: '新的公网 IPv4',
        example: '203.0.113.10',
        key: 'publicIpv4',
        label: '公网 IPv4',
        type: 'string',
      },
      {
        description: '新的公网端口',
        example: '38213',
        key: 'publicPort',
        label: '公网端口',
        type: 'number',
      },
      {
        description: '变化前的公网 IPv4',
        example: '198.51.100.9',
        key: 'previousPublicIpv4',
        label: '原公网 IPv4',
        type: 'string',
      },
      {
        description: '变化前的公网端口',
        example: '38111',
        key: 'previousPublicPort',
        label: '原公网端口',
        type: 'number',
      },
      {
        description: '逻辑端口转发名称',
        example: '帕鲁新世界',
        key: 'portForwardName',
        label: '端口转发名称',
        type: 'string',
      },
    ],
    version: 1,
  };

  constructor(
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
    @InjectRepository(NetworkPortForwardGroup)
    private readonly groupRepository: Repository<NetworkPortForwardGroup>,
    @InjectRepository(NetworkDdnsRecord)
    private readonly ddnsRepository: Repository<NetworkDdnsRecord>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
  ) {}

  onModuleInit(): void {
    if (this.registered) return;
    this.sourceRegistry.register(this);
    this.registered = true;
  }

  onModuleDestroy(): void {
    if (!this.registered) return;
    this.sourceRegistry.unregister(this.definition.sourceKey, this);
    this.registered = false;
  }

  /** 生成事件资源键。 */
  eventResourceKey(payload: Record<string, SystemMessageScalar>): string {
    if (typeof payload.tcpChannelId !== 'string') {
      throw new SystemMessageContractError('invalid_source_config');
    }
    return payload.tcpChannelId;
  }

  /** 规范化订阅配置。 */
  async normalizeSubscriptionConfig(input: unknown): Promise<{
    canonicalConfig: Record<string, string>;
    resourceKey: string;
    sourceSummary: string;
  }> {
    const resolved = await this.resolveSubscription(input);
    return {
      canonicalConfig: resolved.config,
      resourceKey: resolved.config.tcpChannelId,
      sourceSummary: resolved.sourceSummary,
    };
  }

  /** 检查订阅。 */
  async inspectSubscription(config: Record<string, unknown>): Promise<{
    invalidReasonCode: null | string;
    sourceSummary: string;
    valid: boolean;
  }> {
    try {
      const resolved = await this.resolveSubscription(config);
      return {
        invalidReasonCode: null,
        sourceSummary: resolved.sourceSummary,
        valid: true,
      };
    } catch (error) {
      if (!(error instanceof SystemMessageContractError)) throw error;
      return {
        invalidReasonCode: error.code,
        sourceSummary: '未选择有效的 TCP NATMap 通道与 DDNS',
        valid: false,
      };
    }
  }

  /** 列出订阅选项。 */
  async listSubscriptionOptions(): Promise<SystemMessageSourceOptionsResponse> {
    const [mappings, groups, records] = await Promise.all([
      this.mappingRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
      this.groupRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
      this.ddnsRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
    ]);
    const mappingsById = new Map(
      mappings.map((mapping) => [String(mapping.id), mapping]),
    );
    const groupsById = new Map(
      groups.map((group) => [String(group.id), group]),
    );
    return {
      ddnsRecords: records.map((record) => {
        const mapping = record.portForwardId
          ? mappingsById.get(String(record.portForwardId))
          : undefined;
        const group = mapping
          ? groupsById.get(String(mapping.groupId))
          : undefined;
        const disabledReasonCode = ddnsOptionReason(record, mapping, group);
        return {
          ...(record.portForwardId
            ? { dependsOnValue: String(record.portForwardId) }
            : {}),
          disabled: disabledReasonCode !== null,
          disabledReasonCode,
          label: [record.name, ddnsFqdn(record), disabledReasonCode]
            .filter((value) => value !== null)
            .join(' · '),
          value: String(record.id),
        };
      }),
      tcpChannels: mappings.map((mapping) => {
        const group = groupsById.get(String(mapping.groupId));
        const source = classifyTcpNatmapEndpointSource(mapping);
        const groupMissing = !group || group.isDeleted;
        const disabledReasonCode = groupMissing
          ? 'SOURCE_DELETING'
          : source.disabledReasonCode;
        return {
          disabled: disabledReasonCode !== null,
          disabledReasonCode,
          label: `${group?.name || mapping.name} / ${mapping.protocol === 'tcp' ? 'TCP NATMap' : 'UDP Keeper'}`,
          value: String(mapping.id),
        };
      }),
    };
  }

  /** 生成订阅资源键。 */
  subscriptionResourceKey(config: Record<string, unknown>): null | string {
    if (!isPlainRecord(config) || typeof config.tcpChannelId !== 'string') {
      return null;
    }
    return config.tcpChannelId;
  }

  /** 校验事件载荷。 */
  validateEventPayload(
    payload: Record<string, unknown>,
  ): Record<string, SystemMessageScalar> {
    assertExactKeys(payload, EVENT_KEYS);
    const tcpChannelId = normalizeSnowflakeId(payload.tcpChannelId);
    const publicIpv4 = normalizeIpv4(payload.publicIpv4);
    const publicPort = normalizePort(payload.publicPort);
    const previousPublicIpv4 = normalizeIpv4(payload.previousPublicIpv4);
    const previousPublicPort = normalizePort(payload.previousPublicPort);
    if (
      publicIpv4 === previousPublicIpv4 &&
      publicPort === previousPublicPort
    ) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    return {
      previousPublicIpv4,
      previousPublicPort,
      publicIpv4,
      publicPort,
      tcpChannelId,
    };
  }

  /** 解析投递。 */
  async resolveDelivery(input: {
    eventPayload: Record<string, SystemMessageScalar>;
    subscriptionConfig: Record<string, unknown>;
  }): Promise<SystemMessageDeliveryReadiness> {
    let resolved: ResolvedSubscription;
    try {
      resolved = await this.resolveSubscription(input.subscriptionConfig);
    } catch (error) {
      if (!(error instanceof SystemMessageContractError)) throw error;
      return { reasonCode: error.code, status: 'cancelled' };
    }
    let event: TcpNatmapEventPayload;
    try {
      event = this.validateEventPayload(
        input.eventPayload,
      ) as TcpNatmapEventPayload;
    } catch (error) {
      if (!(error instanceof SystemMessageContractError)) throw error;
      return { reasonCode: error.code, status: 'cancelled' };
    }
    if (event.tcpChannelId !== resolved.config.tcpChannelId) {
      return { reasonCode: 'invalid_source_config', status: 'cancelled' };
    }
    if (!hasCurrentEndpointTuple(resolved.mapping)) {
      return { reasonCode: 'endpoint_withdrawn', status: 'cancelled' };
    }
    if (
      !hasFreshCurrentEndpoint(resolved.mapping) ||
      resolved.mapping.currentPublicIpv4 !== event.publicIpv4 ||
      resolved.mapping.currentPublicPort !== event.publicPort
    ) {
      return { reasonCode: 'endpoint_superseded', status: 'superseded' };
    }
    const variables = deliveryVariables(resolved, event);
    if (
      resolved.ddnsRecord.syncStatus !== 'synced' ||
      resolved.ddnsRecord.appliedAddress !== event.publicIpv4
    ) {
      return {
        reasonCode: 'ddns_not_synced',
        status: 'waiting_ddns',
        variables,
      };
    }
    return { reasonCode: null, status: 'ready', variables };
  }

  /** 解析订阅。 */
  private async resolveSubscription(
    input: unknown,
  ): Promise<ResolvedSubscription> {
    assertExactKeys(input, SUBSCRIPTION_KEYS);
    const config = {
      ddnsRecordId: normalizeSnowflakeId(input.ddnsRecordId),
      tcpChannelId: normalizeSnowflakeId(input.tcpChannelId),
    };
    const mapping = await this.mappingRepository.findOne({
      where: { id: config.tcpChannelId },
    });
    if (!mapping) {
      throw new SystemMessageContractError('mapping_not_found');
    }
    const source = classifyTcpNatmapEndpointSource(mapping);
    if (source.disabledReasonCode) {
      throw new SystemMessageContractError(
        messageSourceEligibilityReason(source.disabledReasonCode),
      );
    }
    const group = await this.groupRepository.findOne({
      where: { id: mapping.groupId },
    });
    if (!group || group.isDeleted) {
      throw new SystemMessageContractError('mapping_not_managed');
    }
    const ddnsRecord = await this.ddnsRepository.findOne({
      where: { id: config.ddnsRecordId },
    });
    const ddnsReason = ddnsMessageSourceReason(ddnsRecord, mapping);
    if (ddnsReason) {
      throw new SystemMessageContractError(ddnsReason);
    }
    const resolvedDdns = ddnsRecord as NetworkDdnsRecord;
    return {
      config,
      ddnsRecord: resolvedDdns,
      group,
      mapping,
      sourceSummary: `${group.name} / TCP NATMap · ${ddnsFqdn(resolvedDdns)}`,
    };
  }
}

/** 断言精确键。 */
function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !isPlainRecord(value) ||
    value === null ||
    Object.keys(value).sort().join('\0') !== [...expectedKeys].sort().join('\0')
  ) {
    throw new SystemMessageContractError('invalid_source_config');
  }
}

/** 判断纯文本记录是否成立。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 规范化雪花标识。 */
function normalizeSnowflakeId(value: unknown): string {
  if (typeof value !== 'string' || !SNOWFLAKE_ID_PATTERN.test(value)) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/** 规范化IPv4。 */
function normalizeIpv4(value: unknown): string {
  if (typeof value !== 'string' || isIP(value) !== 4) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/** 规范化端口。 */
function normalizePort(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/** 返回消息来源可用资格原因。 */
function messageSourceEligibilityReason(
  reason: TcpNatmapEndpointSourceDisabledReason,
): 'mapping_not_managed' | 'mapping_not_tcp' | 'natmap_disabled' {
  switch (reason) {
    case 'NATMAP_DISABLED':
      return 'natmap_disabled';
    case 'SOURCE_DELETING':
      return 'mapping_not_managed';
    case 'TCP_REQUIRED':
      return 'mapping_not_tcp';
  }
}

/** 返回DDNS选项原因。 */
function ddnsOptionReason(
  record: NetworkDdnsRecord,
  mapping: NetworkPortForward | undefined,
  group: NetworkPortForwardGroup | undefined,
): null | string {
  if (record.isDeleted) return 'ddns_deleted';
  if (!record.enabled) return 'ddns_disabled';
  if (record.recordType !== 'A') return 'ddns_a_required';
  if (record.sourceType !== 'port_forward_ipv4') {
    return 'ddns_source_type_invalid';
  }
  if (
    !mapping ||
    String(record.portForwardId) !== String(mapping.id) ||
    !group ||
    group.isDeleted
  ) {
    return 'ddns_mapping_mismatch';
  }
  return classifyTcpNatmapEndpointSource(mapping).disabledReasonCode;
}

/** 返回DDNS消息来源原因。 */
function ddnsMessageSourceReason(
  record: NetworkDdnsRecord | null,
  mapping: NetworkPortForward,
):
  | 'ddns_disabled'
  | 'ddns_mapping_mismatch'
  | 'ddns_not_found'
  | 'ddns_not_ipv4'
  | null {
  if (!record || record.isDeleted) return 'ddns_not_found';
  if (!record.enabled) return 'ddns_disabled';
  if (record.recordType !== 'A' || record.sourceType !== 'port_forward_ipv4') {
    return 'ddns_not_ipv4';
  }
  if (String(record.portForwardId) !== String(mapping.id)) {
    return 'ddns_mapping_mismatch';
  }
  return null;
}

/** 返回DDNS完全限定域名。 */
function ddnsFqdn(record: NetworkDdnsRecord): string {
  const domain = record.domain.trim().toLowerCase().replace(/\.$/, '');
  const subDomain = record.subDomain.trim().toLowerCase().replace(/\.$/, '');
  return subDomain === '@' ? domain : `${subDomain}.${domain}`;
}

/** 判断当前端点元组是否存在。 */
function hasCurrentEndpointTuple(mapping: NetworkPortForward): boolean {
  return (
    isIP(mapping.currentPublicIpv4 || '') === 4 &&
    typeof mapping.currentPublicPort === 'number' &&
    Number.isInteger(mapping.currentPublicPort) &&
    mapping.currentPublicPort >= 1 &&
    mapping.currentPublicPort <= 65_535
  );
}

/** 判断新鲜的当前端点是否存在。 */
function hasFreshCurrentEndpoint(mapping: NetworkPortForward): boolean {
  return (
    hasCurrentEndpointTuple(mapping) &&
    !!mapping.currentValidUntil &&
    new Date(mapping.currentValidUntil).getTime() > Date.now()
  );
}

/** 返回投递变量。 */
function deliveryVariables(
  resolved: ResolvedSubscription,
  event: TcpNatmapEventPayload,
): Record<string, boolean | number | string> {
  const fqdn = ddnsFqdn(resolved.ddnsRecord);
  return {
    endpoint: `${fqdn}:${event.publicPort}`,
    fqdn,
    portForwardName: resolved.group.name,
    previousPublicIpv4: event.previousPublicIpv4,
    previousPublicPort: event.previousPublicPort,
    publicIpv4: event.publicIpv4,
    publicPort: event.publicPort,
  };
}
