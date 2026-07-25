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
} from '@/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { NetworkAgentState } from './network-agent-state.entity';
import { NetworkDdnsRecord } from './network-ddns.entity';
import {
  NetworkDnsPodClient,
  NetworkDnsPodClientError,
} from './network-dnspod.client';
import { NetworkManagementEventStreamService } from './network-management-event-stream.service';
import { NetworkPortForward } from './network-management.entity';
import { classifyStunEndpointSource } from './network-source-eligibility';
import type {
  NetworkDdnsListQuery,
  NetworkDdnsRecordInput,
  NetworkDdnsRecordType,
  NetworkDdnsRecordUpdateInput,
  NetworkDdnsSourceOption,
} from './network-management.types';

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

  async sourceOptions(query: {
    recordType: NetworkDdnsRecordType;
  }): Promise<NetworkDdnsSourceOption[]> {
    if (query.recordType === 'AAAA') {
      return [await this.agentIpv6SourceOption()];
    }
    if (query.recordType !== 'A') {
      throwVbenError('DDNS 记录类型无效', HttpStatus.BAD_REQUEST);
    }
    const mappings = await this.mappingRepository.find({
      order: { id: 'ASC', name: 'ASC' },
      where: { isDeleted: false },
    });
    return mappings.map((mapping) => this.portForwardSourceOption(mapping));
  }

  getProviderStatus() {
    return this.dnsPodClient.getStatus();
  }

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
      syncStatus: normalized.enabled ? 'pending' : 'disabled',
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

  private ensureReconcileWorker(): void {
    if (this.reconcileWorker || this.destroyed) return;
    this.reconcileWorker = this.drainReconcileRequests().finally(() => {
      this.reconcileWorker = null;
      if (this.reconcileRequests.length > 0 && !this.destroyed) {
        this.ensureReconcileWorker();
      }
    });
  }

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

  private async reconcileRecord(id: string, force: boolean): Promise<void> {
    await this.withRecordMutation(id, () =>
      this.reconcileRecordLocked(id, force),
    );
  }

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
        .notifyDdnsSynced({
          appliedAddress: current.appliedAddress,
          ddnsRecordId: String(current.id),
        })
        .catch(() => this.loggerWarnDeliveryWake());
    }
  }

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
    current.lastErrorCode = source.currentAddress ? null : 'source_unavailable';
    current.lastErrorMessage = source.currentAddress
      ? null
      : 'DDNS source is unavailable';
    current.nextRetryAt = null;
    current.retryCount = 0;
    current.sourceAddress = source.currentAddress;
    current.syncStatus = source.currentAddress ? 'pending' : 'waiting_source';
    if (await this.saveReconcileState(current, beforeSemantic)) {
      this.enqueueInternalReconcile(id);
    }
    return null;
  }

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
    record.nextRetryAt = shouldRetry
      ? new KtDateTime(Date.now() + this.retryDelayMs(retryCount))
      : null;
    record.retryCount = retryCount;
    record.syncStatus = 'failed';
    await this.saveReconcileState(record, beforeSemantic);
  }

  private safeProviderError(error: unknown): SafeProviderError {
    if (error instanceof NetworkDnsPodClientError) {
      const passthroughCode = /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : null;
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
      record.recordType === 'A' &&
      record.sourceType === 'port_forward_ipv4' &&
      record.portForwardId
    ) {
      const mapping = await this.mappingRepository.findOne({
        where: { id: record.portForwardId, isDeleted: false },
      });
      if (mapping) return this.portForwardSourceOption(mapping);
      return this.missingPortForwardSourceOption(record.portForwardId);
    }
    return this.missingPortForwardSourceOption(
      record.portForwardId || 'invalid',
    );
  }

  private portForwardSourceOption(
    mapping: NetworkPortForward,
  ): NetworkDdnsSourceOption {
    const { disabledReasonCode, eligible } =
      classifyStunEndpointSource(mapping);
    const leaseValid =
      isIP(mapping.currentPublicIpv4 || '') === 4 &&
      !!mapping.currentValidUntil &&
      new Date(mapping.currentValidUntil).getTime() > Date.now();
    const sourceUsable = eligible && leaseValid;
    return {
      currentAddress: sourceUsable ? mapping.currentPublicIpv4 || null : null,
      disabledReasonCode,
      eligible: disabledReasonCode === null,
      externalPort: mapping.externalPort,
      id: String(mapping.id),
      name: mapping.name,
      observedAt: sourceUsable ? mapping.currentObservedAt || null : null,
      protocol: mapping.protocol,
      sourceType: 'port_forward_ipv4',
      validUntil: sourceUsable ? mapping.currentValidUntil || null : null,
    };
  }

  private missingPortForwardSourceOption(id: string): NetworkDdnsSourceOption {
    return {
      currentAddress: null,
      disabledReasonCode: 'SOURCE_NOT_FOUND',
      eligible: false,
      id,
      name: '端口转发来源已删除',
      observedAt: null,
      sourceType: 'port_forward_ipv4',
      validUntil: null,
    };
  }

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
      currentAddress: disabledReasonCode === null ? address : null,
      disabledReasonCode,
      eligible: disabledReasonCode === null,
      id: 'agent-ipv6',
      name: 'Agent 公网 IPv6',
      observedAt: state?.currentIpv6ObservedAt || null,
      sourceType: 'agent_ipv6',
      validUntil: state?.currentIpv6ObservedAt
        ? new KtDateTime(
            new Date(state.currentIpv6ObservedAt).getTime() +
              this.agentIpv6MaxAgeMs(),
          )
        : null,
    };
  }

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

  private async normalizeUpdateInput(
    record: NetworkDdnsRecord,
    input: NetworkDdnsRecordUpdateInput,
  ) {
    const recordType = input.recordType || record.recordType;
    const normalized = this.normalizeInput({
      domain: input.domain ?? record.domain,
      enabled: input.enabled ?? record.enabled,
      name: input.name ?? record.name,
      portForwardId:
        recordType === 'AAAA'
          ? input.portForwardId
          : (input.portForwardId ?? record.portForwardId ?? undefined),
      recordType,
      remark: input.remark ?? record.remark ?? undefined,
      sourceType: input.sourceType || record.sourceType,
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

  private normalizeInput(input: NetworkDdnsRecordInput) {
    if (input.recordType !== 'A' && input.recordType !== 'AAAA') {
      throwVbenError('DDNS 记录类型无效', HttpStatus.BAD_REQUEST);
    }
    if (
      input.sourceType !== 'port_forward_ipv4' &&
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
    const fqdn = subDomain === '@' ? domain : `${subDomain}.${domain}`;
    if (fqdn.length > 253) {
      throwVbenError('DDNS 完整域名过长', HttpStatus.BAD_REQUEST);
    }
    const portForwardId =
      typeof input.portForwardId === 'string' && input.portForwardId.trim()
        ? input.portForwardId.trim()
        : null;
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
    if (
      recordType === 'AAAA' &&
      (sourceType !== 'agent_ipv6' || portForwardId !== null)
    ) {
      throwVbenError(
        'AAAA 记录必须使用 Agent IPv6 且不能绑定端口',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertBindingSource(
    recordType: NetworkDdnsRecordType,
    sourceType: string,
    portForwardId: null | string,
  ): Promise<void> {
    this.assertBindingShape(recordType, sourceType, portForwardId);
    if (recordType === 'AAAA') return;
    const mapping = await this.mappingRepository.findOne({
      where: { id: portForwardId as string, isDeleted: false },
    });
    if (!mapping || !classifyStunEndpointSource(mapping).eligible) {
      throwVbenError(
        'A 记录来源必须是已启用 Keeper 的同端口 UDP 转发',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private normalizeDomain(value: string): string {
    const normalized =
      typeof value === 'string'
        ? value.trim().toLowerCase().replace(/\.$/, '')
        : '';
    if (!isValidDnsName(normalized, true)) {
      throwVbenError('DDNS 主域名无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private normalizeSubDomain(value: string): string {
    const normalized =
      typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized !== '@' && !isValidDnsName(normalized, false)) {
      throwVbenError('DDNS 主机记录无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private normalizeName(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 100) {
      throwVbenError('DDNS 名称长度无效', HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private normalizeRemark(value?: string): null | string {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim().length > 500) {
      throwVbenError('DDNS 备注长度无效', HttpStatus.BAD_REQUEST);
    }
    return value.trim() || null;
  }

  private async serializeRecord(record: NetworkDdnsRecord) {
    const source = await this.resolveRecordSource(record);
    return {
      appliedAddress: record.appliedAddress || null,
      domain: record.domain,
      enabled: record.enabled,
      fqdn:
        record.subDomain === '@'
          ? record.domain
          : `${record.subDomain}.${record.domain}`,
      id: String(record.id),
      lastErrorCode: record.lastErrorCode || null,
      lastErrorMessage: record.lastErrorMessage || null,
      lastSyncedAt: record.lastSyncedAt || null,
      name: record.name,
      nextRetryAt: record.nextRetryAt || null,
      ...(record.recordType === 'A'
        ? { portForwardId: record.portForwardId || null }
        : {}),
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

  private async findActiveRecord(id: string): Promise<NetworkDdnsRecord> {
    const record = await this.recordRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!record) {
      throwVbenError('DDNS 自动更新配置不存在', HttpStatus.NOT_FOUND);
    }
    return record;
  }

  private findByActiveKey(
    activeKey: string,
  ): Promise<NetworkDdnsRecord | null> {
    return this.recordRepository.findOne({ where: { activeKey } });
  }

  private async assertActiveKeyAvailable(activeKey: string): Promise<void> {
    if (await this.findByActiveKey(activeKey)) {
      throwVbenError('同类型完整域名已存在自动更新配置', HttpStatus.CONFLICT);
    }
  }

  private async saveWithSemanticEvent(
    record: NetworkDdnsRecord,
    beforeSemantic: string,
  ): Promise<void> {
    await this.recordRepository.save(record);
    if (this.semanticFingerprint(record) !== beforeSemantic) {
      this.publishSemanticChange();
    }
  }

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

  private publishSemanticChange(): void {
    try {
      this.eventStream.publishCommitted('ddns');
    } catch {
      // Persistence is authoritative; a later HTTP snapshot repairs missed SSE.
    }
  }

  private loggerWarnDeliveryWake(): void {
    this.logger.warn('System message delivery wake failed after DDNS sync');
  }

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

  private markPending(record: NetworkDdnsRecord): void {
    record.lastErrorCode = null;
    record.lastErrorMessage = null;
    record.nextRetryAt = null;
    record.retryCount = 0;
    record.syncStatus = 'pending';
  }

  private markDisabled(record: NetworkDdnsRecord): void {
    record.lastErrorCode = null;
    record.lastErrorMessage = null;
    record.nextRetryAt = null;
    record.retryCount = 0;
    record.syncStatus = 'disabled';
  }

  private retryDelayMs(retryCount: number): number {
    return Math.min(
      RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
      RETRY_MAX_DELAY_MS,
    );
  }

  private agentId(): string {
    return (
      this.configService.get<string>('NETWORK_AGENT_ID') || DEFAULT_AGENT_ID
    );
  }

  private agentIpv6MaxAgeMs(): number {
    return this.durationConfig(
      'NETWORK_DDNS_AGENT_IPV6_MAX_AGE_MS',
      DEFAULT_AGENT_IPV6_MAX_AGE_MS,
    );
  }

  private reconcileIntervalMs(): number {
    return this.durationConfig(
      'NETWORK_DDNS_RECONCILE_INTERVAL_MS',
      DEFAULT_RECONCILE_INTERVAL_MS,
    );
  }

  private durationConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<unknown>(key));
    return Number.isFinite(value) && value >= 1_000 && value <= 86_400_000
      ? Math.floor(value)
      : fallback;
  }

  private assertId(id: string): void {
    if (!/^\d{1,24}$/.test(id)) {
      throwVbenError('DDNS 配置 ID 无效', HttpStatus.BAD_REQUEST);
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; errno?: unknown };
    return record.code === 'ER_DUP_ENTRY' || record.errno === 1062;
  }
}

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
  return Number.isInteger(firstHextet) &&
    firstHextet >= 0x2000 &&
    firstHextet <= 0x3fff
    ? normalized
    : null;
}

function compareDecimalIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}
