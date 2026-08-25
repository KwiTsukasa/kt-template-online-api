import { isIP } from 'node:net';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { KtDateTime, throwVbenError } from '@/common';
import {
  SYSTEM_MESSAGE_DELIVERY_COORDINATOR,
  type SystemMessageDeliveryCoordinator,
} from '@/modules/message-management/contract/message-management.types';
import { NetworkAgentState } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-agent-state.entity';
import { NetworkDdnsRecord } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-ddns.entity';
import {
  NetworkDnsPodClient,
  NetworkDnsPodClientError,
} from '@/modules/admin/platform-config/network-management/infrastructure/integration/network-dnspod.client';
import { NetworkManagementEventStreamService } from './network-management-event-stream.service';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';
import { NetworkPortForwardGroup } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-port-forward-group.entity';
import { classifyStunEndpointSource } from '../domain/network-source-eligibility';
import { classifyTcpNatmapEndpointSource } from '../domain/network-tcp-natmap-source-eligibility';
import type {
  NetworkDdnsListQuery,
  NetworkDdnsRecordInput,
  NetworkDdnsRecordType,
  NetworkDdnsRecordUpdateInput,
  NetworkDdnsSourceOption,
} from '@/modules/admin/platform-config/network-management/contract/network-management.types';

type ReconcileRequest = {
  force: boolean;
  id: null | string;
  reject: (error: unknown) => void;
  resolve: () => void;
};

type SafeProviderError = {
  code: string;
  message: string;
  retryable: boolean;
};

const DEFAULT_AGENT_ID = 'nas-main';
const DEFAULT_AGENT_IPV6_MAX_AGE_MS = 60_000;
const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 15 * 60_000;
const RETRY_MAX_ATTEMPTS = 8;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const PROVIDER_ERROR_CODES: Record<string, string> = {
  DNSPOD_AUTH_FAILED: 'provider_auth_failed',
  DNSPOD_DISABLED: 'provider_unconfigured',
  DNSPOD_INVALID_INPUT: 'record_identity_changed',
  DNSPOD_NOT_CONFIGURED: 'provider_unconfigured',
  DNSPOD_PERMISSION_DENIED: 'provider_permission_denied',
  DNSPOD_PROVIDER_REJECTED: 'provider_permission_denied',
  DNSPOD_PROVIDER_RETRYABLE: 'provider_unavailable',
  DNSPOD_RATE_LIMITED: 'provider_rate_limited',
  DNSPOD_RECORD_AMBIGUOUS: 'record_ambiguous',
  DNSPOD_RECORD_DISABLED: 'record_disabled',
  DNSPOD_RECORD_INVALID: 'record_identity_changed',
  DNSPOD_RECORD_MISMATCH: 'record_identity_changed',
  DNSPOD_RECORD_NOT_FOUND: 'record_not_found',
  DNSPOD_VERIFICATION_FAILED: 'provider_write_unverified',
};

@Injectable()
export class NetworkDdnsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetworkDdnsService.name);
  private destroyed = false;
  private reconcileInterval?: NodeJS.Timeout;
  private reconcileRequestTimer?: NodeJS.Timeout;
  private reconcileWorker: null | Promise<void> = null;
  private readonly reconcileRequests: ReconcileRequest[] = [];
  private readonly recordMutationTails = new Map<string, Promise<void>>();
  private requestedForce = false;

  constructor(
    @InjectRepository(NetworkDdnsRecord)
    private readonly recordRepository: Repository<NetworkDdnsRecord>,
    @InjectRepository(NetworkPortForward)
    private readonly mappingRepository: Repository<NetworkPortForward>,
    @InjectRepository(NetworkPortForwardGroup)
    private readonly groupRepository: Repository<NetworkPortForwardGroup>,
    @InjectRepository(NetworkAgentState)
    private readonly stateRepository: Repository<NetworkAgentState>,
    private readonly configService: ConfigService,
    private readonly dnsPodClient: NetworkDnsPodClient,
    private readonly eventStream: NetworkManagementEventStreamService,
    @Inject(SYSTEM_MESSAGE_DELIVERY_COORDINATOR)
    private readonly deliveryCoordinator: SystemMessageDeliveryCoordinator,
  ) {}

  onModuleInit(): void {
    this.requestReconcile();
    this.reconcileInterval = setInterval(
      () => this.requestReconcile(),
      this.reconcileIntervalMs(),
    );
    this.reconcileInterval.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconcileRequestTimer) {
      clearTimeout(this.reconcileRequestTimer);
      this.reconcileRequestTimer = undefined;
    }
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = undefined;
    }
    const pending = this.reconcileRequests.splice(0);
    pending.forEach((request) => request.resolve());
    await this.reconcileWorker;
  }

  /**
   * 按`query`读取网络DDNS记录；把变更持久化到当前存储（`recordRepository.createQueryBuilder`）。
   * @param query - 限定网络DDNS记录筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`name`、`recordType` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的网络DDNS记录。
   */
  async list(query: NetworkDdnsListQuery = {}) {
    const pageNo = query.pageNo || 1;
    const pageSize = query.pageSize || 20;
    const builder = this.recordRepository
      .createQueryBuilder('record')
      .where('record.isDeleted = :isDeleted', { isDeleted: false });
    if (query.name) {
      builder.andWhere('record.name LIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.recordType) {
      builder.andWhere('record.recordType = :recordType', {
        recordType: query.recordType,
      });
    }
    if (query.syncStatus) {
      builder.andWhere('record.syncStatus = :syncStatus', {
        syncStatus: query.syncStatus,
      });
    }
    if (query.enabled !== undefined) {
      builder.andWhere('record.enabled = :enabled', {
        enabled: query.enabled,
      });
    }
    const [records, total] = await builder
      .orderBy('record.createTime', 'DESC')
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: await Promise.all(
        records.map((record) => this.serializeRecord(record)),
      ),
      total,
    };
  }

  /**
   * 按记录类型返回 Agent IPv6、端口转发 IPv4 或 TCP NATMap IP4P 来源，IP4P 仅从 TCP 通道派生。
   * @param query - 限定输入约束并返回来源选项筛选、排序与分页范围的查询条件，包含 `recordType` 字段。
   * @returns 按输入顺序得到的输入约束并返回来源选项列表；没有匹配项时为空数组。
   */
  async sourceOptions(query: {
    recordType: NetworkDdnsRecordType;
  }): Promise<NetworkDdnsSourceOption[]> {
    if (query.recordType !== 'A' && query.recordType !== 'AAAA') {
      throwVbenError('DDNS 记录类型无效', HttpStatus.BAD_REQUEST);
    }
    const [mappings, groups] = await Promise.all([
      this.mappingRepository.find({
        order: { id: 'ASC', name: 'ASC' },
        where: { isDeleted: false },
      }),
      this.groupRepository.find({
        order: { id: 'ASC', name: 'ASC' },
        where: { isDeleted: false },
      }),
    ]);
    const groupsById = new Map(
      groups.map((group) => [String(group.id), group]),
    );
    if (query.recordType === 'AAAA') {
      const agentIpv6 = await this.agentIpv6SourceOption();
      return [
        agentIpv6,
        ...mappings
          .filter((mapping) => mapping.protocol === 'tcp')
          .map((mapping) =>
            this.portForwardSourceOption(
              mapping,
              groupsById.get(String(mapping.groupId)),
              'port_forward_ip4p',
            ),
          ),
      ];
    }
    return mappings.map((mapping) =>
      this.portForwardSourceOption(
        mapping,
        groupsById.get(String(mapping.groupId)),
        'port_forward_ipv4',
      ),
    );
  }

  /**
   * 读取资料源状态；通过 `dnsPodClient.getStatus` 读取对应运行状态。
   * @returns 返回资料源状态；通过 `dnsPodClient.getStatus` 读取对应运行状态。
   */
  getProviderStatus() {
    return this.dnsPodClient.getStatus();
  }

  /**
   * 根据`input`构造网络DDNS记录；把变更持久化到当前存储（`recordRepository.create`）。
   * @param input - 用于网络DDNS记录的结构化输入。
   * @returns 网络DDNS记录。
   * @throws 当 `recordRepository.save` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  async create(input: NetworkDdnsRecordInput) {
    const normalized = await this.normalizeCreateInput(input);
    await this.assertActiveKeyAvailable(normalized.activeKey);
    const record = this.recordRepository.create({
      activeKey: normalized.activeKey,
      appliedAddress: null,
      domain: normalized.domain,
      enabled: normalized.enabled,
      isDeleted: false,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSyncedAt: null,
      name: normalized.name,
      nextRetryAt: null,
      portForwardId: normalized.portForwardId,
      providerRecordId: null,
      recordType: normalized.recordType,
      remark: normalized.remark,
      retryCount: 0,
      sourceAddress: null,
      sourceType: normalized.sourceType,
      subDomain: normalized.subDomain,
      syncStatus: (() => {
        if (normalized.enabled) {
          return 'pending';
        }
        return 'disabled';
      })(),
    });
    try {
      await this.recordRepository.save(record);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throwVbenError('同类型完整域名已存在自动更新配置', HttpStatus.CONFLICT);
      }
      throw error;
    }
    this.publishSemanticChange();
    if (record.enabled) this.requestReconcile();
    return this.serializeRecord(record);
  }

  /**
   * 根据`id`、`input`更新网络DDNS记录；先通过 `assertId` 校验输入边界。
   * @param id - 决定网络DDNS记录内容、边界或目标的 `id` 值。
   * @param input - 用于网络DDNS记录的结构化输入。
   * @returns 网络DDNS记录。
   */
  async update(id: string, input: NetworkDdnsRecordUpdateInput) {
    this.assertId(id);
    return this.withRecordMutation(id, async () => {
      if (!input || Object.keys(input).length === 0) {
        throwVbenError('至少提供一个修改字段', HttpStatus.BAD_REQUEST);
      }
      const record = await this.findActiveRecord(id);
      const normalized = await this.normalizeUpdateInput(record, input);
      if (normalized.activeKey !== record.activeKey) {
        const conflict = await this.findByActiveKey(normalized.activeKey);
        if (conflict && conflict.id !== record.id) {
          throwVbenError(
            '同类型完整域名已存在自动更新配置',
            HttpStatus.CONFLICT,
          );
        }
      }

      const beforeSemantic = this.semanticFingerprint(record);
      const dnsIdentityChanged =
        record.recordType !== normalized.recordType ||
        record.domain !== normalized.domain ||
        record.subDomain !== normalized.subDomain;
      const sourceIdentityChanged =
        record.sourceType !== normalized.sourceType ||
        (record.portForwardId || null) !== normalized.portForwardId;
      const enabledChanged = record.enabled !== normalized.enabled;

      record.activeKey = normalized.activeKey;
      record.domain = normalized.domain;
      record.enabled = normalized.enabled;
      record.name = normalized.name;
      record.portForwardId = normalized.portForwardId;
      record.recordType = normalized.recordType;
      record.remark = normalized.remark;
      record.sourceType = normalized.sourceType;
      record.subDomain = normalized.subDomain;

      if (dnsIdentityChanged) {
        record.appliedAddress = null;
        record.providerRecordId = null;
      }
      if (dnsIdentityChanged || sourceIdentityChanged) {
        record.sourceAddress = null;
      }
      if (!record.enabled) {
        this.markDisabled(record);
      } else if (
        dnsIdentityChanged ||
        sourceIdentityChanged ||
        enabledChanged
      ) {
        this.markPending(record);
      }

      try {
        await this.saveWithSemanticEvent(record, beforeSemantic);
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          throwVbenError(
            '同类型完整域名已存在自动更新配置',
            HttpStatus.CONFLICT,
          );
        }
        throw error;
      }
      if (
        record.enabled &&
        (dnsIdentityChanged || sourceIdentityChanged || enabledChanged)
      ) {
        this.requestReconcile();
      }
      return this.serializeRecord(record);
    });
  }

  /**
   * 按`id`移除网络DDNS记录；先通过 `assertId` 校验输入边界。
   * @param id - 决定网络DDNS记录内容、边界或目标的 `id` 值。
   * @returns 网络DDNS记录。
   */
  async remove(id: string) {
    this.assertId(id);
    return this.withRecordMutation(id, async () => {
      const record = await this.findActiveRecord(id);
      const beforeSemantic = this.semanticFingerprint(record);
      record.activeKey = null;
      record.enabled = false;
      record.isDeleted = true;
      this.markDisabled(record);
      await this.saveWithSemanticEvent(record, beforeSemantic);
      return this.serializeRecord(record);
    });
  }

  /**
   * 根据`id`处理网络DDNS记录；先通过 `assertId` 校验输入边界。
   * @param id - 决定网络DDNS记录内容、边界或目标的 `id` 值。
   * @returns 网络DDNS记录。
   */
  async retry(id: string) {
    this.assertId(id);
    return this.withRecordMutation(id, async () => {
      const record = await this.findActiveRecord(id);
      if (!record.enabled) {
        throwVbenError('自动更新已停用', HttpStatus.BAD_REQUEST);
      }
      const beforeSemantic = this.semanticFingerprint(record);
      this.markPending(record);
      await this.saveWithSemanticEvent(record, beforeSemantic);
      void this.reconcileNow(id, true).catch(() => {
        // Durable pending state is retried by the interval and next startup.
      });
      return this.serializeRecord(record);
    });
  }

  /**
   * 合并同一事件循环内的 DDNS 核对请求并延迟一次执行；任一请求要求强制核对时保留该要求。
   * @param force - 决定是否启用“force”分支的布尔选项；省略时默认采用 `false`。
   */
  requestReconcile(force = false): void {
    if (this.destroyed) return;
    this.requestedForce ||= force;
    if (this.reconcileRequestTimer) return;
    this.reconcileRequestTimer = setTimeout(() => {
      this.reconcileRequestTimer = undefined;
      const requestedForce = this.requestedForce;
      this.requestedForce = false;
      void this.reconcileNow(undefined, requestedForce).catch(() => {
        // Durable rows remain recoverable by the next bounded scan or restart.
      });
    }, 0);
    this.reconcileRequestTimer.unref?.();
  }

  /**
   * 根据`id`、`force`处理立即执行核对；先通过 `assertId` 校验输入边界。
   * @param id - 决定立即执行核对内容、边界或目标的 `id` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @param force - 决定是否启用“force”分支的布尔选项；省略时默认采用 `false`。
   * @returns 完成初始化并携带当前边界配置的立即执行核对；无法解析或未命中时为 `null`。
   */
  reconcileNow(id?: string, force = false): Promise<void> {
    if (id !== undefined) this.assertId(id);
    if (this.destroyed) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.reconcileRequests.push({
        force,
        id: id || null,
        reject,
        resolve,
      });
      this.ensureReconcileWorker();
    });
  }

  /**
   * 确保核对工作进程存在且保持一致；缺失时根据当前运行态补齐对应状态。
   */
  private ensureReconcileWorker(): void {
    if (this.reconcileWorker || this.destroyed) return;
    this.reconcileWorker = this.drainReconcileRequests().finally(() => {
      this.reconcileWorker = null;
      if (this.reconcileRequests.length > 0 && !this.destroyed) {
        this.ensureReconcileWorker();
      }
    });
  }

  /**
   * 根据`id`、`operation`处理在记录变更期间执行传入操作；从 `recordMutationTails.get` 读取在记录变更期间执行传入操作。
   * @param id - 决定在记录变更期间执行传入操作内容、边界或目标的 `id` 值。
   * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
   * @returns 在记录变更期间执行传入操作。
   */
  private async withRecordMutation<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.recordMutationTails.get(id) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.recordMutationTails.set(id, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.recordMutationTails.get(id) === tail) {
        this.recordMutationTails.delete(id);
      }
    }
  }

  /**
   * 根据当前运行态处理对应领域流程并产生排空核对请求。
   */
  private async drainReconcileRequests(): Promise<void> {
    while (!this.destroyed && this.reconcileRequests.length > 0) {
      const requests = this.reconcileRequests.splice(0);
      try {
        await this.reconcileBatch(requests);
        requests.forEach((request) => request.resolve());
      } catch (error) {
        requests.forEach((request) => request.reject(error));
      }
    }
  }

  /**
   * 根据`requests`处理批次；从 `recordForces.get` 读取批次。
   * @param requests - 决定批次内容、边界或目标的 `requests` 值。
   */
  private async reconcileBatch(requests: ReconcileRequest[]): Promise<void> {
    const recordForces = new Map<string, boolean>();
    const allRequests = requests.filter((request) => request.id === null);
    if (allRequests.length > 0) {
      const forceAll = allRequests.some((request) => request.force);
      const activeRecords = await this.recordRepository.find({
        order: { nextRetryAt: 'ASC', id: 'ASC' },
        where: { enabled: true, isDeleted: false },
      });
      activeRecords.forEach((record) => {
        recordForces.set(
          String(record.id),
          forceAll || recordForces.get(String(record.id)) === true,
        );
      });
    }
    requests
      .filter((request) => request.id !== null)
      .forEach((request) => {
        const id = request.id as string;
        recordForces.set(id, request.force || recordForces.get(id) === true);
      });
    const ids = [...recordForces.keys()].sort(compareDecimalIds);
    for (const id of ids) {
      await this.reconcileRecord(id, recordForces.get(id) === true);
    }
  }

  /**
   * 根据`id`、`force`处理网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param force - 决定是否启用“force”分支的布尔选项。
   */
  private async reconcileRecord(id: string, force: boolean): Promise<void> {
    await this.withRecordMutation(id, () =>
      this.reconcileRecordLocked(id, force),
    );
  }

  /**
   * 根据`id`、`force`处理记录已锁定；当 `!targetAddress` 成立时直接结束且不产生返回值。
   * @param id - 决定记录已锁定内容、边界或目标的 `id` 值。
   * @param force - 决定是否启用“force”分支的布尔选项。
   */
  private async reconcileRecordLocked(
    id: string,
    force: boolean,
  ): Promise<void> {
    const record = await this.recordRepository.findOne({
      where: { enabled: true, id, isDeleted: false },
    });
    if (!record) return;
    const source = await this.resolveRecordSource(record);
    const targetAddress = source.currentAddress;
    if (!targetAddress) {
      await this.persistWaitingSource(record);
      return;
    }

    const sourceChanged = record.sourceAddress !== targetAddress;
    if (
      !force &&
      record.syncStatus === 'synced' &&
      !sourceChanged &&
      record.appliedAddress === targetAddress &&
      !!record.providerRecordId
    ) {
      return;
    }
    if (
      !force &&
      record.syncStatus === 'failed' &&
      !sourceChanged &&
      (!record.nextRetryAt ||
        new Date(record.nextRetryAt).getTime() > Date.now())
    ) {
      return;
    }

    const beforeSyncing = this.semanticFingerprint(record);
    if (sourceChanged) record.retryCount = 0;
    record.lastAttemptAt = new KtDateTime();
    record.lastErrorCode = null;
    record.lastErrorMessage = null;
    record.nextRetryAt = null;
    record.sourceAddress = targetAddress;
    record.syncStatus = 'syncing';
    if (!(await this.saveReconcileState(record, beforeSyncing))) return;

    const expectedIdentity = this.reconcileIdentity(record);
    let result;
    try {
      result = await this.dnsPodClient.reconcile({
        domain: record.domain,
        expectedRecordId: record.providerRecordId || null,
        recordType: record.recordType,
        subDomain: record.subDomain,
        targetAddress,
      });
    } catch (error) {
      const current = await this.reReadForProviderResult(
        id,
        expectedIdentity,
        targetAddress,
      );
      if (!current) return;
      await this.persistProviderFailure(current, this.safeProviderError(error));
      return;
    }
    const current = await this.reReadForProviderResult(
      id,
      expectedIdentity,
      targetAddress,
    );
    if (!current) return;
    const beforeSynced = this.semanticFingerprint(current);
    const expectedProviderRecordId = current.providerRecordId || null;
    current.appliedAddress = result.appliedAddress;
    current.lastErrorCode = null;
    current.lastErrorMessage = null;
    current.lastSyncedAt = new KtDateTime();
    current.nextRetryAt = null;
    current.providerRecordId = result.providerRecordId;
    current.retryCount = 0;
    current.sourceAddress = targetAddress;
    current.syncStatus = 'synced';
    const saved = await this.saveReconcileState(
      current,
      beforeSynced,
      expectedProviderRecordId,
    );
    if (saved && current.syncStatus === 'synced' && current.appliedAddress) {
      void this.deliveryCoordinator
        .notifyDependencyChanged({
          dependencyKey: 'network.ddns.synced',
          payload: {
            appliedAddress: current.appliedAddress,
            ddnsRecordId: String(current.id),
          },
        })
        .catch(() => this.loggerWarnDeliveryWake());
    }
  }

  /**
   * 根据`id`、`expectedIdentity`、`targetAddress`处理为资料源结果重新读取记录；当 `this.reconcileIdentity(current) !== expectedIdentity` 成立时返回 `null`。
   * @param id - 决定为资料源结果重新读取记录内容、边界或目标的 `id` 值。
   * @param expectedIdentity - 决定为资料源结果重新读取记录内容、边界或目标的 `expectedIdentity` 值。
   * @param targetAddress - 决定为资料源结果重新读取记录内容、边界或目标的 `targetAddress` 值。
   * @returns 为资料源结果重新读取记录；无法解析或未命中时为 `null`。
   */
  private async reReadForProviderResult(
    id: string,
    expectedIdentity: string,
    targetAddress: string,
  ): Promise<NetworkDdnsRecord | null> {
    const current = await this.recordRepository.findOne({
      where: { enabled: true, id, isDeleted: false },
    });
    if (!current) return null;
    if (this.reconcileIdentity(current) !== expectedIdentity) {
      this.enqueueInternalReconcile(id);
      return null;
    }
    const source = await this.resolveRecordSource(current);
    if (source.currentAddress === targetAddress) return current;

    const beforeSemantic = this.semanticFingerprint(current);
    if (source.currentAddress) {
      current.lastErrorCode = null;
    } else {
      current.lastErrorCode = 'source_unavailable';
    }
    if (source.currentAddress) {
      current.lastErrorMessage = null;
    } else {
      current.lastErrorMessage = 'DDNS source is unavailable';
    }
    current.nextRetryAt = null;
    current.retryCount = 0;
    current.sourceAddress = source.currentAddress;
    if (source.currentAddress) {
      current.syncStatus = 'pending';
    } else {
      current.syncStatus = 'waiting_source';
    }
    if (await this.saveReconcileState(current, beforeSemantic)) {
      this.enqueueInternalReconcile(id);
    }
    return null;
  }

  /**
   * 将内部核对任务加入队列。
   * @param id - 决定将内部核对任务加入队列内容、边界或目标的 `id` 值。
   */
  private enqueueInternalReconcile(id: string): void {
    if (this.destroyed) return;
    this.reconcileRequests.push({
      force: false,
      id,
      reject: () => undefined,
      resolve: () => undefined,
    });
    this.ensureReconcileWorker();
  }

  /**
   * 根据`record`更新持久化等待中的来源。
   * @param record - 用于持久化等待中的来源的领域对象，包含 `lastAttemptAt`、`lastErrorCode`、`lastErrorMessage`、`nextRetryAt` 字段。
   */
  private async persistWaitingSource(record: NetworkDdnsRecord): Promise<void> {
    const beforeSemantic = this.semanticFingerprint(record);
    record.lastAttemptAt = new KtDateTime();
    record.lastErrorCode = 'source_unavailable';
    record.lastErrorMessage = 'DDNS source is unavailable';
    record.nextRetryAt = null;
    record.retryCount = 0;
    record.sourceAddress = null;
    record.syncStatus = 'waiting_source';
    await this.saveReconcileState(record, beforeSemantic);
  }

  /**
   * 持久化资料源失败。
   * @param record - 用于持久化资料源失败的领域对象，包含 `retryCount`、`lastErrorCode`、`lastErrorMessage`、`nextRetryAt` 字段。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private async persistProviderFailure(
    record: NetworkDdnsRecord,
    error: SafeProviderError,
  ): Promise<void> {
    const beforeSemantic = this.semanticFingerprint(record);
    const previousRetryCount = Math.max(0, record.retryCount || 0);
    const retryCount = Math.min(previousRetryCount + 1, RETRY_MAX_ATTEMPTS);
    const shouldRetry =
      error.retryable && previousRetryCount < RETRY_MAX_ATTEMPTS;
    record.lastErrorCode = error.code.slice(0, 64);
    record.lastErrorMessage = error.message.slice(0, 512);
    if (shouldRetry) {
      record.nextRetryAt = new KtDateTime(
        Date.now() + this.retryDelayMs(retryCount),
      );
    } else {
      record.nextRetryAt = null;
    }
    record.retryCount = retryCount;
    record.syncStatus = 'failed';
    await this.saveReconcileState(record, beforeSemantic);
  }

  /**
   * 将资料源错误转换为安全错误信息。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 包含 `code`、`message`、`retryable` 字段的将资料源错误转换为安全错误信息。
   */
  private safeProviderError(error: unknown): SafeProviderError {
    if (error instanceof NetworkDnsPodClientError) {
      const passthroughCode = (() => {
        if (/^[a-z][a-z0-9_]{0,63}$/.test(error.code)) {
          return error.code;
        }
        return null;
      })();
      return {
        code:
          passthroughCode ||
          PROVIDER_ERROR_CODES[error.code] ||
          'provider_unavailable',
        message: error.message.slice(0, 512) || 'DDNS provider request failed',
        retryable: error.retryable,
      };
    }
    return {
      code: 'provider_unavailable',
      message: 'DDNS provider request failed',
      retryable: true,
    };
  }

  /**
   * 从`record`解析记录来源；当 `record.recordType === 'AAAA' && record.sourceType === 'agent_…` 成立时返回 `this.agentIpv6SourceOption()`。
   * @param record - 用于记录来源的领域对象，包含 `recordType`、`sourceType`、`portForwardId` 字段。
   * @returns 记录来源；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveRecordSource(
    record: NetworkDdnsRecord,
  ): Promise<NetworkDdnsSourceOption> {
    if (
      record.recordType === 'AAAA' &&
      record.sourceType === 'agent_ipv6' &&
      !record.portForwardId
    ) {
      return this.agentIpv6SourceOption();
    }
    if (
      ((record.recordType === 'A' &&
        record.sourceType === 'port_forward_ipv4') ||
        (record.recordType === 'AAAA' &&
          record.sourceType === 'port_forward_ip4p')) &&
      record.portForwardId
    ) {
      const mapping = await this.mappingRepository.findOne({
        where: { id: record.portForwardId, isDeleted: false },
      });
      if (mapping) {
        const group = await this.groupRepository.findOne({
          where: { id: mapping.groupId, isDeleted: false },
        });
        return this.portForwardSourceOption(
          mapping,
          group || undefined,
          record.sourceType,
        );
      }
      return this.missingPortForwardSourceOption(
        record.portForwardId,
        record.sourceType,
      );
    }
    return this.missingPortForwardSourceOption(
      record.portForwardId || 'invalid',
      (() => {
        if (record.sourceType === 'port_forward_ip4p') {
          return 'port_forward_ip4p';
        }
        return 'port_forward_ipv4';
      })(),
    );
  }

  /**
   * 按边界约束计算端口转发来源选项。
   * @param mapping - 用于按边界约束计算端口转发来源选项的领域对象，包含 `protocol`、`currentPublicIpv4`、`currentPublicPort`、`currentValidUntil` 字段。
   * @param group - 用于按边界约束计算端口转发来源选项的领域对象，包含 `name` 字段；为空时采用 `mapping.name` 作为兜底。
   * @param sourceType - 决定返回原始公网 IPv4 还是编码公网 IPv4 与端口的 IP4P AAAA。
   * @returns 包含 `currentAddress`、`disabledReasonCode`、`eligible`、`externalPort`、`groupId` 字段的按边界约束计算端口转发来源选项；无法解析或未命中时为 `null`。
   */
  private portForwardSourceOption(
    mapping: NetworkPortForward,
    group?: NetworkPortForwardGroup,
    sourceType: 'port_forward_ip4p' | 'port_forward_ipv4' = 'port_forward_ipv4',
  ): NetworkDdnsSourceOption {
    const mechanism = (() => {
      if (mapping.protocol === 'tcp') {
        return 'tcp_natmap';
      }
      return 'udp_stun';
    })();
    const sourceEligibility = (() => {
      if (mapping.protocol === 'tcp') {
        return classifyTcpNatmapEndpointSource(mapping);
      }
      return classifyStunEndpointSource(mapping);
    })();
    const disabledReasonCode = (() => {
      if (sourceType === 'port_forward_ip4p' && mapping.protocol !== 'tcp') {
        return 'IP4P_REQUIRES_TCP_NATMAP';
      }
      if (group) {
        return sourceEligibility.disabledReasonCode;
      }
      return 'SOURCE_NOT_FOUND';
    })();
    const eligible = disabledReasonCode === null;
    const leaseValid =
      isIP(mapping.currentPublicIpv4 || '') === 4 &&
      isValidPort(mapping.currentPublicPort) &&
      !!mapping.currentValidUntil &&
      new Date(mapping.currentValidUntil).getTime() > Date.now();
    const sourceUsable = eligible && leaseValid;
    const ip4pAddress = encodeIp4pAddress(
      mapping.currentPublicIpv4,
      mapping.currentPublicPort,
    );
    return {
      currentAddress: (() => {
        if (sourceUsable) {
          if (sourceType === 'port_forward_ip4p') {
            return ip4pAddress;
          }
          return mapping.currentPublicIpv4 || null;
        }
        return null;
      })(),
      ...(() => {
        if (sourceUsable) {
          return { currentPort: mapping.currentPublicPort as number };
        }
        return {};
      })(),
      disabledReasonCode,
      eligible,
      externalPort: mapping.externalPort,
      groupId: String(mapping.groupId),
      id: String(mapping.id),
      mechanism,
      name: `${group?.name || mapping.name} / ${(() => {
        if (sourceType === 'port_forward_ip4p') {
          return 'TCP NATMap IP4P';
        }
        if (mechanism === 'tcp_natmap') {
          return 'TCP NATMap';
        }
        return 'UDP Keeper';
      })()}`,
      observedAt: (() => {
        if (sourceUsable) {
          return mapping.currentObservedAt || null;
        }
        return null;
      })(),
      protocol: mapping.protocol,
      sourceType,
      validUntil: (() => {
        if (sourceUsable) {
          return mapping.currentValidUntil || null;
        }
        return null;
      })(),
    };
  }

  /**
   * 根据`id`处理并返回缺失的配置键。
   * @param id - 决定并返回缺失的配置键内容、边界或目标的 `id` 值。
   * @param sourceType - 保留已删除来源原本的 IPv4 或 IP4P 类型，避免管理端错误降级显示。
   * @returns 包含 `currentAddress`、`disabledReasonCode`、`eligible`、`id`、`name` 字段的并返回缺失的配置键；无法解析或未命中时为 `null`。
   */
  private missingPortForwardSourceOption(
    id: string,
    sourceType: 'port_forward_ip4p' | 'port_forward_ipv4',
  ): NetworkDdnsSourceOption {
    return {
      currentAddress: null,
      disabledReasonCode: 'SOURCE_NOT_FOUND',
      eligible: false,
      id,
      name: '端口转发来源已删除',
      observedAt: null,
      sourceType,
      validUntil: null,
    };
  }

  /**
   * 把来源状态投影为AgentIPv6来源选项。
   * @returns 包含 `currentAddress`、`disabledReasonCode`、`eligible`、`id`、`name` 字段的把来源状态投影为AgentIPv6来源选项；无法解析或未命中时为 `null`。
   */
  private async agentIpv6SourceOption(): Promise<NetworkDdnsSourceOption> {
    const state = await this.stateRepository.findOne({
      where: { agentId: this.agentId() },
    });
    let disabledReasonCode: null | string = null;
    const address = normalizeGlobalIpv6(state?.currentPublicIpv6);
    if (!state?.online) {
      disabledReasonCode = 'AGENT_OFFLINE';
    } else if (!address || !state.currentIpv6ObservedAt) {
      disabledReasonCode = 'IPV6_UNAVAILABLE';
    } else if (
      Date.now() - new Date(state.currentIpv6ObservedAt).getTime() >
      this.agentIpv6MaxAgeMs()
    ) {
      disabledReasonCode = 'IPV6_STALE';
    }
    return {
      currentAddress: (() => {
        if (disabledReasonCode === null) {
          return address;
        }
        return null;
      })(),
      disabledReasonCode,
      eligible: disabledReasonCode === null,
      id: 'agent-ipv6',
      name: 'Agent 公网 IPv6',
      observedAt: state?.currentIpv6ObservedAt || null,
      sourceType: 'agent_ipv6',
      validUntil: (() => {
        if (state?.currentIpv6ObservedAt) {
          return new KtDateTime(
            new Date(state.currentIpv6ObservedAt).getTime() +
              this.agentIpv6MaxAgeMs(),
          );
        }
        return null;
      })(),
    };
  }

  /**
   * 将`input`规范为创建输入，使等价输入得到一致表示；先通过 `assertBindingSource` 校验输入边界。
   * @param input - 用于创建输入的结构化输入，包含 `portForwardId` 字段。
   * @returns 创建输入。
   */
  private async normalizeCreateInput(input: NetworkDdnsRecordInput) {
    const normalized = this.normalizeInput({
      ...input,
      portForwardId: input?.portForwardId,
    });
    await this.assertBindingSource(
      normalized.recordType,
      normalized.sourceType,
      normalized.portForwardId,
    );
    return normalized;
  }

  /**
   * 将`record`、`input`规范为更新输入，使等价输入得到一致表示；先通过 `assertBindingSource` 校验输入边界。
   * @param record - 用于更新输入的领域对象，包含 `recordType`、`domain`、`enabled`、`name` 字段。
   * @param input - 用于更新输入的结构化输入，包含 `recordType`、`domain`、`enabled`、`name` 字段。
   * @returns 更新输入。
   */
  private async normalizeUpdateInput(
    record: NetworkDdnsRecord,
    input: NetworkDdnsRecordUpdateInput,
  ) {
    const recordType = input.recordType || record.recordType;
    const sourceType = input.sourceType || record.sourceType;
    const normalized = this.normalizeInput({
      domain: input.domain ?? record.domain,
      enabled: input.enabled ?? record.enabled,
      name: input.name ?? record.name,
      portForwardId: (() => {
        if (sourceType === 'agent_ipv6') {
          return undefined;
        }
        return input.portForwardId ?? record.portForwardId ?? undefined;
      })(),
      recordType,
      remark: input.remark ?? record.remark ?? undefined,
      sourceType,
      subDomain: input.subDomain ?? record.subDomain,
    });
    const sourceIdentityChanged =
      record.recordType !== normalized.recordType ||
      record.sourceType !== normalized.sourceType ||
      (record.portForwardId || null) !== normalized.portForwardId;
    if (normalized.enabled || sourceIdentityChanged) {
      await this.assertBindingSource(
        normalized.recordType,
        normalized.sourceType,
        normalized.portForwardId,
      );
    } else {
      this.assertBindingShape(
        normalized.recordType,
        normalized.sourceType,
        normalized.portForwardId,
      );
    }
    return normalized;
  }

  /**
   * 将`input`规范为输入，使等价输入得到一致表示；先通过 `assertBindingShape` 校验输入边界。
   * @param input - 用于输入的结构化输入，包含 `recordType`、`sourceType`、`enabled`、`name` 字段。
   * @returns 包含 `activeKey`、`domain`、`enabled`、`fqdn`、`name` 字段的输入。
   */
  private normalizeInput(input: NetworkDdnsRecordInput) {
    if (input.recordType !== 'A' && input.recordType !== 'AAAA') {
      throwVbenError('DDNS 记录类型无效', HttpStatus.BAD_REQUEST);
    }
    if (
      input.sourceType !== 'port_forward_ipv4' &&
      input.sourceType !== 'port_forward_ip4p' &&
      input.sourceType !== 'agent_ipv6'
    ) {
      throwVbenError('DDNS 来源类型无效', HttpStatus.BAD_REQUEST);
    }
    if (typeof input.enabled !== 'boolean') {
      throwVbenError('DDNS 启用状态无效', HttpStatus.BAD_REQUEST);
    }
    const name = this.normalizeName(input.name);
    const remark = this.normalizeRemark(input.remark);
    const domain = this.normalizeDomain(input.domain);
    const subDomain = this.normalizeSubDomain(input.subDomain);
    const fqdn = (() => {
      if (subDomain === '@') {
        return domain;
      }
      return `${subDomain}.${domain}`;
    })();
    if (fqdn.length > 253) {
      throwVbenError('DDNS 完整域名过长', HttpStatus.BAD_REQUEST);
    }
    const portForwardId = (() => {
      if (
        typeof input.portForwardId === 'string' &&
        input.portForwardId.trim()
      ) {
        return input.portForwardId.trim();
      }
      return null;
    })();
    this.assertBindingShape(input.recordType, input.sourceType, portForwardId);
    return {
      activeKey: `${input.recordType.toLowerCase()}:${fqdn}`,
      domain,
      enabled: input.enabled,
      fqdn,
      name,
      portForwardId,
      recordType: input.recordType,
      remark,
      sourceType: input.sourceType,
      subDomain,
    };
  }

  /**
   * 校验`recordType`、`sourceType`、`portForwardId`是否满足绑定结构约束，并拒绝不合法输入。
   * @param recordType - 决定绑定结构内容、边界或目标的 `recordType` 值。
   * @param sourceType - 决定绑定结构内容、边界或目标的 `sourceType` 值。
   * @param portForwardId - 用于精确定位端口Forward的标识。
   */
  private assertBindingShape(
    recordType: NetworkDdnsRecordType,
    sourceType: string,
    portForwardId: null | string,
  ): void {
    if (
      recordType === 'A' &&
      (sourceType !== 'port_forward_ipv4' ||
        !portForwardId ||
        !/^\d{1,24}$/.test(portForwardId))
    ) {
      throwVbenError(
        'A 记录必须选择有效的 IPv4 端口来源',
        HttpStatus.BAD_REQUEST,
      );
    }
    const agentIpv6Shape =
      recordType === 'AAAA' &&
      sourceType === 'agent_ipv6' &&
      portForwardId === null;
    const ip4pShape =
      recordType === 'AAAA' &&
      sourceType === 'port_forward_ip4p' &&
      !!portForwardId &&
      /^\d{1,24}$/.test(portForwardId);
    if (recordType === 'AAAA' && !agentIpv6Shape && !ip4pShape) {
      throwVbenError(
        'AAAA 记录必须使用 Agent IPv6，或选择有效的 TCP NATMap IP4P 来源',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 校验`recordType`、`sourceType`、`portForwardId`是否满足绑定来源约束，并拒绝不合法输入；先通过 `assertBindingShape` 校验输入边界。
   * @param recordType - 决定绑定来源内容、边界或目标的 `recordType` 值。
   * @param sourceType - 决定绑定来源内容、边界或目标的 `sourceType` 值。
   * @param portForwardId - 用于精确定位端口Forward的标识。
   */
  private async assertBindingSource(
    recordType: NetworkDdnsRecordType,
    sourceType: string,
    portForwardId: null | string,
  ): Promise<void> {
    this.assertBindingShape(recordType, sourceType, portForwardId);
    if (sourceType === 'agent_ipv6') return;
    const mapping = await this.mappingRepository.findOne({
      where: { id: portForwardId as string, isDeleted: false },
    });
    const group = await (async () => {
      if (mapping) {
        return await this.groupRepository.findOne({
          where: { id: mapping.groupId, isDeleted: false },
        });
      }
      return null;
    })();
    const sourceEligible = (() => {
      if (sourceType === 'port_forward_ip4p') {
        return (
          mapping?.protocol === 'tcp' &&
          classifyTcpNatmapEndpointSource(mapping).eligible
        );
      }
      if (mapping?.protocol === 'tcp') {
        return classifyTcpNatmapEndpointSource(mapping).eligible;
      }
      if (mapping) {
        return classifyStunEndpointSource(mapping).eligible;
      }
      return false;
    })();
    if (!mapping || !group || !sourceEligible) {
      if (sourceType === 'port_forward_ip4p') {
        throwVbenError(
          'IP4P AAAA 来源必须是已启用的 TCP NATMap 通道',
          HttpStatus.BAD_REQUEST,
        );
      }
      throwVbenError(
        'A 记录来源必须是已启用的 UDP Keeper 或 TCP NATMap 通道',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 将`value`规范为域名，使等价输入得到一致表示。
   * @param value - 待转换为域名的原始值。
   * @returns 域名。
   */
  private normalizeDomain(value: string): string {
    const normalized = (() => {
      if (typeof value === 'string') {
        return value.trim().toLowerCase().replace(/\.$/, '');
      }
      return '';
    })();
    if (!isValidDnsName(normalized, true)) {
      throwVbenError('DDNS 主域名无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 将`value`规范为子域名，使等价输入得到一致表示。
   * @param value - 待转换为子域名的原始值。
   * @returns 子域名。
   */
  private normalizeSubDomain(value: string): string {
    const normalized = (() => {
      if (typeof value === 'string') {
        return value.trim().toLowerCase();
      }
      return '';
    })();
    if (normalized !== '@' && !isValidDnsName(normalized, false)) {
      throwVbenError('DDNS 主机记录无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 将`value`规范为名称，使等价输入得到一致表示。
   * @param value - 待转换为名称的原始值。
   * @returns 名称。
   */
  private normalizeName(value: string): string {
    const normalized = (() => {
      if (typeof value === 'string') {
        return value.trim();
      }
      return '';
    })();
    if (!normalized || normalized.length > 100) {
      throwVbenError('DDNS 名称长度无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  /**
   * 将`value`规范为备注，使等价输入得到一致表示。
   * @param value - 待转换为备注的原始值；为空时采用 `value === null` 作为兜底。
   * @returns 规范化后的备注；主值为空时采用 `null` 兜底；无法解析或未命中时为 `null`。
   */
  private normalizeRemark(value?: string): null | string {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim().length > 500) {
      throwVbenError('DDNS 备注长度无效', HttpStatus.BAD_REQUEST);
    }
    return value.trim() || null;
  }

  /**
   * 将`record`转换为序列化记录。
   * @param record - 用于序列化记录的领域对象，包含 `subDomain`、`domain`、`recordType`、`syncStatus` 字段。
   * @returns 包含 `appliedAddress`、`domain`、`enabled`、`fqdn`、`id` 字段的序列化记录。
   */
  private async serializeRecord(record: NetworkDdnsRecord) {
    const source = await this.resolveRecordSource(record);
    const fqdn = (() => {
      if (record.subDomain === '@') {
        return record.domain;
      }
      return `${record.subDomain}.${record.domain}`;
    })();
    const accessEndpoint = (() => {
      if (
        record.recordType === 'A' &&
        record.syncStatus === 'synced' &&
        !!record.appliedAddress &&
        record.appliedAddress === source.currentAddress &&
        isValidPort(source.currentPort)
      ) {
        return `${fqdn}:${source.currentPort}`;
      }
      return null;
    })();
    return {
      ...(() => {
        if (accessEndpoint) {
          return { accessEndpoint };
        }
        return {};
      })(),
      appliedAddress: record.appliedAddress || null,
      domain: record.domain,
      enabled: record.enabled,
      fqdn,
      id: String(record.id),
      lastErrorCode: record.lastErrorCode || null,
      lastErrorMessage: record.lastErrorMessage || null,
      lastSyncedAt: record.lastSyncedAt || null,
      name: record.name,
      nextRetryAt: record.nextRetryAt || null,
      ...(() => {
        if (record.sourceType !== 'agent_ipv6') {
          return { portForwardId: record.portForwardId || null };
        }
        return {};
      })(),
      recordType: record.recordType,
      remark: record.remark || null,
      retryCount: record.retryCount || 0,
      source,
      sourceAddress: record.sourceAddress || null,
      sourceType: record.sourceType,
      subDomain: record.subDomain,
      syncStatus: record.syncStatus,
      updateTime: record.updateTime,
    };
  }

  /**
   * 按`id`读取启用的记录；从 `recordRepository.findOne` 读取启用的记录。
   * @param id - 决定启用的记录内容、边界或目标的 `id` 值。
   * @returns 启用的记录。
   */
  private async findActiveRecord(id: string): Promise<NetworkDdnsRecord> {
    const record = await this.recordRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!record) {
      throwVbenError('DDNS 自动更新配置不存在', HttpStatus.NOT_FOUND);
    }
    return record;
  }

  /**
   * 按`activeKey`读取按启用的键；从 `recordRepository.findOne` 读取按启用的键。
   * @param activeKey - 用于读取或更新按启用的键的稳定键。
   * @returns 按启用的键。
   */
  private findByActiveKey(
    activeKey: string,
  ): Promise<NetworkDdnsRecord | null> {
    return this.recordRepository.findOne({ where: { activeKey } });
  }

  /**
   * 校验`activeKey`是否满足启用的键可用约束，并拒绝不合法输入；从 `findByActiveKey` 读取启用的键可用。
   * @param activeKey - 用于读取或更新启用的键可用的稳定键。
   */
  private async assertActiveKeyAvailable(activeKey: string): Promise<void> {
    if (await this.findByActiveKey(activeKey)) {
      throwVbenError('同类型完整域名已存在自动更新配置', HttpStatus.CONFLICT);
    }
  }

  /**
   * 根据`record`、`beforeSemantic`更新携带语义事件；把变更持久化到当前存储（`recordRepository.save`）。
   * @param record - 决定携带语义事件内容、边界或目标的 `record` 值。
   * @param beforeSemantic - 决定携带语义事件内容、边界或目标的 `beforeSemantic` 值。
   */
  private async saveWithSemanticEvent(
    record: NetworkDdnsRecord,
    beforeSemantic: string,
  ): Promise<void> {
    await this.recordRepository.save(record);
    if (this.semanticFingerprint(record) !== beforeSemantic) {
      this.publishSemanticChange();
    }
  }

  /**
   * 根据`record`、`beforeSemantic`、`expectedProviderRecordId`更新核对状态；当 `!Number.isFinite(previousTimestamp)` 成立时返回 `false`。
   * @param record - 用于核对状态的领域对象，包含 `updateTime`、`id`、`activeKey`、`domain` 字段。
   * @param beforeSemantic - 决定核对状态内容、边界或目标的 `beforeSemantic` 值。
   * @param expectedProviderRecordId - 用于精确定位expected数据提供器记录的标识；省略时默认采用 `record.providerRecordId || null`。
   * @returns 满足核对状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async saveReconcileState(
    record: NetworkDdnsRecord,
    beforeSemantic: string,
    expectedProviderRecordId: null | string = record.providerRecordId || null,
  ): Promise<boolean> {
    const expectedUpdateTime = record.updateTime;
    const previousTimestamp = new Date(expectedUpdateTime).getTime();
    if (!Number.isFinite(previousTimestamp)) {
      this.enqueueInternalReconcile(String(record.id));
      return false;
    }
    const updateTime = new KtDateTime(
      Math.max(Date.now(), previousTimestamp + 1),
    );
    const result = await this.recordRepository.update(
      {
        activeKey: record.activeKey as string,
        domain: record.domain,
        enabled: true,
        id: String(record.id),
        isDeleted: false,
        portForwardId: record.portForwardId || IsNull(),
        providerRecordId: expectedProviderRecordId || IsNull(),
        recordType: record.recordType,
        sourceType: record.sourceType,
        subDomain: record.subDomain,
        updateTime: expectedUpdateTime,
      },
      {
        appliedAddress: record.appliedAddress || null,
        lastAttemptAt: record.lastAttemptAt || null,
        lastErrorCode: record.lastErrorCode || null,
        lastErrorMessage: record.lastErrorMessage || null,
        lastSyncedAt: record.lastSyncedAt || null,
        nextRetryAt: record.nextRetryAt || null,
        providerRecordId: record.providerRecordId || null,
        retryCount: record.retryCount,
        sourceAddress: record.sourceAddress || null,
        syncStatus: record.syncStatus,
        updateTime,
      },
    );
    if (result.affected !== 1) {
      this.enqueueInternalReconcile(String(record.id));
      return false;
    }
    record.updateTime = updateTime;
    if (this.semanticFingerprint(record) !== beforeSemantic) {
      this.publishSemanticChange();
    }
    return true;
  }

  /**
   * 发布语义变更；通过 `eventStream.publishCommitted` 发布领域状态。
   */
  private publishSemanticChange(): void {
    try {
      this.eventStream.publishCommitted('ddns');
    } catch {
      // Persistence is authoritative; a later HTTP snapshot repairs missed SSE.
    }
  }

  /**
   * 记录 DDNS 同步完成后系统消息投递唤醒失败的告警，不改变同步结果。
   */
  private loggerWarnDeliveryWake(): void {
    this.logger.warn('System message delivery wake failed after DDNS sync');
  }

  /**
   * 根据`record`处理语义指纹。
   * @param record - 用于语义指纹的领域对象，包含 `appliedAddress`、`domain`、`enabled`、`isDeleted` 字段。
   * @returns 语义指纹；无法解析或未命中时为 `null`。
   */
  private semanticFingerprint(record: NetworkDdnsRecord): string {
    return JSON.stringify([
      record.appliedAddress || null,
      record.domain,
      record.enabled,
      record.isDeleted,
      record.lastErrorCode || null,
      record.lastErrorMessage || null,
      record.name,
      record.portForwardId || null,
      record.recordType,
      record.remark || null,
      record.sourceAddress || null,
      record.sourceType,
      record.subDomain,
      record.syncStatus,
    ]);
  }

  /**
   * 将影响 DDNS 核对身份的域名、开关、来源、记录类型与提供商记录标识序列化为稳定比较文本。
   * @param record - 用于身份的领域对象，包含 `domain`、`enabled`、`isDeleted`、`portForwardId` 字段。
   * @returns 身份；无法解析或未命中时为 `null`。
   */
  private reconcileIdentity(record: NetworkDdnsRecord): string {
    return JSON.stringify([
      record.domain,
      record.enabled,
      record.isDeleted,
      record.portForwardId || null,
      record.providerRecordId || null,
      record.recordType,
      record.sourceType,
      record.subDomain,
    ]);
  }

  /**
   * 标记待处理，并会更新 `record.lastErrorCode`、`record.lastErrorMessage`、`record.nextRetryAt`。
   * @param record - 用于等待状态的领域对象，包含 `lastErrorCode`、`lastErrorMessage`、`nextRetryAt`、`retryCount` 字段。
   */
  private markPending(record: NetworkDdnsRecord): void {
    record.lastErrorCode = null;
    record.lastErrorMessage = null;
    record.nextRetryAt = null;
    record.retryCount = 0;
    record.syncStatus = 'pending';
  }

  /**
   * 标记禁用，并会更新 `record.lastErrorCode`、`record.lastErrorMessage`、`record.nextRetryAt`。
   * @param record - 用于Disabled的领域对象，包含 `lastErrorCode`、`lastErrorMessage`、`nextRetryAt`、`retryCount` 字段。
   */
  private markDisabled(record: NetworkDdnsRecord): void {
    record.lastErrorCode = null;
    record.lastErrorMessage = null;
    record.nextRetryAt = null;
    record.retryCount = 0;
    record.syncStatus = 'disabled';
  }

  /**
   * 根据`retryCount`处理延迟毫秒。
   * @param retryCount - 限制延迟毫秒数量、尺寸、等级或重试边界的数值。
   * @returns 延迟毫秒。
   */
  private retryDelayMs(retryCount: number): number {
    return Math.min(
      RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
      RETRY_MAX_DELAY_MS,
    );
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
   * 按边界约束计算AgentIPv6最大存活时长毫秒。
   * @returns 按边界约束计算AgentIPv6最大存活时长毫秒。
   */
  private agentIpv6MaxAgeMs(): number {
    return this.durationConfig(
      'NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS',
      DEFAULT_AGENT_IPV6_MAX_AGE_MS,
    );
  }

  /**
   * 根据当前运行态处理间隔毫秒。
   * @returns 间隔毫秒。
   */
  private reconcileIntervalMs(): number {
    return this.durationConfig(
      'NETWORK_DDNS_RECONCILE_INTERVAL_MS',
      DEFAULT_RECONCILE_INTERVAL_MS,
    );
  }

  /**
   * 从输入或当前状态提取时长配置。
   * @param key - 用于读取或更新duration配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns duration配置。
   */
  private durationConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<unknown>(key));
    if (Number.isFinite(value) && value >= 1_000 && value <= 86_400_000) {
      return Math.floor(value);
    }
    return fallback;
  }

  /**
   * 要求 DDNS 配置标识由 1 至 24 位十进制数字组成，避免非法 ID 进入查询与变更流程。
   * @param id - 待校验的 DDNS 配置标识。
   */
  private assertId(id: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError('DDNS 配置 ID 无效', HttpStatus.BAD_REQUEST);
    }
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

/**
 * 根据`value`、`requireMultipleLabels`与当前约束判定有效DNS名称。
 * @param value - 待判定是否满足有效DNS名称约束的候选值。
 * @param requireMultipleLabels - 决定是否启用“MultipleLabels”分支的布尔选项。
 * @returns 满足有效DNS名称约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isValidDnsName(
  value: string,
  requireMultipleLabels: boolean,
): boolean {
  if (!value || value.length > 253) return false;
  const labels = value.split('.');
  if (requireMultipleLabels && labels.length < 2) return false;
  return labels.every(
    (label) => label.length <= 63 && DNS_LABEL_PATTERN.test(label),
  );
}

/**
 * 根据`value`与当前约束判定有效端口。
 * @param value - 待判定是否满足有效端口约束的候选值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
 * @returns 满足有效端口约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isValidPort(value?: null | number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65_535
  );
}

/**
 * 把 NATMap 当前公网 IPv4 与动态端口编码为官方 IP4P AAAA 文本，非法或不完整端点返回空值。
 * @param publicIpv4 - NATMap 当前发布的规范公网 IPv4。
 * @param publicPort - NATMap 当前发布的动态公网 TCP 端口。
 * @returns `2001::端口:IPv4高两字节:IPv4低两字节` 的零填充文本；端点无效时为 `null`。
 */
function encodeIp4pAddress(
  publicIpv4?: null | string,
  publicPort?: null | number,
): null | string {
  if (!publicIpv4 || isIP(publicIpv4) !== 4 || !isValidPort(publicPort)) {
    return null;
  }
  const octets = publicIpv4.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  const portHex = publicPort.toString(16).padStart(4, '0');
  const addressHigh = ((octets[0] << 8) | octets[1])
    .toString(16)
    .padStart(4, '0');
  const addressLow = ((octets[2] << 8) | octets[3])
    .toString(16)
    .padStart(4, '0');
  return `2001::${portHex}:${addressHigh}:${addressLow}`;
}

/**
 * 将`value`规范为全局IPv6，使等价输入得到一致表示；当 `Number.isInteger(firstHextet) && firstHextet >= 0x2000 && fir…` 成立时返回 `normalized`。
 * @param value - 待转换为全局IPv6的原始值；为空时采用 `isIP(value) !== 6` 作为兜底。
 * @returns 全局IPv6；无法解析或未命中时为 `null`。
 */
function normalizeGlobalIpv6(value?: null | string): null | string {
  if (!value || isIP(value) !== 6) return null;
  let normalized: string;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    normalized = hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  if (
    Number.isInteger(firstHextet) &&
    firstHextet >= 0x2000 &&
    firstHextet <= 0x3fff
  ) {
    return normalized;
  }
  return null;
}

/**
 * 根据`left`、`right`处理比较十进制标识列表。
 * @param left - 用于比较十进制标识列表的领域对象，包含 `length`、`localeCompare` 字段。
 * @param right - 用于比较十进制标识列表的领域对象，包含 `length` 字段。
 * @returns 比较十进制标识列表。
 */
function compareDecimalIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}
