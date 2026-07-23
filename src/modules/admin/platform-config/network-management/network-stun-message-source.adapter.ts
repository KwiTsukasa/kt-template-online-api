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
  type SystemMessageSourceDefinition,
} from '@/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { SystemMessageSourceRegistry } from '@/modules/qqbot/core/application/message-push/system-message-source.registry';
import { NetworkDdnsRecord } from './network-ddns.entity';
import { NetworkPortForward } from './network-management.entity';
import { classifyStunEndpointSource } from './network-source-eligibility';

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

/**
 * Adapts Network-owned STUN mappings and DDNS records to the QQBot source contract.
 *
 * It deliberately owns no event staging or delivery queue state; every delivery is
 * recomputed from the current Network records to prevent stale endpoint sends.
 */
@Injectable()
export class NetworkStunMessageSourceAdapter
  implements OnModuleDestroy, OnModuleInit
{
  private registered = false;

  /** Immutable public schema for the first Network-owned system message source. */
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

  /**
   * Creates the Network-owned source adapter.
   * @param mappingRepository - Current port-forward and Keeper state reader.
   * @param ddnsRepository - Current A-record DDNS binding reader.
   * @param sourceRegistry - Core-owned process registry exported to Network.
   */
  constructor(
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
    @InjectRepository(NetworkDdnsRecord)
    private readonly ddnsRepository: Repository<NetworkDdnsRecord>,
    private readonly sourceRegistry: SystemMessageSourceRegistry,
  ) {}

  /** Registers this instance once after its owning Network module initializes. */
  onModuleInit(): void {
    if (this.registered) return;
    this.sourceRegistry.register(this);
    this.registered = true;
  }

  /** Unregisters only this instance during Network module teardown. */
  onModuleDestroy(): void {
    if (!this.registered) return;
    this.sourceRegistry.unregister(this.definition.sourceKey, this);
    this.registered = false;
  }

  /**
   * Normalizes a submitted subscription to the two supported string identifiers.
   * @param input - Untrusted admin configuration; unknown fields are intentionally discarded.
   * @returns Canonical IDs, the mapping resource key, and a server-derived summary.
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
   * Checks current subscription validity without writing subscription or Network state.
   * @param config - Persisted or submitted source configuration.
   * @returns Stable validity result with a safe source summary for management UI.
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
   * Lists current mapping and DDNS candidates with structural, lease-independent eligibility.
   * @returns Locked `portForwards` and `ddnsRecords` option collections.
   */
  async listSubscriptionOptions(): Promise<Record<string, unknown>> {
    const [mappings, records] = await Promise.all([
      this.mappingRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
      this.ddnsRepository.find({ order: { id: 'ASC', name: 'ASC' } }),
    ]);
    const mappingsById = new Map(
      mappings.map((mapping) => [String(mapping.id), mapping]),
    );
    return {
      ddnsRecords: records.map((record) => {
        const mapping = record.portForwardId
          ? mappingsById.get(String(record.portForwardId))
          : undefined;
        const disabledReasonCode = ddnsOptionReason(record, mapping);
        return {
          disabledReasonCode,
          eligible: disabledReasonCode === null,
          fqdn: ddnsFqdn(record),
          id: String(record.id),
          name: record.name,
          portForwardId: record.portForwardId
            ? String(record.portForwardId)
            : '',
        };
      }),
      portForwards: mappings.map((mapping) => {
        const { disabledReasonCode, eligible } =
          classifyStunEndpointSource(mapping);
        return {
          disabledReasonCode,
          eligible,
          externalPort: mapping.externalPort,
          id: String(mapping.id),
          internalPort: mapping.internalPort,
          name: mapping.name,
          protocol: mapping.protocol,
        };
      }),
    };
  }

  /**
   * Rejects unsafe event data and retains only the source's permitted scalar fields.
   * @param payload - Network event candidate before it is staged in the QQBot Outbox.
   * @returns Canonical event variables with no client-controlled endpoint field.
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
   * Re-evaluates a frozen event against the current mapping and DDNS state before sending.
   * @param input - Event payload and persisted subscription configuration.
   * @returns Ready variables, a DDNS wait result, or terminal cancellation/supersession.
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
        status: 'waiting_ddns',
        variables,
      };
    }
    return { reasonCode: null, status: 'ready', variables };
  }

  /**
   * Resolves and structurally validates both persisted resources selected by a subscription.
   * @param input - Unknown configuration from an Admin request or persisted subscription.
   * @returns Current resource rows and canonical identity when their relationship is valid.
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
 * Verifies that a value is a non-array object with string-addressable own values.
 * @param value - Untrusted input at an adapter boundary.
 * @returns Whether the value is safe to inspect as a plain record.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates a Snowflake at JSON boundaries without converting it to an unsafe number.
 * @param value - Candidate string identifier.
 * @returns The unchanged decimal string.
 */
function normalizeSnowflakeId(value: unknown): string {
  if (typeof value !== 'string' || !SNOWFLAKE_ID_PATTERN.test(value)) {
    throw new SystemMessageContractError('invalid_source_config');
  }
  return value;
}

/**
 * Validates an event port as an integer transport port.
 * @param value - Candidate event scalar.
 * @returns The safe port number.
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
 * Normalizes a timezone-qualified event timestamp to canonical ISO UTC text.
 * @param value - Candidate RFC3339 timestamp.
 * @returns Canonical ISO string safe for later Shanghai rendering.
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
 * Validates RFC3339 calendar and offset components before JavaScript can normalize them.
 * @param match - Capture groups produced by the source timestamp pattern.
 * @returns Whether all calendar, wall-clock, and offset fields are in range.
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
  const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
  const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
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
 * Determines whether a persisted DDNS record is a usable structural subscription target.
 * @param record - Candidate A-record binding, possibly absent or deleted.
 * @param mapping - Mapping selected by the subscription, if currently present.
 * @returns Null when structurally valid or a stable invalid-reason code.
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
 * Converts a shared Network structural reason to the locked message-source contract.
 * @param reason - Existing uppercase Network eligibility reason.
 * @returns Lowercase reason code safe for message subscription views and delivery state.
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
 * Determines the locked message-source reason for a DDNS record and its selected mapping.
 * @param record - Candidate DDNS record, including deleted or absent state.
 * @param mapping - Canonical selected mapping after its structural validation.
 * @returns Null when valid or a locked lowercase message-source reason.
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
  return source.disabledReasonCode
    ? messageSourceEligibilityReason(source.disabledReasonCode)
    : null;
}

/**
 * Forms the normalized fully-qualified hostname from persisted server-owned DDNS fields.
 * @param record - Canonical DDNS binding.
 * @returns Lowercase FQDN without a trailing dot.
 */
function ddnsFqdn(record: NetworkDdnsRecord): string {
  const domain = record.domain.trim().toLowerCase().replace(/\.$/, '');
  const subDomain = record.subDomain.trim().toLowerCase().replace(/\.$/, '');
  return subDomain === '@' ? domain : `${subDomain}.${domain}`;
}

/**
 * Checks current Keeper endpoint readiness independently of structural subscription validity.
 * @param mapping - Current mapping row after structural eligibility passed.
 * @returns Whether a live public IPv4 endpoint is available at this instant.
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
 * Builds the whitelisted template variables from current Network records and frozen event data.
 * @param resolved - Current structurally valid subscription resources.
 * @param event - Validated immutable event payload.
 * @returns Server-derived scalar values ready for formal template rendering.
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
 * Formats an event timestamp as the locked Asia/Shanghai template variable value.
 * @param value - Valid RFC3339 event timestamp.
 * @returns `YYYY-MM-DD HH:mm:ss` assembled without locale punctuation assumptions.
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
