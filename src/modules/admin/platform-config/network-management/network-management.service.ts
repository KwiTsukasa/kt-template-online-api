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
import { isIpv4Address } from './network-management.types';
import {
  NetworkTcpReleasePolicyError,
  NetworkTcpReleasePolicyService,
  type TcpProtocolMode,
  type TcpReleaseMutation,
  type TcpReleaseState,
} from './network-tcp-release-policy.service';
import { NetworkPortForwardGroupService } from './network-port-forward-group.service';

const DEFAULT_AGENT_ID = 'nas-main';
const DEFAULT_TARGET_IPV4 = '192.168.31.224';

@Injectable()
export class NetworkManagementService {
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
    private readonly tcpReleasePolicy: NetworkTcpReleasePolicyService,
    private readonly groupService: NetworkPortForwardGroupService,
  ) {}

  async list(query: NetworkPortForwardListQueryDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const builder = this.mappingRepository
      .createQueryBuilder('mapping')
      .where('mapping.isDeleted = :isDeleted', { isDeleted: false });
    if (!this.tcpReleasePolicy.isTcpVisibleToAdmin()) {
      builder.andWhere('mapping.protocol <> :hiddenProtocol', {
        hiddenProtocol: 'tcp',
      });
    }
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

  async create(input: NetworkPortForwardCreateDto) {
    return this.groupService.createV1(input);
  }

  async update(id: string, input: NetworkPortForwardUpdateDto) {
    return this.groupService.updateV1(id, input);
  }

  async remove(id: string) {
    return this.groupService.removeV1(id);
  }

  async retry(id: string) {
    return this.mutate(id, async (mapping) => {
      this.assertReleaseMutation({
        current: this.releaseState(mapping),
        kind: 'retry',
      });
      mapping.lastErrorCode = null;
      mapping.lastErrorMessage = null;
      mapping.syncStatus =
        mapping.desiredPresence === 'absent' ? 'deleting' : 'pending';
    });
  }

  async enableKeeper(id: string) {
    return this.groupService.enableKeeperV1(id);
  }

  async disableKeeper(id: string) {
    return this.groupService.disableKeeperV1(id);
  }

  async probe(id: string) {
    return this.groupService.probeV1(id);
  }

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

  private assertReleaseMutation(mutation: TcpReleaseMutation): void {
    try {
      this.tcpReleasePolicy.assertMutationAllowed(mutation);
    } catch (error) {
      if (error instanceof NetworkTcpReleasePolicyError) {
        throwVbenError('当前发布模式不允许该 TCP 操作', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  private releaseState(value: {
    externalPort: number;
    internalPort: number;
    natmapDesiredEnabled?: boolean;
    protocol: TcpProtocolMode;
  }): TcpReleaseState {
    return {
      externalPort: value.externalPort,
      internalPort: value.internalPort,
      natmapDesiredEnabled: value.natmapDesiredEnabled ?? false,
      protocolMode: value.protocol,
    };
  }

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

  private serialize(mapping: NetworkPortForward) {
    const leaseValid =
      !!mapping.currentPublicIpv4 &&
      !!mapping.currentPublicPort &&
      !!mapping.currentValidUntil &&
      new Date(mapping.currentValidUntil).getTime() > Date.now();
    return {
      id: String(mapping.id),
      groupId: String(mapping.groupId),
      name: mapping.name,
      remark: mapping.remark || null,
      protocol: mapping.protocol,
      externalPort: mapping.externalPort,
      internalPort: mapping.internalPort,
      targetIpv4: mapping.targetIpv4,
      desiredPresence: mapping.desiredPresence,
      keeperDesiredEnabled: mapping.keeperDesiredEnabled,
      natmapDesiredEnabled: mapping.natmapDesiredEnabled,
      probeRequestId: mapping.probeRequestId || null,
      desiredRevision: String(mapping.desiredRevision),
      desiredIssuedAt: mapping.desiredIssuedAt,
      reportedRevision: String(mapping.reportedRevision),
      syncStatus: mapping.syncStatus,
      keeperStatus: mapping.keeperStatus,
      natmapStatus: mapping.natmapStatus,
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

  private notifyDesiredChanged(): void {
    try {
      this.mqttService.requestDesiredPublish();
    } catch {
      // Desired state is durable; the periodic publisher will retry independently.
    }
  }

  private assertId(id: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError('端口转发 ID 无效', HttpStatus.BAD_REQUEST);
    }
  }

  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

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

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
