import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { KtDateTime, throwVbenError } from '@/common';
import { NetworkAgentMqttService } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-agent-mqtt.service';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkEndpointHistory } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-endpoint-history.entity';
import {
  NetworkEndpointHistoryQueryDto,
  NetworkPortForwardCreateDto,
  NetworkPortForwardListQueryDto,
  NetworkPortForwardUpdateDto,
} from '@/modules/admin/platform-config/network-management/contract/network-management.dto';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { isIpv4Address } from '@/modules/admin/platform-config/network-management/contract/network-management.types';
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

  /**
   * 按`query`读取网络管理记录；把变更持久化到当前存储（`mappingRepository.createQueryBuilder`）。
   * @param query - 限定网络管理记录筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`name`、`protocol` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的网络管理记录。
   */
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

  /**
   * 根据`input`构造网络管理记录。
   * @param input - 用于网络管理记录的结构化输入。
   * @returns 网络管理记录。
   */
  async create(input: NetworkPortForwardCreateDto) {
    return this.groupService.createV1(input);
  }

  /**
   * 根据`id`、`input`更新网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param input - 用于网络管理记录的结构化输入。
   * @returns 网络管理记录。
   */
  async update(id: string, input: NetworkPortForwardUpdateDto) {
    return this.groupService.updateV1(id, input);
  }

  /**
   * 按`id`移除网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @returns 网络管理记录。
   */
  async remove(id: string) {
    return this.groupService.removeV1(id);
  }

  /**
   * 根据`id`处理网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @returns 网络管理记录。
   */
  async retry(id: string) {
    return this.mutate(id, async (mapping) => {
      this.assertReleaseMutation({
        current: this.releaseState(mapping),
        kind: 'retry',
      });
      mapping.lastErrorCode = null;
      mapping.lastErrorMessage = null;
      if (mapping.desiredPresence === 'absent') {
        mapping.syncStatus = 'deleting';
      } else {
        mapping.syncStatus = 'pending';
      }
    });
  }

  /**
   * 按旧版通道标识启用 UDP STUN 保活，并返回更新后的兼容通道视图。
   * @param id - 决定保活器内容、边界或目标的 `id` 值。
   * @returns 返回启用保活后的目标网络通道视图或对应成功响应。
   */
  async enableKeeper(id: string) {
    return this.groupService.enableKeeperV1(id);
  }

  /**
   * 按`id`停止保活器并清理该入口拥有的运行态资源。
   * @param id - 决定保活器内容、边界或目标的 `id` 值。
   * @returns 返回禁用保活后的目标网络通道视图或对应成功响应。
   */
  async disableKeeper(id: string) {
    return this.groupService.disableKeeperV1(id);
  }

  /**
   * 触发目标网络通道的即时连通性探测，并返回提交后的通道状态。
   * @param id - 决定probe内容、边界或目标的 `id` 值。
   * @returns 返回即时探测后的目标网络通道视图或对应成功响应。
   */
  async probe(id: string) {
    return this.groupService.probeV1(id);
  }

  /**
   * 按目标 ID、协议与分页条件查询端点变更历史，并投影为管理端视图。
   * @param id - 决定端点历史内容、边界或目标的 `id` 值。
   * @param query - 限定端点历史筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的端点历史。
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
   * 按输入分支映射Agent状态。
   * @returns 包含 `agentId`、`appliedRevision`、`desiredRevision`、`lastErrorCode`、`lastErrorMessage` 字段的按输入分支映射Agent状态；无法解析或未命中时为 `null`。
   */
  async agentStatus() {
    const agentId = this.agentId();
    const tcpReleaseMode = this.tcpReleasePolicy.readMode();
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
        tcpReleaseMode,
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
      tcpReleaseMode,
      version: state.version || null,
    };
  }

  /**
   * 根据`id`、`change`处理网络管理记录；先通过 `assertId` 校验输入边界。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param change - 决定网络管理记录内容、边界或目标的 `change` 值。
   * @returns 网络管理记录。
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
   * 在事务中确保当前 Agent 状态行存在，并以悲观写锁读取且核对固定目标 IPv4。
   * @param manager - 提供 Agent 状态仓库和当前事务写锁边界的实体管理器。
   * @returns 已取得写锁且目标 IPv4 与服务端配置一致的 Agent 状态行。
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
   * 按当前 TCP 发布模式校验状态变更，把策略拒绝统一映射为 HTTP 409 业务错误。
   * @param mutation - 包含变更前后 TCP 发布状态的策略校验输入。
   * @throws 策略拒绝时抛出 HTTP 409 业务异常；其他校验错误原样重新抛出。
   */
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

  /**
   * 从网络映射投影 TCP 发布策略所需的端口、协议与 NATMap 期望状态。
   * @param value - 参与从网络映射投影 TCP 发布策略所需的端口、协议与 NATMap 期望状态比较、格式化或输出的候选值。
   * @returns 包含 `externalPort`、`internalPort`、`natmapDesiredEnabled`、`protocolMode` 字段的状态。
   */
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

  /**
   * 根据`state`、`mapping`处理推进当前版本号。
   * @param state - 用于推进当前版本号的领域对象，包含 `desiredRevision`、`desiredIssuedAt` 字段。
   * @param mapping - 用于推进当前版本号的领域对象，包含 `desiredRevision`、`desiredIssuedAt` 字段。
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

  /**
   * 将`mapping`转换为序列化网络管理记录；从 `getTime` 读取序列化网络管理记录。
   * @param mapping - 用于序列化网络管理记录的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`currentValidUntil`、`id` 字段。
   * @returns 包含 `id`、`groupId`、`name`、`remark`、`protocol` 字段的序列化网络管理记录。
   */
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
      currentPublicIpv4: (() => {
        if (leaseValid) {
          return mapping.currentPublicIpv4;
        }
        return null;
      })(),
      currentPublicPort: (() => {
        if (leaseValid) {
          return mapping.currentPublicPort;
        }
        return null;
      })(),
      currentPublicEndpoint: (() => {
        if (leaseValid) {
          return `${mapping.currentPublicIpv4}:${mapping.currentPublicPort}`;
        }
        return null;
      })(),
      currentObservedAt: (() => {
        if (leaseValid) {
          return mapping.currentObservedAt;
        }
        return null;
      })(),
      currentValidUntil: (() => {
        if (leaseValid) {
          return mapping.currentValidUntil;
        }
        return null;
      })(),
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
   * 序列化历史，并输出固定投影 `id`、`eventId`、`eventType`、`firstObservedAt`、`lastObservedAt` 字段。
   * @param history - 用于历史的领域对象，包含 `id`、`eventId`、`eventType`、`firstObservedAt` 字段。
   * @returns 包含 `id`、`eventId`、`eventType`、`firstObservedAt`、`lastObservedAt` 字段的历史。
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

  /**
   * 请求 MQTT 发布最新网络期望态；同步唤醒失败时保留持久状态，交由周期发布器重试。
   */
  private notifyDesiredChanged(): void {
    try {
      this.mqttService.requestDesiredPublish();
    } catch {
      // Desired state is durable; the periodic publisher will retry independently.
    }
  }

  /**
   * 要求端口转发记录标识由 1 至 24 位十进制数字组成，避免非法 ID 进入查询与变更流程。
   * @param id - 待校验的端口转发记录标识。
   */
  private assertId(id: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError('端口转发 ID 无效', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * 从运行时配置读取网络 Agent 的稳定标识；缺失或非法配置按调用处约束拒绝。
   * @returns 返回 `this.configService.get<string>('NETWORK_AGENT_ID')` 的可用值；为空时回退到 `DEFAULT_AGENT_ID`。
   */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  /**
   * 读取网络 Agent 固定目标 IPv4，配置缺失时使用默认地址，并拒绝格式非法的服务端配置。
   * @returns 已通过 IPv4 格式校验的配置值或默认目标地址。
   */
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
   * 仅把 MySQL `ER_DUP_ENTRY` 或错误号 1062 识别为唯一键冲突，其他错误一律返回 `false`。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足Duplicate键错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}
