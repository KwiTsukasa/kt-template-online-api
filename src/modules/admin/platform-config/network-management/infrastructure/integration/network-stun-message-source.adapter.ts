import { isIP } from 'node:net';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SystemMessageContractError,
  type SystemMessageDeliveryReadiness,
  type SystemMessageScalar,
  type SystemMessageSourceAdapter,
  type SystemMessageSourceDefinition,
  type SystemMessageSourceOptionsResponse,
} from '@/modules/message-management/contract/message-management.types';
import { SystemMessageSourceRegistry } from '@/modules/message-management/application/system-message-source.registry';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { classifyStunEndpointSource } from '../../domain/network-source-eligibility';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const SNOWFLAKE_ID_PATTERN = /^[1-9]\d{0,23}$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

type StunSubscriptionConfig = {
  ddnsRecordId: string;
  portForwardId: string;
};

type StunEventPayload = {
  changedAt: string;
  currentPort: number;
  portForwardId: string;
  previousPort: number;
  publicIpv4: string;
};

type ResolvedSubscription = {
  config: StunSubscriptionConfig;
  ddnsRecord: NetworkDdnsRecord;
  mapping: NetworkPortForward;
  sourceSummary: string;
};

@Injectable()
export class NetworkStunMessageSourceAdapter
  implements OnModuleDestroy, OnModuleInit, SystemMessageSourceAdapter
{
  private registered = false;

  readonly definition: SystemMessageSourceDefinition = {
    description: '当 UDP STUN 映射端口变更且 IPv4 DDNS 已同步时发送消息。',
    displayName: 'STUN 映射端口变更',
    sourceKey: SOURCE_KEY,
    subscriptionFields: [
      {
        key: 'portForwardId',
        label: 'STUN 端口转发',
        optionCollection: 'portForwards',
        required: true,
        type: 'select',
      },
      {
        dependsOn: 'portForwardId',
        key: 'ddnsRecordId',
        label: 'IPv4 DDNS 记录',
        optionCollection: 'ddnsRecords',
        required: true,
        type: 'select',
      },
    ],
    variables: [
      {
        description: '所选 DDNS 完整域名',
        example: 'pal.kwitsukasa.top',
        key: 'domain',
        label: '域名',
        type: 'string',
      },
      {
        description: '新的公网映射端口',
        example: '38213',
        key: 'port',
        label: '端口',
        type: 'number',
      },
      {
        description: '服务端组合的域名与端口',
        example: 'pal.kwitsukasa.top:38213',
        key: 'endpoint',
        label: '访问端点',
        type: 'string',
      },
      {
        description: '端口转发显示名称',
        example: '帕鲁新世界',
        key: 'mappingName',
        label: '映射名称',
        type: 'string',
      },
      {
        description: '变化前的公网映射端口',
        example: '8213',
        key: 'previousPort',
        label: '原端口',
        type: 'number',
      },
      {
        description: '事件对应的公网 IPv4',
        example: '203.0.113.10',
        key: 'publicIpv4',
        label: '公网 IPv4',
        type: 'string',
      },
      {
        description: '按上海时区格式化的变化时间',
        example: '2026-07-23 20:30:00',
        key: 'changedAt',
        label: '变化时间',
        type: 'string',
      },
    ],
    version: 1,
  };

  constructor(
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
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
   * 从已校验事件中提取 STUN 映射的稳定资源键。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `portForwardId` 字段。
   * @returns 从已校验事件中提取 STUN 映射的稳定资源键。
   * @throws 当 `!Object.prototype.hasOwnProperty.call(payload, 'portForwardId') || type…` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  eventResourceKey(payload: Record<string, SystemMessageScalar>): string {
    if (
      !Object.prototype.hasOwnProperty.call(payload, 'portForwardId') ||
      typeof payload.portForwardId !== 'string'
    ) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    return payload.portForwardId;
  }

  /**
   * 校验 STUN 映射与 DDNS 绑定，并生成可持久化配置、资源键和来源摘要。
   * @param input - 待解析的 STUN 系统消息订阅配置。
   * @returns 已规范化的订阅配置、端口转发资源键与可读来源摘要。
   */
  async normalizeSubscriptionConfig(input: unknown): Promise<{
    canonicalConfig: Record<string, string>;
    resourceKey: string;
    sourceSummary: string;
  }> {
    const resolved = await this.resolveSubscription(input);
    return {
      canonicalConfig: resolved.config,
      resourceKey: resolved.config.portForwardId,
      sourceSummary: resolved.sourceSummary,
    };
  }

  /**
   * 探测 STUN 订阅配置是否仍可解析，把契约错误转换为禁用原因而不打断管理端读取。
   * @param config - 待检查的已持久化 STUN 订阅配置。
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
        sourceSummary: '未选择有效的 STUN 映射与 DDNS',
        valid: false,
      };
    }
  }

  /**
   * 将网络实体转换成供动态订阅表单使用的标准选项。
   * @returns 包含 `ddnsRecords`、`portForwards` 字段的将网络实体转换成供动态订阅表单使用的标准选项。
   */
  async listSubscriptionOptions(): Promise<SystemMessageSourceOptionsResponse> {
    const [mappings, records] = await Promise.all([
      this.mappingRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
      this.ddnsRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
    ]);
    const mappingsById = new Map(
      mappings.map((mapping) => [String(mapping.id), mapping]),
    );
    return {
      ddnsRecords: records.map((record) => {
        const mapping = (() => {
          if (record.portForwardId) {
            return mappingsById.get(String(record.portForwardId));
          }
          return undefined;
        })();
        const disabledReasonCode = ddnsOptionReason(record, mapping);
        return {
          ...(() => {
            if (record.portForwardId) {
              return { dependsOnValue: String(record.portForwardId) };
            }
            return {};
          })(),
          disabled: disabledReasonCode !== null,
          disabledReasonCode,
          eligible: disabledReasonCode === null,
          fqdn: ddnsFqdn(record),
          id: String(record.id),
          label: [record.name, ddnsFqdn(record), disabledReasonCode]
            .filter((value) => value !== null)
            .join(' · '),
          name: record.name,
          portForwardId: (() => {
            if (record.portForwardId) {
              return String(record.portForwardId);
            }
            return '';
          })(),
          value: String(record.id),
        };
      }),
      portForwards: mappings.map((mapping) => {
        const { disabledReasonCode, eligible } =
          classifyStunEndpointSource(mapping);
        return {
          disabled: !eligible,
          disabledReasonCode,
          eligible,
          externalPort: mapping.externalPort,
          id: String(mapping.id),
          internalPort: mapping.internalPort,
          label: [
            mapping.name,
            `${mapping.protocol.toUpperCase()}:${mapping.externalPort}`,
            disabledReasonCode,
          ]
            .filter((value) => value !== null)
            .join(' · '),
          name: mapping.name,
          protocol: mapping.protocol,
          value: String(mapping.id),
        };
      }),
    };
  }

  /**
   * 从订阅配置中提取自有的字符串资源键，无效配置不参与匹配。
   * @param config - 限定从订阅配置中提取自有的字符串资源键，无效配置不参与匹配边界、地址与开关的运行配置，包含 `portForwardId` 字段。
   * @returns 从订阅配置中提取自有的字符串资源键，无效配置不参与匹配；无法解析或未命中时为 `null`。
   */
  subscriptionResourceKey(config: Record<string, unknown>): null | string {
    if (
      !isPlainRecord(config) ||
      !Object.prototype.hasOwnProperty.call(config, 'portForwardId') ||
      typeof config.portForwardId !== 'string'
    ) {
      return null;
    }
    return config.portForwardId;
  }

  /**
   * 校验`payload`是否满足事件载荷约束，并拒绝不合法输入。
   * @param payload - 待按当前协议校验并路由的事件载荷，包含 `changedAt`、`currentPort`、`previousPort`、`portForwardId` 字段。
   * @returns 包含 `changedAt`、`currentPort`、`portForwardId`、`previousPort`、`publicIpv4` 字段的事件载荷。
   * @throws 当 `!isPlainRecord(payload)` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `typeof payload.publicIpv4 !== 'string' || isIP(payload.publicIpv4) !==…` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  validateEventPayload(
    payload: Record<string, unknown>,
  ): Record<string, SystemMessageScalar> {
    if (!isPlainRecord(payload)) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    const changedAt = normalizeRfc3339(payload.changedAt);
    const currentPort = normalizePort(payload.currentPort);
    const previousPort = normalizePort(payload.previousPort);
    const portForwardId = normalizeSnowflakeId(payload.portForwardId);
    if (
      typeof payload.publicIpv4 !== 'string' ||
      isIP(payload.publicIpv4) !== 4 ||
      currentPort === previousPort
    ) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    return {
      changedAt,
      currentPort,
      portForwardId,
      previousPort,
      publicIpv4: payload.publicIpv4,
    };
  }

  /**
   * 从`input`解析投递；当 `event.portForwardId !== resolved.config.portForwardId` 成立时返回 `{ reasonCode: 'invalid_source_config', stat…`。
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
    let event: StunEventPayload;
    try {
      event = this.validateEventPayload(input.eventPayload) as StunEventPayload;
    } catch (error) {
      if (!(error instanceof SystemMessageContractError)) throw error;
      return { reasonCode: error.code, status: 'cancelled' };
    }
    if (event.portForwardId !== resolved.config.portForwardId) {
      return { reasonCode: 'invalid_source_config', status: 'cancelled' };
    }
    if (!hasCurrentEndpoint(resolved.mapping)) {
      return { reasonCode: 'endpoint_superseded', status: 'superseded' };
    }
    if (
      resolved.mapping.currentPublicPort !== event.currentPort ||
      resolved.mapping.currentPublicIpv4 !== event.publicIpv4
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
        status: 'deferred',
        variables,
      };
    }
    return { reasonCode: null, status: 'ready', variables };
  }

  /**
   * 从`input`解析订阅；从 `mappingRepository.findOne` 读取订阅。
   * @param input - 用于订阅的结构化输入，包含 `ddnsRecordId`、`portForwardId` 字段。
   * @returns 包含 `config`、`ddnsRecord`、`mapping`、`sourceSummary` 字段的订阅。
   * @throws 当 `!isPlainRecord(input)` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `normalizeSnowflakeId` 调用失败时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `!mapping` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `!sourceEligibility.eligible` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
   *   当 `ddnsReason` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
   */
  private async resolveSubscription(
    input: unknown,
  ): Promise<ResolvedSubscription> {
    if (!isPlainRecord(input)) {
      throw new SystemMessageContractError('invalid_source_config');
    }
    let config: StunSubscriptionConfig;
    try {
      config = {
        ddnsRecordId: normalizeSnowflakeId(input.ddnsRecordId),
        portForwardId: normalizeSnowflakeId(input.portForwardId),
      };
    } catch {
      throw new SystemMessageContractError('invalid_source_config');
    }
    const mapping = await this.mappingRepository.findOne({
      where: { id: config.portForwardId },
    });
    if (!mapping) {
      throw new SystemMessageContractError('mapping_not_found');
    }
    const sourceEligibility = classifyStunEndpointSource(mapping);
    if (!sourceEligibility.eligible) {
      throw new SystemMessageContractError(
        messageSourceEligibilityReason(
          sourceEligibility.disabledReasonCode as NonNullable<
            typeof sourceEligibility.disabledReasonCode
          >,
        ),
      );
    }
    const ddnsRecord = await this.ddnsRepository.findOne({
      where: { id: config.ddnsRecordId },
    });
    const ddnsReason = ddnsMessageSourceReason(ddnsRecord, mapping);
    if (ddnsReason) {
      throw new SystemMessageContractError(ddnsReason);
    }
    return {
      config,
      ddnsRecord: ddnsRecord as NetworkDdnsRecord,
      mapping,
      sourceSummary: `${mapping.name} · ${ddnsFqdn(ddnsRecord as NetworkDdnsRecord)}`,
    };
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
 * 将`value`规范为RFC3339 时间字符串，使等价输入得到一致表示；从 `date.getTime` 读取RFC3339 时间字符串。
 * @param value - 待转换为RFC3339 时间字符串的原始值。
 * @returns RFC3339 时间字符串。
 * @throws 当 `typeof value !== 'string'` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；当 `!match || !isValidRfc3339Calendar(match)` 成立时拒绝当前输入并抛出 `SystemMessageContractError`；
 *   当 `Number.isNaN(date.getTime())` 成立时拒绝当前输入并抛出 `SystemMessageContractError`。
 */
function normalizeRfc3339(value: unknown): string {
  if (typeof value !== 'string') {
    throw new SystemMessageContractError('invalid_source_config');
  }
  const match = RFC3339_PATTERN.exec(value);
  if (!match || !isValidRfc3339Calendar(match)) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return date.toISOString();
}

/**
 * 根据`match`与当前约束判定有效RFC3339日历。
 * @param match - 决定有效RFC3339日历内容、边界或目标的 `match` 值。
 * @returns 满足有效RFC3339日历约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isValidRfc3339Calendar(match: RegExpExecArray): boolean {
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = (() => {
    if (offsetHourText) {
      return Number(offsetHourText);
    }
    return 0;
  })();
  const offsetMinute = (() => {
    if (offsetMinuteText) {
      return Number(offsetMinuteText);
    }
    return 0;
  })();
  const daysInMonth = [
    31,
    (() => {
      if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
        return 29;
      }
      return 28;
    })(),
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

/**
 * 按输入分支映射DDNS选项原因。
 * @param record - 用于按输入分支映射DDNS选项原因的领域对象，包含 `isDeleted`、`enabled`、`recordType`、`sourceType` 字段。
 * @param mapping - 用于按输入分支映射DDNS选项原因的领域对象，包含 `id` 字段。
 * @returns 按输入分支映射DDNS选项原因。
 */
function ddnsOptionReason(
  record: NetworkDdnsRecord | null | undefined,
  mapping: NetworkPortForward | undefined,
): null | string {
  if (!record) return 'ddns_not_found';
  if (record.isDeleted) return 'ddns_deleted';
  if (!record.enabled) return 'ddns_disabled';
  if (record.recordType !== 'A') return 'ddns_a_required';
  if (record.sourceType !== 'port_forward_ipv4')
    return 'ddns_source_type_invalid';
  if (!mapping || String(record.portForwardId) !== String(mapping.id)) {
    return 'ddns_mapping_mismatch';
  }
  const source = classifyStunEndpointSource(mapping);
  return source.disabledReasonCode;
}

/**
 * 按输入分支映射消息来源可用资格原因。
 * @param reason - 决定按输入分支映射消息来源可用资格原因内容、边界或目标的 `reason` 值。
 * @returns 当前状态对应的按输入分支映射消息来源可用资格原因，取值为 `'keeper_disabled'`、`'mapping_port_mismatch'`、`'mapping_not_managed'`、`'mapping_not_udp'`。
 */
function messageSourceEligibilityReason(
  reason: NonNullable<
    ReturnType<typeof classifyStunEndpointSource>['disabledReasonCode']
  >,
):
  | 'keeper_disabled'
  | 'mapping_not_managed'
  | 'mapping_not_udp'
  | 'mapping_port_mismatch' {
  switch (reason) {
    case 'KEEPER_DISABLED':
      return 'keeper_disabled';
    case 'PORT_MISMATCH':
      return 'mapping_port_mismatch';
    case 'SOURCE_DELETING':
      return 'mapping_not_managed';
    case 'UDP_REQUIRED':
      return 'mapping_not_udp';
  }
}

/**
 * 按输入分支映射DDNS消息来源原因。
 * @param record - 用于按输入分支映射DDNS消息来源原因的领域对象，包含 `isDeleted`、`enabled`、`recordType`、`sourceType` 字段。
 * @param mapping - 用于按输入分支映射DDNS消息来源原因的领域对象，包含 `id` 字段。
 * @returns 当前状态对应的按输入分支映射DDNS消息来源原因，取值为 `'ddns_not_found'`、`'ddns_disabled'`、`'ddns_not_ipv4'`、`'ddns_mapping_mismatch'`；无法解析或未命中时为 `null`。
 */
function ddnsMessageSourceReason(
  record: NetworkDdnsRecord | null | undefined,
  mapping: NetworkPortForward,
):
  | 'ddns_disabled'
  | 'ddns_mapping_mismatch'
  | 'ddns_not_found'
  | 'ddns_not_ipv4'
  | 'keeper_disabled'
  | 'mapping_not_managed'
  | 'mapping_not_udp'
  | 'mapping_port_mismatch'
  | null {
  if (!record || record.isDeleted) return 'ddns_not_found';
  if (!record.enabled) return 'ddns_disabled';
  if (record.recordType !== 'A' || record.sourceType !== 'port_forward_ipv4') {
    return 'ddns_not_ipv4';
  }
  if (String(record.portForwardId) !== String(mapping.id)) {
    return 'ddns_mapping_mismatch';
  }
  const source = classifyStunEndpointSource(mapping);
  if (source.disabledReasonCode) {
    return messageSourceEligibilityReason(source.disabledReasonCode);
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
 * 根据`mapping`与当前约束判定当前端点是否存在；从 `getTime` 读取当前端点是否存在。
 * @param mapping - 用于当前端点是否存在的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`currentValidUntil` 字段。
 * @returns 满足当前端点是否存在约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function hasCurrentEndpoint(mapping: NetworkPortForward): boolean {
  return (
    isIP(mapping.currentPublicIpv4 || '') === 4 &&
    typeof mapping.currentPublicPort === 'number' &&
    Number.isInteger(mapping.currentPublicPort) &&
    mapping.currentPublicPort >= 1 &&
    mapping.currentPublicPort <= 65_535 &&
    !!mapping.currentValidUntil &&
    new Date(mapping.currentValidUntil).getTime() > Date.now()
  );
}

/**
 * 把领域字段投影为投递变量。
 * @param resolved - 用于把领域字段投影为投递变量的领域对象，包含 `ddnsRecord`、`mapping` 字段。
 * @param event - 触发把领域字段投影为投递变量的领域事件，包含 `changedAt`、`currentPort`、`previousPort`、`publicIpv4` 字段。
 * @returns 包含 `changedAt`、`domain`、`endpoint`、`mappingName`、`port` 字段的把领域字段投影为投递变量。
 */
function deliveryVariables(
  resolved: ResolvedSubscription,
  event: StunEventPayload,
): Record<string, boolean | number | string> {
  const domain = ddnsFqdn(resolved.ddnsRecord);
  return {
    changedAt: formatShanghaiDateTime(event.changedAt),
    domain,
    endpoint: `${domain}:${event.currentPort}`,
    mappingName: resolved.mapping.name,
    port: event.currentPort,
    previousPort: event.previousPort,
    publicIpv4: event.publicIpv4,
  };
}

/**
 * 按上海时区格式化日期时间。
 * @param value - 待转换为按上海时区格式化日期时间的原始值。
 * @returns 按参数编码并拼接完成的按上海时区格式化日期时间。
 */
function formatShanghaiDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
