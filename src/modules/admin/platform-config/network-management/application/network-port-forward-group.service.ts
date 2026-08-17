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

  /** 列出网络端口转发分组记录。 */
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

  /** 创建网络端口转发分组记录。 */
  async create(input: NetworkPortForwardGroupCreateDto) {
    const result = await this.createInternal(input);
    return this.serializeGroup(result.group, result.channels);
  }

  /** 创建v1。 */
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

  /** 更新网络端口转发分组记录。 */
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

  /** 更新v1。 */
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

  /** 移除网络端口转发分组记录。 */
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

  /** 移除v1。 */
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

  /** 重试网络端口转发分组记录。 */
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

  /** 启用NATMap。 */
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

  /** 禁用NATMap。 */
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

  /** 启用保活器。 */
  async enableKeeper(groupId: string) {
    return this.enableKeeperTarget(groupId);
  }

  /** 禁用保活器。 */
  async disableKeeper(groupId: string) {
    return this.disableKeeperTarget(groupId);
  }

  /** 启用保活器v1。 */
  async enableKeeperV1(channelId: string) {
    return this.enableKeeperTarget({ action: 'UDP Keeper', channelId });
  }

  /** 禁用保活器v1。 */
  async disableKeeperV1(channelId: string) {
    return this.disableKeeperTarget({ action: 'UDP Keeper', channelId });
  }

  /** 返回探针v1。 */
  async probeV1(channelId: string) {
    return this.probeTarget({ action: 'UDP Keeper', channelId });
  }

  /** 返回探针。 */
  async probe(groupId: string) {
    return this.probeTarget(groupId);
  }

  /** 启用保活器目标。 */
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

  /** 禁用保活器目标。 */
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

  /** 返回探针目标。 */
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

  /** 返回端点历史。 */
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
    const mechanism = protocol === 'tcp' ? 'tcp_natmap' : 'udp_stun';
    const [items, total] = await this.historyRepository.findAndCount({
      order: { occurredAt: 'DESC' },
      skip: (pageNo - 1) * pageSize,
      take: pageSize,
      where: { mappingId: channel.id, mechanism },
    });
    return { items: items.map((item) => this.serializeHistory(item)), total };
  }

  /** 创建内部。 */
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

  /** 在事务中更新记录。 */
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
    const mutation: TcpReleaseMutation =
      group.protocolMode === 'tcp_udp' && protocolMode === 'udp'
        ? {
            after: {
              externalPort,
              internalPort,
              natmapDesiredEnabled: false,
              protocolMode,
            },
            before: this.releaseState(
              group,
              tcp?.natmapDesiredEnabled || false,
            ),
            kind: 'protocol-shrink',
          }
        : {
            after: {
              externalPort,
              internalPort,
              natmapDesiredEnabled:
                protocolMode === 'udp'
                  ? false
                  : tcp?.natmapDesiredEnabled || false,
              protocolMode,
            },
            before: this.releaseState(
              group,
              tcp?.natmapDesiredEnabled || false,
            ),
            kind: 'update',
          };
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

    const name =
      input.name === undefined ? group.name : this.normalizeName(input.name);
    const authorityPayloadChanged =
      name !== group.name ||
      externalPort !== group.externalPort ||
      internalPort !== group.internalPort;
    group.name = name;
    group.remark =
      input.remark === undefined ? group.remark : input.remark.trim() || null;
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

  /** 在事务中移除记录。 */
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

  /** 修改通道。 */
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
    const v1Target = typeof target === 'string' ? null : target;
    const targetId = typeof target === 'string' ? target : target.channelId;
    this.assertId(targetId, v1Target ? '端口转发' : '逻辑组');
    const result = await this.dataSource.transaction(async (manager) => {
      const state = await this.lockAgentState(manager);
      const mappingRepository = manager.getRepository(NetworkPortForward);
      const requested = v1Target
        ? await mappingRepository.findOne({
            lock: { mode: 'pessimistic_write' },
            where: { id: v1Target.channelId, isDeleted: false },
          })
        : null;
      if (v1Target && !requested) {
        throwVbenError('端口转发不存在', HttpStatus.NOT_FOUND);
      }
      if (v1Target && requested && requested.protocol !== protocol) {
        throwVbenError(
          `${requested.protocol.toUpperCase()} 通道不支持 ${v1Target.action}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const groupId = requested ? String(requested.groupId) : targetId;
      const group = await this.findLockedGroup(manager, groupId);
      const channels = await this.findChannels(manager, groupId);
      const requestedIndex = requested
        ? channels.findIndex((item) => item.id === requested.id)
        : -1;
      if (
        requested &&
        (requested.isDeleted ||
          requested.groupId !== group.id ||
          requestedIndex < 0 ||
          channels[requestedIndex].groupId !== group.id ||
          channels[requestedIndex].protocol !== protocol)
      ) {
        throwVbenError('端口转发通道已失效或被替换', HttpStatus.CONFLICT);
      }
      if (requested) channels[requestedIndex] = requested;
      const channel =
        requested || channels.find((item) => item.protocol === protocol);
      if (!channel) {
        throwVbenError(
          `逻辑组不包含 ${protocol.toUpperCase()} 协议通道`,
          invalidProtocolIsBadRequest
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.NOT_FOUND,
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

  /** 查找已锁定分组。 */
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

  /** 查找匹配的通道。 */
  private async findChannels(
    manager: EntityManager,
    groupId: string,
  ): Promise<NetworkPortForward[]> {
    return manager.getRepository(NetworkPortForward).find({
      order: { protocol: 'ASC' },
      where: { groupId, isDeleted: false },
    });
  }

  /** 创建通道。 */
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

  /** 断言结构性编辑允许的。 */
  private assertStructuralEditAllowed(channels: NetworkPortForward[]): void {
    if (
      channels.some(
        (channel) =>
          channel.desiredPresence !== 'present' ||
          channel.syncStatus !== 'synced',
      )
    ) {
      throwVbenError('逻辑组正在删除或协调中', HttpStatus.CONFLICT);
    }
    if (
      channels.some(
        (channel) =>
          channel.keeperDesiredEnabled ||
          channel.natmapDesiredEnabled ||
          channel.keeperStatus !== 'disabled' ||
          channel.natmapStatus !== 'disabled',
      )
    ) {
      throwVbenError(
        '请先停用 Keeper 和 NATMap 再修改端口或协议',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** 校验机制转换是否允许。 */
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

  /** 断言v1单一的通道。 */
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

  /** 断言保活器端口。 */
  private assertKeeperPorts(channel: NetworkPortForward): void {
    if (channel.externalPort !== channel.internalPort) {
      throwVbenError(
        'UDP Keeper 要求外部端口与内部端口一致',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** 断言启用的键可用。 */
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

  /** 返回推进全局版本。 */
  private advanceGlobalRevision(state: NetworkAgentState): string {
    const revision = (BigInt(state.desiredRevision) + 1n).toString();
    state.desiredRevision = revision;
    state.desiredIssuedAt = new KtDateTime();
    return revision;
  }

  /** 分配版本。 */
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

  /** 返回锁Agent状态。 */
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

  /** 释放状态。 */
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

  /** 断言发布变更。 */
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

  /** 列出当前协议。 */
  private protocols(mode: TcpProtocolMode): PortForwardProtocol[] {
    if (mode === 'tcp_udp') return ['tcp', 'udp'];
    return [mode];
  }

  /** 读取已应用的协议模式。 */
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

  /** 判断版本是否已追平。 */
  private revisionCaughtUp(reported: string, desired: string): boolean {
    try {
      return BigInt(reported) >= BigInt(desired);
    } catch {
      return false;
    }
  }

  /** 序列化分组。 */
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
        tcp: tcp ? this.serializeChannel(tcp) : null,
        udp: udp ? this.serializeChannel(udp) : null,
      },
      isDeleted: group.isDeleted,
      createTime: group.createTime,
      updateTime: group.updateTime,
    };
  }

  /** 序列化通道。 */
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
      currentPublicIpv4: leaseValid ? channel.currentPublicIpv4 : null,
      currentPublicPort: leaseValid ? channel.currentPublicPort : null,
      currentPublicEndpoint: leaseValid
        ? `${channel.currentPublicIpv4}:${channel.currentPublicPort}`
        : null,
      currentObservedAt: leaseValid ? channel.currentObservedAt : null,
      currentValidatedAt: leaseValid ? channel.currentValidatedAt : null,
      currentValidUntil: leaseValid ? channel.currentValidUntil : null,
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

  /** 序列化历史。 */
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

  /** 撤回当前端点。 */
  private withdrawCurrentEndpoint(channel: NetworkPortForward): void {
    channel.currentPublicIpv4 = null;
    channel.currentPublicPort = null;
    channel.currentObservedAt = null;
    channel.currentValidatedAt = null;
    channel.currentValidUntil = null;
  }

  /** 断言更新输入。 */
  private assertUpdateInput(input: object): void {
    if (Object.keys(input).length === 0) {
      throwVbenError('至少提供一个修改字段', HttpStatus.BAD_REQUEST);
    }
  }

  /** 断言标识。 */
  private assertId(id: string, label: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError(`${label} ID 无效`, HttpStatus.BAD_REQUEST);
    }
  }

  /** 规范化名称。 */
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

  /** 返回Agent标识。 */
  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  /** 返回目标IPv4。 */
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

  /** 重新抛出重复项错误。 */
  private rethrowDuplicate(error: unknown): never {
    if (this.isDuplicateKeyError(error)) {
      throwVbenError('同协议外部端口或组内协议已存在', HttpStatus.CONFLICT);
    }
    throw error;
  }

  /** 判断重复键错误是否成立。 */
  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }

  /** 通知期望的已变更。 */
  private notifyDesiredChanged(): void {
    try {
      this.mqttService.requestDesiredPublish();
    } catch {
      // Desired state is durable; the periodic publisher will retry independently.
    }
  }
}
