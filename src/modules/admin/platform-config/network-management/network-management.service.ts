import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { KtDateTime, throwVbenError } from '@/common';
import { NetworkAgentMqttService } from './network-agent-mqtt.service';
import { NetworkAgentState } from './network-agent-state.entity';
import { NetworkEndpointHistory } from './network-endpoint-history.entity';
import {
  NetworkEndpointHistoryQueryDto,
  NetworkPortForwardCreateDto,
  NetworkPortForwardListQueryDto,
  NetworkPortForwardUpdateDto,
} from './network-management.dto';
import { NetworkPortForward } from './network-management.entity';
import {
  isIpv4Address,
  portForwardActiveKey,
} from './network-management.types';

const DEFAULT_AGENT_ID = 'nas-main';
const DEFAULT_TARGET_IPV4 = '192.168.31.224';

@Injectable()
export class NetworkManagementService {
  /**
   * Creates the persisted network desired-state application service.
   * @param mappingRepository - Read model for port-forward list queries.
   * @param historyRepository - Read model for endpoint history queries.
   * @param stateRepository - Read model for Agent status queries.
   * @param dataSource - Transaction boundary serializing global desired revision changes.
   * @param configService - Fixed Agent and NAS target identity settings.
   * @param mqttService - Asynchronous retained desired snapshot publisher.
   */
  constructor(
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
    @InjectRepository(NetworkEndpointHistory)
    private readonly historyRepository: Repository<NetworkEndpointHistory>,
    @InjectRepository(NetworkAgentState)
    private readonly stateRepository: Repository<NetworkAgentState>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly mqttService: NetworkAgentMqttService,
  ) {}

  /**
   * Lists active desired mappings with independent sync, Keeper, and lease state.
   * @param query - Validated pagination and filter query.
   * @returns Page whose endpoint fields hide expired leases.
   */
  async list(query: NetworkPortForwardListQueryDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const builder = this.mappingRepository
      .createQueryBuilder('mapping')
      .where('mapping.isDeleted = :isDeleted', { isDeleted: false });
    if (query.name) {
      builder.andWhere('mapping.name LIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.protocol) {
      builder.andWhere('mapping.protocol = :protocol', {
        protocol: query.protocol,
      });
    }
    if (query.syncStatus) {
      builder.andWhere('mapping.syncStatus = :syncStatus', {
        syncStatus: query.syncStatus,
      });
    }
    const [items, total] = await builder
      .orderBy('mapping.createTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: items.map((item) => this.serialize(item)), total };
  }

  /**
   * Creates one TCP or UDP desired mapping under the global revision lock.
   * @param input - Strict mutable fields; target IPv4 comes from server configuration.
   * @returns Latest desired record in pending state.
   */
  async create(input: NetworkPortForwardCreateDto) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const repository = manager.getRepository(NetworkPortForward);
      if ((await repository.count({ where: { isDeleted: false } })) >= 64) {
        throwVbenError('端口转发记录已达到 64 条上限', HttpStatus.CONFLICT);
      }
      const activeKey = portForwardActiveKey(
        input.protocol,
        input.externalPort,
      );
      if (await repository.findOne({ where: { activeKey } })) {
        throwVbenError('同协议外部端口已存在', HttpStatus.CONFLICT);
      }
      const mapping = repository.create({
        activeKey,
        currentObservedAt: null,
        currentPublicIpv4: null,
        currentPublicPort: null,
        currentValidUntil: null,
        desiredPresence: 'present',
        externalPort: input.externalPort,
        internalPort: input.internalPort,
        isDeleted: false,
        keeperDesiredEnabled: false,
        keeperStatus: 'disabled',
        lastErrorCode: null,
        lastErrorMessage: null,
        name: this.normalizeName(input.name),
        probeRequestId: null,
        protocol: input.protocol,
        remark: input.remark?.trim() || null,
        reportedRevision: '0',
        syncStatus: 'pending',
        targetIpv4: state.targetIpv4,
      });
      this.advanceRevision(state, mapping);
      try {
        await repository.save(mapping);
        await manager.getRepository(NetworkAgentState).save(state);
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          throwVbenError('同协议外部端口已存在', HttpStatus.CONFLICT);
        }
        throw error;
      }
      return mapping;
    });
    this.notifyDesiredChanged();
    return this.serialize(saved);
  }

  /**
   * Updates editable desired fields while preserving Keeper prerequisites.
   * @param id - Active mapping identifier.
   * @param input - Non-empty strict update payload.
   * @returns Latest desired record in pending state.
   */
  async update(id: string, input: NetworkPortForwardUpdateDto) {
    if (Object.keys(input).length === 0) {
      throwVbenError('至少提供一个修改字段', HttpStatus.BAD_REQUEST);
    }
    return this.mutate(id, async (mapping, manager) => {
      if (mapping.desiredPresence === 'absent') {
        throwVbenError('端口转发正在删除', HttpStatus.CONFLICT);
      }
      const protocol = input.protocol || mapping.protocol;
      const externalPort = input.externalPort || mapping.externalPort;
      const internalPort = input.internalPort || mapping.internalPort;
      if (
        mapping.keeperDesiredEnabled &&
        (protocol !== 'udp' || externalPort !== internalPort)
      ) {
        throwVbenError(
          '请先停用 Keeper 再修改协议或同源端口',
          HttpStatus.BAD_REQUEST,
        );
      }
      const activeKey = portForwardActiveKey(protocol, externalPort);
      if (activeKey !== mapping.activeKey) {
        const conflict = await manager
          .getRepository(NetworkPortForward)
          .findOne({ where: { activeKey } });
        if (conflict && conflict.id !== mapping.id) {
          throwVbenError('同协议外部端口已存在', HttpStatus.CONFLICT);
        }
      }
      if (input.name !== undefined) {
        mapping.name = this.normalizeName(input.name);
      }
      mapping.remark =
        input.remark === undefined
          ? mapping.remark
          : input.remark.trim() || null;
      mapping.protocol = protocol;
      mapping.externalPort = externalPort;
      mapping.internalPort = internalPort;
      mapping.activeKey = activeKey;
      mapping.syncStatus = 'pending';
    });
  }

  /**
   * Writes an absent tombstone while retaining the active key until explicit Agent proof.
   * @param id - Active mapping identifier.
   * @returns Latest deleting desired record.
   */
  async remove(id: string) {
    return this.mutate(id, async (mapping) => {
      if (mapping.desiredPresence === 'absent') {
        throwVbenError('端口转发正在删除', HttpStatus.CONFLICT);
      }
      mapping.desiredPresence = 'absent';
      mapping.keeperDesiredEnabled = false;
      mapping.probeRequestId = null;
      mapping.syncStatus = 'deleting';
      this.withdrawCurrentEndpoint(mapping);
    });
  }

  /**
   * Advances revision to retry reconciliation without rewriting actual state.
   * @param id - Active or deleting mapping identifier.
   * @returns Latest desired record.
   */
  async retry(id: string) {
    return this.mutate(id, async (mapping) => {
      mapping.lastErrorCode = null;
      mapping.lastErrorMessage = null;
      mapping.syncStatus =
        mapping.desiredPresence === 'absent' ? 'deleting' : 'pending';
    });
  }

  /**
   * Enables continuous STUN only for same-port UDP and emits a new probe request ID.
   * @param id - Active mapping identifier.
   * @returns Latest desired record.
   */
  async enableKeeper(id: string) {
    return this.mutate(id, async (mapping) => {
      this.assertKeeperCapable(mapping);
      mapping.keeperDesiredEnabled = true;
      mapping.probeRequestId = randomUUID();
      mapping.syncStatus = 'pending';
    });
  }

  /**
   * Disables continuous STUN and immediately hides the current public lease.
   * @param id - Active mapping identifier.
   * @returns Latest desired record.
   */
  async disableKeeper(id: string) {
    return this.mutate(id, async (mapping) => {
      this.assertKeeperCapable(mapping);
      mapping.keeperDesiredEnabled = false;
      mapping.probeRequestId = null;
      mapping.syncStatus = 'pending';
      this.withdrawCurrentEndpoint(mapping);
    });
  }

  /**
   * Requests an immediate idempotent probe for an already-enabled UDP Keeper.
   * @param id - Active mapping identifier.
   * @returns Latest desired record.
   */
  async probe(id: string) {
    return this.mutate(id, async (mapping) => {
      this.assertKeeperCapable(mapping);
      if (!mapping.keeperDesiredEnabled) {
        throwVbenError('请先启用 UDP Keeper', HttpStatus.BAD_REQUEST);
      }
      mapping.probeRequestId = randomUUID();
      mapping.syncStatus = 'pending';
    });
  }

  /**
   * Lists append-only endpoint events for one active desired mapping.
   * @param id - Active mapping identifier.
   * @param query - Validated pagination query.
   * @returns Endpoint event page ordered newest first.
   */
  async endpointHistory(
    id: string,
    query: NetworkEndpointHistoryQueryDto = {},
  ) {
    this.assertId(id);
    const mapping = await this.mappingRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!mapping) throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const [items, total] = await this.historyRepository.findAndCount({
      order: { occurredAt: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where: { mappingId: id },
    });
    return { items: items.map((item) => this.serializeHistory(item)), total };
  }

  /**
   * Returns Agent connectivity and the three independent revision cursors.
   * @returns Persisted singleton state or a safe offline bootstrap view.
   */
  async agentStatus() {
    const agentId = this.agentId();
    const state = await this.stateRepository.findOne({ where: { agentId } });
    if (!state) {
      return {
        agentId,
        appliedRevision: '0',
        desiredRevision: '0',
        lastErrorCode: null,
        lastErrorMessage: null,
        lastHeartbeatAt: null,
        currentIpv6ObservedAt: null,
        currentPublicIpv6: null,
        online: false,
        publishedRevision: '0',
        targetIpv4: this.targetIpv4(),
        version: null,
      };
    }
    return {
      agentId: state.agentId,
      appliedRevision: state.appliedRevision,
      desiredRevision: state.desiredRevision,
      lastErrorCode:
        state.lastReconcileErrorCode || state.lastMqttErrorCode || null,
      lastErrorMessage:
        state.lastReconcileErrorMessage || state.lastMqttErrorMessage || null,
      lastHeartbeatAt: state.lastHeartbeatAt || null,
      lastMqttErrorCode: state.lastMqttErrorCode || null,
      lastMqttErrorMessage: state.lastMqttErrorMessage || null,
      lastReconcileErrorCode: state.lastReconcileErrorCode || null,
      lastReconcileErrorMessage: state.lastReconcileErrorMessage || null,
      currentIpv6ObservedAt: state.currentIpv6ObservedAt || null,
      currentPublicIpv6: state.currentPublicIpv6 || null,
      online: state.online,
      publishedRevision: state.publishedRevision,
      startedAt: state.startedAt || null,
      targetIpv4: state.targetIpv4,
      version: state.version || null,
    };
  }

  /**
   * Serializes one mutation under the singleton pessimistic revision lock.
   * @param id - Active mapping identifier.
   * @param change - Scoped desired-state mutation executed before revision advance.
   * @returns Latest serialized desired record.
   */
  private async mutate(
    id: string,
    change: (
      mapping: NetworkPortForward,
      manager: EntityManager,
    ) => Promise<void>,
  ) {
    this.assertId(id);
    const saved = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const repository = manager.getRepository(NetworkPortForward);
      const mapping = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id, isDeleted: false },
      });
      if (!mapping) throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
      await change(mapping, manager);
      this.advanceRevision(state, mapping);
      try {
        await repository.save(mapping);
        await manager.getRepository(NetworkAgentState).save(state);
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          throwVbenError('同协议外部端口已存在', HttpStatus.CONFLICT);
        }
        throw error;
      }
      return mapping;
    });
    this.notifyDesiredChanged();
    return this.serialize(saved);
  }

  /**
   * Locks or initializes the one configured Agent state row.
   * @param manager - Active desired-state transaction manager.
   * @returns Pessimistically locked singleton Agent state.
   */
  private async lockAgentState(
    manager: EntityManager,
  ): Promise<NetworkAgentState> {
    const repository = manager.getRepository(NetworkAgentState);
    const agentId = this.agentId();
    await repository
      .createQueryBuilder()
      .insert()
      .into(NetworkAgentState)
      .values({
        agentId,
        appliedRevision: '0',
        desiredIssuedAt: new KtDateTime(),
        desiredRevision: '0',
        online: false,
        publishedRevision: '0',
        targetIpv4: this.targetIpv4(),
      })
      .orIgnore()
      .execute();
    const existing = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { agentId },
    });
    if (existing) {
      if (existing.targetIpv4 !== this.targetIpv4()) {
        throwVbenError(
          'Agent 目标 IPv4 与服务端固定配置不一致',
          HttpStatus.CONFLICT,
        );
      }
      return existing;
    }
    throwVbenError('Agent 状态行初始化失败', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Increments the global revision exactly once and stamps stable issue time on both rows.
   * @param state - Locked singleton Agent state.
   * @param mapping - Mapping changed by the current transaction.
   */
  private advanceRevision(
    state: NetworkAgentState,
    mapping: NetworkPortForward,
  ): void {
    const revision = (BigInt(state.desiredRevision) + 1n).toString();
    const issuedAt = new KtDateTime();
    state.desiredRevision = revision;
    state.desiredIssuedAt = issuedAt;
    mapping.desiredRevision = revision;
    mapping.desiredIssuedAt = issuedAt;
  }

  /** Rejects TCP, mismatched ports, and deleting records for raw UDP Keeper actions. */
  private assertKeeperCapable(mapping: NetworkPortForward): void {
    if (mapping.desiredPresence !== 'present') {
      throwVbenError('删除中的记录不能操作 Keeper', HttpStatus.CONFLICT);
    }
    if (mapping.protocol !== 'udp') {
      throwVbenError('TCP 仅支持端口转发 CRUD', HttpStatus.BAD_REQUEST);
    }
    if (mapping.externalPort !== mapping.internalPort) {
      throwVbenError(
        'UDP Keeper 要求外部端口与内部端口一致',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Clears only current publishable lease fields while preserving last observation. */
  private withdrawCurrentEndpoint(mapping: NetworkPortForward): void {
    mapping.currentPublicIpv4 = null;
    mapping.currentPublicPort = null;
    mapping.currentObservedAt = null;
    mapping.currentValidUntil = null;
  }

  /**
   * Converts one entity to the Admin contract and hides an expired current endpoint.
   * @param mapping - Persisted desired and reported record.
   * @returns Response-safe record with bigint fields kept as strings.
   */
  private serialize(mapping: NetworkPortForward) {
    const leaseValid =
      !!mapping.currentPublicIpv4 &&
      !!mapping.currentPublicPort &&
      !!mapping.currentValidUntil &&
      new Date(mapping.currentValidUntil).getTime() > Date.now();
    return {
      id: String(mapping.id),
      name: mapping.name,
      remark: mapping.remark || null,
      protocol: mapping.protocol,
      externalPort: mapping.externalPort,
      internalPort: mapping.internalPort,
      targetIpv4: mapping.targetIpv4,
      desiredPresence: mapping.desiredPresence,
      keeperDesiredEnabled: mapping.keeperDesiredEnabled,
      probeRequestId: mapping.probeRequestId || null,
      desiredRevision: String(mapping.desiredRevision),
      desiredIssuedAt: mapping.desiredIssuedAt,
      reportedRevision: String(mapping.reportedRevision),
      syncStatus: mapping.syncStatus,
      keeperStatus: mapping.keeperStatus,
      currentPublicIpv4: leaseValid ? mapping.currentPublicIpv4 : null,
      currentPublicPort: leaseValid ? mapping.currentPublicPort : null,
      currentPublicEndpoint: leaseValid
        ? `${mapping.currentPublicIpv4}:${mapping.currentPublicPort}`
        : null,
      currentObservedAt: leaseValid ? mapping.currentObservedAt : null,
      currentValidUntil: leaseValid ? mapping.currentValidUntil : null,
      lastObservedIpv4: mapping.lastObservedIpv4 || null,
      lastObservedPort: mapping.lastObservedPort || null,
      lastObservedAt: mapping.lastObservedAt || null,
      lastErrorCode: mapping.lastErrorCode || null,
      lastErrorMessage: mapping.lastErrorMessage || null,
      isDeleted: mapping.isDeleted,
      createTime: mapping.createTime,
      updateTime: mapping.updateTime,
    };
  }

  /**
   * Converts one append-only endpoint event to the Admin history contract.
   * @param history - Persisted endpoint transition.
   * @returns Stable string IDs and Admin-facing field names.
   */
  private serializeHistory(history: NetworkEndpointHistory) {
    return {
      id: String(history.id),
      eventId: history.eventId,
      eventType: history.eventType,
      firstObservedAt: history.firstObservedAt,
      lastObservedAt: history.lastObservedAt,
      occurredAt: history.occurredAt,
      portForwardId: String(history.mappingId),
      publicIpv4: history.publicIpv4 || null,
      publicPort: history.publicPort || null,
      withdrawalReason: history.reason || null,
      createTime: history.createTime,
    };
  }

  /** Schedules MQTT publication without allowing broker errors to reject HTTP state. */
  private notifyDesiredChanged(): void {
    try {
      this.mqttService.requestDesiredPublish();
    } catch {
      // Desired state is durable; the periodic publisher will retry independently.
    }
  }

  /** Validates decimal Snowflake path input without number coercion. */
  private assertId(id: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError('端口转发 ID 无效', HttpStatus.BAD_REQUEST);
    }
  }

  /** Returns the one configured Agent identifier. */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  /** Returns and validates the fixed NAS target IPv4. */
  private targetIpv4(): string {
    const target =
      this.configService.get<string>('NETWORK_AGENT_TARGET_IPV4') ||
      DEFAULT_TARGET_IPV4;
    if (!isIpv4Address(target)) {
      throwVbenError(
        'NETWORK_AGENT_TARGET_IPV4 配置无效',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return target;
  }

  /**
   * Normalizes a display name and enforces the Go schema-v1 UTF-8 byte limit.
   * @param value - DTO-validated mapping display name.
   * @returns Trimmed name safe for both MySQL and Agent validation.
   */
  private normalizeName(value: string): string {
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, 'utf8') > 128) {
      throwVbenError(
        '规则名称超出 Agent UTF-8 长度限制',
        HttpStatus.BAD_REQUEST,
      );
    }
    return normalized;
  }

  /** Detects MySQL nullable-unique active-key conflicts. */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
