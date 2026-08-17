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

  /**
   * 根据`payload`拼接稳定的事件资源键，用于隔离对应资源或存储记录。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `tcpChannelId` 字段。
   * @returns 事件资源键。
   * @throws 当 `typeof payload.tcpChannelId !== 'string'` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  eventResourceKey(payload: Record<string, SystemMessageScalar>): string {
    if (typeof payload.tcpChannelId !== 'string') {
      throw new SystemMessageContractError('invalid_source_config');
    }
    return payload.tcpChannelId;
  }

  /**
   * 校验 TCP NATMap 通道与 DDNS 绑定，并生成可持久化配置、资源键和来源摘要。
   * @param input - 待解析的 TCP NATMap 系统消息订阅配置。
   * @returns 已规范化的订阅配置、TCP 通道资源键与可读来源摘要。
   */
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

  /**
   * 探测 TCP NATMap 订阅配置是否仍可解析，把契约错误转换为禁用原因而不打断管理端读取。
   * @param config - 待检查的已持久化 TCP NATMap 订阅配置。
   * @returns 有效时包含来源摘要；无效时包含 `valid=false` 和契约错误码。
   * @throws 捕获到非 `SystemMessageContractError` 的意外错误时原样重新抛出。
   */
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

  /**
   * 按当前运行态读取订阅选项。
   * @returns 包含 `ddnsRecords`、`tcpChannels` 字段的订阅选项。
   */
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
        const mapping = (() => {
          if (record.portForwardId) {
            return mappingsById.get(String(record.portForwardId));
          }
          return undefined;
        })();
        const group = (() => {
          if (mapping) {
            return groupsById.get(String(mapping.groupId));
          }
          return undefined;
        })();
        const disabledReasonCode = ddnsOptionReason(record, mapping, group);
        return {
          ...((() => {
            if (record.portForwardId) {
              return { dependsOnValue: String(record.portForwardId) };
            }
            return {};
          })()),
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
        const disabledReasonCode = (() => {
          if (groupMissing) {
            return 'SOURCE_DELETING';
          }
          return source.disabledReasonCode;
        })();
        return {
          disabled: disabledReasonCode !== null,
          disabledReasonCode,
          label: `${group?.name || mapping.name} / ${(() => {
            if (mapping.protocol === 'tcp') {
              return 'TCP NATMap';
            }
            return 'UDP Keeper';
          })()}`,
          value: String(mapping.id),
        };
      }),
    };
  }

  /**
   * 根据`config`拼接稳定的订阅资源键，用于隔离对应资源或存储记录；当 `!isPlainRecord(config) || typeof config.tcpChannelId !== 'str…` 成立时返回 `null`。
   * @param config - 限定订阅资源键边界、地址与开关的运行配置，包含 `tcpChannelId` 字段。
   * @returns 订阅资源键；无法解析或未命中时为 `null`。
   */
  subscriptionResourceKey(config: Record<string, unknown>): null | string {
    if (!isPlainRecord(config) || typeof config.tcpChannelId !== 'string') {
      return null;
    }
    return config.tcpChannelId;
  }

  /**
   * 校验`payload`是否满足事件载荷约束，并拒绝不合法输入；先通过 `assertExactKeys` 校验输入边界。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `tcpChannelId`、`publicIpv4`、`publicPort`、`previousPublicIpv4` 字段。
   * @returns 包含 `previousPublicIpv4`、`previousPublicPort`、`publicIpv4`、`publicPort`、`tcpChannelId` 字段的事件载荷。
   * @throws 当 `publicIpv4 === previousPublicIpv4 && publicPort === previousPublicPort` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
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

  /**
   * 从`input`解析投递；当 `event.tcpChannelId !== resolved.config.tcpChannelId` 成立时返回 `{ reasonCode: 'invalid_source_config', stat…`。
   * @param input - 用于投递的结构化输入，包含 `subscriptionConfig`、`eventPayload` 字段。
   * @returns 包含 `reasonCode`、`status`、`variables` 字段的投递；无法解析或未命中时为 `null`。
   * @throws 当 `!(error instanceof SystemMessageContractError)` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
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

  /**
   * 从`input`解析订阅；先通过 `assertExactKeys` 校验输入边界。
   * @param input - 用于订阅的结构化输入，包含 `ddnsRecordId`、`tcpChannelId` 字段。
   * @returns 包含 `config`、`ddnsRecord`、`group`、`mapping`、`sourceSummary` 字段的订阅。
   * @throws 当 `!mapping` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `source.disabledReasonCode` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `!group || group.isDeleted` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `ddnsReason` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
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

/**
 * 校验`value`、`expectedKeys`是否满足精确键约束，并拒绝不合法输入。
 * @param value - 参与精确键比较、格式化或输出的候选值。
 * @param expectedKeys - 用于批量校验或读取精确键的键集合。
 * @throws 当 `!isPlainRecord(value) || value === null || Object.keys(value).sort().jo…` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
 */
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

/**
 * 根据`value`与当前约束判定纯文本记录。
 * @param value - 待判定是否满足纯文本记录约束的候选值。
 * @returns 满足纯文本记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 按输入约束要求系统消息资源标识为 1 至 24 位、首位非零的十进制雪花 ID。
 * @param value - 待验证的资源标识值。
 * @returns 保持文本不变的有效雪花 ID。
 * @throws 值不是字符串或不符合雪花 ID 十进制格式时抛出 `SystemMessageContractError`。
 */
function normalizeSnowflakeId(value: unknown): string {
  if (typeof value !== 'string' || !SNOWFLAKE_ID_PATTERN.test(value)) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/**
 * 将`value`规范为Ipv4，使等价输入得到一致表示。
 * @param value - 待转换为Ipv4的原始值。
 * @returns 通过格式校验的 IPv4 地址原文；输入不是 IPv4 字符串时不返回而是抛出合同错误。
 * @throws 当 `typeof value !== 'string' || isIP(value) !== 4` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
 */
function normalizeIpv4(value: unknown): string {
  if (typeof value !== 'string' || isIP(value) !== 4) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/**
 * 按输入约束要求系统消息来源端口为 1 至 65535 范围内的整数。
 * @param value - 待验证的来源端口值。
 * @returns 保持数值不变的有效 TCP 或 UDP 端口。
 * @throws 值不是整数或超出有效端口范围时抛出 `SystemMessageContractError`。
 */
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

/**
 * 按输入分支映射消息来源可用资格原因。
 * @param reason - 决定按输入分支映射消息来源可用资格原因内容、边界或目标的 `reason` 值。
 * @returns 当前状态对应的按输入分支映射消息来源可用资格原因，取值为 `'natmap_disabled'`、`'mapping_not_managed'`、`'mapping_not_tcp'`。
 */
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

/**
 * 按输入分支映射DDNS选项原因。
 * @param record - 用于按输入分支映射DDNS选项原因的领域对象，包含 `isDeleted`、`enabled`、`recordType`、`sourceType` 字段。
 * @param mapping - 用于按输入分支映射DDNS选项原因的领域对象，包含 `id` 字段。
 * @param group - 用于按输入分支映射DDNS选项原因的领域对象，包含 `isDeleted` 字段。
 * @returns 当前状态对应的按输入分支映射DDNS选项原因，取值为 `'ddns_deleted'`、`'ddns_disabled'`、`'ddns_a_required'`、`'ddns_source_type_invalid'`、`'ddns_mapping_mismatch'`。
 */
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

/**
 * 按输入分支映射DDNS消息来源原因。
 * @param record - 用于按输入分支映射DDNS消息来源原因的领域对象，包含 `isDeleted`、`enabled`、`recordType`、`sourceType` 字段。
 * @param mapping - 用于按输入分支映射DDNS消息来源原因的领域对象，包含 `id` 字段。
 * @returns 当前状态对应的按输入分支映射DDNS消息来源原因，取值为 `'ddns_not_found'`、`'ddns_disabled'`、`'ddns_not_ipv4'`、`'ddns_mapping_mismatch'`；无法解析或未命中时为 `null`。
 */
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

/**
 * 根据`record`处理域名标签并规范化DDNS完全限定域名；当 `subDomain === '@'` 成立时返回 `domain`。
 * @param record - 用于域名标签并规范化DDNS完全限定域名的领域对象，包含 `domain`、`subDomain` 字段。
 * @returns 按参数编码并拼接完成的域名标签并规范化DDNS完全限定域名。
 */
function ddnsFqdn(record: NetworkDdnsRecord): string {
  const domain = record.domain.trim().toLowerCase().replace(/\.$/, '');
  const subDomain = record.subDomain.trim().toLowerCase().replace(/\.$/, '');
  if (subDomain === '@') {
    return domain;
  }
  return `${subDomain}.${domain}`;
}

/**
 * 根据`mapping`与当前约束判定当前端点元组是否存在。
 * @param mapping - 用于当前端点元组是否存在的领域对象，包含 `currentPublicIpv4`、`currentPublicPort` 字段。
 * @returns 满足当前端点元组是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function hasCurrentEndpointTuple(mapping: NetworkPortForward): boolean {
  return (
    isIP(mapping.currentPublicIpv4 || '') === 4 &&
    typeof mapping.currentPublicPort === 'number' &&
    Number.isInteger(mapping.currentPublicPort) &&
    mapping.currentPublicPort >= 1 &&
    mapping.currentPublicPort <= 65_535
  );
}

/**
 * 根据`mapping`与当前约束判定新鲜的当前端点是否存在；从 `getTime` 读取新鲜的当前端点是否存在。
 * @param mapping - 用于新鲜的当前端点是否存在的领域对象，包含 `currentValidUntil` 字段。
 * @returns 满足新鲜的当前端点是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function hasFreshCurrentEndpoint(mapping: NetworkPortForward): boolean {
  return (
    hasCurrentEndpointTuple(mapping) &&
    !!mapping.currentValidUntil &&
    new Date(mapping.currentValidUntil).getTime() > Date.now()
  );
}

/**
 * 把领域字段投影为投递变量。
 * @param resolved - 用于把领域字段投影为投递变量的领域对象，包含 `ddnsRecord`、`group` 字段。
 * @param event - 触发把领域字段投影为投递变量的领域事件，包含 `publicPort`、`previousPublicIpv4`、`previousPublicPort`、`publicIpv4` 字段。
 * @returns 包含 `endpoint`、`fqdn`、`portForwardName`、`previousPublicIpv4`、`previousPublicPort` 字段的把领域字段投影为投递变量。
 */
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
