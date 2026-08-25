import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { KtDateTime, throwVbenError } from '@/common';
import { NetworkAgentMqttService } from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-agent-mqtt.service';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NETWORK_AGENT_V2_MAX_CHANNELS } from '@/modules/admin/platform-config/network-management/contract/network-agent-v2.types';
import { NetworkEndpointHistory } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-endpoint-history.entity';
import type {
  NetworkEndpointHistoryQueryDto,
  NetworkPortForwardCreateDto,
  NetworkPortForwardUpdateDto,
} from '@/modules/admin/platform-config/network-management/contract/network-management.dto';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import {
  isIpv4Address,
  portForwardActiveKey,
  type PortForwardProtocol,
} from '@/modules/admin/platform-config/network-management/contract/network-management.types';
import type {
  NetworkPortForwardGroupCreateDto,
  NetworkPortForwardGroupListQueryDto,
  NetworkPortForwardGroupUpdateDto,
} from '@/modules/admin/platform-config/network-management/contract/network-port-forward-group.dto';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import {
  NetworkTcpReleasePolicyError,
  NetworkTcpReleasePolicyService,
  type TcpProtocolMode,
  type TcpReleaseMutation,
  type TcpReleaseState,
} from './network-tcp-release-policy.service';

const DEFAULT_AGENT_ID = 'nas-main';
const DEFAULT_TARGET_IPV4 = '192.168.31.224';

type GroupTransactionResult = {
  channels: NetworkPortForward[];
  changed: boolean;
  group: NetworkPortForwardGroup;
};

type V1ChannelMutationTarget = {
  action: string;
  channelId: string;
};

@Injectable()
export class NetworkPortForwardGroupService {
  constructor(
    @InjectRepository(NetworkPortForwardGroup)
    private readonly groupRepository: Repository<NetworkPortForwardGroup>,
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
    @InjectRepository(NetworkEndpointHistory)
    private readonly historyRepository: Repository<NetworkEndpointHistory>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly mqttService: NetworkAgentMqttService,
    private readonly tcpReleasePolicy: NetworkTcpReleasePolicyService,
  ) {}

  /**
   * 按`query`读取网络端口转发分组记录；把变更持久化到当前存储（`groupRepository.createQueryBuilder`）。
   * @param query - 限定网络端口转发分组记录筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`name`、`protocolMode` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的网络端口转发分组记录。
   */
  async list(query: NetworkPortForwardGroupListQueryDto = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const builder = this.groupRepository
      .createQueryBuilder('group')
      .where('group.isDeleted = :isDeleted', { isDeleted: false });
    if (query.name) {
      builder.andWhere('group.name LIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.protocolMode) {
      builder.andWhere('group.protocolMode = :protocolMode', {
        protocolMode: query.protocolMode,
      });
    }
    const [groups, total] = await builder
      .orderBy('group.createTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const items = await Promise.all(
      groups.map(async (group) =>
        this.serializeGroup(
          group,
          await this.mappingRepository.find({
            order: { protocol: 'ASC' },
            where: { groupId: group.id, isDeleted: false },
          }),
        ),
      ),
    );
    return { items, total };
  }

  /**
   * 根据`input`构造网络端口转发分组记录。
   * @param input - 用于网络端口转发分组记录的结构化输入。
   * @returns 网络端口转发分组记录。
   */
  async create(input: NetworkPortForwardGroupCreateDto) {
    const result = await this.createInternal(input);
    return this.serializeGroup(result.group, result.channels);
  }

  /**
   * 把旧版单通道创建请求转换为分组写入，并返回对应协议通道的兼容视图。
   * @param input - 包含 `externalPort`、`internalPort`、`name`、`protocol` 字段的结构化领域输入。
   * @returns 返回新建分组中目标协议通道的旧版兼容视图。
   */
  async createV1(input: NetworkPortForwardCreateDto) {
    const result = await this.createInternal({
      externalPort: input.externalPort,
      internalPort: input.internalPort,
      name: input.name,
      protocolMode: input.protocol,
      remark: input.remark,
    });
    const channel = result.channels.find(
      (item) => item.protocol === input.protocol,
    );
    if (!channel) {
      throwVbenError('端口转发通道创建失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return this.serializeChannel(channel);
  }

  /**
   * 根据`groupId`、`input`更新网络端口转发分组记录；先通过 `assertId` 校验输入边界。
   * @param groupId - 用于精确定位group的标识。
   * @param input - 用于网络端口转发分组记录的结构化输入。
   * @returns 网络端口转发分组记录。
   */
  async update(groupId: string, input: NetworkPortForwardGroupUpdateDto) {
    this.assertId(groupId, '逻辑组');
    this.assertUpdateInput(input);
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const group = await this.findLockedGroup(manager, groupId);
      const channels = await this.findChannels(manager, groupId);
      return this.updateInTransaction(manager, state, group, channels, input);
    });
    this.notifyDesiredChanged();
    return this.serializeGroup(result.group, result.channels);
  }

  /**
   * 在事务中按旧版单通道契约更新分组和目标通道，并返回兼容视图。
   * @param channelId - 用于精确定位通道的标识。
   * @param input - 用于V1的结构化输入，包含 `externalPort`、`internalPort`、`name`、`protocol` 字段。
   * @returns 返回事务更新后的目标通道旧版兼容视图。
   */
  async updateV1(channelId: string, input: NetworkPortForwardUpdateDto) {
    this.assertId(channelId, '端口转发');
    this.assertUpdateInput(input);
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const repository = manager.getRepository(NetworkPortForward);
      const requested = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: channelId, isDeleted: false },
      });
      if (!requested) {
        throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
      }
      const group = await this.findLockedGroup(manager, requested.groupId);
      const channels = await this.findChannels(manager, group.id);
      this.assertV1SingleChannel(channels);
      return this.updateInTransaction(manager, state, group, channels, {
        externalPort: input.externalPort,
        internalPort: input.internalPort,
        name: input.name,
        protocolMode: input.protocol,
        remark: input.remark,
      });
    });
    this.notifyDesiredChanged();
    const protocol = input.protocol || result.channels[0]?.protocol;
    const channel = result.channels.find(
      (item) =>
        !item.isDeleted &&
        item.desiredPresence === 'present' &&
        item.protocol === protocol,
    );
    if (!channel) {
      throwVbenError('端口转发通道更新失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return this.serializeChannel(channel);
  }

  /**
   * 按`groupId`移除网络端口转发分组记录；先通过 `assertId` 校验输入边界。
   * @param groupId - 用于精确定位group的标识。
   * @returns 网络端口转发分组记录。
   */
  async remove(groupId: string) {
    this.assertId(groupId, '逻辑组');
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const group = await this.findLockedGroup(manager, groupId);
      const channels = await this.findChannels(manager, groupId);
      return this.removeInTransaction(manager, state, group, channels);
    });
    this.notifyDesiredChanged();
    return this.serializeGroup(result.group, result.channels);
  }

  /**
   * 按旧版单通道契约撤销目标通道或整个分组，并通知 Agent 重新发布期望状态。
   * @param channelId - 用于精确定位通道的标识。
   * @returns 返回撤销操作后目标通道或替代通道的旧版兼容视图。
   */
  async removeV1(channelId: string) {
    this.assertId(channelId, '端口转发');
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const repository = manager.getRepository(NetworkPortForward);
      const requested = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: channelId, isDeleted: false },
      });
      if (!requested) {
        throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
      }
      const group = await this.findLockedGroup(manager, requested.groupId);
      const channels = await this.findChannels(manager, group.id);
      this.assertV1SingleChannel(channels);
      return this.removeInTransaction(manager, state, group, channels);
    });
    this.notifyDesiredChanged();
    return this.serializeChannel(result.channels[0]);
  }

  /**
   * 根据`groupId`、`protocol`处理网络端口转发分组记录。
   * @param groupId - 用于精确定位group的标识。
   * @param protocol - 决定网络端口转发分组记录内容、边界或目标的 `protocol` 值。
   * @returns 网络端口转发分组记录。
   */
  async retry(groupId: string, protocol: PortForwardProtocol) {
    return this.mutateChannel(groupId, protocol, async (group, channel) => {
      if (channel.desiredPresence !== 'present') {
        throwVbenError('删除中的通道不能重试', HttpStatus.CONFLICT);
      }
      if (protocol === 'tcp') {
        this.assertReleaseMutation({
          current: this.releaseState(group, channel.natmapDesiredEnabled),
          kind: 'retry',
        });
      }
      channel.lastErrorCode = null;
      channel.lastErrorMessage = null;
      if (protocol === 'tcp') {
        channel.natmapLastErrorCode = null;
        channel.natmapLastErrorMessage = null;
      } else {
        channel.keeperLastErrorCode = null;
        channel.keeperLastErrorMessage = null;
      }
      channel.syncStatus = 'pending';
      return true;
    });
  }

  /**
   * 校验期望修订号、机制切换与 TCP 发布策略后启用 NATMap，并把通道标记为等待发布。
   * @param groupId - 用于精确定位group的标识。
   * @param expectedDesiredRevision - 决定NATMap 转发内容、边界或目标的 `expectedDesiredRevision` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns NATMap 转发。
   */
  async enableNatmap(groupId: string, expectedDesiredRevision?: string) {
    return this.mutateChannel(
      groupId,
      'tcp',
      async (group, channel, channels) => {
        if (channel.natmapDesiredEnabled) return false;
        this.assertMechanismTransitionAllowed(channels);
        this.assertReleaseMutation({
          current: this.releaseState(group, true),
          kind: 'natmap-enable',
        });
        channel.natmapDesiredEnabled = true;
        channel.syncStatus = 'pending';
        return true;
      },
      true,
      expectedDesiredRevision,
    );
  }

  /**
   * 按`groupId`、`expectedDesiredRevision`停止NATMap 转发并清理该入口拥有的运行态资源。
   * @param groupId - 用于精确定位group的标识。
   * @param expectedDesiredRevision - 决定NATMap 转发内容、边界或目标的 `expectedDesiredRevision` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns NATMap 转发。
   */
  async disableNatmap(groupId: string, expectedDesiredRevision?: string) {
    return this.mutateChannel(
      groupId,
      'tcp',
      async (group, channel, channels) => {
        if (!channel.natmapDesiredEnabled) return false;
        this.assertMechanismTransitionAllowed(channels);
        this.assertReleaseMutation({
          after: this.releaseState(group, false),
          before: this.releaseState(group, true),
          kind: 'natmap-disable',
        });
        channel.natmapDesiredEnabled = false;
        channel.syncStatus = 'pending';
        this.withdrawCurrentEndpoint(channel);
        return true;
      },
      true,
      expectedDesiredRevision,
    );
  }

  /**
   * 按分组标识启用 UDP STUN 保活，并返回更新后的目标通道视图。
   * @param groupId - 用于精确定位group的标识。
   * @returns 返回启用保活后的目标网络通道视图或对应成功响应。
   */
  async enableKeeper(groupId: string) {
    return this.enableKeeperTarget(groupId);
  }

  /**
   * 按`groupId`停止保活器并清理该入口拥有的运行态资源。
   * @param groupId - 用于精确定位group的标识。
   * @returns 返回禁用保活后的目标网络通道视图或对应成功响应。
   */
  async disableKeeper(groupId: string) {
    return this.disableKeeperTarget(groupId);
  }

  /**
   * 按旧版通道标识启用 UDP STUN 保活，并返回单通道兼容视图。
   * @param channelId - 用于精确定位通道的标识。
   * @returns 返回启用保活后的目标通道旧版兼容视图。
   */
  async enableKeeperV1(channelId: string) {
    return this.enableKeeperTarget({ action: 'UDP Keeper', channelId });
  }

  /**
   * 按`channelId`停止保活器v1并清理该入口拥有的运行态资源。
   * @param channelId - 用于精确定位通道的标识。
   * @returns 返回禁用保活后的目标通道旧版兼容视图。
   */
  async disableKeeperV1(channelId: string) {
    return this.disableKeeperTarget({ action: 'UDP Keeper', channelId });
  }

  /**
   * 对旧版单通道端口转发执行即时探测，并返回探测后的兼容通道视图。
   * @param channelId - 用于精确定位通道的标识。
   * @returns 返回即时探测后的目标通道旧版兼容视图。
   */
  async probeV1(channelId: string) {
    return this.probeTarget({ action: 'UDP Keeper', channelId });
  }

  /**
   * 触发目标网络通道的即时连通性探测，并返回提交后的通道状态。
   * @param groupId - 用于精确定位group的标识。
   * @returns 返回即时探测后的目标网络通道视图或对应成功响应。
   */
  async probe(groupId: string) {
    return this.probeTarget(groupId);
  }

  /**
   * 按`target`启动保活器目标。
   * @param target - 决定保活器目标内容、边界或目标的 `target` 值。
   * @returns 保活器目标。
   */
  private enableKeeperTarget(target: string | V1ChannelMutationTarget) {
    return this.mutateChannel(
      target,
      'udp',
      async (_, channel, channels) => {
        if (channel.keeperDesiredEnabled) return false;
        this.assertKeeperPorts(channel);
        this.assertMechanismTransitionAllowed(channels);
        channel.keeperDesiredEnabled = true;
        channel.probeRequestId = randomUUID();
        channel.syncStatus = 'pending';
        return true;
      },
      true,
    );
  }

  /**
   * 按`target`停止保活器目标并清理该入口拥有的运行态资源。
   * @param target - 决定保活器目标内容、边界或目标的 `target` 值。
   * @returns 保活器目标。
   */
  private disableKeeperTarget(target: string | V1ChannelMutationTarget) {
    return this.mutateChannel(
      target,
      'udp',
      async (_, channel, channels) => {
        if (!channel.keeperDesiredEnabled) return false;
        this.assertKeeperPorts(channel);
        this.assertMechanismTransitionAllowed(channels);
        channel.keeperDesiredEnabled = false;
        channel.probeRequestId = null;
        channel.syncStatus = 'pending';
        this.withdrawCurrentEndpoint(channel);
        return true;
      },
      true,
    );
  }

  /**
   * 根据`target`处理对应领域流程并产生探针目标。
   * @param target - 决定对应领域流程并产生探针目标内容、边界或目标的 `target` 值。
   * @returns 对应领域流程并产生探针目标。
   */
  private probeTarget(target: string | V1ChannelMutationTarget) {
    return this.mutateChannel(
      target,
      'udp',
      async (_, channel, channels) => {
        this.assertMechanismTransitionAllowed(channels);
        this.assertKeeperPorts(channel);
        if (!channel.keeperDesiredEnabled) {
          throwVbenError('请先启用 UDP Keeper', HttpStatus.BAD_REQUEST);
        }
        channel.probeRequestId = randomUUID();
        channel.syncStatus = 'pending';
        return true;
      },
      true,
    );
  }

  /**
   * 按目标 ID、协议与分页条件查询端点变更历史，并投影为管理端视图。
   * @param groupId - 用于精确定位group的标识。
   * @param protocol - 决定端点历史内容、边界或目标的 `protocol` 值。
   * @param query - 限定端点历史筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的端点历史。
   */
  async endpointHistory(
    groupId: string,
    protocol: PortForwardProtocol,
    query: NetworkEndpointHistoryQueryDto = {},
  ) {
    this.assertId(groupId, '逻辑组');
    const group = await this.groupRepository.findOne({
      where: { id: groupId, isDeleted: false },
    });
    if (!group) throwVbenError('逻辑端口转发组不存在', HttpStatus.NOT_FOUND);
    const channel = await this.mappingRepository.findOne({
      where: { groupId, isDeleted: false, protocol },
    });
    if (!channel) throwVbenError('协议通道不存在', HttpStatus.NOT_FOUND);
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const mechanism = (() => {
      if (protocol === 'tcp') {
        return 'tcp_natmap';
      }
      return 'udp_stun';
    })();
    const [items, total] = await this.historyRepository.findAndCount({
      order: { occurredAt: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where: { mappingId: channel.id, mechanism },
    });
    return { items: items.map((item) => this.serializeHistory(item)), total };
  }

  /**
   * 通过在事务中创建端口转发分组及协议通道，校验 TCP 发布策略后分配全局版本。
   * @param input - 用于通过在事务中创建端口转发分组及协议通道，校验 TCP 发布策略后分配全局版本的结构化输入，包含 `name`、`externalPort`、`internalPort`、`protocolMode` 字段。
   * @returns 内部创建记录。
   */
  private async createInternal(
    input: NetworkPortForwardGroupCreateDto,
  ): Promise<GroupTransactionResult> {
    const name = this.normalizeName(input.name);
    this.assertReleaseMutation({
      after: {
        externalPort: input.externalPort,
        internalPort: input.internalPort,
        natmapDesiredEnabled: false,
        protocolMode: input.protocolMode,
      },
      kind: 'create',
    });
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const mappingRepository = manager.getRepository(NetworkPortForward);
      const groupRepository = manager.getRepository(NetworkPortForwardGroup);
      const protocols = this.protocols(input.protocolMode);
      const count = await mappingRepository.count({
        where: { isDeleted: false },
      });
      if (count + protocols.length > NETWORK_AGENT_V2_MAX_CHANNELS) {
        throwVbenError('端口转发通道已达到 64 条上限', HttpStatus.CONFLICT);
      }
      for (const protocol of protocols) {
        await this.assertActiveKeyAvailable(
          mappingRepository,
          protocol,
          input.externalPort,
        );
      }
      const group = groupRepository.create({
        externalPort: input.externalPort,
        internalPort: input.internalPort,
        isDeleted: false,
        name,
        protocolMode: input.protocolMode,
        remark: input.remark?.trim() || null,
        targetIpv4: state.targetIpv4,
      });
      await groupRepository.save(group);
      const channels = protocols.map((protocol) =>
        this.createChannel(mappingRepository, group, protocol),
      );
      const revision = this.advanceGlobalRevision(state);
      this.assignRevision(channels, revision, state.desiredIssuedAt);
      try {
        await mappingRepository.save(channels);
        await manager.getRepository(NetworkAgentState).save(state);
      } catch (error) {
        this.rethrowDuplicate(error);
      }
      return { changed: true, channels, group };
    });
    this.notifyDesiredChanged();
    return result;
  }

  /**
   * 根据`manager`、`state`、`group`更新在事务中更新记录；把变更持久化到当前存储（`mappingRepository.save`）。
   * @param manager - 保证在事务中更新记录读写处于同一事务中的实体管理器。
   * @param state - 用于在事务中更新记录的领域对象，包含 `desiredIssuedAt` 字段。
   * @param group - 用于在事务中更新记录的领域对象，包含 `protocolMode`、`externalPort`、`internalPort`、`name` 字段。
   * @param channels - 用于在事务中更新记录的领域对象，包含 `push` 字段。
   * @param input - 用于在事务中更新记录的结构化输入，包含 `protocolMode`、`externalPort`、`internalPort`、`name` 字段。
   * @returns 包含 `changed`、`channels`、`group` 字段的在事务中更新记录。
   */
  private async updateInTransaction(
    manager: EntityManager,
    state: NetworkAgentState,
    group: NetworkPortForwardGroup,
    channels: NetworkPortForward[],
    input: NetworkPortForwardGroupUpdateDto,
  ): Promise<GroupTransactionResult> {
    const protocolMode =
      input.protocolMode || (group.protocolMode as TcpProtocolMode);
    const externalPort = input.externalPort || group.externalPort;
    const internalPort = input.internalPort || group.internalPort;
    const structuralChange =
      protocolMode !== group.protocolMode ||
      externalPort !== group.externalPort ||
      internalPort !== group.internalPort;
    if (structuralChange) this.assertStructuralEditAllowed(channels);
    if (channels.every((channel) => channel.desiredPresence === 'absent')) {
      throwVbenError('逻辑组正在删除', HttpStatus.CONFLICT);
    }
    const tcp = channels.find((channel) => channel.protocol === 'tcp');
    const mutation: TcpReleaseMutation = (() => {
      if (group.protocolMode === 'tcp_udp' && protocolMode === 'udp') {
        return {
          after: {
            externalPort,
            internalPort,
            natmapDesiredEnabled: false,
            protocolMode,
          },
          before: this.releaseState(group, tcp?.natmapDesiredEnabled || false),
          kind: 'protocol-shrink',
        };
      }
      return {
        after: {
          externalPort,
          internalPort,
          natmapDesiredEnabled: (() => {
            if (protocolMode === 'udp') {
              return false;
            }
            return tcp?.natmapDesiredEnabled || false;
          })(),
          protocolMode,
        },
        before: this.releaseState(group, tcp?.natmapDesiredEnabled || false),
        kind: 'update',
      };
    })();
    this.assertReleaseMutation(mutation);

    const oldProtocols = new Set(
      this.protocols(group.protocolMode as TcpProtocolMode),
    );
    const nextProtocols = new Set(this.protocols(protocolMode));
    const changedChannels = new Set<NetworkPortForward>();
    const mappingRepository = manager.getRepository(NetworkPortForward);
    const additions = [...nextProtocols].filter(
      (protocol) => !oldProtocols.has(protocol),
    );
    if (additions.length) {
      const count = await mappingRepository.count({
        where: { isDeleted: false },
      });
      if (count + additions.length > NETWORK_AGENT_V2_MAX_CHANNELS) {
        throwVbenError('端口转发通道已达到 64 条上限', HttpStatus.CONFLICT);
      }
    }
    for (const protocol of additions) {
      if (
        channels.some(
          (channel) =>
            channel.protocol === protocol &&
            channel.desiredPresence === 'absent',
        )
      ) {
        throwVbenError('协议通道正在删除，不能重新添加', HttpStatus.CONFLICT);
      }
      await this.assertActiveKeyAvailable(
        mappingRepository,
        protocol,
        externalPort,
      );
      const channel = this.createChannel(mappingRepository, group, protocol);
      channels.push(channel);
      changedChannels.add(channel);
    }
    for (const channel of channels) {
      if (!nextProtocols.has(channel.protocol)) {
        channel.desiredPresence = 'absent';
        channel.keeperDesiredEnabled = false;
        channel.natmapDesiredEnabled = false;
        channel.probeRequestId = null;
        channel.syncStatus = 'deleting';
        this.withdrawCurrentEndpoint(channel);
        changedChannels.add(channel);
      }
    }

    const name = (() => {
      if (input.name === undefined) {
        return group.name;
      }
      return this.normalizeName(input.name);
    })();
    const authorityPayloadChanged =
      name !== group.name ||
      externalPort !== group.externalPort ||
      internalPort !== group.internalPort;
    group.name = name;
    if (input.remark === undefined) {
      group.remark = group.remark;
    } else {
      group.remark = input.remark.trim() || null;
    }
    group.externalPort = externalPort;
    group.internalPort = internalPort;
    group.protocolMode = protocolMode;
    for (const channel of channels) {
      if (authorityPayloadChanged) changedChannels.add(channel);
      channel.name = group.name;
      channel.remark = group.remark;
      channel.externalPort = group.externalPort;
      channel.internalPort = group.internalPort;
      channel.targetIpv4 = group.targetIpv4;
      if (channel.desiredPresence === 'present') {
        channel.activeKey = portForwardActiveKey(
          channel.protocol,
          group.externalPort,
        );
      }
    }
    const revision = this.advanceGlobalRevision(state);
    this.assignRevision([...changedChannels], revision, state.desiredIssuedAt);
    try {
      await manager.getRepository(NetworkPortForwardGroup).save(group);
      await mappingRepository.save(channels);
      await manager.getRepository(NetworkAgentState).save(state);
    } catch (error) {
      this.rethrowDuplicate(error);
    }
    return { changed: true, channels, group };
  }

  /**
   * 按`manager`、`state`、`group`移除在事务中移除记录；先通过 `assertReleaseMutation` 校验输入边界。
   * @param manager - 保证在事务中移除记录读写处于同一事务中的实体管理器。
   * @param state - 用于在事务中移除记录的领域对象，包含 `desiredIssuedAt` 字段。
   * @param group - 决定在事务中移除记录内容、边界或目标的 `group` 值。
   * @param channels - 用于在事务中移除记录的领域对象，包含 `length` 字段。
   * @returns 包含 `changed`、`channels`、`group` 字段的在事务中移除记录。
   */
  private async removeInTransaction(
    manager: EntityManager,
    state: NetworkAgentState,
    group: NetworkPortForwardGroup,
    channels: NetworkPortForward[],
  ): Promise<GroupTransactionResult> {
    if (
      channels.length === 0 ||
      channels.some((channel) => channel.desiredPresence === 'absent')
    ) {
      throwVbenError('逻辑组正在删除或协调中', HttpStatus.CONFLICT);
    }
    const tcp = channels.find((channel) => channel.protocol === 'tcp');
    this.assertReleaseMutation({
      current: this.releaseState(group, tcp?.natmapDesiredEnabled || false),
      kind: 'delete',
    });
    for (const channel of channels) {
      channel.desiredPresence = 'absent';
      channel.keeperDesiredEnabled = false;
      channel.natmapDesiredEnabled = false;
      channel.probeRequestId = null;
      channel.syncStatus = 'deleting';
      this.withdrawCurrentEndpoint(channel);
    }
    const revision = this.advanceGlobalRevision(state);
    this.assignRevision(channels, revision, state.desiredIssuedAt);
    await manager.getRepository(NetworkPortForward).save(channels);
    await manager.getRepository(NetworkAgentState).save(state);
    return { changed: true, channels, group };
  }

  /**
   * 根据`target`、`protocol`、`change`处理通道；先通过 `assertId` 校验输入边界。
   * @param target - 用于通道的领域对象，包含 `channelId` 字段。
   * @param protocol - 决定通道内容、边界或目标的 `protocol` 值。
   * @param change - 决定通道内容、边界或目标的 `change` 值。
   * @param invalidProtocolIsBadRequest - 决定通道内容、边界或目标的 `invalidProtocolIsBadRequest` 值；省略时默认采用 `false`。
   * @param expectedDesiredRevision - 决定通道内容、边界或目标的 `expectedDesiredRevision` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 通道。
   */
  private async mutateChannel(
    target: string | V1ChannelMutationTarget,
    protocol: PortForwardProtocol,
    change: (
      group: NetworkPortForwardGroup,
      channel: NetworkPortForward,
      channels: NetworkPortForward[],
    ) => Promise<boolean>,
    invalidProtocolIsBadRequest = false,
    expectedDesiredRevision?: string,
  ) {
    const v1Target = (() => {
      if (typeof target === 'string') {
        return null;
      }
      return target;
    })();
    const targetId = (() => {
      if (typeof target === 'string') {
        return target;
      }
      return target.channelId;
    })();
    this.assertId(
      targetId,
      (() => {
        if (v1Target) {
          return '端口转发';
        }
        return '逻辑组';
      })(),
    );
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const mappingRepository = manager.getRepository(NetworkPortForward);
      const requested = await (async () => {
        if (v1Target) {
          return await mappingRepository.findOne({
            lock: { mode: 'pessimistic_write' },
            where: { id: v1Target.channelId, isDeleted: false },
          });
        }
        return null;
      })();
      if (v1Target && !requested) {
        throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
      }
      if (v1Target && requested && requested.protocol !== protocol) {
        throwVbenError(
          `${requested.protocol.toUpperCase()} 通道不支持 ${v1Target.action}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const groupId = (() => {
        if (requested) {
          return String(requested.groupId);
        }
        return targetId;
      })();
      const group = await this.findLockedGroup(manager, groupId);
      const channels = await this.findChannels(manager, groupId);
      const requestedIndex = (() => {
        if (requested) {
          return channels.findIndex((item) => item.id === requested.id);
        }
        return -1;
      })();
      if (requested) {
        if (
          requested.isDeleted ||
          requested.groupId !== group.id ||
          requestedIndex < 0
        ) {
          throwVbenError('端口转发通道已失效或被替换', HttpStatus.CONFLICT);
        }
        const persistedChannel = channels[requestedIndex];
        if (
          persistedChannel.groupId !== group.id ||
          persistedChannel.protocol !== protocol
        ) {
          throwVbenError('端口转发通道已失效或被替换', HttpStatus.CONFLICT);
        }
      }
      if (requested) channels[requestedIndex] = requested;
      const channel =
        requested || channels.find((item) => item.protocol === protocol);
      if (!channel) {
        throwVbenError(
          `逻辑组不包含 ${protocol.toUpperCase()} 协议通道`,
          (() => {
            if (invalidProtocolIsBadRequest) {
              return HttpStatus.BAD_REQUEST;
            }
            return HttpStatus.NOT_FOUND;
          })(),
        );
      }
      if (
        expectedDesiredRevision !== undefined &&
        channel.desiredRevision !== expectedDesiredRevision
      ) {
        throwVbenError('端口转发状态已变化，请刷新后重试', HttpStatus.CONFLICT);
      }
      if (channel.desiredPresence !== 'present') {
        throwVbenError('协议通道正在删除', HttpStatus.CONFLICT);
      }
      const changed = await change(group, channel, channels);
      if (!changed) return { changed, channel };
      const revision = this.advanceGlobalRevision(state);
      this.assignRevision([channel], revision, state.desiredIssuedAt);
      await mappingRepository.save(channel);
      await manager.getRepository(NetworkAgentState).save(state);
      return { changed, channel };
    });
    if (result.changed) this.notifyDesiredChanged();
    return this.serializeChannel(result.channel);
  }

  /**
   * 按`manager`、`groupId`读取已锁定分组；从 `findOne` 读取已锁定分组。
   * @param manager - 保证已锁定分组读写处于同一事务中的实体管理器。
   * @param groupId - 用于精确定位group的标识。
   * @returns 已锁定分组。
   */
  private async findLockedGroup(
    manager: EntityManager,
    groupId: string,
  ): Promise<NetworkPortForwardGroup> {
    const group = await manager.getRepository(NetworkPortForwardGroup).findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id: groupId, isDeleted: false },
    });
    if (!group) throwVbenError('逻辑端口转发组不存在', HttpStatus.NOT_FOUND);
    return group;
  }

  /**
   * 按`manager`、`groupId`读取匹配的通道；从 `manager.getRepository` 读取匹配的通道。
   * @param manager - 保证匹配的通道读写处于同一事务中的实体管理器。
   * @param groupId - 用于精确定位group的标识。
   * @returns 按输入顺序得到的匹配的通道列表；没有匹配项时为空数组。
   */
  private async findChannels(
    manager: EntityManager,
    groupId: string,
  ): Promise<NetworkPortForward[]> {
    return manager.getRepository(NetworkPortForward).find({
      order: { protocol: 'ASC' },
      where: { groupId, isDeleted: false },
    });
  }

  /**
   * 根据`repository`、`group`、`protocol`构造通道；把变更持久化到当前存储（`repository.create`）。
   * @param repository - 负责查询或持久化通道的仓库实例。
   * @param group - 用于通道的领域对象，包含 `id`、`externalPort`、`internalPort`、`name` 字段。
   * @param protocol - 决定通道内容、边界或目标的 `protocol` 值。
   * @returns 通道。
   */
  private createChannel(
    repository: Repository<NetworkPortForward>,
    group: NetworkPortForwardGroup,
    protocol: PortForwardProtocol,
  ): NetworkPortForward {
    return repository.create({
      activeGroupProtocolKey: `${group.id}:${protocol}`,
      activeKey: portForwardActiveKey(protocol, group.externalPort),
      currentObservedAt: null,
      currentPublicIpv4: null,
      currentPublicPort: null,
      currentValidUntil: null,
      desiredPresence: 'present',
      externalPort: group.externalPort,
      groupId: group.id,
      internalPort: group.internalPort,
      isDeleted: false,
      keeperDesiredEnabled: false,
      keeperStatus: 'disabled',
      lastErrorCode: null,
      lastErrorMessage: null,
      name: group.name,
      natmapDesiredEnabled: false,
      natmapStatus: 'disabled',
      probeRequestId: null,
      protocol,
      remark: group.remark,
      reportedRevision: '0',
      syncStatus: 'pending',
      targetIpv4: group.targetIpv4,
    });
  }

  /**
   * 校验`channels`是否满足结构性编辑允许的约束，并拒绝不合法输入。
   * @param channels - 决定结构性编辑允许的内容、边界或目标的 `channels` 值。
   */
  private assertStructuralEditAllowed(channels: NetworkPortForward[]): void {
    for (const channel of channels) {
      if (channel.desiredPresence !== 'present') {
        throwVbenError('逻辑组正在删除或协调中', HttpStatus.CONFLICT);
      }
      const mechanismStopped = (() => {
        if (channel.protocol === 'tcp') {
          return (
            !channel.natmapDesiredEnabled &&
            ['disabled', 'failed'].includes(channel.natmapStatus) &&
            !channel.keeperDesiredEnabled &&
            channel.keeperStatus === 'disabled'
          );
        }
        return (
          !channel.keeperDesiredEnabled &&
          ['disabled', 'failed'].includes(channel.keeperStatus) &&
          !channel.natmapDesiredEnabled &&
          channel.natmapStatus === 'disabled'
        );
      })();
      if (!mechanismStopped) {
        throwVbenError(
          '请先停用 Keeper 和 NATMap 再修改端口或协议',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (channel.syncStatus === 'synced') continue;
      const recoverableFailure =
        channel.syncStatus === 'failed' &&
        channel.reportedRevision === channel.desiredRevision &&
        !channel.currentPublicIpv4 &&
        !channel.currentPublicPort &&
        !channel.currentValidUntil;
      if (!recoverableFailure) {
        throwVbenError('逻辑组正在删除或协调中', HttpStatus.CONFLICT);
      }
    }
  }

  /**
   * 校验`channels`是否满足机制转换是否允许约束，并拒绝不合法输入。
   * @param channels - 决定机制转换是否允许内容、边界或目标的 `channels` 值。
   */
  private assertMechanismTransitionAllowed(
    channels: NetworkPortForward[],
  ): void {
    if (
      channels.some(
        (channel) =>
          channel.desiredPresence !== 'present' ||
          channel.syncStatus !== 'synced',
      )
    ) {
      throwVbenError('逻辑组正在删除或协调中', HttpStatus.CONFLICT);
    }
  }

  /**
   * 校验`channels`是否满足v1单一的通道约束，并拒绝不合法输入。
   * @param channels - 用于v1单一的通道的领域对象，包含 `length`、`0` 字段。
   */
  private assertV1SingleChannel(channels: NetworkPortForward[]): void {
    if (
      channels.length !== 1 ||
      channels[0].desiredPresence !== 'present' ||
      channels[0].syncStatus === 'deleting' ||
      channels[0].syncStatus === 'pending' ||
      channels[0].syncStatus === 'syncing'
    ) {
      throwVbenError(
        '多协议或协调中的逻辑组请使用新版管理接口',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * 校验`channel`是否满足保活器端口约束，并拒绝不合法输入。
   * @param channel - 用于保活器端口的领域对象，包含 `externalPort`、`internalPort` 字段。
   */
  private assertKeeperPorts(channel: NetworkPortForward): void {
    if (channel.externalPort !== channel.internalPort) {
      throwVbenError(
        'UDP Keeper 要求外部端口与内部端口一致',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 校验`repository`、`protocol`、`externalPort`是否满足启用的键可用约束，并拒绝不合法输入；从 `repository.findOne` 读取启用的键可用。
   * @param repository - 负责查询或持久化启用的键可用的仓库实例。
   * @param protocol - 决定启用的键可用内容、边界或目标的 `protocol` 值。
   * @param externalPort - 决定启用的键可用内容、边界或目标的 `externalPort` 值。
   * @param currentId - 用于精确定位`current` 对应结果的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async assertActiveKeyAvailable(
    repository: Repository<NetworkPortForward>,
    protocol: PortForwardProtocol,
    externalPort: number,
    currentId?: string,
  ): Promise<void> {
    const conflict = await repository.findOne({
      where: { activeKey: portForwardActiveKey(protocol, externalPort) },
    });
    if (conflict && conflict.id !== currentId) {
      throwVbenError('同协议外部端口已存在', HttpStatus.CONFLICT);
    }
  }

  /**
   * 按边界约束计算推进全局版本。
   * @param state - 用于按边界约束计算推进全局版本的领域对象，包含 `desiredRevision`、`desiredIssuedAt` 字段。
   * @returns 按边界约束计算推进全局版本。
   */
  private advanceGlobalRevision(state: NetworkAgentState): string {
    const revision = (BigInt(state.desiredRevision) + 1n).toString();
    state.desiredRevision = revision;
    state.desiredIssuedAt = new KtDateTime();
    return revision;
  }

  /**
   * 根据`channels`、`revision`、`issuedAt`处理分配版本。
   * @param channels - 决定分配版本内容、边界或目标的 `channels` 值。
   * @param revision - 决定分配版本内容、边界或目标的 `revision` 值。
   * @param issuedAt - 用于过期、排序或租约判定的时间基准。
   */
  private assignRevision(
    channels: NetworkPortForward[],
    revision: string,
    issuedAt: KtDateTime,
  ): void {
    for (const channel of channels) {
      channel.desiredRevision = revision;
      channel.desiredIssuedAt = issuedAt;
    }
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
    const state = await repository.findOne({
      lock: { mode: 'pessimistic_write' },
      where: { agentId },
    });
    if (!state) {
      throwVbenError(
        'Agent 状态行初始化失败',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (state.targetIpv4 !== this.targetIpv4()) {
      throwVbenError(
        'Agent 目标 IPv4 与服务端固定配置不一致',
        HttpStatus.CONFLICT,
      );
    }
    return state;
  }

  /**
   * 从协议通道投影 TCP 发布策略所需的端口、协议与 NATMap 期望状态。
   * @param group - 用于从协议通道投影 TCP 发布策略所需的端口、协议与 NATMap 期望状态的领域对象，包含 `externalPort`、`internalPort`、`protocolMode` 字段。
   * @param natmapDesiredEnabled - 决定从协议通道投影 TCP 发布策略所需的端口、协议与 NATMap 期望状态内容、边界或目标的 `natmapDesiredEnabled` 值。
   * @returns 包含 `externalPort`、`internalPort`、`natmapDesiredEnabled`、`protocolMode` 字段的状态。
   */
  private releaseState(
    group: Pick<
      NetworkPortForwardGroup,
      'externalPort' | 'internalPort' | 'protocolMode'
    >,
    natmapDesiredEnabled: boolean,
  ): TcpReleaseState {
    return {
      externalPort: group.externalPort,
      internalPort: group.internalPort,
      natmapDesiredEnabled,
      protocolMode: group.protocolMode as TcpProtocolMode,
    };
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
   * 根据`mode`处理当前协议。
   * @param mode - 选择当前协议处理分支的模式值。
   * @returns 按输入顺序得到的当前协议列表；没有匹配项时为空数组。
   */
  private protocols(mode: TcpProtocolMode): PortForwardProtocol[] {
    if (mode === 'tcp_udp') return ['tcp', 'udp'];
    return [mode];
  }

  /**
   * 根据`channels`处理已应用的协议模式。
   * @param channels - 决定已应用的协议模式内容、边界或目标的 `channels` 值。
   * @returns 当前状态对应的已应用的协议模式，取值为 `'tcp_udp'`、`'tcp'`、`'udp'`；无法解析或未命中时为 `null`。
   */
  private appliedProtocolMode(
    channels: NetworkPortForward[],
  ): TcpProtocolMode | null {
    const applied = channels
      .filter(
        (channel) =>
          channel.desiredPresence === 'present' &&
          channel.syncStatus === 'synced' &&
          this.revisionCaughtUp(
            channel.reportedRevision,
            channel.desiredRevision,
          ),
      )
      .map((channel) => channel.protocol);
    const tcp = applied.includes('tcp');
    const udp = applied.includes('udp');
    if (tcp && udp) return 'tcp_udp';
    if (tcp) return 'tcp';
    if (udp) return 'udp';
    return null;
  }

  /**
   * 根据`reported`、`desired`处理版本是否已追平。
   * @param reported - 决定版本是否已追平内容、边界或目标的 `reported` 值。
   * @param desired - 决定版本是否已追平内容、边界或目标的 `desired` 值。
   * @returns 满足版本是否已追平约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private revisionCaughtUp(reported: string, desired: string): boolean {
    try {
      return BigInt(reported) >= BigInt(desired);
    } catch {
      return false;
    }
  }

  /**
   * 将`group`、`channels`转换为序列化分组。
   * @param group - 用于序列化分组的领域对象，包含 `id`、`name`、`remark`、`externalPort` 字段。
   * @param channels - 决定序列化分组内容、边界或目标的 `channels` 值。
   * @returns 包含 `id`、`name`、`remark`、`externalPort`、`internalPort` 字段的序列化分组；无法解析或未命中时为 `null`。
   */
  private serializeGroup(
    group: NetworkPortForwardGroup,
    channels: NetworkPortForward[],
  ) {
    const tcp = channels.find(
      (channel) => !channel.isDeleted && channel.protocol === 'tcp',
    );
    const udp = channels.find(
      (channel) => !channel.isDeleted && channel.protocol === 'udp',
    );
    return {
      id: String(group.id),
      name: group.name,
      remark: group.remark || null,
      externalPort: group.externalPort,
      internalPort: group.internalPort,
      protocolMode: group.protocolMode,
      appliedProtocolMode: this.appliedProtocolMode(channels),
      targetIpv4: group.targetIpv4,
      channels: {
        tcp: (() => {
          if (tcp) {
            return this.serializeChannel(tcp);
          }
          return null;
        })(),
        udp: (() => {
          if (udp) {
            return this.serializeChannel(udp);
          }
          return null;
        })(),
      },
      isDeleted: group.isDeleted,
      createTime: group.createTime,
      updateTime: group.updateTime,
    };
  }

  /**
   * 将`channel`转换为序列化通道；从 `getTime` 读取序列化通道。
   * @param channel - 用于序列化通道的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`currentValidUntil`、`id` 字段。
   * @returns 包含 `id`、`groupId`、`name`、`remark`、`protocol` 字段的序列化通道。
   */
  private serializeChannel(channel: NetworkPortForward) {
    const leaseValid =
      !!channel.currentPublicIpv4 &&
      !!channel.currentPublicPort &&
      !!channel.currentValidUntil &&
      new Date(channel.currentValidUntil).getTime() > Date.now();
    return {
      id: String(channel.id),
      groupId: String(channel.groupId),
      name: channel.name,
      remark: channel.remark || null,
      protocol: channel.protocol,
      externalPort: channel.externalPort,
      internalPort: channel.internalPort,
      targetIpv4: channel.targetIpv4,
      desiredPresence: channel.desiredPresence,
      keeperDesiredEnabled: channel.keeperDesiredEnabled,
      natmapDesiredEnabled: channel.natmapDesiredEnabled,
      probeRequestId: channel.probeRequestId || null,
      desiredRevision: String(channel.desiredRevision),
      desiredIssuedAt: channel.desiredIssuedAt,
      reportedRevision: String(channel.reportedRevision),
      syncStatus: channel.syncStatus,
      keeperStatus: channel.keeperStatus,
      natmapStatus: channel.natmapStatus,
      currentPublicIpv4: (() => {
        if (leaseValid) {
          return channel.currentPublicIpv4;
        }
        return null;
      })(),
      currentPublicPort: (() => {
        if (leaseValid) {
          return channel.currentPublicPort;
        }
        return null;
      })(),
      currentPublicEndpoint: (() => {
        if (leaseValid) {
          return `${channel.currentPublicIpv4}:${channel.currentPublicPort}`;
        }
        return null;
      })(),
      currentObservedAt: (() => {
        if (leaseValid) {
          return channel.currentObservedAt;
        }
        return null;
      })(),
      currentValidatedAt: (() => {
        if (leaseValid) {
          return channel.currentValidatedAt;
        }
        return null;
      })(),
      currentValidUntil: (() => {
        if (leaseValid) {
          return channel.currentValidUntil;
        }
        return null;
      })(),
      lastObservedIpv4: channel.lastObservedIpv4 || null,
      lastObservedPort: channel.lastObservedPort || null,
      lastObservedAt: channel.lastObservedAt || null,
      lastErrorCode: channel.lastErrorCode || null,
      lastErrorMessage: channel.lastErrorMessage || null,
      keeperLastErrorCode: channel.keeperLastErrorCode || null,
      keeperLastErrorMessage: channel.keeperLastErrorMessage || null,
      natmapLastErrorCode: channel.natmapLastErrorCode || null,
      natmapLastErrorMessage: channel.natmapLastErrorMessage || null,
      isDeleted: channel.isDeleted,
      createTime: channel.createTime,
      updateTime: channel.updateTime,
    };
  }

  /**
   * 序列化历史，并输出固定投影 `id`、`eventId`、`eventType`、`mechanism`、`firstObservedAt` 字段。
   * @param history - 用于历史的领域对象，包含 `id`、`eventId`、`eventType`、`mechanism` 字段。
   * @returns 包含 `id`、`eventId`、`eventType`、`mechanism`、`firstObservedAt` 字段的历史。
   */
  private serializeHistory(history: NetworkEndpointHistory) {
    return {
      id: String(history.id),
      eventId: history.eventId,
      eventType: history.eventType,
      mechanism: history.mechanism,
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
   * 根据`channel`处理撤回当前端点。
   * @param channel - 用于撤回当前端点的领域对象，包含 `currentPublicIpv4`、`currentPublicPort`、`currentObservedAt`、`currentValidatedAt` 字段。
   */
  private withdrawCurrentEndpoint(channel: NetworkPortForward): void {
    channel.currentPublicIpv4 = null;
    channel.currentPublicPort = null;
    channel.currentObservedAt = null;
    channel.currentValidatedAt = null;
    channel.currentValidUntil = null;
  }

  /**
   * 校验`input`是否满足更新输入约束，并拒绝不合法输入。
   * @param input - 用于更新输入的结构化输入。
   */
  private assertUpdateInput(input: object): void {
    if (Object.keys(input).length === 0) {
      throwVbenError('至少提供一个修改字段', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * 要求端口转发分组或通道标识由 1 至 24 位十进制数字组成，并以调用方标签生成错误消息。
   * @param id - 待校验的端口转发分组或协议通道标识。
   * @param label - 标明无效标识所属对象的中文标签。
   */
  private assertId(id: string, label: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError(`${label} ID 无效`, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * 将`value`规范为名称，使等价输入得到一致表示。
   * @param value - 待转换为名称的原始值。
   * @returns 名称。
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
   * 根据`error`处理重新抛出重复项错误。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @throws 错误为 MySQL 唯一键冲突时抛出 HTTP 409 业务错误；否则原样重新抛出传入错误。
   */
  private rethrowDuplicate(error: unknown): never {
    if (this.isDuplicateKeyError(error)) {
      throwVbenError('同协议外部端口或组内协议已存在', HttpStatus.CONFLICT);
    }
    throw error;
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
}
