import { createHash, randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import {
  MEDIA_CODEX_AGENT_TOOLS,
  parseMediaCodexAgentResult,
  sha256Json,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type {
  MediaGovernanceAgentConversationEventDto,
  MediaGovernanceAgentEventDto,
  MediaGovernanceAgentMessageDto,
  MediaGovernanceAgentSessionQueryDto,
  MediaGovernanceAgentToolCallDto,
  MediaGovernanceDescriptorRedeemDto,
  MediaGovernanceExecutorEventDto,
  MediaGovernancePlanRedeemDto,
  MediaGovernanceMagnetSourceCreateDto,
  MediaGovernanceMediaType,
  MediaGovernanceOperatorDecisionDto,
  MediaGovernanceProvider,
  MediaGovernanceRevisionCommandDto,
  MediaGovernanceSourceClassificationDto,
  MediaGovernanceSourceSelectionDto,
  MediaGovernanceSelectedFileRole,
  MediaGovernanceSourceRole,
  MediaGovernanceSubtitleLanguage,
  MediaGovernanceContentKind,
  MediaGovernanceSubtitleContractDto,
  MediaGovernanceTaskCreateDto,
  MediaGovernanceTaskIdentityUpdateDto,
  MediaGovernanceTaskPageQueryDto,
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import {
  MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS,
  assertSourceClassification,
  type MediaGovernanceTaskProjection,
  type MediaGovernanceUnitProjection,
  validateAgentBoundaryRequest,
  validateDescriptorManifestEntry,
  validateSubtitleContracts,
} from '../domain/media-governance-domain';
import { MediaDescriptorStore } from '@/modules/admin/media-governance/infrastructure/persistence/media-descriptor.store';
import { MediaGovernanceEventStreamService } from './media-governance-event-stream.service';
import { parseTorrentDescriptor } from '../domain/media-torrent-descriptor';
import {
  MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
  type MediaGovernanceCodexAgentGateway,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-codex-agent.gateway';
import {
  MEDIA_GOVERNANCE_STATE_STORE,
  type MediaGovernanceStateStore,
  type MediaGovernanceStoredTask,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';
import {
  buildMediaGovernanceExecutionEnvelope,
  type MediaGovernanceExecutorAction,
} from '@/modules/admin/media-governance/contract/media-governance-executor.contract';
import {
  MEDIA_GOVERNANCE_EXECUTION_GATEWAY,
  type MediaGovernanceExecutionEnvelope,
  type MediaGovernanceExecutionGateway,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import { buildAdminMediaGovernancePlan } from './media-governance-plan';
import {
  MEDIA_GOVERNANCE_PROGRESS_HOT_STORE,
  type MediaGovernanceProgressHotStore,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';
import {
  searchTmdbMediaCandidates,
  type MediaGovernanceTmdbCandidate,
} from '../infrastructure/integration/media-governance-provider-search';

type MediaGovernanceProviderRef = {
  provider: MediaGovernanceProvider;
  providerId: string;
};

export type MediaGovernanceUnit = {
  evidenceSha256: null | string;
  expectedEpisodeNumbers: number[];
  id: string;
  localAcceptedAt: null | string;
  metadataProjection: {
    identityRefreshAttempts?: number;
    missingA: string[];
    missingB: string[];
    missingC: string[];
    repairAttempts: number;
    validBFallbacks: string[];
  };
  seasonNumber: null | string;
  subtitleContract: null | {
    expectedEpisodeNumbers: number[];
    mappings: Array<{ episodeNumber: number; relativePath: string }>;
    releaseGroup: string;
    sourceId: string;
  };
  unitKind: 'movie' | 'season';
};

export type MediaGovernanceSource = {
  descriptorBytes: number;
  contentKind: MediaGovernanceContentKind;
  descriptorObjectId: string;
  descriptorRevision: number;
  descriptorSha256: string;
  descriptorTombstonedAt: null | string;
  id: string;
  infoHash: string;
  manifest: Array<{
    executable: boolean;
    index: number;
    relativePath: string;
    sizeBytes: number;
  }>;
  manifestSha256: null | string;
  manifestState: 'inspected' | 'pending-inspection';
  releaseGroup: null | string;
  seasonNumbers: string[];
  selectedBytes: number;
  selectedFileCount: number;
  selectedFileIndices: number[];
  selectedFileMappings: Array<{
    episodeNumber: null | number;
    fileRole: MediaGovernanceSelectedFileRole;
    index: number;
    language: MediaGovernanceSubtitleLanguage | null;
    unitId: string;
  }>;
  sourceHealth:
    | 'degraded'
    | 'inconclusive'
    | 'probing'
    | 'unavailable'
    | 'unchecked'
    | 'viable';
  sourceHealthLabel: string;
  sourceHealthReasonLabel: string;
  sourceRole: MediaGovernanceSourceRole;
  transportKind: 'magnet' | 'torrent';
};

export type MediaGovernanceProgress = {
  completedBytes: number;
  completedItems: number;
  etaLabel: string;
  heartbeatLabel: string;
  observedAt: null | string;
  percent: number;
  progressLabel: string;
  speedLabel: string;
  totalBytes: number;
  totalItems: number;
};

type MediaGovernanceAgentSealedPlan = {
  identity?: {
    provider: 'tmdb';
    providerId: string;
    releaseYear: null | number;
  };
  operations: Array<{
    action: string;
    sourcePath?: string;
    targetPath: string;
  }>;
  replayKey: string;
  summary: string;
};

type MediaGovernanceAgentPendingAmendment = {
  identity: NonNullable<MediaGovernanceAgentSealedPlan['identity']>;
  planSha256: string;
  providerTitle: string;
  replayKey: string;
  summary: string;
  taskRevision: number;
};

export type MediaGovernancePayloadSeal = {
  evidenceSha256: string;
  files: Array<{
    index: number;
    mtimeMs: number;
    path: string;
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    sourceId: string;
  }>;
  runId: string;
};

export type MediaGovernanceTask = {
  activeRunId: null | string;
  agentSession: null | {
    capsuleSha256: string;
    checkpointSha256: string;
    currentActionLabel: string;
    currentUnitId: null | string;
    lastHeartbeatLabel: string;
    lastSequence: number;
    pendingPlanSha256: null | string;
    policyBoundaryLabel: string;
    policySha256: string;
    policyVersion: string;
    status: 'failed' | 'needs-operator' | 'running' | 'succeeded';
    statusLabel: string;
    threadId: string;
  };
  closedAt: null | string;
  closedMode: 'agent_verified' | 'automatic' | 'bounded_repair' | null;
  gateReason: null | string;
  governanceProfile: null | 'embedded' | 'sidecar-bundled' | 'sidecar-linked';
  id: string;
  identityPreview: {
    mediaTypeLabel: string;
    providerLabel: string;
    releaseYearLabel: string;
    seasonLabel: string;
    status: 'pending-provider-verification' | 'verified-provider-identity';
    statusLabel: '待资料源核验' | '元数据身份已验证';
    title: string;
  };
  inputSnapshotSha256: string;
  mediaType: MediaGovernanceMediaType;
  metadataIdentity: null | {
    provider: MediaGovernanceProvider;
    providerId: string;
    releaseYear: null | number;
  };
  metadataStatus: 'pending' | 'requires-agent' | 'verified';
  nextCommandLabel: string;
  persistenceMode: 'database' | 'process-simulator';
  payloadSeal: MediaGovernancePayloadSeal | null;
  progress: MediaGovernanceProgress;
  providerRef: MediaGovernanceProviderRef | null;
  releaseYear: null | number;
  revision: number;
  runState: 'blocked' | 'draft' | 'queued' | 'running' | 'succeeded';
  semanticProjection: {
    currentActionLabel: string;
    discardAllowed: boolean;
    discardReasonLabel: null | string;
    gateReasonLabel: string;
    metadataStatusLabel: string;
    runStateLabel: string;
    sourceHealthLabel: string;
    stageLabel: string;
  };
  sealedPlanSha256: null | string;
  sealedPlan: null | Record<string, unknown>;
  sources: MediaGovernanceSource[];
  stage:
    | 'acceptance'
    | 'closed'
    | 'download'
    | 'governance'
    | 'intake'
    | 'metadata';
  titleHint: string;
  units: MediaGovernanceUnit[];
  workItemId: null | string;
};

const MEDIA_TYPE_LABELS: Record<MediaGovernanceMediaType, string> = {
  movie: 'Movie 电影',
  theatrical: 'Theatrical 剧场版',
  tv: 'TV 正常剧集',
};
const PROVIDER_LABELS: Record<MediaGovernanceProvider, string> = {
  bangumi: 'Bangumi',
  tmdb: 'TMDB',
  tvdb: 'TVDB',
};
const SOURCE_HEALTH_REASON_LABELS: Record<string, string> = {
  download_stalled: '已连接来源，但有效下载量连续 10 分钟没有增长',
  insufficient_throughput: '来源有数据，但预计无法在 24 小时内完成所选载荷',
  local_connectivity_degraded: 'NAS 本地网络连通性异常，暂时无法判定来源状态',
  magnet_metadata_unavailable: '磁链在限定时间内未取得文件清单',
  no_complete_peer: '当前没有持有完整所选文件的可用节点',
  partial_availability: '来源只能提供部分所选文件',
  source_runtime_available: '来源已产生有效数据，可进入隔离下载',
  source_runtime_unavailable: '限定时间内没有取得任何有效来源数据',
  tracker_auth_failed: '来源追踪器拒绝了当前访问身份',
  tracker_unreachable: '来源追踪器在限定时间内不可达',
};
const MAX_DISPATCH_ATTEMPTS = 5;
const STALE_RUN_THRESHOLD_MS = 10 * 60_000;
const HIGH_FREQUENCY_EXECUTOR_EVENTS = new Set([
  'download-progress',
  'governance-progress',
  'peer-progress',
]);

@Injectable()
export class MediaGovernanceService implements OnModuleDestroy, OnModuleInit {
  private readonly tasks: MediaGovernanceTask[] = [];
  private dispatchTimer: null | NodeJS.Timeout = null;
  private dispatchRetryActive = false;
  private executionReconcileActive = false;
  private progressSnapshotQueue: Promise<unknown> = Promise.resolve();

  constructor(
    @Optional()
    private readonly eventStream?: MediaGovernanceEventStreamService,
    @Optional()
    private readonly descriptorStore?: MediaDescriptorStore,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY)
    private readonly agentGateway?: MediaGovernanceCodexAgentGateway,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_STATE_STORE)
    private readonly stateStore?: MediaGovernanceStateStore,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_EXECUTION_GATEWAY)
    private readonly executionGateway?: MediaGovernanceExecutionGateway,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_PROGRESS_HOT_STORE)
    private readonly progressHotStore?: MediaGovernanceProgressHotStore,
  ) {}

  async onModuleInit() {
    if (!this.stateStore) return;
    const tasks = await this.stateStore.loadTasks();
    this.tasks.splice(
      0,
      this.tasks.length,
      ...tasks.map((task) => this.restoreStoredTask(task)),
    );
    if (this.executionGateway?.enabled()) {
      void this.retryPendingDispatches();
      void this.reconcileActiveExecutions();
      this.dispatchTimer = setInterval(() => {
        void this.retryPendingDispatches();
        void this.reconcileActiveExecutions();
      }, 5_000);
      this.dispatchTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    this.dispatchTimer = null;
  }

  /** 规范化作品身份与季号后创建并持久化媒体治理任务草稿。 */
  async create(
    input: MediaGovernanceTaskCreateDto,
  ): Promise<MediaGovernanceTask> {
    const titleHint = input.titleHint.trim();
    const seasonNumbers = (input.seasonNumbers ?? []).map((season) =>
      season.trim().toUpperCase(),
    );
    this.assertUnitContract(input.mediaType, seasonNumbers);

    let providerRef = null;
    if (input.providerRef) {
      providerRef = {
        provider: input.providerRef.provider,
        providerId: input.providerRef.providerId.trim(),
      };
    }
    let persistenceMode: MediaGovernanceTask['persistenceMode'] =
      'process-simulator';
    if (this.databaseReady()) persistenceMode = 'database';
    const normalizedInput = {
      mediaType: input.mediaType,
      providerRef,
      releaseYear: input.releaseYear ?? null,
      seasonNumbers,
      titleHint,
      workItemId: input.workItemId ?? null,
    };
    const task: MediaGovernanceTask = {
      activeRunId: null,
      agentSession: null,
      closedAt: null,
      closedMode: null,
      gateReason: null,
      governanceProfile: null,
      id: `media-task-${randomUUID()}`,
      identityPreview: this.buildIdentityPreview(normalizedInput),
      inputSnapshotSha256: createHash('sha256')
        .update(JSON.stringify(normalizedInput))
        .digest('hex'),
      mediaType: input.mediaType,
      metadataIdentity: null,
      metadataStatus: 'pending',
      nextCommandLabel: '补充并检查来源',
      persistenceMode,
      payloadSeal: null,
      progress: {
        completedBytes: 0,
        completedItems: 0,
        etaLabel: '尚未开始',
        heartbeatLabel: '尚未开始',
        observedAt: null,
        percent: 0,
        progressLabel: '等待来源',
        speedLabel: '0 B/s',
        totalBytes: 0,
        totalItems: 0,
      },
      providerRef,
      releaseYear: input.releaseYear ?? null,
      revision: 1,
      runState: 'draft',
      semanticProjection: {
        currentActionLabel: '等待补充来源',
        discardAllowed: true,
        discardReasonLabel: null,
        gateReasonLabel: '无阻塞',
        metadataStatusLabel: '待校验',
        runStateLabel: '草稿',
        sourceHealthLabel: '未检查',
        stageLabel: '接收资料',
      },
      sealedPlanSha256: null,
      sealedPlan: null,
      sources: [],
      stage: 'intake',
      titleHint,
      units: this.createUnits(input.mediaType, seasonNumbers),
      workItemId: input.workItemId ?? null,
    };
    await this.persistTask(task);
    this.tasks.unshift(task);
    this.publishTaskPatch(task, 'created');
    return task;
  }

  /** 在执行前校验任务状态，并修正作品身份及关联单元结构。 */
  async updateIdentity(
    taskId: string,
    input: MediaGovernanceTaskIdentityUpdateDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (
      task.stage !== 'intake' ||
      !['blocked', 'draft'].includes(task.runState) ||
      task.activeRunId !== null ||
      task.payloadSeal !== null ||
      task.sealedPlan !== null
    ) {
      throwVbenError('作品身份只能在下载和治理开始前修正', HttpStatus.CONFLICT);
    }
    if (
      task.sealedPlanSha256 !== null ||
      task.closedAt !== null ||
      task.agentSession !== null ||
      task.metadataIdentity !== null ||
      task.metadataStatus !== 'pending'
    ) {
      throwVbenError('作品身份只能在下载和治理开始前修正', HttpStatus.CONFLICT);
    }

    if (
      input.mediaType === undefined &&
      input.providerRef === undefined &&
      input.releaseYear === undefined &&
      input.seasonNumbers === undefined &&
      input.titleHint === undefined
    ) {
      throwVbenError(
        '至少修改作品名、作品类型、季号、媒体资料库编号或年份之一',
        HttpStatus.BAD_REQUEST,
      );
    }

    let providerRef = task.providerRef;
    if (input.providerRef !== undefined) {
      providerRef = null;
      if (input.providerRef) {
        providerRef = {
          provider: input.providerRef.provider,
          providerId: input.providerRef.providerId.trim(),
        };
      }
    }
    let releaseYear = task.releaseYear;
    if (input.releaseYear !== undefined) {
      releaseYear = input.releaseYear ?? null;
    }
    let titleHint = task.titleHint;
    if (input.titleHint !== undefined) titleHint = input.titleHint.trim();
    const currentSeasonNumbers = task.units
      .map((unit) => unit.seasonNumber)
      .filter((season): season is string => Boolean(season));
    const mediaType = input.mediaType ?? task.mediaType;
    const seasonNumbers = (input.seasonNumbers ?? currentSeasonNumbers).map(
      (season) => season.trim().toUpperCase(),
    );
    this.assertUnitContract(mediaType, seasonNumbers);
    const structureChanged =
      mediaType !== task.mediaType ||
      seasonNumbers.length !== currentSeasonNumbers.length ||
      seasonNumbers.some(
        (season, index) => season !== currentSeasonNumbers[index],
      );

    if (structureChanged) {
      let units: MediaGovernanceUnit[];
      if (task.mediaType === 'tv' && mediaType === 'tv') {
        const existingUnits = new Map(
          task.units.map((unit) => [unit.seasonNumber, unit]),
        );
        units = seasonNumbers.map(
          (seasonNumber) =>
            existingUnits.get(seasonNumber) ??
            this.createUnits('tv', [seasonNumber])[0],
        );
      } else if (task.mediaType !== 'tv' && mediaType !== 'tv') {
        units = task.units;
      } else {
        units = this.createUnits(mediaType, seasonNumbers);
      }

      const unitSeasons = new Map(
        units.map((unit) => [unit.id, unit.seasonNumber]),
      );
      for (const source of task.sources) {
        if (mediaType === 'tv') {
          source.seasonNumbers = source.seasonNumbers.filter((season) =>
            seasonNumbers.includes(season),
          );
        } else {
          source.seasonNumbers = [];
        }
        source.selectedFileMappings = source.selectedFileMappings.filter(
          (mapping) => {
            if (!unitSeasons.has(mapping.unitId)) return false;
            if (mediaType !== 'tv') return true;
            const seasonNumber = unitSeasons.get(mapping.unitId);
            return Boolean(
              seasonNumber && source.seasonNumbers.includes(seasonNumber),
            );
          },
        );
      }
      task.mediaType = mediaType;
      task.units = units;
    }

    const normalizedInput = {
      mediaType,
      providerRef,
      releaseYear,
      seasonNumbers,
      titleHint,
      workItemId: task.workItemId,
    };
    task.providerRef = providerRef;
    task.releaseYear = releaseYear;
    task.titleHint = titleHint;
    task.identityPreview = this.buildIdentityPreview(normalizedInput);
    task.inputSnapshotSha256 = createHash('sha256')
      .update(JSON.stringify(normalizedInput))
      .digest('hex');
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    return task;
  }

  /** 按期望版本删除可丢弃草稿，并同步清除持久化账本。 */
  async discardTask(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<{
    clearedWorkItemId: null | string;
    deletedTaskId: string;
  }> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const discardReason = this.getDiscardDisabledReason(task);
    if (discardReason) throwVbenError(discardReason, HttpStatus.CONFLICT);

    let clearedWorkItemId = task.workItemId;
    if (this.stateStore) {
      if (!this.databaseReady() || !this.stateStore.deleteTask) {
        throwVbenError(
          '媒体治理数据库删除链路暂不可用',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      try {
        const receipt = await this.stateStore.deleteTask({
          expectedRevision: task.revision,
          expectedWorkItemId: task.workItemId,
          taskId: task.id,
        });
        clearedWorkItemId = receipt.clearedWorkItemId;
      } catch {
        throwVbenError(
          '媒体治理数据库删除链路暂不可用',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    const taskIndex = this.tasks.findIndex(
      (candidate) => candidate.id === task.id,
    );
    if (taskIndex >= 0) this.tasks.splice(taskIndex, 1);
    this.publishTaskPatch(task, 'deleted', null, null, true);
    return { clearedWorkItemId, deletedTaskId: task.id };
  }

  /** 消费一次性描述符授权，并返回经摘要校验的私有内容。 */
  async redeemDescriptor(
    input: MediaGovernanceDescriptorRedeemDto,
  ): Promise<Buffer> {
    if (
      !this.databaseReady() ||
      !this.stateStore?.consumeDescriptorGrant ||
      !this.descriptorStore
    ) {
      throwVbenError(
        '媒体描述文件授权服务暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const grant = await this.stateStore.consumeDescriptorGrant(input);
    return this.descriptorStore.readDescriptor({
      descriptorSha256: input.descriptorSha256,
      objectId: grant.descriptorObjectId,
    });
  }

  /** 消费一次性计划授权，并返回与运行绑定的密封治理计划。 */
  async redeemPlan(input: MediaGovernancePlanRedeemDto) {
    if (!this.databaseReady() || !this.stateStore?.consumePlanGrant) {
      throwVbenError(
        '媒体治理计划授权服务暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stateStore.consumePlanGrant(input);
  }

  /** 返回执行器回调链路的持久化模式与就绪状态。 */
  executionCallbackHealth() {
    let persistenceMode: 'database' | 'process-simulator' = 'process-simulator';
    if (this.databaseReady()) persistenceMode = 'database';
    let status: 'not-ready' | 'ready' = 'not-ready';
    if (
      this.databaseReady() &&
      this.stateStore?.applyExecutorEvent &&
      this.stateStore.readRunSequence
    ) {
      status = 'ready';
    }
    return {
      persistenceMode,
      status,
    } as const;
  }

  /** 按运行序号应用执行器事件，并协调热层、数据库与任务投影。 */
  async applyExecutorEvent(input: MediaGovernanceExecutorEventDto) {
    if (
      !this.databaseReady() ||
      !this.stateStore?.applyExecutorEvent ||
      !this.stateStore.readRunSequence
    ) {
      throwVbenError(
        '媒体执行器回调持久化暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const task = this.detail(input.taskId);
    if (
      task.activeRunId !== input.runId ||
      task.revision !== input.taskRevision
    ) {
      throwVbenError('媒体执行器回调身份已过期', HttpStatus.CONFLICT);
    }
    const observedAt = Date.parse(input.observedAt);
    if (
      !Number.isFinite(observedAt) ||
      Math.abs(Date.now() - observedAt) > 24 * 60 * 60_000
    ) {
      throwVbenError('媒体执行器回调时间无效', HttpStatus.BAD_REQUEST);
    }
    this.applyExecutorProjection(structuredClone(task), input);
    const highFrequency = HIGH_FREQUENCY_EXECUTOR_EVENTS.has(input.eventType);
    let snapshotRequired = false;
    if (this.progressHotStore) {
      let hotResult;
      try {
        hotResult = await this.progressHotStore.append(input, null);
        if (hotResult.authorityRequired) {
          const authoritySequence = await this.stateStore.readRunSequence(
            input.runId,
          );
          hotResult = await this.progressHotStore.append(
            input,
            authoritySequence,
          );
        }
      } catch {
        throwVbenError(
          '媒体执行器实时进度热层暂不可用',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (hotResult.sequenceGap) {
        throwVbenError('媒体执行器回调序号不连续', HttpStatus.CONFLICT);
      }
      if (!hotResult.applied) {
        if (highFrequency) {
          return { applied: false, reason: 'duplicate-sequence' };
        }
        const authoritySequence = await this.stateStore.readRunSequence(
          input.runId,
        );
        if (input.sequence <= authoritySequence) {
          return { applied: false, reason: 'duplicate-sequence' };
        }
      }
      snapshotRequired = hotResult.snapshotRequired;
    } else {
      const previousSequence = await this.stateStore.readRunSequence(
        input.runId,
      );
      if (input.sequence <= previousSequence) {
        return { applied: false, reason: 'duplicate-sequence' };
      }
      if (input.sequence !== previousSequence + 1) {
        throwVbenError('媒体执行器回调序号不连续', HttpStatus.CONFLICT);
      }
    }
    this.applyExecutorProjection(task, input);
    if (highFrequency && this.progressHotStore) {
      this.publishTaskPatch(
        task,
        'state-updated',
        input.runId,
        input.sequence,
        false,
        true,
      );
      if (snapshotRequired && this.stateStore.saveExecutorProgressSnapshot) {
        const taskSnapshot = structuredClone(task);
        const eventSnapshot = structuredClone(input);
        this.progressSnapshotQueue = this.progressSnapshotQueue
          .catch(() => undefined)
          .then(() =>
            this.stateStore!.saveExecutorProgressSnapshot!(
              taskSnapshot,
              eventSnapshot,
            ),
          );
        void this.progressSnapshotQueue.catch(() => undefined);
      }
      return {
        applied: true,
        revision: task.revision,
        runSequence: input.sequence,
      };
    }
    if (this.progressHotStore) {
      await this.progressSnapshotQueue.catch(() => undefined);
    }
    const terminal =
      input.eventType === 'run-succeeded' || input.eventType === 'run-failed';
    if (terminal) this.bumpRevision(task);
    try {
      const applied = await this.stateStore.applyExecutorEvent(task, input);
      if (!applied) return { applied: false, reason: 'duplicate-sequence' };
    } catch {
      try {
        const storedTasks = await this.stateStore.loadTasks();
        this.tasks.splice(
          0,
          this.tasks.length,
          ...storedTasks.map((storedTask) =>
            this.restoreStoredTask(storedTask),
          ),
        );
      } catch {
        this.tasks.splice(0, this.tasks.length);
      }
      throwVbenError(
        '媒体执行器回调持久化暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.publishTaskPatch(task, 'state-updated', input.runId, input.sequence);
    return {
      applied: true,
      revision: task.revision,
      runSequence: input.sequence,
    };
  }

  /** 将已校验执行器事件投影到任务、来源和进度状态。 */
  private applyExecutorProjection(
    task: MediaGovernanceTask,
    input: MediaGovernanceExecutorEventDto,
  ) {
    let source = null;
    if (input.sourceId) source = this.findSource(task, input.sourceId);
    if (input.eventType === 'source-inspected') {
      if (
        !source ||
        !input.manifest ||
        !input.manifestSha256 ||
        input.manifest.length === 0
      ) {
        throwVbenError('来源清单回调不完整', HttpStatus.BAD_REQUEST);
      }
      const manifest = input.manifest.map((entry) => ({
        executable: false,
        index: entry.index,
        relativePath: validateDescriptorManifestEntry({
          entryType: 'file',
          executable: entry.executable,
          relativePath: entry.relativePath,
        }),
        sizeBytes: entry.sizeBytes,
      }));
      const manifestSha256 = createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
      if (manifestSha256 !== input.manifestSha256) {
        throwVbenError('来源清单摘要不匹配', HttpStatus.CONFLICT);
      }
      source.manifest = manifest;
      source.manifestSha256 = manifestSha256;
      source.manifestState = 'inspected';
      source.selectedBytes = manifest.reduce(
        (total, entry) => total + entry.sizeBytes,
        0,
      );
      source.selectedFileCount = manifest.length;
      source.selectedFileIndices = manifest.map((entry) => entry.index);
      source.selectedFileMappings = [];
      source.sourceHealth = 'unchecked';
      source.sourceHealthLabel = '来源清单已检查';
      source.sourceHealthReasonLabel = '等待运行时死种/死链探针';
    }
    if (input.eventType === 'source-probed') {
      if (!source || !input.sourceHealth || !input.sourceHealthReason) {
        throwVbenError('来源健康回调不完整', HttpStatus.BAD_REQUEST);
      }
      source.sourceHealth = input.sourceHealth;
      source.sourceHealthLabel = {
        degraded: '来源降级可用',
        inconclusive: '来源状态无法确认',
        unavailable: '来源不可用',
        viable: '来源可用',
      }[input.sourceHealth];
      source.sourceHealthReasonLabel =
        SOURCE_HEALTH_REASON_LABELS[input.sourceHealthReason] ??
        '来源探针返回了未识别的原因';
    }
    task.progress.observedAt = input.observedAt;
    task.progress.heartbeatLabel = '刚刚';
    if (input.progress) {
      if (
        input.progress.completedBytes > input.progress.totalBytes ||
        input.progress.completedItems > input.progress.totalItems
      ) {
        throwVbenError('执行器进度超出总量', HttpStatus.BAD_REQUEST);
      }
      let percent = 0;
      if (input.progress.totalBytes !== 0) {
        percent = Number(
          (
            (input.progress.completedBytes / input.progress.totalBytes) *
            100
          ).toFixed(1),
        );
      }
      task.progress = {
        completedBytes: input.progress.completedBytes,
        completedItems: input.progress.completedItems,
        etaLabel: input.progress.etaLabel,
        heartbeatLabel: '刚刚',
        observedAt: input.observedAt,
        percent,
        progressLabel: input.summary,
        speedLabel: this.formatSpeed(input.progress.speedBytesPerSecond),
        totalBytes: input.progress.totalBytes,
        totalItems: input.progress.totalItems,
      };
    }
    if (input.eventType === 'run-started') {
      task.runState = 'running';
      task.gateReason = null;
      task.nextCommandLabel = '执行器正在处理';
      if (!input.progress) {
        task.progress.etaLabel = '执行中';
        task.progress.progressLabel = input.summary;
      }
    } else if (input.eventType === 'run-paused') {
      task.runState = 'blocked';
      task.gateReason = '下载已安全暂停';
      task.nextCommandLabel = '可从同一 Run 续传';
    } else if (input.eventType === 'run-resumed') {
      task.runState = 'running';
      task.gateReason = null;
      task.nextCommandLabel = '正在从原 Run 继续下载';
    } else if (input.eventType === 'run-failed') {
      task.activeRunId = null;
      task.runState = 'blocked';
      task.progress.etaLabel = '已停止';
      task.progress.progressLabel = input.summary.slice(0, 160);
      const sourceFailure = ['source.inspect', 'source.probe-runtime'].includes(
        input.action,
      );
      if (sourceFailure && source) {
        let sourceHealthReasonLabel = input.summary.slice(0, 160);
        if (input.sourceHealthReason) {
          sourceHealthReasonLabel =
            SOURCE_HEALTH_REASON_LABELS[input.sourceHealthReason] ??
            '来源检查未能完成';
        }
        source.sourceHealth = input.sourceHealth ?? 'inconclusive';
        source.sourceHealthLabel = '来源检查失败';
        source.sourceHealthReasonLabel = sourceHealthReasonLabel;
      }
      const cancelledDownload =
        ['source.download', 'source.resume'].includes(input.action) &&
        input.summary.includes('download_cancelled');
      task.gateReason = input.summary.slice(0, 160);
      if (cancelledDownload) {
        task.gateReason = '下载已取消，现有载荷等待精确清理';
      }
      task.nextCommandLabel = '查看失败原因后重试';
      if (sourceFailure) {
        task.nextCommandLabel = '可重新填写来源、编辑文件清单或删除任务';
      }
      if (cancelledDownload) {
        task.nextCommandLabel = '移除低效来源并上传替换来源';
      }
    } else if (input.eventType === 'run-succeeded') {
      if (!input.evidenceSha256) {
        throwVbenError('执行器终态缺少密封证据', HttpStatus.BAD_REQUEST);
      }
      this.finalizeSucceededProgress(task, input.observedAt, input.summary);
      if (input.action === 'source.inspect') {
        task.stage = 'intake';
        task.runState = 'draft';
        task.gateReason = null;
        task.nextCommandLabel = '运行死种/死链探针';
      } else if (input.action === 'source.probe-runtime') {
        if (!source) {
          throwVbenError('来源探针终态缺少来源身份', HttpStatus.BAD_REQUEST);
        }
        task.stage = 'intake';
        task.runState = 'blocked';
        task.gateReason = source.sourceHealthReasonLabel;
        task.nextCommandLabel = '更换来源后重新探针';
        if (source.sourceHealth === 'viable') {
          task.runState = 'draft';
          task.gateReason = null;
          task.nextCommandLabel = '检查其余来源或开始下载';
        }
      } else if (
        input.action === 'source.download' ||
        input.action === 'source.resume'
      ) {
        if (!input.payloadFiles?.length) {
          throwVbenError('下载载荷密封证据不完整', HttpStatus.BAD_REQUEST);
        }
        const expectedPrefix = `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/`;
        if (
          input.payloadFiles.some(
            (file) =>
              !file.path.startsWith(expectedPrefix) ||
              !file.path.includes(`/sources/${file.sourceId}/`),
          )
        ) {
          throwVbenError('下载载荷路径越过任务边界', HttpStatus.BAD_REQUEST);
        }
        task.payloadSeal = {
          evidenceSha256: input.evidenceSha256,
          files: input.payloadFiles.map((file) => ({ ...file })),
          runId: input.runId,
        };
        task.stage = 'download';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.nextCommandLabel = '开始本地治理';
      } else if (input.action === 'source.cleanup') {
        if (!source || !source.descriptorTombstonedAt) {
          throwVbenError('来源清理终态身份不完整', HttpStatus.CONFLICT);
        }
        this.finalizeSourceRemoval(task, source);
      } else if (input.action === 'governance.execute') {
        task.stage = 'metadata';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.metadataStatus = 'pending';
        task.nextCommandLabel = '运行 A/B/C 分档元数据核验';
      } else if (input.action === 'metadata.repair') {
        const automaticEnrichment =
          this.canRunAutomaticMetadataEnrichment(task);
        this.applyMetadataEvidence(task, input);
        task.stage = 'metadata';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.metadataStatus = 'pending';
        if (automaticEnrichment) task.closedMode = 'automatic';
        task.nextCommandLabel = '重新运行 A/B/C 分档元数据核验';
      } else if (input.action === 'metadata.verify') {
        const refreshingDeferredIdentity =
          task.metadataStatus === 'requires-agent' &&
          this.hasDeferredMetadataIdentityGap(task);
        if (refreshingDeferredIdentity) {
          for (const unit of task.units) {
            unit.metadataProjection.identityRefreshAttempts =
              (unit.metadataProjection.identityRefreshAttempts ?? 0) + 1;
          }
        }
        this.applyMetadataEvidence(task, input);
        const metadata = input.metadata!;
        task.stage = 'metadata';
        task.metadataStatus = 'requires-agent';
        task.runState = 'blocked';
        task.gateReason = `元数据仍缺少 A 级 ${metadata.units.reduce(
          (count, unit) => count + unit.missingA.length,
          0,
        )} 项、B 级 ${metadata.units.reduce(
          (count, unit) => count + unit.missingB.length,
          0,
        )} 项`;
        if (metadata.canAccept) {
          task.metadataStatus = 'verified';
          task.runState = 'succeeded';
          task.gateReason = null;
        }
        const canRepair = this.canRunBoundedMetadataRepair(task);
        const canRefreshDeferredIdentity =
          this.canRefreshDeferredMetadataIdentity(task);
        const canEnrichAutomatically =
          this.canRunAutomaticMetadataEnrichment(task);
        if (!metadata.canAccept && task.closedMode === 'automatic') {
          task.closedMode = null;
        }
        task.nextCommandLabel = '启动 CodexAgent 有界人工治理';
        if (canRepair) {
          task.nextCommandLabel = `运行第 ${this.metadataRepairAttempts(task) + 1}/2 次有界元数据修复`;
        }
        if (canEnrichAutomatically) {
          task.nextCommandLabel = '自动补齐 LocalNFO 与作品/季海报';
        }
        if (canRefreshDeferredIdentity) {
          task.nextCommandLabel = 'fnOS 身份回填尚未稳定，重新采集元数据事实';
        }
        if (metadata.canAccept) {
          task.nextCommandLabel = '运行独立本地验收';
        }
      } else if (input.action === 'acceptance.verify') {
        const acceptance = input.acceptance;
        if (
          !acceptance ||
          !acceptance.canClose ||
          acceptance.acceptedUnits !== task.units.length
        ) {
          throwVbenError('独立本地验收证据未闭合', HttpStatus.CONFLICT);
        }
        if (
          acceptance.activeDownloadOwners !== 0 ||
          acceptance.cloudWrites !== 0 ||
          acceptance.databaseDirectWrites !== 0
        ) {
          throwVbenError('独立本地验收证据未闭合', HttpStatus.CONFLICT);
        }
        if (
          acceptance.mechanicalScans !== 0 ||
          acceptance.stagingResiduals !== 0 ||
          acceptance.uiWrites !== 0
        ) {
          throwVbenError('独立本地验收证据未闭合', HttpStatus.CONFLICT);
        }
        task.stage = 'closed';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.metadataStatus = 'verified';
        task.closedAt = input.observedAt;
        let closedMode: NonNullable<MediaGovernanceTask['closedMode']> =
          'automatic';
        if (this.metadataRepairAttempts(task) > 0) {
          closedMode = 'bounded_repair';
        }
        if (task.closedMode === 'automatic') closedMode = 'automatic';
        if (task.agentSession?.status === 'succeeded') {
          closedMode = 'agent_verified';
        }
        task.closedMode = closedMode;
        for (const unit of task.units) {
          unit.evidenceSha256 = input.evidenceSha256;
          unit.localAcceptedAt = input.observedAt;
        }
        task.nextCommandLabel = '查看验收证据';
      } else {
        throwVbenError('执行器终态动作不受支持', HttpStatus.BAD_REQUEST);
      }
      task.activeRunId = null;
    }
    this.refreshSemanticProjection(task);
  }

  /** 校验分档元数据证据，并更新任务身份与单元缺项投影。 */
  private applyMetadataEvidence(
    task: MediaGovernanceTask,
    input: MediaGovernanceExecutorEventDto,
  ) {
    const metadata = input.metadata;
    if (
      !metadata ||
      !input.evidenceSha256 ||
      metadata.units.length !== task.units.length
    ) {
      throwVbenError('元数据分档证据不完整', HttpStatus.BAD_REQUEST);
    }
    if (
      new Set(metadata.units.map((unit) => unit.unitId)).size !==
        task.units.length ||
      metadata.units.some(
        (unit) =>
          !task.units.some((candidate) => candidate.id === unit.unitId) ||
          unit.accepted !==
            (unit.missingA.length === 0 && unit.missingB.length === 0),
      )
    ) {
      throwVbenError('元数据分档证据不完整', HttpStatus.BAD_REQUEST);
    }
    if (
      metadata.canAccept !== metadata.units.every((unit) => unit.accepted) ||
      Object.values(metadata.writeBoundaries).some((count) => count !== 0)
    ) {
      throwVbenError('元数据分档证据不完整', HttpStatus.BAD_REQUEST);
    }
    const identity = metadata.identity ?? task.providerRef;
    if (identity) {
      const observedReleaseYear = (identity as { releaseYear?: null | number })
        .releaseYear;
      let releaseYear = task.releaseYear;
      if (typeof observedReleaseYear === 'number') {
        releaseYear = observedReleaseYear;
      }
      task.metadataIdentity = {
        provider: identity.provider,
        providerId: identity.providerId,
        releaseYear,
      };
    } else if (metadata.canAccept) {
      throwVbenError('元数据身份硬门禁未闭合', HttpStatus.CONFLICT);
    }
    task.identityPreview = this.buildIdentityPreview({
      mediaType: task.mediaType,
      metadataIdentity: task.metadataIdentity,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      seasonNumbers: task.units
        .map((unit) => unit.seasonNumber)
        .filter((season): season is string => Boolean(season)),
      titleHint: task.titleHint,
    });
    for (const projection of metadata.units) {
      const unit = task.units.find(
        (candidate) => candidate.id === projection.unitId,
      )!;
      unit.evidenceSha256 = input.evidenceSha256;
      unit.metadataProjection = {
        identityRefreshAttempts:
          unit.metadataProjection.identityRefreshAttempts ?? 0,
        missingA: [...projection.missingA],
        missingB: [...projection.missingB],
        missingC: [...projection.missingC],
        repairAttempts: Math.max(
          unit.metadataProjection.repairAttempts,
          metadata.repairAttempts,
        ),
        validBFallbacks: [],
      };
    }
  }

  /** 返回任务各单元中已记录的最大元数据修复次数。 */
  private metadataRepairAttempts(task: MediaGovernanceTask) {
    return Math.max(
      0,
      ...task.units.map((unit) => unit.metadataProjection.repairAttempts),
    );
  }

  /** 返回任务各单元中已记录的最大身份回填次数。 */
  private metadataIdentityRefreshAttempts(task: MediaGovernanceTask) {
    return Math.max(
      0,
      ...task.units.map(
        (unit) => unit.metadataProjection.identityRefreshAttempts ?? 0,
      ),
    );
  }

  /** 判断任务是否仅剩可延后处理的元数据身份缺口。 */
  private hasDeferredMetadataIdentityGap(task: MediaGovernanceTask) {
    const providerIdentityFields = new Set([
      'identity.provider',
      'identity.providerId',
    ]);
    return (
      !task.metadataIdentity &&
      task.units.every(
        (unit) =>
          unit.evidenceSha256 !== null &&
          unit.metadataProjection.repairAttempts === 0 &&
          unit.metadataProjection.missingA.length ===
            providerIdentityFields.size &&
          unit.metadataProjection.missingA.every((field) =>
            providerIdentityFields.has(field),
          ) &&
          unit.metadataProjection.missingC.length === 0,
      )
    );
  }

  /** 判断任务是否仍使用缺少分档事实的旧版空投影。 */
  private hasLegacyEmptyMetadataProjection(task: MediaGovernanceTask) {
    return task.units.every(
      (unit) =>
        unit.metadataProjection.missingA.length === 0 &&
        unit.metadataProjection.missingB.length === 0 &&
        unit.metadataProjection.missingC.length === 0 &&
        unit.metadataProjection.repairAttempts === 0 &&
        unit.evidenceSha256 === null,
    );
  }

  /** 判断旧版空元数据投影是否可以重新采集事实。 */
  private canRefreshLegacyMetadata(task: MediaGovernanceTask) {
    return (
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.metadataStatus === 'requires-agent' &&
      Boolean(task.sealedPlan) &&
      this.hasLegacyEmptyMetadataProjection(task)
    );
  }

  /** 判断延后身份缺口是否仍可执行一次受限回填。 */
  private canRefreshDeferredMetadataIdentity(task: MediaGovernanceTask) {
    return (
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.metadataStatus === 'requires-agent' &&
      Boolean(task.sealedPlan) &&
      this.hasDeferredMetadataIdentityGap(task) &&
      this.metadataIdentityRefreshAttempts(task) < 1
    );
  }

  /** 判断失败的元数据或验收运行是否可从同一阶段重试。 */
  private canRetryFailedVerification(
    task: MediaGovernanceTask,
    stage: 'acceptance' | 'metadata',
    metadataStatus: 'pending' | 'verified',
  ) {
    return (
      task.stage === stage &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.metadataStatus === metadataStatus &&
      Boolean(task.sealedPlan) &&
      task.gateReason?.startsWith('NAS 执行失败：') === true
    );
  }

  /** 判断当前 B 级缺项是否仍满足最多两次修复边界。 */
  private canRunBoundedMetadataRepair(task: MediaGovernanceTask) {
    const projections = task.units.map((unit) => unit.metadataProjection);
    return (
      this.metadataRepairAttempts(task) < 2 &&
      projections.every((projection) => projection.missingA.length === 0) &&
      projections.some((projection) => projection.missingB.length > 0)
    );
  }

  /** 判断缺项是否仅涉及可确定生成的本地元数据资源。 */
  private canRunAutomaticMetadataEnrichment(task: MediaGovernanceTask) {
    const generatedMetadataFields = new Set([
      'artwork.poster',
      'metadata.local-nfo',
    ]);
    return (
      task.governanceProfile === 'embedded' &&
      Boolean(task.metadataIdentity) &&
      this.metadataRepairAttempts(task) === 0 &&
      task.units.every((unit) => {
        const projection = unit.metadataProjection;
        return (
          projection.missingA.length === 0 &&
          projection.missingC.length === 0 &&
          new Set(projection.missingB).size === generatedMetadataFields.size &&
          projection.missingB.every((field) =>
            generatedMetadataFields.has(field),
          )
        );
      })
    );
  }

  /** 读取指定任务并刷新其心跳显示，任务不存在时返回统一错误。 */
  detail(taskId: string): MediaGovernanceTask {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      throwVbenError('媒体治理任务不存在', HttpStatus.NOT_FOUND);
    }
    return this.refreshHeartbeatLabel(task);
  }

  /** 汇总任务阻塞、运行、证据漂移和字幕发布组等语义指标。 */
  summary() {
    const now = Date.now();
    this.tasks.forEach((task) => this.refreshHeartbeatLabel(task, now));
    const closed = this.tasks.filter((task) => task.stage === 'closed').length;
    const blocked = this.tasks.filter(
      (task) => task.runState === 'blocked',
    ).length;
    const evidenceDriftTasks = new Set(
      this.tasks
        .filter(
          (task) =>
            task.stage === 'closed' &&
            task.units.some(
              (unit) => !unit.localAcceptedAt || !unit.evidenceSha256,
            ),
        )
        .map((task) => task.id),
    );
    const stuckRunTasks = new Set(
      this.tasks
        .filter((task) => this.isStuckRun(task, now))
        .map((task) => task.id),
    );
    const mixedSubtitles = this.mixedSubtitleSummary();
    const attentionTaskIds = new Set([
      ...this.tasks
        .filter((task) => task.runState === 'blocked')
        .map((task) => task.id),
      ...evidenceDriftTasks,
      ...stuckRunTasks,
      ...mixedSubtitles.taskIds,
    ]);
    let healthLabel = `发现 ${attentionTaskIds.size} 个任务需要处理`;
    if (attentionTaskIds.size === 0) healthLabel = '运行核对正常';
    let metadataAutoClosureRate = 0;
    if (this.tasks.length !== 0) {
      metadataAutoClosureRate = Number(
        ((closed / this.tasks.length) * 100).toFixed(1),
      );
    }
    return {
      agentPending: this.tasks.filter(
        (task) =>
          task.stage !== 'closed' &&
          (task.agentSession?.status === 'failed' ||
            task.agentSession?.status === 'needs-operator' ||
            task.agentSession?.status === 'running'),
      ).length,
      attentionRequired: attentionTaskIds.size,
      blocked,
      closed,
      downloading: this.tasks.filter(
        (task) => task.stage === 'download' && task.runState === 'running',
      ).length,
      evidenceDriftCount: evidenceDriftTasks.size,
      governing: this.tasks.filter(
        (task) => task.stage === 'governance' && task.runState === 'running',
      ).length,
      healthLabel,
      metadataAutoClosureRate,
      mixedSubtitleSeasonCount: mixedSubtitles.seasonCount,
      stagingResidualCount: null,
      stuckRunCount: stuckRunTasks.size,
      total: this.tasks.length,
    };
  }

  /** 解析并脱敏保存磁力来源，初始化其治理与健康投影。 */
  async addMagnetSource(
    taskId: string,
    input: MediaGovernanceMagnetSourceCreateDto,
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    this.assertSourceOwnerAvailable(task, input.sourceRole);
    const seasonNumbers = this.normalizeSourceSeasons(
      task,
      input.seasonNumbers,
    );
    const governanceProfile = this.assertClassification(task, input);
    const { displayName, infoHash, trackerCount } = this.parseMagnetUri(
      input.magnetUri,
    );
    const sourceId = `media-source-${randomUUID()}`;
    const descriptorSha256 = createHash('sha256')
      .update(input.magnetUri)
      .digest('hex');
    const stored = await this.descriptorStore?.putMagnetDescriptor({
      magnetUri: input.magnetUri,
      revision: 1,
      sourceId,
      taskId,
    });
    let sourceHealthReasonLabel = '未声明追踪器，等待运行时探针';
    if (trackerCount > 0) {
      sourceHealthReasonLabel = `已脱敏记录 ${trackerCount} 个追踪器，等待运行时探针`;
    }
    const source: MediaGovernanceSource = {
      contentKind: input.contentKind,
      descriptorBytes: stored?.bytes ?? Buffer.byteLength(input.magnetUri),
      descriptorObjectId:
        stored?.objectId ?? `simulator-private/${sourceId}/${descriptorSha256}`,
      descriptorSha256,
      descriptorRevision: 1,
      descriptorTombstonedAt: null,
      id: sourceId,
      infoHash,
      manifest: [],
      manifestSha256: null,
      manifestState: 'pending-inspection',
      releaseGroup: input.releaseGroup?.trim() || displayName || null,
      seasonNumbers,
      selectedBytes: 0,
      selectedFileCount: 0,
      selectedFileIndices: [],
      selectedFileMappings: [],
      sourceHealth: 'unchecked',
      sourceHealthLabel: '尚未检查',
      sourceHealthReasonLabel,
      sourceRole: input.sourceRole,
      transportKind: 'magnet',
    };
    task.sources.push(source);
    if (governanceProfile) task.governanceProfile = governanceProfile;
    task.nextCommandLabel = '检查来源清单';
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 安全解析并保存种子描述符，初始化来源文件清单。 */
  async addTorrentSource(
    taskId: string,
    input: MediaGovernanceSourceClassificationDto,
    file: { buffer: Buffer; size: number },
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    this.assertSourceOwnerAvailable(task, input.sourceRole);
    if (!file?.buffer || file.size !== file.buffer.length) {
      throwVbenError('必须上传完整种子描述文件', HttpStatus.BAD_REQUEST);
    }
    const seasonNumbers = this.normalizeSourceSeasons(
      task,
      input.seasonNumbers,
    );
    const governanceProfile = this.assertClassification(task, input);
    const sourceId = `media-source-${randomUUID()}`;
    const localParsed = parseTorrentDescriptor(file.buffer);
    const stored = await this.descriptorStore?.putTorrentDescriptor({
      bytes: file.buffer,
      revision: 1,
      sourceId,
      taskId,
    });
    const parsed = stored ?? {
      ...localParsed,
      bytes: file.size,
      objectId: `simulator-private/${sourceId}/${localParsed.descriptorSha256}`,
    };
    const source: MediaGovernanceSource = {
      contentKind: input.contentKind,
      descriptorBytes: parsed.bytes,
      descriptorObjectId: parsed.objectId,
      descriptorRevision: 1,
      descriptorSha256: parsed.descriptorSha256,
      descriptorTombstonedAt: null,
      id: sourceId,
      infoHash: parsed.infoHash,
      manifest: parsed.manifest,
      manifestSha256: parsed.manifestSha256,
      manifestState: 'inspected',
      releaseGroup: input.releaseGroup?.trim() || null,
      seasonNumbers,
      selectedBytes: parsed.manifest.reduce(
        (total, item) => total + item.sizeBytes,
        0,
      ),
      selectedFileCount: parsed.manifest.length,
      selectedFileIndices: parsed.manifest.map((item) => item.index),
      selectedFileMappings: [],
      sourceHealth: 'unchecked',
      sourceHealthLabel: '尚未检查',
      sourceHealthReasonLabel: '种子清单已安全解析，等待运行时探针',
      sourceRole: input.sourceRole,
      transportKind: 'torrent',
    };
    task.sources.push(source);
    if (governanceProfile) task.governanceProfile = governanceProfile;
    task.nextCommandLabel = '运行死种/死链探针';
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 修订来源角色、内容类型及适用季范围，并清除旧映射。 */
  async updateSourceClassification(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceSourceClassificationDto,
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const source = this.findSource(task, sourceId);
    if (
      input.sourceRole === 'primary_media' &&
      source.sourceRole !== 'primary_media'
    ) {
      this.assertSourceOwnerAvailable(task, input.sourceRole);
    }
    const governanceProfile = this.assertClassification(task, input);
    source.contentKind = input.contentKind;
    source.sourceRole = input.sourceRole;
    source.seasonNumbers = this.normalizeSourceSeasons(
      task,
      input.seasonNumbers,
    );
    source.selectedFileMappings = [];
    source.releaseGroup = input.releaseGroup?.trim() || source.releaseGroup;
    if (governanceProfile) task.governanceProfile = governanceProfile;
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 校验文件选择与治理身份一一对应后密封来源映射。 */
  async updateSourceSelection(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceSourceSelectionDto,
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.activeRunId) {
      throwVbenError('来源运行期间不能修改文件选择', HttpStatus.CONFLICT);
    }
    const source = this.findSource(task, sourceId);
    const selectedFileIndices = [...new Set(input.selectedFileIndices)].sort(
      (left, right) => left - right,
    );
    if (selectedFileIndices.length !== input.selectedFileIndices.length) {
      throwVbenError('来源文件索引不能重复', HttpStatus.BAD_REQUEST);
    }
    const manifestByIndex = new Map(
      source.manifest.map((entry) => [entry.index, entry]),
    );
    const selectedEntries = selectedFileIndices.map((index) => {
      const entry = manifestByIndex.get(index);
      if (!entry) throwVbenError('来源文件索引不存在', HttpStatus.BAD_REQUEST);
      return entry;
    });
    if (input.fileMappings.length !== selectedFileIndices.length) {
      throwVbenError(
        '每个所选文件都必须绑定一个治理身份',
        HttpStatus.BAD_REQUEST,
      );
    }
    const mappingIndices = input.fileMappings.map((mapping) => mapping.index);
    if (
      new Set(mappingIndices).size !== mappingIndices.length ||
      mappingIndices.some((index) => !selectedFileIndices.includes(index)) ||
      selectedFileIndices.some((index) => !mappingIndices.includes(index))
    ) {
      throwVbenError('文件映射必须与所选索引一一对应', HttpStatus.BAD_REQUEST);
    }
    const unitById = new Map(task.units.map((unit) => [unit.id, unit]));
    const selectedFileMappings = input.fileMappings
      .map((mapping) => {
        const entry = manifestByIndex.get(mapping.index)!;
        const unit = unitById.get(mapping.unitId);
        if (!unit) {
          throwVbenError('文件映射引用了未知治理单元', HttpStatus.BAD_REQUEST);
        }
        if (
          unit.seasonNumber &&
          !source.seasonNumbers.includes(unit.seasonNumber)
        ) {
          throwVbenError(
            '文件映射季号超出来源声明范围',
            HttpStatus.BAD_REQUEST,
          );
        }
        this.assertSelectedFileRole(entry.relativePath, mapping.fileRole);
        const episodeNumber = mapping.episodeNumber ?? null;
        const language = mapping.language ?? null;
        if (mapping.fileRole === 'font') {
          if (episodeNumber !== null || language !== null) {
            throwVbenError(
              '字体文件不能绑定集号或字幕语言',
              HttpStatus.BAD_REQUEST,
            );
          }
        } else if (task.mediaType === 'tv') {
          if (!Number.isInteger(episodeNumber) || episodeNumber! < 0) {
            throwVbenError(
              'TV 视频和字幕必须绑定有效集号',
              HttpStatus.BAD_REQUEST,
            );
          }
        } else if (episodeNumber !== null) {
          throwVbenError('电影文件不能绑定 TV 集号', HttpStatus.BAD_REQUEST);
        }
        if (
          (mapping.fileRole === 'subtitle' && !language) ||
          (mapping.fileRole !== 'subtitle' && language !== null)
        ) {
          throwVbenError('字幕语言只能绑定到字幕文件', HttpStatus.BAD_REQUEST);
        }
        return {
          episodeNumber,
          fileRole: mapping.fileRole,
          index: mapping.index,
          language,
          unitId: mapping.unitId,
        };
      })
      .sort((left, right) => left.index - right.index);
    const videoKeys = selectedFileMappings
      .filter((mapping) => mapping.fileRole === 'video')
      .map(
        (mapping) => `${mapping.unitId}:${mapping.episodeNumber ?? 'movie'}`,
      );
    const subtitleKeys = selectedFileMappings
      .filter((mapping) => mapping.fileRole === 'subtitle')
      .map(
        (mapping) =>
          `${mapping.unitId}:${mapping.episodeNumber ?? 'movie'}:${mapping.language}`,
      );
    if (
      new Set(videoKeys).size !== videoKeys.length ||
      new Set(subtitleKeys).size !== subtitleKeys.length
    ) {
      throwVbenError('视频或字幕映射存在重复治理身份', HttpStatus.BAD_REQUEST);
    }
    if (source.sourceRole === 'supplemental_subtitle') {
      const subtitlePattern = /\.(?:ass|ssa|srt|vtt)$/iu;
      const fontPattern =
        /(?:^|\/)[^/]*fonts?[^/]*\.(?:7z|otf|rar|ttf|woff2?|zip)$/iu;
      if (
        !selectedEntries.some((entry) =>
          subtitlePattern.test(entry.relativePath),
        )
      ) {
        throwVbenError(
          '补充字幕来源至少选择一个字幕文件',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        selectedEntries.some(
          (entry) =>
            !subtitlePattern.test(entry.relativePath) &&
            !fontPattern.test(entry.relativePath),
        )
      ) {
        throwVbenError(
          '补充字幕来源只能选择字幕和必要字体',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        selectedFileMappings.some(
          (mapping) =>
            mapping.fileRole !== 'subtitle' && mapping.fileRole !== 'font',
        )
      ) {
        throwVbenError('补充字幕来源不能映射为视频', HttpStatus.BAD_REQUEST);
      }
    } else if (
      !selectedFileMappings.some((mapping) => mapping.fileRole === 'video')
    ) {
      throwVbenError('主媒体来源至少选择一个视频文件', HttpStatus.BAD_REQUEST);
    }
    source.selectedFileIndices = selectedFileIndices;
    source.selectedFileMappings = selectedFileMappings;
    source.selectedFileCount = selectedEntries.length;
    source.selectedBytes = selectedEntries.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    );
    this.refreshExpectedEpisodeNumbers(task);
    this.deriveBundledSubtitleContracts(task, true);
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 在允许阶段停用描述符，并触发来源运行态的精确清理。 */
  async removeSource(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const source = this.findSource(task, sourceId);
    const resettableUnboundResidue =
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.workItemId === null &&
      task.payloadSeal === null &&
      task.sealedPlan === null &&
      task.sealedPlanSha256 === null &&
      task.closedAt === null &&
      task.metadataIdentity === null &&
      task.metadataStatus === 'requires-agent' &&
      task.units.every(
        (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
      );
    if (
      task.activeRunId ||
      (!['intake', 'download'].includes(task.stage) &&
        !resettableUnboundResidue) ||
      task.payloadSeal ||
      task.sealedPlan
    ) {
      throwVbenError('当前阶段不能移除来源', HttpStatus.CONFLICT);
    }
    if (this.executionGateway?.enabled()) {
      const previous = {
        descriptorTombstonedAt: source.descriptorTombstonedAt,
        sourceHealth: source.sourceHealth,
        sourceHealthLabel: source.sourceHealthLabel,
        sourceHealthReasonLabel: source.sourceHealthReasonLabel,
      };
      source.descriptorTombstonedAt = new Date().toISOString();
      source.sourceHealth = 'unavailable';
      source.sourceHealthLabel = '正在精确清理';
      source.sourceHealthReasonLabel = '描述文件已停用，正在清理来源独占运行态';
      try {
        await this.reserveExecution(task, 'source.cleanup', [source]);
      } catch (error) {
        Object.assign(source, previous);
        throw error;
      }
      return task;
    }
    source.descriptorTombstonedAt = new Date().toISOString();
    this.finalizeSourceRemoval(task, source);
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return task;
  }

  /** 移除已清理来源，并重置相关字幕合同和可恢复任务状态。 */
  private finalizeSourceRemoval(
    task: MediaGovernanceTask,
    source: MediaGovernanceSource,
  ) {
    task.sources.splice(task.sources.indexOf(source), 1);
    for (const unit of task.units) {
      if (unit.subtitleContract?.sourceId === source.id) {
        unit.subtitleContract = null;
      }
    }
    this.refreshExpectedEpisodeNumbers(task);
    if (source.sourceRole === 'primary_media') task.governanceProfile = null;
    const hasNoPersistentArtifacts =
      task.sources.length === 0 &&
      task.workItemId === null &&
      task.payloadSeal === null &&
      task.sealedPlan === null &&
      task.sealedPlanSha256 === null &&
      task.closedAt === null &&
      task.metadataIdentity === null;
    const unitsUntouched = task.units.every(
      (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
    );
    if (hasNoPersistentArtifacts && unitsUntouched) {
      task.agentSession = null;
      task.closedMode = null;
      task.metadataStatus = 'pending';
      for (const unit of task.units) {
        unit.metadataProjection = {
          identityRefreshAttempts: 0,
          missingA: [],
          missingB: [],
          missingC: [],
          repairAttempts: 0,
          validBFallbacks: [],
        };
      }
    }
    task.gateReason = null;
    task.progress = {
      completedBytes: 0,
      completedItems: 0,
      etaLabel: '尚未开始',
      heartbeatLabel: '尚未开始',
      observedAt: null,
      percent: 0,
      progressLabel: '等待替换来源',
      speedLabel: '0 B/s',
      totalBytes: 0,
      totalItems: 0,
    };
    task.runState = 'draft';
    task.stage = 'intake';
    task.nextCommandLabel = '添加新的补充字幕来源';
    if (source.sourceRole === 'primary_media') {
      task.nextCommandLabel = '添加新的主媒体来源';
    }
  }

  /** 校验所选文件扩展名是否符合视频、字幕或字体角色。 */
  private assertSelectedFileRole(
    relativePath: string,
    fileRole: MediaGovernanceSelectedFileRole,
  ) {
    const lower = relativePath.toLowerCase();
    let valid: boolean;
    if (fileRole === 'video') {
      valid = /\.(?:avi|m2ts|m4v|mkv|mov|mp4|ts|webm)$/u.test(lower);
    } else if (fileRole === 'subtitle') {
      valid = /\.(?:ass|ssa|srt|sup|vtt)$/u.test(lower);
    } else {
      valid =
        /\.(?:otf|ttf|woff2?)$/u.test(lower) ||
        /(?:^|\/)[^/]*fonts?[^/]*\.(?:7z|rar|zip)$/u.test(lower);
    }
    if (!valid) {
      throwVbenError('文件扩展名与治理角色不匹配', HttpStatus.BAD_REQUEST);
    }
  }

  /** 从主媒体文件映射重新计算各季预期集号。 */
  private refreshExpectedEpisodeNumbers(task: MediaGovernanceTask) {
    if (task.mediaType !== 'tv') return;
    const primaryMappings = task.sources
      .filter((source) => source.sourceRole === 'primary_media')
      .flatMap((source) => source.selectedFileMappings)
      .filter((mapping) => mapping.fileRole === 'video');
    for (const unit of task.units) {
      unit.expectedEpisodeNumbers = [
        ...new Set(
          primaryMappings
            .filter((mapping) => mapping.unitId === unit.id)
            .map((mapping) => mapping.episodeNumber)
            .filter((episode): episode is number => episode !== null),
        ),
      ].sort((left, right) => left - right);
    }
  }

  /** 从同包简体字幕映射推导逐季单一发布组合同。 */
  private deriveBundledSubtitleContracts(
    task: MediaGovernanceTask,
    strict = false,
  ) {
    if (task.governanceProfile !== 'sidecar-bundled') return;
    for (const unit of task.units) {
      if (!unit.seasonNumber) continue;
      const sources = task.sources.filter(
        (source) =>
          source.sourceRole === 'primary_media' &&
          source.contentKind === 'bundled_sidecar_media' &&
          source.selectedFileMappings.some(
            (mapping) =>
              mapping.unitId === unit.id &&
              mapping.fileRole === 'subtitle' &&
              mapping.language === 'zh-CN',
          ),
      );
      let source = null;
      if (sources.length === 1) source = sources[0];
      const releaseGroup = source?.releaseGroup?.trim();
      let mappings: Array<{ episodeNumber: number; relativePath: string }> = [];
      if (source) {
        mappings = source.selectedFileMappings
          .filter(
            (mapping) =>
              mapping.unitId === unit.id &&
              mapping.fileRole === 'subtitle' &&
              mapping.language === 'zh-CN' &&
              mapping.episodeNumber !== null,
          )
          .map((mapping) => ({
            episodeNumber: mapping.episodeNumber!,
            relativePath:
              source.manifest.find((entry) => entry.index === mapping.index)
                ?.relativePath ?? '',
          }))
          .sort((left, right) => left.episodeNumber - right.episodeNumber);
      }
      const complete =
        Boolean(source && releaseGroup) &&
        unit.expectedEpisodeNumbers.length > 0 &&
        mappings.length === unit.expectedEpisodeNumbers.length &&
        mappings.every(
          (mapping, index) =>
            mapping.relativePath.length > 0 &&
            mapping.episodeNumber === unit.expectedEpisodeNumbers[index],
        );
      if (!complete) {
        unit.subtitleContract = null;
        if (strict) {
          throwVbenError(
            '同包外挂字幕必须由一个发布组完整覆盖整季简体中文字幕',
            HttpStatus.CONFLICT,
          );
        }
        continue;
      }
      const [validated] = validateSubtitleContracts([
        {
          expectedEpisodeNumbers: unit.expectedEpisodeNumbers,
          mappings: mappings.map((mapping) => ({
            episodeNumber: mapping.episodeNumber,
            releaseGroup: releaseGroup!,
          })),
          seasonNumber: unit.seasonNumber,
          sourceId: source!.id,
        },
      ]);
      unit.subtitleContract = {
        expectedEpisodeNumbers: validated.expectedEpisodeNumbers,
        mappings,
        releaseGroup: validated.releaseGroup,
        sourceId: validated.sourceId,
      };
    }
  }

  /** 校验补充字幕来源后绑定完整逐季字幕合同。 */
  async bindSubtitleContract(
    taskId: string,
    unitId: string,
    input: MediaGovernanceSubtitleContractDto,
  ) {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const unit = task.units.find((item) => item.id === unitId);
    if (!unit || !unit.seasonNumber) {
      throwVbenError(
        '字幕合同只能绑定到已声明的 TV 季',
        HttpStatus.BAD_REQUEST,
      );
    }
    const source = this.findSource(task, input.sourceId);
    if (source.sourceRole !== 'supplemental_subtitle') {
      throwVbenError('字幕合同必须使用补充字幕来源', HttpStatus.BAD_REQUEST);
    }
    if (!source.seasonNumbers.includes(unit.seasonNumber)) {
      throwVbenError('字幕来源季范围与目标季不匹配', HttpStatus.BAD_REQUEST);
    }
    if (
      source.releaseGroup &&
      source.releaseGroup !== input.releaseGroup.trim()
    ) {
      throwVbenError(
        '字幕合同发布组必须与所选字幕来源一致',
        HttpStatus.BAD_REQUEST,
      );
    }
    const mappings = input.mappings.map((mapping) => ({
      episodeNumber: mapping.episodeNumber,
      relativePath: validateDescriptorManifestEntry({
        entryType: 'file',
        executable: false,
        relativePath: mapping.relativePath,
      }),
    }));
    const [validated] = validateSubtitleContracts([
      {
        expectedEpisodeNumbers: input.expectedEpisodeNumbers,
        mappings: mappings.map((mapping) => ({
          episodeNumber: mapping.episodeNumber,
          releaseGroup: input.releaseGroup,
        })),
        seasonNumber: unit.seasonNumber,
        sourceId: input.sourceId,
      },
    ]);
    unit.expectedEpisodeNumbers = validated.expectedEpisodeNumbers;
    unit.subtitleContract = {
      expectedEpisodeNumbers: validated.expectedEpisodeNumbers,
      mappings,
      releaseGroup: validated.releaseGroup,
      sourceId: validated.sourceId,
    };
    task.nextCommandLabel = '检查来源清单';
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    return unit;
  }

  /** 启动正式来源清单检查，或在模拟模式构造受限清单。 */
  async inspectSource(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const source = this.findSource(task, sourceId);
    if (this.executionGateway?.enabled()) {
      source.sourceHealth = 'probing';
      source.sourceHealthLabel = '等待 NAS 检查来源清单';
      source.sourceHealthReasonLabel = '最长 2 分钟，期间每 5 秒更新等待进度';
      await this.reserveExecution(task, 'source.inspect', [source]);
      return source;
    }
    if (source.manifestState === 'pending-inspection') {
      let manifestIndex = 0;
      if (source.sourceRole === 'supplemental_subtitle') {
        source.manifest = task.units.flatMap((unit) => {
          if (unit.subtitleContract?.sourceId !== source.id) return [];
          return unit.subtitleContract.mappings.map((mapping) => ({
            executable: false,
            index: manifestIndex++,
            relativePath: mapping.relativePath,
            sizeBytes: 2 * 1024 * 1024,
          }));
        });
      } else {
        source.manifest = task.units.map((unit, index) => {
          let relativePath = 'Movie.mkv';
          if (unit.seasonNumber) {
            relativePath = `${unit.seasonNumber}/Episode-${String(index + 1).padStart(2, '0')}.mkv`;
          }
          return {
            executable: false,
            index,
            relativePath: validateDescriptorManifestEntry({
              entryType: 'file',
              executable: false,
              relativePath,
            }),
            sizeBytes: 1024 * 1024 * 1024,
          };
        });
      }
      if (source.manifest.length === 0) {
        throwVbenError('来源尚未绑定可检查的文件合同', HttpStatus.CONFLICT);
      }
      source.manifestSha256 = createHash('sha256')
        .update(JSON.stringify(source.manifest))
        .digest('hex');
      source.manifestState = 'inspected';
      source.selectedBytes = source.manifest.reduce(
        (total, item) => total + item.sizeBytes,
        0,
      );
      source.selectedFileCount = source.manifest.length;
      source.selectedFileIndices = source.manifest.map((entry) => entry.index);
    }
    task.nextCommandLabel = '运行死种/死链探针';
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 启动来源运行时可用性探针，或返回模拟探针结果。 */
  async probeRuntimeSource(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceSource> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const source = this.findSource(task, sourceId);
    if (source.manifestState !== 'inspected') {
      throwVbenError('必须先检查来源清单', HttpStatus.CONFLICT);
    }
    if (this.executionGateway?.enabled()) {
      source.sourceHealth = 'probing';
      source.sourceHealthLabel = '正在运行死种/死链探针';
      source.sourceHealthReasonLabel = '最长 10 分钟给出可复核分类';
      await this.reserveExecution(task, 'source.probe-runtime', [source]);
      return source;
    }
    source.sourceHealth = 'viable';
    source.sourceHealthLabel = '演示探针通过';
    source.sourceHealthReasonLabel = '进程内演示未连接 NAS，正式探针仍保持关闭';
    task.nextCommandLabel = '开始 NAS 下载';
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
  }

  /** 校验所有来源与文件映射后启动或续接隔离下载。 */
  async startDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.runState === 'running') {
      throwVbenError('任务已有运行中的操作', HttpStatus.CONFLICT);
    }
    const primary = task.sources.find(
      (source) => source.sourceRole === 'primary_media',
    );
    if (
      !primary ||
      primary.descriptorTombstonedAt !== null ||
      primary.sourceHealth !== 'viable'
    ) {
      throwVbenError('主媒体来源尚未通过运行时探针', HttpStatus.CONFLICT);
    }
    if (
      task.sources.some(
        (source) =>
          source.descriptorTombstonedAt !== null ||
          source.manifestState !== 'inspected' ||
          source.sourceHealth !== 'viable',
      )
    ) {
      throwVbenError('仍有来源未完成清单检查或运行时探针', HttpStatus.CONFLICT);
    }
    this.assertDownloadFileMappings(task);
    if (this.executionGateway?.enabled()) {
      let action: 'source.download' | 'source.resume' = 'source.download';
      if (task.stage === 'download' && task.runState === 'blocked') {
        action = 'source.resume';
      }
      await this.reserveExecution(task, action, task.sources);
      return task;
    }
    task.stage = 'download';
    task.runState = 'running';
    task.nextCommandLabel = '等待来源载荷就绪';
    const selectedBytes = task.sources.reduce(
      (total, source) => total + source.selectedBytes,
      0,
    );
    const selectedFileCount = task.sources.reduce(
      (total, source) => total + source.selectedFileCount,
      0,
    );
    task.progress = {
      completedBytes: 0,
      completedItems: 0,
      etaLabel: '演示约 1 秒',
      heartbeatLabel: '刚刚',
      observedAt: new Date().toISOString(),
      percent: 0,
      progressLabel: `正在连接来源（0/${selectedFileCount}）`,
      speedLabel: '演示模式',
      totalBytes: selectedBytes,
      totalItems: selectedFileCount,
    };
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    this.scheduleProgress(task, { selectedBytes, selectedFileCount });
    return task;
  }

  /** 校验下载来源的文件映射、视频覆盖与字幕合同完整性。 */
  private assertDownloadFileMappings(task: MediaGovernanceTask) {
    for (const source of task.sources) {
      const mappedIndices = source.selectedFileMappings.map(
        (mapping) => mapping.index,
      );
      if (
        source.selectedFileCount === 0 ||
        source.selectedFileMappings.length !== source.selectedFileCount ||
        mappedIndices.some(
          (index) => !source.selectedFileIndices.includes(index),
        ) ||
        source.selectedFileIndices.some(
          (index) => !mappedIndices.includes(index),
        )
      ) {
        throwVbenError('来源文件尚未完成一对一治理映射', HttpStatus.CONFLICT);
      }
    }
    const primaryVideos = task.sources
      .filter((source) => source.sourceRole === 'primary_media')
      .flatMap((source) => source.selectedFileMappings)
      .filter((mapping) => mapping.fileRole === 'video');
    for (const unit of task.units) {
      const videos = primaryVideos.filter(
        (mapping) => mapping.unitId === unit.id,
      );
      if (videos.length === 0) {
        throwVbenError(
          `${unit.seasonNumber ?? '电影单元'} 缺少已映射视频`,
          HttpStatus.CONFLICT,
        );
      }
    }
    if (task.governanceProfile === 'embedded') return;
    const subtitleMappings = task.sources.flatMap((source) =>
      source.selectedFileMappings
        .filter(
          (mapping) =>
            mapping.fileRole === 'subtitle' &&
            (mapping.language === 'zh-CN' || mapping.language === 'zh-TW'),
        )
        .map((mapping) => ({ mapping, source })),
    );
    for (const unit of task.units) {
      let expectedEpisodes: Array<null | number> = [null];
      if (task.mediaType === 'tv') {
        expectedEpisodes = unit.expectedEpisodeNumbers;
      }
      const missing = expectedEpisodes.filter(
        (episodeNumber) =>
          !subtitleMappings.some(
            ({ mapping }) =>
              mapping.unitId === unit.id &&
              mapping.episodeNumber === episodeNumber,
          ),
      );
      if (missing.length > 0) {
        throwVbenError(
          `${unit.seasonNumber ?? '电影单元'} 中文字幕映射不完整`,
          HttpStatus.CONFLICT,
        );
      }
      if (task.governanceProfile !== 'sidecar-linked') continue;
      const contract = unit.subtitleContract;
      if (
        !contract ||
        contract.expectedEpisodeNumbers.length !== expectedEpisodes.length ||
        contract.expectedEpisodeNumbers.some(
          (episode, index) => episode !== expectedEpisodes[index],
        )
      ) {
        throwVbenError(
          `${unit.seasonNumber ?? '电影单元'} 缺少完整字幕合同`,
          HttpStatus.CONFLICT,
        );
      }
      const contractSource = task.sources.find(
        (source) => source.id === contract.sourceId,
      );
      if (
        !contractSource ||
        contractSource.releaseGroup !== contract.releaseGroup
      ) {
        throwVbenError('字幕合同来源或发布组不匹配', HttpStatus.CONFLICT);
      }
      for (const mapping of contract.mappings) {
        const selectedMapping = contractSource.selectedFileMappings.find(
          (candidate) =>
            candidate.fileRole === 'subtitle' &&
            candidate.unitId === unit.id &&
            candidate.episodeNumber === mapping.episodeNumber,
        );
        let manifestEntry = null;
        if (selectedMapping) {
          manifestEntry = contractSource.manifest.find(
            (entry) => entry.index === selectedMapping.index,
          );
        }
        if (
          !manifestEntry ||
          manifestEntry.relativePath !== mapping.relativePath
        ) {
          throwVbenError('字幕合同与密封文件映射不一致', HttpStatus.CONFLICT);
        }
      }
    }
  }

  /** 请求安全暂停当前下载运行。 */
  async pauseDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'pause');
  }

  /** 请求取消当前下载并保留后续精确清理所需载荷。 */
  async cancelDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'cancel');
  }

  /** 请求从同一运行身份继续已暂停下载。 */
  async resumeDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'resume');
  }

  /** 校验下载运行身份后发送幂等暂停、取消或续传命令。 */
  private async controlDownload(
    taskId: string,
    expectedRevision: number,
    command: 'cancel' | 'pause' | 'resume',
  ) {
    const task = this.detail(taskId);
    this.assertRevision(task, expectedRevision);
    let commandAllowed = false;
    if (command === 'pause') commandAllowed = task.runState === 'running';
    if (command === 'resume') commandAllowed = task.runState === 'blocked';
    if (command === 'cancel') {
      commandAllowed = ['blocked', 'running'].includes(task.runState);
    }
    if (task.stage !== 'download' || !task.activeRunId || !commandAllowed) {
      const message = {
        cancel: '当前没有可取消的下载',
        pause: '当前没有可暂停的下载',
        resume: '当前没有可续传的下载',
      }[command];
      throwVbenError(message, HttpStatus.CONFLICT);
    }
    if (
      !this.executionGateway?.enabled() ||
      !this.stateStore?.readRunEnvelope
    ) {
      throwVbenError(
        '媒体执行器控制链路暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const envelope = await this.stateStore.readRunEnvelope(task.activeRunId);
    if (
      !envelope ||
      !['source.download', 'source.resume'].includes(envelope.action) ||
      envelope.taskId !== task.id ||
      envelope.runId !== task.activeRunId
    ) {
      throwVbenError('下载 Run 身份不匹配', HttpStatus.CONFLICT);
    }
    await this.executionGateway.control({
      command,
      controlId: `media-control-${randomUUID()}`,
      runId: envelope.runId,
      sealedInputSha256: envelope.sealedInputSha256,
      taskId: task.id,
    });
    task.runState = 'blocked';
    if (command === 'resume') task.runState = 'running';
    task.gateReason = null;
    if (command === 'pause') task.gateReason = '下载暂停请求已送达';
    if (command === 'cancel') task.gateReason = '下载取消请求已送达';
    task.nextCommandLabel = {
      cancel: '等待执行器停止并保留待清理载荷',
      pause: '等待执行器确认安全暂停',
      resume: '正在从同一 Run 续传',
    }[command];
    this.refreshSemanticProjection(task);
    await this.persistTask(task);
    this.publishTaskPatch(task, 'state-updated');
    return task;
  }

  /** 密封本地治理计划，并启动正式执行或受限模拟流程。 */
  async startGovernance(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const retryingPlanFailure =
      task.stage === 'download' &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.payloadSeal !== null &&
      task.gateReason?.startsWith('本地计划无法安全密封：') === true;
    const retryingExecutionFailure =
      task.stage === 'governance' &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.payloadSeal !== null &&
      task.sealedPlan !== null &&
      task.sealedPlanSha256 !== null;
    if (
      !(
        (task.stage === 'download' &&
          (task.runState === 'succeeded' || retryingPlanFailure)) ||
        retryingExecutionFailure
      )
    ) {
      throwVbenError('来源载荷尚未就绪', HttpStatus.CONFLICT);
    }
    if (this.executionGateway?.enabled()) {
      if (!task.payloadSeal) {
        throwVbenError('下载载荷缺少密封证据', HttpStatus.CONFLICT);
      }
      if (!task.workItemId) {
        if (!this.databaseReady() || !this.stateStore?.reserveWorkItemId) {
          throwVbenError(
            '媒体治理作品编号分配链路暂不可用',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        task.workItemId = await this.stateStore.reserveWorkItemId(task.id);
      }
      if (retryingPlanFailure || retryingExecutionFailure) {
        task.runState = 'succeeded';
        task.gateReason = null;
        task.nextCommandLabel = '开始本地治理';
      }
      if (!task.sealedPlan) {
        try {
          task.sealedPlan = buildAdminMediaGovernancePlan(
            task,
            task.payloadSeal,
          );
          task.sealedPlanSha256 = sha256Json(task.sealedPlan);
        } catch (error) {
          task.runState = 'blocked';
          task.gateReason = '本地计划无法安全密封';
          if (error instanceof Error) {
            task.gateReason = `本地计划无法安全密封：${error.message}`.slice(
              0,
              160,
            );
          }
          task.nextCommandLabel = '修正作品编号、来源映射或字幕合同后重试';
          this.bumpRevision(task);
          await this.commitTask(task, 'state-updated');
          throwVbenError(task.gateReason, HttpStatus.CONFLICT);
        }
      }
      await this.reserveExecution(task, 'governance.execute');
      return task;
    }
    task.stage = 'governance';
    task.runState = 'running';
    task.nextCommandLabel = '等待目录与元数据验证';
    task.progress = {
      ...task.progress,
      completedItems: 1,
      etaLabel: '演示约 1 秒',
      percent: 10,
      progressLabel: '正在密封本地治理计划（1/6）',
      totalItems: 6,
    };
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    const timer = setTimeout(() => {
      task.stage = 'metadata';
      task.runState = 'blocked';
      task.metadataStatus = 'requires-agent';
      task.nextCommandLabel = '启动 CodexAgent 人工治理';
      task.progress = {
        ...task.progress,
        completedItems: 6,
        etaLabel: '等待人工治理',
        percent: 100,
        progressLabel: '本地治理演示完成，元数据需要人工核验',
      };
      this.refreshSemanticProjection(task);
      void this.commitTask(task, 'state-updated').catch(() => undefined);
    }, 500);
    timer.unref?.();
    return task;
  }

  /** 校验元数据门状态后启动分档事实核验。 */
  async startMetadataVerification(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const regularVerificationInvalid =
      task.stage !== 'metadata' ||
      task.runState !== 'succeeded' ||
      task.metadataStatus !== 'pending';
    const retryingFailedVerification = this.canRetryFailedVerification(
      task,
      'metadata',
      'pending',
    );
    const refreshingDeferredIdentity =
      this.canRefreshDeferredMetadataIdentity(task);
    if (
      (regularVerificationInvalid &&
        !this.canRefreshLegacyMetadata(task) &&
        !refreshingDeferredIdentity &&
        !retryingFailedVerification) ||
      !task.sealedPlan
    ) {
      throwVbenError('当前任务尚未进入元数据核验门', HttpStatus.CONFLICT);
    }
    await this.reserveExecution(task, 'metadata.verify');
    return task;
  }

  /** 在次数与缺项边界内启动确定性元数据修复。 */
  async startMetadataRepair(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (
      task.stage !== 'metadata' ||
      task.runState !== 'blocked' ||
      task.metadataStatus !== 'requires-agent' ||
      !task.sealedPlan ||
      !this.canRunBoundedMetadataRepair(task)
    ) {
      throwVbenError('当前任务不满足有界元数据修复条件', HttpStatus.CONFLICT);
    }
    await this.reserveExecution(task, 'metadata.repair');
    return task;
  }

  /** 在元数据门闭合后启动独立本地验收。 */
  async startAcceptanceVerification(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const retryingFailedVerification = this.canRetryFailedVerification(
      task,
      'acceptance',
      'verified',
    );
    if (
      ((task.stage !== 'metadata' ||
        task.runState !== 'succeeded' ||
        task.metadataStatus !== 'verified') &&
        !retryingFailedVerification) ||
      !task.sealedPlan
    ) {
      throwVbenError('当前任务尚未通过元数据核验门', HttpStatus.CONFLICT);
    }
    let sources: MediaGovernanceSource[] | undefined;
    if (task.sources.length > 0) sources = task.sources;
    await this.reserveExecution(task, 'acceptance.verify', sources);
    return task;
  }

  /** 保留当前运行边界并启动或安全重试 Codex Agent 会话。 */
  async startAgent(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask['agentSession']> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.stage === 'closed') {
      throwVbenError('已完成任务不能启动 Agent', HttpStatus.CONFLICT);
    }
    let previousAgentSession = null;
    if (task.agentSession) {
      previousAgentSession = structuredClone(task.agentSession);
    }
    const retryFailedTurn = Boolean(
      previousAgentSession &&
      (previousAgentSession.status === 'failed' ||
        this.isLegacyFailedAgentSession(previousAgentSession)),
    );
    if (previousAgentSession && !retryFailedTurn) {
      throwVbenError('任务已有运行中的 Agent 会话', HttpStatus.CONFLICT);
    }
    if (this.agentGateway) {
      if (!this.agentGateway.enabled()) {
        throwVbenError(
          'NAS CodexAgent gateway 尚未配置',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const primaryRunActive = Boolean(task.activeRunId);
      const previousInputSnapshotSha256 = task.inputSnapshotSha256;
      const previousNextCommandLabel = task.nextCommandLabel;
      const previousRevision = task.revision;
      const previousRunState = task.runState;
      let nextRevision = task.revision + 1;
      if (primaryRunActive) nextRevision = task.revision;
      const replayKey = this.agentReplayKey(task, nextRevision);
      const compactContext = this.buildAgentCompactContext(task, nextRevision);
      let manifestSha256 = task.inputSnapshotSha256;
      if (!primaryRunActive) {
        manifestSha256 = sha256Json({
          compactContext,
          taskId: task.id,
          taskRevision: nextRevision,
        });
      }
      const request: Parameters<
        MediaGovernanceCodexAgentGateway['startTurn']
      >[0] = {
        compactContext,
        currentStage: task.stage,
        currentUnitId: task.units[0]?.id ?? null,
        manifestSha256,
        operatorCommand: this.buildAgentOperatorCommand(task),
        replayKey,
        taskId: task.id,
        taskRevision: nextRevision,
      };
      if (retryFailedTurn) request.recoveryMode = 'restart-failed-turn';
      const policy = buildMediaCodexAgentPolicy(task.id);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      if (!primaryRunActive) {
        task.inputSnapshotSha256 = manifestSha256;
        task.revision = nextRevision;
      }
      task.agentSession = {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: sha256Json({
          capsuleSha256: capsule.capsuleSha256,
          phase: 'starting',
          taskId: task.id,
          taskRevision: nextRevision,
        }),
        currentActionLabel: '正在创建 Agent 会话',
        currentUnitId: request.currentUnitId,
        lastHeartbeatLabel: '刚刚',
        lastSequence: previousAgentSession?.lastSequence ?? 0,
        pendingPlanSha256: null,
        policyBoundaryLabel:
          '五层边界已启用；真实媒体、云端和数据库写入保持关闭',
        policySha256: policy.policySha256,
        policyVersion: policy.policyVersion,
        status: 'running',
        statusLabel: '正在创建 Agent 会话',
        threadId: this.pendingAgentThreadId(task.id),
      };
      if (!primaryRunActive) {
        task.runState = 'running';
        task.nextCommandLabel = '等待 Agent 会话绑定';
      }
      this.refreshSemanticProjection(task);
      await this.commitTask(task, 'state-updated');
      let session;
      try {
        session = await this.agentGateway.startTurn(request);
      } catch {
        try {
          session = await this.agentGateway.session(task.id);
        } catch {
          session = null;
        }
      }
      if (!session || !this.agentSessionMatchesReservation(task, session)) {
        if (task.agentSession?.capsuleSha256 === capsule.capsuleSha256) {
          task.agentSession = previousAgentSession;
        }
        if (!primaryRunActive && task.revision === nextRevision) {
          task.inputSnapshotSha256 = previousInputSnapshotSha256;
          task.nextCommandLabel = previousNextCommandLabel;
          task.revision = previousRevision;
          task.runState = previousRunState;
        }
        this.refreshSemanticProjection(task);
        await this.commitTask(task, 'state-updated');
        let message = 'NAS CodexAgent gateway 当前不可用';
        let status = HttpStatus.SERVICE_UNAVAILABLE;
        if (session) {
          message = 'NAS CodexAgent 会话身份不匹配';
          status = HttpStatus.CONFLICT;
        }
        throwVbenError(message, status);
      }
      const reservedSession = task.agentSession!;
      const failedRemoteSession = ['failed', 'interrupted'].includes(
        String(session.terminalKind),
      );
      let agentStatus: NonNullable<
        MediaGovernanceTask['agentSession']
      >['status'] = 'needs-operator';
      let agentStatusLabel = '等待人工放行';
      if (session.status === 'active') {
        agentStatus = 'running';
        agentStatusLabel = 'Agent 正在治理';
      } else if (failedRemoteSession) {
        agentStatus = 'failed';
        agentStatusLabel = 'Agent 已阻塞，可安全重试';
      }
      task.agentSession = {
        ...reservedSession,
        capsuleSha256: session.capsuleSha256,
        checkpointSha256: session.checkpointSha256,
        currentActionLabel: '正在核对媒体身份与季级字幕合同',
        currentUnitId: session.currentUnitId,
        lastHeartbeatLabel: '刚刚',
        lastSequence: Math.max(
          reservedSession.lastSequence,
          session.lastEventSequence,
        ),
        policySha256: session.policySha256,
        policyVersion: session.policyVersion,
        status: agentStatus,
        statusLabel: agentStatusLabel,
        threadId: session.threadId,
      };
      if (!primaryRunActive) {
        task.runState = 'blocked';
        if (session.status === 'active') task.runState = 'running';
        task.nextCommandLabel = '观察 Agent 语义进度';
      }
      this.refreshSemanticProjection(task);
      await this.commitTask(task, 'state-updated');
      return task.agentSession;
    }
    task.agentSession = {
      capsuleSha256: '0'.repeat(64),
      checkpointSha256: '0'.repeat(64),
      currentActionLabel: '正在核对媒体身份与季级字幕合同',
      currentUnitId: task.units[0]?.id ?? null,
      lastHeartbeatLabel: '刚刚',
      lastSequence: 0,
      pendingPlanSha256: null,
      policyBoundaryLabel: '五层边界已启用；NAS、媒体和云端写适配器保持关闭',
      policySha256: '0'.repeat(64),
      policyVersion: 'process-simulator-v1',
      status: 'running',
      statusLabel: 'Agent 正在治理',
      threadId: `media-agent-${randomUUID()}`,
    };
    const primaryRunActive = Boolean(task.activeRunId);
    if (!primaryRunActive) {
      task.runState = 'running';
      task.nextCommandLabel = '观察 Agent 语义进度';
      this.bumpRevision(task);
    }
    await this.commitTask(task, 'state-updated');
    const timer = setTimeout(() => {
      if (!task.agentSession) return;
      task.agentSession.currentActionLabel = '等待操作员确认候选身份';
      task.agentSession.lastHeartbeatLabel = '刚刚';
      task.agentSession.status = 'needs-operator';
      task.agentSession.statusLabel = '等待人工放行';
      if (!primaryRunActive) {
        task.runState = 'blocked';
        task.nextCommandLabel = '选择候选并填写放行理由';
      }
      this.refreshSemanticProjection(task);
      void this.commitTask(task, 'state-updated').catch(() => undefined);
    }, 500);
    timer.unref?.();
    return task.agentSession;
  }

  /** 返回 Agent 回调持久化链路的就绪状态。 */
  agentCallbackHealth() {
    if (this.databaseReady()) {
      return { persistenceMode: 'database', status: 'ready' } as const;
    }
    return {
      persistenceMode: 'process-simulator',
      status: 'not-ready',
    } as const;
  }

  /** 同步远端 Agent 会话，并投影最新状态、结果与对话增量。 */
  async agentSession(
    taskId: string,
    query: MediaGovernanceAgentSessionQueryDto = {
      afterSequence: 0,
      limit: 200,
    },
  ) {
    const task = this.detail(taskId);
    const primaryRunActive = Boolean(task.activeRunId);
    if (!task.agentSession || !this.agentGateway?.enabled()) {
      return task.agentSession;
    }
    const previousTaskSha256 = sha256Json(task);
    let remoteSession;
    try {
      remoteSession = await this.agentGateway.session(taskId, query);
    } catch {
      throwVbenError(
        'NAS CodexAgent gateway 当前不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!remoteSession) {
      throwVbenError('NAS CodexAgent 会话不存在', HttpStatus.NOT_FOUND);
    }
    if (
      remoteSession.taskId !== task.id ||
      remoteSession.threadId !== task.agentSession.threadId ||
      remoteSession.policySha256 !== task.agentSession.policySha256 ||
      remoteSession.capsuleSha256 !== task.agentSession.capsuleSha256 ||
      remoteSession.taskRevision > task.revision
    ) {
      throwVbenError('NAS CodexAgent 会话身份不匹配', HttpStatus.CONFLICT);
    }
    if (remoteSession.taskRevision < task.revision - 1) {
      return this.projectAgentConversation(task, remoteSession);
    }
    const hasPendingPlan = Boolean(task.agentSession.pendingPlanSha256);
    const failedRemoteSession = ['failed', 'interrupted'].includes(
      String(remoteSession.terminalKind),
    );
    const retainedLegacyFailure =
      remoteSession.terminalKind === null &&
      task.agentSession.status === 'failed';
    task.agentSession = {
      ...task.agentSession,
      checkpointSha256: remoteSession.checkpointSha256,
      currentActionLabel:
        remoteSession.result?.summary ?? task.agentSession.currentActionLabel,
      currentUnitId: remoteSession.currentUnitId,
      lastHeartbeatLabel: '刚刚',
      lastSequence: Math.max(
        task.agentSession.lastSequence,
        remoteSession.lastEventSequence,
      ),
    };
    const result = remoteSession.result;
    if (remoteSession.status === 'active') {
      task.agentSession.status = 'running';
      task.agentSession.statusLabel = 'Agent 正在治理';
      if (!primaryRunActive) task.runState = 'running';
    } else if (failedRemoteSession || retainedLegacyFailure) {
      this.discardAgentPendingAmendment(task);
      task.agentSession.pendingPlanSha256 = null;
      task.agentSession.status = 'failed';
      task.agentSession.statusLabel = 'Agent 已阻塞，可安全重试';
      if (!primaryRunActive) task.runState = 'blocked';
    } else if (
      result?.status === 'plan-submitted' &&
      result.planSha256 &&
      hasPendingPlan &&
      result.planSha256 === task.agentSession.pendingPlanSha256
    ) {
      if (this.agentPendingAmendment(task)) {
        this.finalizeAgentIdentityAmendment(task, result.planSha256);
        task.agentSession.status = 'succeeded';
        task.agentSession.statusLabel = 'TMDB 身份已密封应用';
      } else {
        task.agentSession.status = 'needs-operator';
        task.agentSession.statusLabel = '密封文件计划待人工复核';
        if (!primaryRunActive) task.runState = 'blocked';
      }
      task.agentSession.pendingPlanSha256 = null;
      task.revision += 1;
    } else if (
      result?.status === 'plan-submitted' &&
      result.planSha256 &&
      this.hasAppliedAgentPlan(task, result.planSha256)
    ) {
      task.agentSession.status = 'succeeded';
      task.agentSession.statusLabel = 'TMDB 身份已密封应用';
      if (!primaryRunActive) task.runState = 'succeeded';
    } else if (
      result?.status === 'plan-submitted' &&
      !hasPendingPlan &&
      task.agentSession.status === 'needs-operator'
    ) {
      task.agentSession.statusLabel = '密封文件计划待人工复核';
      if (!primaryRunActive) task.runState = 'blocked';
    } else if (result?.status === 'requires-operator') {
      task.agentSession.status = 'needs-operator';
      task.agentSession.statusLabel = '等待人工选择 TMDB 候选';
      if (!primaryRunActive) task.runState = 'blocked';
    } else if (result?.status !== 'conversation-response') {
      this.discardAgentPendingAmendment(task);
      task.agentSession.pendingPlanSha256 = null;
      task.agentSession.status = 'failed';
      task.agentSession.statusLabel = 'Agent 结果未通过一致性校验，可安全重试';
      if (!primaryRunActive) task.runState = 'blocked';
    }
    this.refreshSemanticProjection(task);
    if (sha256Json(task) !== previousTaskSha256) {
      await this.commitTask(task, 'state-updated');
    }
    return this.projectAgentConversation(task, remoteSession);
  }

  /** 校验线程和对话版本后，在同一 Agent 会话发送操作员消息。 */
  async continueAgentConversation(
    taskId: string,
    input: MediaGovernanceAgentMessageDto,
  ) {
    const task = this.detail(taskId);
    if (
      task.stage === 'closed' ||
      !task.agentSession ||
      !this.agentGateway?.enabled()
    ) {
      let message = 'NAS CodexAgent 会话不可用';
      if (task.stage === 'closed') message = '已完成任务不能继续 Agent 对话';
      throwVbenError(message, HttpStatus.CONFLICT);
    }
    const remote = await this.agentGateway.session(taskId, {
      afterSequence: 0,
      limit: 1,
    });
    if (
      !remote ||
      remote.threadId !== input.threadId ||
      remote.threadId !== task.agentSession.threadId ||
      remote.policySha256 !== task.agentSession.policySha256
    ) {
      throwVbenError('NAS CodexAgent 会话身份不匹配', HttpStatus.CONFLICT);
    }
    if (remote.lastClientMessageId === input.clientMessageId) {
      return this.projectAgentConversation(task, remote);
    }
    if (
      remote.status === 'active' ||
      remote.conversationRevision !== input.expectedConversationRevision
    ) {
      let message = 'Agent 会话已有新消息，请刷新后重试';
      if (remote.status === 'active') message = 'Agent 正在处理上一条消息';
      throwVbenError(message, HttpStatus.CONFLICT);
    }
    const request = {
      clientMessageId: input.clientMessageId,
      compactContext: this.buildAgentCompactContext(task, task.revision),
      currentStage: task.stage,
      currentUnitId: task.units[0]?.id ?? null,
      manifestSha256: task.inputSnapshotSha256,
      operatorCommand: input.content.trim(),
      replayKey: `media-chat-${sha256Json({
        clientMessageId: input.clientMessageId,
        taskId,
        threadId: input.threadId,
      }).slice(0, 64)}`,
      taskId,
      taskRevision: task.revision,
    };
    const policy = buildMediaCodexAgentPolicy(task.id);
    const capsule = buildMediaCodexAgentCapsule(request, policy);
    const previousSession = structuredClone(task.agentSession);
    task.agentSession = {
      ...task.agentSession,
      capsuleSha256: capsule.capsuleSha256,
      checkpointSha256: sha256Json({
        capsuleSha256: capsule.capsuleSha256,
        clientMessageId: input.clientMessageId,
        phase: 'conversation-starting',
        taskId,
        taskRevision: task.revision,
      }),
      currentActionLabel: 'Agent 正在处理本回合消息',
      lastHeartbeatLabel: '刚刚',
      policySha256: policy.policySha256,
      policyVersion: policy.policyVersion,
      status: 'running',
      statusLabel: 'Agent 正在回复',
    };
    await this.persistTask(task);
    let session;
    try {
      session = await this.agentGateway.startTurn(request);
    } catch (error) {
      task.agentSession = previousSession;
      await this.persistTask(task);
      throw error;
    }
    if (
      session.threadId !== input.threadId ||
      session.capsuleSha256 !== capsule.capsuleSha256
    ) {
      task.agentSession = previousSession;
      await this.persistTask(task);
      throwVbenError('NAS CodexAgent 会话身份不匹配', HttpStatus.CONFLICT);
    }
    task.agentSession.checkpointSha256 = session.checkpointSha256;
    await this.persistTask(task);
    return this.projectAgentConversation(task, session);
  }

  /** 组合本地会话状态、远端消息和建议操作的安全投影。 */
  private projectAgentConversation(
    task: MediaGovernanceTask,
    remoteSession: Awaited<
      ReturnType<MediaGovernanceCodexAgentGateway['startTurn']>
    >,
  ) {
    return {
      ...structuredClone(task.agentSession),
      conversationRevision: remoteSession.conversationRevision ?? 0,
      hasMoreMessages: remoteSession.hasMoreMessages ?? false,
      historyComplete: remoteSession.historyComplete ?? true,
      messages: structuredClone(remoteSession.messages ?? []),
      recommendations: this.agentConversationRecommendations(
        task,
        remoteSession.result,
      ),
      result: structuredClone(remoteSession.result),
    };
  }

  /** 根据 Agent 结果或任务阶段生成有限的建议提问。 */
  private agentConversationRecommendations(
    task: MediaGovernanceTask,
    result: Awaited<
      ReturnType<MediaGovernanceCodexAgentGateway['startTurn']>
    >['result'],
  ) {
    if (result?.status === 'requires-operator') {
      return result.candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.summary,
        prompt: `请按当前边界复核候选 ${candidate.summary}，确认是否应作为本任务的资料源身份。`,
      }));
    }
    const stagePrompt = {
      acceptance: '解释当前独立验收结果，并给出仍需处理的事项。',
      closed: '总结这个任务的最终治理结果。',
      download: '分析当前来源、死种死链状态与下一步下载动作。',
      governance: '核对目录、命名、字幕关联和治理计划是否完整。',
      intake: '核对当前任务的基础身份与来源清单。',
      metadata: '核对当前元数据身份、缺项和有限修复路径。',
    }[task.stage];
    return [
      {
        id: `stage-${task.stage}`,
        label: '分析当前阶段',
        prompt: stagePrompt,
      },
      {
        id: 'explain-next-action',
        label: '说明下一步',
        prompt: `请解释“${task.nextCommandLabel}”的原因、输入和完成标准。`,
      },
    ];
  }

  /** 校验 Agent 工具身份与边界后执行受支持的类型化调用。 */
  async agentToolCall(input: MediaGovernanceAgentToolCallDto) {
    const task = this.detail(input.taskId);
    const session = task.agentSession;
    if (
      !session ||
      session.status !== 'running' ||
      input.taskRevision !== task.revision ||
      input.manifestSha256 !== task.inputSnapshotSha256
    ) {
      throwVbenError('Agent 工具调用身份不匹配', HttpStatus.CONFLICT);
    }
    if (
      input.policySha256 !== session.policySha256 ||
      input.capsuleSha256 !== session.capsuleSha256 ||
      !(MEDIA_CODEX_AGENT_TOOLS as readonly string[]).includes(input.tool)
    ) {
      throwVbenError('Agent 工具调用身份不匹配', HttpStatus.CONFLICT);
    }
    if (
      input.tool === 'plan.submit.sealed' &&
      (task.activeRunId || !['governance', 'metadata'].includes(task.stage))
    ) {
      throwVbenError(
        '当前阶段只允许 Agent 只读核对，不能提交密封写计划',
        HttpStatus.CONFLICT,
      );
    }
    let sealedPlan = null;
    if (input.tool === 'plan.submit.sealed') {
      sealedPlan = this.parseAgentSealedPlan(
        input.arguments,
        task.id,
        this.agentReplayKey(task, task.revision),
      );
    }
    const paths = this.agentToolPaths(input.tool, sealedPlan);
    try {
      validateAgentBoundaryRequest({
        capsule: {
          allowedRoots: [
            `/vol2/1000/.kt-media-governance-staging/${task.id}`,
            `/vol1/docker/kt-codex/artifacts/automation/media/${task.id}`,
          ],
          allowedTools: [...MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS],
          capsuleSha256: session.capsuleSha256,
          cloudGate: false,
          currentStage: task.stage,
          manifestSha256: task.inputSnapshotSha256,
          outputSchema: 'media-governance-agent-result-v1',
          policySha256: session.policySha256,
          policyVersion: session.policyVersion,
          taskId: task.id,
          taskRevision: task.revision,
        },
        policy: {
          allowedRoots: [
            `/vol2/1000/.kt-media-governance-staging/${task.id}`,
            `/vol1/docker/kt-codex/artifacts/automation/media/${task.id}`,
          ],
          allowedTools: [...MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS],
          approvalPolicy: 'never',
          cleanCwd: '/vol1/docker/kt-codex-agent/runtime',
          permissionProfile: 'media-agent',
          policySha256: session.policySha256,
          policyVersion: session.policyVersion,
        },
        request: {
          instructionSource: 'task-capsule',
          paths,
          requestsCloud: false,
          symbolicLinkPaths: [],
          tool: input.tool,
        },
        task: this.projectAgentTask(task),
        units: this.projectAgentUnits(task),
      });
    } catch {
      throwVbenError('Agent 工具调用越过任务边界', HttpStatus.BAD_REQUEST);
    }

    switch (input.tool) {
      case 'media.identity.read':
        this.assertAgentReadArguments(input.arguments);
        return {
          identityPreview: task.identityPreview,
          mediaType: task.mediaType,
          metadataIdentity: task.metadataIdentity,
          providerRef: task.providerRef,
          releaseYear: task.releaseYear,
          taskId: task.id,
          titleHint: task.titleHint,
        };
      case 'media.manifest.read':
        this.assertAgentReadArguments(input.arguments);
        return task.sources.map((source) => ({
          id: source.id,
          infoHash: source.infoHash,
          manifest: source.manifest,
          manifestSha256: source.manifestSha256,
          sourceRole: source.sourceRole,
        }));
      case 'media.probe.read':
        this.assertAgentReadArguments(input.arguments);
        return task.sources.map((source) => ({
          id: source.id,
          sourceHealth: source.sourceHealth,
          sourceHealthLabel: source.sourceHealthLabel,
          sourceHealthReasonLabel: source.sourceHealthReasonLabel,
        }));
      case 'provider.metadata.read':
        this.assertAgentReadArguments(input.arguments);
        try {
          return {
            candidates: await this.searchAgentIdentityCandidates(task),
            declaredProvider: task.providerRef,
            identityPreview: task.identityPreview,
            networkLookupPerformed: true,
            verifiedIdentity: task.metadataIdentity,
          };
        } catch {
          throwVbenError(
            'TMDB 资料源查询暂不可用',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
      case 'subtitle.contract.read':
        this.assertAgentReadArguments(input.arguments);
        return task.units.map((unit) => ({
          id: unit.id,
          seasonNumber: unit.seasonNumber,
          subtitleContract: unit.subtitleContract,
        }));
      case 'evidence.read':
        this.assertAgentReadArguments(input.arguments);
        return this.evidence(task.id);
      case 'plan.submit.sealed': {
        if (!sealedPlan) {
          throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
        }
        if (this.agentIdentityRepairRequired(task) && !sealedPlan.identity) {
          throwVbenError(
            '当前元数据缺口必须提交 TMDB 身份修正',
            HttpStatus.CONFLICT,
          );
        }
        let identityCandidate: MediaGovernanceTmdbCandidate | null = null;
        if (sealedPlan.identity) {
          if (!task.sealedPlan) {
            throwVbenError('当前任务缺少本地密封计划', HttpStatus.CONFLICT);
          }
          identityCandidate = await this.assertAgentIdentityCandidate(
            task,
            sealedPlan.identity,
          );
        }
        const planSha256 = sha256Json({
          capsuleSha256: input.capsuleSha256,
          manifestSha256: input.manifestSha256,
          plan: sealedPlan,
          policySha256: input.policySha256,
          taskId: task.id,
          taskRevision: task.revision,
        });
        session.pendingPlanSha256 = planSha256;
        if (sealedPlan.identity) {
          this.storeAgentPendingAmendment(task, {
            identity: sealedPlan.identity,
            planSha256,
            providerTitle: identityCandidate!.title,
            replayKey: sealedPlan.replayKey,
            summary: sealedPlan.summary,
            taskRevision: task.revision,
          });
        }
        session.currentActionLabel = '密封治理计划已提交，正在等待回合完成';
        await this.persistTask(task);
        return {
          accepted: true,
          planSha256,
          taskId: task.id,
          taskRevision: task.revision,
          writeBoundaries: { cloud: 0, database: 0, formalMedia: 0 },
        };
      }
    }
  }

  /** 按序应用 Agent 生命周期事件，并同步计划与任务状态。 */
  async applyAgentEvent(input: MediaGovernanceAgentEventDto) {
    const task = this.detail(input.taskId);
    const primaryRunActive = Boolean(task.activeRunId);
    const session = task.agentSession;
    const pendingThreadMapping = Boolean(
      session &&
      session.threadId === this.pendingAgentThreadId(task.id) &&
      input.type === 'agent-thread-mapped' &&
      input.sequence === session.lastSequence + 1 &&
      input.status === 'active' &&
      input.taskRevision === task.revision,
    );
    if (!session) {
      throwVbenError('Agent 事件身份不匹配', HttpStatus.CONFLICT);
    }
    let threadMatches = input.threadId === session.threadId;
    if (session.threadId === this.pendingAgentThreadId(task.id)) {
      threadMatches = pendingThreadMapping;
    }
    if (
      !threadMatches ||
      input.policySha256 !== session.policySha256 ||
      input.capsuleSha256 !== session.capsuleSha256
    ) {
      throwVbenError('Agent 事件身份不匹配', HttpStatus.CONFLICT);
    }
    if (input.sequence <= session.lastSequence) {
      return { applied: false, reason: 'duplicate-sequence' };
    }
    const terminalEvent =
      input.type === 'agent-turn-completed' || input.type === 'agent-blocked';
    let eventStatusValid = input.status === 'active';
    if (terminalEvent) eventStatusValid = input.status === 'blocked';
    if (
      input.taskRevision !== task.revision ||
      session.status !== 'running' ||
      !eventStatusValid
    ) {
      throwVbenError('Agent 事件状态不匹配', HttpStatus.CONFLICT);
    }
    const eventPlanSha256 = input.planSha256 ?? null;
    if (
      (input.type === 'agent-turn-completed' &&
        eventPlanSha256 !== (session.pendingPlanSha256 ?? null)) ||
      (input.type !== 'agent-turn-completed' && eventPlanSha256 !== null)
    ) {
      throwVbenError('Agent 密封计划哈希不匹配', HttpStatus.CONFLICT);
    }
    if (pendingThreadMapping) session.threadId = input.threadId;
    session.lastSequence = input.sequence;
    session.lastHeartbeatLabel = '刚刚';
    session.currentActionLabel = input.summary;
    if (input.type === 'agent-turn-completed') {
      if (session.pendingPlanSha256) {
        const pendingPlanSha256 = session.pendingPlanSha256;
        const identityAmendment = this.agentPendingAmendment(task);
        if (identityAmendment) {
          this.finalizeAgentIdentityAmendment(task, pendingPlanSha256);
          session.status = 'succeeded';
          session.statusLabel = 'TMDB 身份已密封应用';
        } else {
          session.status = 'needs-operator';
          session.statusLabel = '密封文件计划待人工复核';
          if (!primaryRunActive) {
            task.runState = 'blocked';
            task.nextCommandLabel = session.statusLabel;
          }
        }
        session.pendingPlanSha256 = null;
        task.revision += 1;
      } else {
        session.status = 'needs-operator';
        session.statusLabel = '等待人工选择 TMDB 候选';
        if (!primaryRunActive) {
          task.runState = 'blocked';
          task.nextCommandLabel = session.statusLabel;
        }
      }
    } else if (input.type === 'agent-blocked') {
      this.discardAgentPendingAmendment(task);
      session.pendingPlanSha256 = null;
      session.status = 'failed';
      session.statusLabel = 'Agent 已阻塞，可安全重试';
      if (!primaryRunActive) {
        task.runState = 'blocked';
        task.nextCommandLabel = input.summary;
      }
    }
    this.refreshSemanticProjection(task);
    await this.commitTask(task, 'state-updated', input);
    return { applied: true, revision: task.revision };
  }

  /** 校验并发布 Agent 对话事件，持久化已完成回复状态。 */
  async applyAgentConversationEvent(
    input: MediaGovernanceAgentConversationEventDto,
  ) {
    const task = this.detail(input.taskId);
    const session = task.agentSession;
    let result: ReturnType<typeof parseMediaCodexAgentResult> = null;
    if (input.result) {
      result = parseMediaCodexAgentResult({
        candidateSummaries: input.result.candidateSummaries,
        nextActionLabel: input.result.nextActionLabel,
        planSha256: input.result.planSha256,
        status: input.result.status,
        summary: input.result.summary,
      });
    }
    if (
      !session ||
      input.taskRevision > task.revision ||
      input.threadId !== session.threadId ||
      input.policySha256 !== session.policySha256
    ) {
      throwVbenError('Agent 会话事件身份不匹配', HttpStatus.CONFLICT);
    }
    if (
      input.capsuleSha256 !== session.capsuleSha256 ||
      (input.result !== null && !result)
    ) {
      throwVbenError('Agent 会话事件身份不匹配', HttpStatus.CONFLICT);
    }
    this.eventStream?.publishAgentConversation({
      ...input,
      result,
    });
    if (
      input.changeType === 'turn-completed' &&
      result?.status === 'conversation-response'
    ) {
      session.currentActionLabel = result.summary;
      session.lastHeartbeatLabel = '刚刚';
      session.status = 'needs-operator';
      session.statusLabel = 'Agent 已回复，可继续对话';
      this.refreshSemanticProjection(task);
      await this.persistTask(task);
      this.publishTaskPatch(task, 'state-updated');
    }
    return {
      applied: true,
      conversationRevision: input.conversationRevision,
      eventSequence: input.eventSequence,
    };
  }

  /** 复核操作员选择的候选，并推进正式或模拟治理状态。 */
  async operatorDecision(
    taskId: string,
    input: MediaGovernanceOperatorDecisionDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    const productionExecution = this.executionGateway?.enabled() === true;
    const productionAgent = this.agentGateway?.enabled() === true;
    this.assertRevision(task, input.expectedRevision);
    if (task.agentSession?.status !== 'needs-operator') {
      throwVbenError('当前没有待处理的 Agent 候选', HttpStatus.CONFLICT);
    }
    if (productionAgent) {
      const remoteSession = await this.agentGateway!.session(task.id);
      if (
        !remoteSession ||
        remoteSession.threadId !== task.agentSession.threadId ||
        remoteSession.policySha256 !== task.agentSession.policySha256 ||
        remoteSession.result?.status !== 'requires-operator' ||
        !remoteSession.result.candidates.some(
          (candidate) => candidate.id === input.selectedCandidateId,
        )
      ) {
        throwVbenError('所选候选不属于当前 Agent 回合', HttpStatus.CONFLICT);
      }
      const providerId =
        input.selectedCandidateId.match(/^tmdb:([1-9]\d*)$/u)?.[1];
      let candidates: MediaGovernanceTmdbCandidate[];
      try {
        candidates = await this.searchAgentIdentityCandidates(task);
      } catch {
        throwVbenError(
          'TMDB 资料源查询暂不可用',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const candidate = candidates.find(
        (entry) => entry.providerId === providerId,
      );
      if (!candidate || !task.sealedPlan) {
        throwVbenError('所选 TMDB 候选无法复核', HttpStatus.CONFLICT);
      }
      const planSha256 = sha256Json({
        candidateId: input.selectedCandidateId,
        reason: input.reason.trim(),
        taskId: task.id,
        taskRevision: task.revision,
      });
      this.storeAgentPendingAmendment(task, {
        identity: {
          provider: 'tmdb',
          providerId: candidate.providerId,
          releaseYear: candidate.releaseYear,
        },
        planSha256,
        providerTitle: candidate.title,
        replayKey: `${task.id}-operator-r${task.revision}`,
        summary: input.reason.trim(),
        taskRevision: task.revision,
      });
      this.finalizeAgentIdentityAmendment(task, planSha256);
      task.agentSession = {
        ...task.agentSession,
        currentActionLabel: `已确认 TMDB 候选 ${candidate.providerId}`,
        status: 'succeeded',
        statusLabel: '人工候选已密封应用',
      };
      this.bumpRevision(task);
      await this.commitTask(task, 'state-updated');
      return task;
    }
    task.agentSession = {
      ...task.agentSession,
      currentActionLabel: `已选择候选 ${input.selectedCandidateId}`,
      status: 'succeeded',
      statusLabel: '人工治理已闭环',
    };
    task.stage = 'closed';
    task.runState = 'succeeded';
    task.metadataStatus = 'verified';
    task.nextCommandLabel = '查看验收证据';
    let progressLabel = '本地闭环演示已完成';
    if (productionExecution) {
      task.agentSession.statusLabel = '人工治理已放行';
      task.stage = 'metadata';
      task.metadataStatus = 'pending';
      task.nextCommandLabel = '重新运行 A/B/C 分档元数据核验';
      progressLabel = '人工治理已放行，等待独立复核';
    }
    task.progress = {
      ...task.progress,
      etaLabel: '已完成',
      percent: 100,
      progressLabel,
    };
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    return task;
  }

  /** 返回任务的脱敏验收摘要及固定零写边界。 */
  evidence(taskId: string) {
    const task = this.detail(taskId);
    let localAcceptedUnitCount = 0;
    if (task.stage === 'closed') {
      localAcceptedUnitCount = task.units.length;
    }
    return {
      agentStatusLabel: task.agentSession?.statusLabel ?? '未启动',
      descriptorCount: task.sources.length,
      eventProjection: 'Redis Stream 实时进度热层',
      localAcceptedUnitCount,
      metadataStatusLabel: task.semanticProjection.metadataStatusLabel,
      taskId: task.id,
      writeBoundaries: {
        cloud: 0,
        database: 0,
        media: 0,
        nas: 0,
        uiMutationOutsideAdmin: 0,
      },
    };
  }

  /** 按关键词与语义筛选条件分页返回任务列表。 */
  page(query: MediaGovernanceTaskPageQueryDto = {}) {
    const pageNo = query.pageNo ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (pageNo - 1) * pageSize;
    const keyword = query.keyword?.trim().toLocaleLowerCase();
    const filtered = this.tasks.filter(
      (task) =>
        (!keyword ||
          task.titleHint.toLocaleLowerCase().includes(keyword) ||
          task.id.toLocaleLowerCase().includes(keyword)) &&
        (!query.stage || task.stage === query.stage) &&
        (!query.runState || task.runState === query.runState) &&
        (!query.governanceProfile ||
          task.governanceProfile === query.governanceProfile) &&
        (!query.gateReason || task.gateReason === query.gateReason) &&
        (!query.metadataStatus || task.metadataStatus === query.metadataStatus),
    );
    return {
      items: filtered
        .slice(start, start + pageSize)
        .map((task) => this.refreshHeartbeatLabel(task)),
      total: filtered.length,
    };
  }

  /** 按任务标题、类型和年份查询 TMDB 身份候选。 */
  private searchAgentIdentityCandidates(task: MediaGovernanceTask) {
    return searchTmdbMediaCandidates({
      mediaType: task.mediaType,
      releaseYear: task.releaseYear,
      title: task.titleHint,
    });
  }

  /** 判断 A 级缺项是否要求 Agent 修正资料源身份。 */
  private agentIdentityRepairRequired(task: MediaGovernanceTask) {
    const identityFields = new Set([
      'identity.provider',
      'identity.providerId',
    ]);
    return task.units.some((unit) =>
      unit.metadataProjection.missingA.some((field) =>
        identityFields.has(field),
      ),
    );
  }

  /** 重新查询 TMDB 并确认 Agent 提交候选仍与声明一致。 */
  private async assertAgentIdentityCandidate(
    task: MediaGovernanceTask,
    identity: NonNullable<MediaGovernanceAgentSealedPlan['identity']>,
  ) {
    let candidates: MediaGovernanceTmdbCandidate[];
    try {
      candidates = await this.searchAgentIdentityCandidates(task);
    } catch {
      throwVbenError('TMDB 资料源查询暂不可用', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const candidate = candidates.find(
      (entry) => entry.providerId === identity.providerId,
    );
    if (!candidate || candidate.releaseYear !== identity.releaseYear) {
      throwVbenError('Agent 提交的 TMDB 候选无法复核', HttpStatus.CONFLICT);
    }
    return candidate;
  }

  /** 将待确认身份修正写入当前密封计划的临时区。 */
  private storeAgentPendingAmendment(
    task: MediaGovernanceTask,
    amendment: MediaGovernanceAgentPendingAmendment,
  ) {
    if (!task.sealedPlan) {
      throwVbenError('当前任务缺少本地密封计划', HttpStatus.CONFLICT);
    }
    task.sealedPlan = {
      ...task.sealedPlan,
      agentPendingAmendment: amendment,
    };
  }

  /** 读取并严格校验密封计划中的待确认身份修正。 */
  private agentPendingAmendment(
    task: MediaGovernanceTask,
  ): MediaGovernanceAgentPendingAmendment | null {
    const value = task.sealedPlan?.agentPendingAmendment;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const amendment = value as Record<string, unknown>;
    const identity = amendment.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
      return null;
    }
    const identityValue = identity as Record<string, unknown>;
    if (
      identityValue.provider !== 'tmdb' ||
      typeof identityValue.providerId !== 'string' ||
      !/^[1-9]\d*$/u.test(identityValue.providerId)
    ) {
      return null;
    }
    if (identityValue.releaseYear !== null) {
      if (
        !Number.isInteger(identityValue.releaseYear) ||
        Number(identityValue.releaseYear) < 1870 ||
        Number(identityValue.releaseYear) > 2100
      ) {
        return null;
      }
    }
    if (
      typeof amendment.planSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(amendment.planSha256) ||
      typeof amendment.providerTitle !== 'string' ||
      !amendment.providerTitle.trim()
    ) {
      return null;
    }
    if (
      amendment.providerTitle.length > 200 ||
      typeof amendment.replayKey !== 'string' ||
      typeof amendment.summary !== 'string' ||
      !Number.isSafeInteger(amendment.taskRevision)
    ) {
      return null;
    }
    return amendment as unknown as MediaGovernanceAgentPendingAmendment;
  }

  /** 移除密封计划中未应用的 Agent 身份修正。 */
  private discardAgentPendingAmendment(task: MediaGovernanceTask) {
    if (!task.sealedPlan?.agentPendingAmendment) return;
    const { agentPendingAmendment, ...sealedPlan } = task.sealedPlan;
    void agentPendingAmendment;
    task.sealedPlan = sealedPlan;
  }

  /** 核对计划摘要后原子应用 TMDB 身份修正并重封计划。 */
  private finalizeAgentIdentityAmendment(
    task: MediaGovernanceTask,
    planSha256: string,
  ) {
    const amendment = this.agentPendingAmendment(task);
    if (
      !amendment ||
      amendment.planSha256 !== planSha256 ||
      amendment.taskRevision !== task.revision ||
      !task.sealedPlan
    ) {
      throwVbenError('Agent 密封计划哈希不匹配', HttpStatus.CONFLICT);
    }
    const { agentPendingAmendment, ...currentPlan } = task.sealedPlan;
    void agentPendingAmendment;
    let currentIdentity = {};
    if (
      currentPlan.identity &&
      typeof currentPlan.identity === 'object' &&
      !Array.isArray(currentPlan.identity)
    ) {
      currentIdentity = currentPlan.identity;
    }
    let currentAmendments: unknown[] = [];
    if (Array.isArray(currentPlan.agentAmendments)) {
      currentAmendments = currentPlan.agentAmendments.slice(-15);
    }
    task.providerRef = {
      provider: 'tmdb',
      providerId: amendment.identity.providerId,
    };
    task.metadataIdentity = {
      ...task.providerRef,
      releaseYear: amendment.identity.releaseYear,
    };
    task.releaseYear = amendment.identity.releaseYear;
    task.sealedPlan = {
      ...currentPlan,
      agentAmendments: [
        ...currentAmendments,
        {
          appliedAt: new Date().toISOString(),
          kind: 'identity',
          planSha256,
          provider: 'tmdb',
          providerId: amendment.identity.providerId,
          providerTitle: amendment.providerTitle,
          releaseYear: amendment.identity.releaseYear,
          summary: amendment.summary,
        },
      ],
      identity: {
        ...currentIdentity,
        providerRef: task.providerRef,
        providerTitle: amendment.providerTitle,
        releaseYear: task.releaseYear,
      },
    };
    task.sealedPlanSha256 = sha256Json(task.sealedPlan);
    task.identityPreview = this.buildIdentityPreview({
      mediaType: task.mediaType,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      seasonNumbers: task.units
        .map((unit) => unit.seasonNumber)
        .filter((season): season is string => Boolean(season)),
      titleHint: task.titleHint,
    });
    task.metadataStatus = 'pending';
    task.runState = 'succeeded';
    task.stage = 'metadata';
    task.gateReason = null;
    task.nextCommandLabel = '重新运行 A/B/C 分档元数据核验';
    task.progress = {
      ...task.progress,
      etaLabel: '等待元数据复核',
      progressLabel: 'TMDB 身份已密封应用，等待独立元数据复核',
    };
  }

  /** 判断指定 Agent 计划摘要是否已记录在修正历史中。 */
  private hasAppliedAgentPlan(task: MediaGovernanceTask, planSha256: string) {
    const amendments = task.sealedPlan?.agentAmendments;
    return (
      Array.isArray(amendments) &&
      amendments.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>).planSha256 === planSha256,
      )
    );
  }

  /** 提取密封计划操作涉及的来源与目标路径。 */
  private agentToolPaths(
    tool: MediaGovernanceAgentToolCallDto['tool'],
    plan: MediaGovernanceAgentSealedPlan | null,
  ) {
    if (tool !== 'plan.submit.sealed' || !plan) return [];
    return plan.operations.flatMap((operation) => {
      if (operation.sourcePath) {
        return [operation.sourcePath, operation.targetPath];
      }
      return [operation.targetPath];
    });
  }

  /** 校验 Agent 只读工具仅携带允许的来源或单元标识。 */
  private assertAgentReadArguments(value: Record<string, unknown>) {
    const keys = Object.keys(value);
    const sourceId = value.sourceId;
    const unitId = value.unitId;
    const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
    if (
      keys.some((key) => key !== 'sourceId' && key !== 'unitId') ||
      (sourceId !== undefined && typeof sourceId !== 'string') ||
      (unitId !== undefined && typeof unitId !== 'string')
    ) {
      throwVbenError('Agent 只读工具参数无效', HttpStatus.BAD_REQUEST);
    }
    if (
      (typeof sourceId === 'string' && !safeId.test(sourceId)) ||
      (typeof unitId === 'string' && !safeId.test(unitId))
    ) {
      throwVbenError('Agent 只读工具参数无效', HttpStatus.BAD_REQUEST);
    }
    let normalizedSourceId = null;
    if (typeof sourceId === 'string') normalizedSourceId = sourceId;
    let normalizedUnitId = null;
    if (typeof unitId === 'string') normalizedUnitId = unitId;
    return {
      sourceId: normalizedSourceId,
      unitId: normalizedUnitId,
    };
  }

  /** 构建有界任务、来源、单元和写边界上下文供 Agent 使用。 */
  private buildAgentCompactContext(
    task: MediaGovernanceTask,
    taskRevision: number,
  ) {
    const currentUnit = task.units[0] ?? null;
    const sourceItems = task.sources.slice(0, 32).map((source) => ({
      contentKind: source.contentKind,
      id: source.id,
      manifestSha256: source.manifestSha256,
      seasonNumbers: source.seasonNumbers,
      sourceHealth: source.sourceHealth,
      sourceRole: source.sourceRole,
    }));
    let currentUnitProjection = null;
    if (currentUnit) {
      let subtitleContract = null;
      if (currentUnit.subtitleContract) {
        subtitleContract = {
          expectedEpisodeNumbers:
            currentUnit.subtitleContract.expectedEpisodeNumbers,
          releaseGroup: currentUnit.subtitleContract.releaseGroup,
          sourceId: currentUnit.subtitleContract.sourceId,
        };
      }
      currentUnitProjection = {
        expectedEpisodeNumbers: currentUnit.expectedEpisodeNumbers,
        id: currentUnit.id,
        metadataProjection: currentUnit.metadataProjection,
        seasonNumber: currentUnit.seasonNumber,
        subtitleContract,
        unitKind: currentUnit.unitKind,
      };
    }
    return {
      boundaries: {
        cloudGate: false,
        databaseWrite: false,
        formalMediaWrite: false,
        uiWrite: false,
      },
      currentUnit: currentUnitProjection,
      identity: {
        mediaType: task.mediaType,
        metadataIdentity: task.metadataIdentity,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        titleHint: task.titleHint,
      },
      schemaVersion: 'media-agent-compact-context-v1',
      sources: {
        count: task.sources.length,
        items: sourceItems,
        truncated: sourceItems.length < task.sources.length,
      },
      taskId: task.id,
      taskRevision,
      unitCount: task.units.length,
      workflow: {
        activeRun: Boolean(task.activeRunId),
        hasGovernanceProfile: Boolean(task.governanceProfile),
        hasSealedPlan: Boolean(task.sealedPlan && task.sealedPlanSha256),
        runState: task.runState,
        stage: task.stage,
      },
    };
  }

  /** 按任务阶段生成限制明确的 Agent 操作指令。 */
  private buildAgentOperatorCommand(task: MediaGovernanceTask) {
    const instructions = [
      '只处理当前媒体治理任务；仅使用胶囊允许的类型化工具读取事实，不得调用 shell、浏览器、UI、云端或数据库写入，不得改动正式媒体目录。',
      '若当前有媒体执行器运行，只做旁路核对，不得暂停、取消、重启或覆盖其 revision、进度和运行状态。',
    ];
    if (this.agentIdentityRepairRequired(task)) {
      instructions.push(
        '当前只修正缺失的 TMDB 身份：核对媒体身份与季集映射后提交 identity 密封修正，operations 必须为 []，不得重复复制、重命名或生成媒体、字幕、NFO、海报。',
      );
      return instructions.join('\n');
    }
    switch (task.stage) {
      case 'intake':
        instructions.push(
          '接收资料阶段只核对作品名、媒体类型、季号（特别篇使用 S00）、可选年份/资料库编号和现有来源；缺少治理类型、来源或清单时语义化列出缺口，不得虚构文件计划。',
        );
        break;
      case 'download':
        instructions.push(
          'NAS 下载阶段只核对来源健康、文件清单、下载进度和季集覆盖；不得新增、替换、暂停、取消或重启下载，不得提交密封写计划。',
        );
        break;
      case 'governance':
        instructions.push(
          '本地治理阶段核对身份、季集映射、目录命名和同季字幕发布组一致性；只有无活动执行器且事实完整时，才可提交任务 staging 根内的密封治理计划。',
        );
        break;
      case 'metadata':
        instructions.push(
          '元数据阶段按 A/B/C 三档核对缺口、已有尝试和候选歧义；只提交与已验证事实一致的密封修正，无法唯一确认时返回需要操作员选择。',
        );
        break;
      case 'acceptance':
        instructions.push(
          '独立验收阶段只解释现有证据、未通过项和可复核入口，不得绕过验收门或提交新的文件写计划。',
        );
        break;
      case 'closed':
        instructions.push('任务已完成，不得开始新的治理动作。');
        break;
    }
    return instructions.join('\n');
  }

  /** 严格解析 Agent 密封计划，并限制身份、操作和路径范围。 */
  private parseAgentSealedPlan(
    value: Record<string, unknown>,
    taskId: string,
    expectedReplayKey: string,
  ): MediaGovernanceAgentSealedPlan {
    const operations = value.operations;
    const identity = value.identity;
    if (
      Object.keys(value).some(
        (key) =>
          !['identity', 'operations', 'replayKey', 'summary'].includes(key),
      ) ||
      !Array.isArray(operations) ||
      operations.length > 500 ||
      (operations.length === 0) === (identity === undefined)
    ) {
      throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
    }
    if (
      value.replayKey !== expectedReplayKey ||
      typeof value.summary !== 'string' ||
      !value.summary.trim() ||
      value.summary.length > 800
    ) {
      throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
    }
    let normalizedIdentity:
      | MediaGovernanceAgentSealedPlan['identity']
      | undefined;
    if (identity !== undefined) {
      if (
        !identity ||
        typeof identity !== 'object' ||
        Array.isArray(identity)
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      const entry = identity as Record<string, unknown>;
      if (
        Object.keys(entry).some(
          (key) => !['provider', 'providerId', 'releaseYear'].includes(key),
        ) ||
        entry.provider !== 'tmdb' ||
        typeof entry.providerId !== 'string' ||
        !/^[1-9]\d*$/u.test(entry.providerId)
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      if (entry.releaseYear !== null) {
        if (
          !Number.isInteger(entry.releaseYear) ||
          Number(entry.releaseYear) < 1870 ||
          Number(entry.releaseYear) > 2100
        ) {
          throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
        }
      }
      let releaseYear = null;
      if (entry.releaseYear !== null) {
        releaseYear = Number(entry.releaseYear);
      }
      normalizedIdentity = {
        provider: 'tmdb',
        providerId: entry.providerId as string,
        releaseYear,
      };
    }
    const stagingRoot = `/vol2/1000/.kt-media-governance-staging/${taskId}`;
    const targetRoots = [`${stagingRoot}/plan`, `${stagingRoot}/work`];
    const normalizedOperations = (operations as unknown[]).map((operation) => {
      if (
        !operation ||
        typeof operation !== 'object' ||
        Array.isArray(operation)
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      const entry = operation as Record<string, unknown>;
      if (
        Object.keys(entry).some(
          (key) => !['action', 'sourcePath', 'targetPath'].includes(key),
        ) ||
        typeof entry.action !== 'string' ||
        !entry.action.trim() ||
        entry.action.length > 80
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      if (
        typeof entry.targetPath !== 'string' ||
        entry.targetPath.length > 600 ||
        !targetRoots.some(
          (root) =>
            entry.targetPath === root ||
            (typeof entry.targetPath === 'string' &&
              entry.targetPath.startsWith(`${root}/`)),
        )
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      if (entry.sourcePath !== undefined) {
        if (
          typeof entry.sourcePath !== 'string' ||
          entry.sourcePath.length > 600
        ) {
          throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
        }
      }
      const normalizedOperation: {
        action: string;
        sourcePath?: string;
        targetPath: string;
      } = {
        action: entry.action as string,
        targetPath: entry.targetPath as string,
      };
      if (typeof entry.sourcePath === 'string') {
        normalizedOperation.sourcePath = entry.sourcePath;
      }
      return normalizedOperation;
    });
    const normalizedPlan: MediaGovernanceAgentSealedPlan = {
      operations: normalizedOperations,
      replayKey: expectedReplayKey,
      summary: value.summary as string,
    };
    if (normalizedIdentity) normalizedPlan.identity = normalizedIdentity;
    return normalizedPlan;
  }

  /** 将完整任务裁剪为 Agent 边界校验所需领域投影。 */
  private projectAgentTask(
    task: MediaGovernanceTask,
  ): MediaGovernanceTaskProjection {
    let metadataIdentity = null;
    if (task.metadataIdentity) {
      metadataIdentity = {
        provider: task.metadataIdentity.provider,
        providerId: task.metadataIdentity.providerId,
      };
    }
    return {
      activeRunId: task.activeRunId,
      closedAt: task.closedAt,
      closedMode: task.closedMode,
      declaredUnitIds: task.units.map((unit) => unit.id),
      gateReason: task.gateReason,
      governanceProfile: task.governanceProfile,
      id: task.id,
      inputSnapshotSha256: task.inputSnapshotSha256,
      mediaType: task.mediaType,
      metadataIdentity,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      revision: task.revision,
      runState: task.runState,
      sealedPlanSha256: task.sealedPlanSha256,
      stage: task.stage,
      titleHint: task.titleHint,
      workItemId: task.workItemId,
    };
  }

  /** 将治理单元裁剪为 Agent 可见的元数据与字幕合同投影。 */
  private projectAgentUnits(
    task: MediaGovernanceTask,
  ): MediaGovernanceUnitProjection[] {
    return task.units.map((unit) => {
      let subtitleContract = null;
      if (unit.subtitleContract && unit.seasonNumber) {
        subtitleContract = {
          expectedEpisodeNumbers: unit.subtitleContract.expectedEpisodeNumbers,
          mappings: unit.subtitleContract.mappings.map((mapping) => ({
            episodeNumber: mapping.episodeNumber,
            releaseGroup: unit.subtitleContract!.releaseGroup,
          })),
          releaseGroup: unit.subtitleContract.releaseGroup,
          seasonNumber: unit.seasonNumber,
          sourceId: unit.subtitleContract.sourceId,
        };
      }
      return {
        evidenceSha256: unit.evidenceSha256,
        expectedEpisodeNumbers: unit.expectedEpisodeNumbers,
        id: unit.id,
        localAcceptedAt: unit.localAcceptedAt,
        metadataProjection: {
          missingA: [...unit.metadataProjection.missingA],
          missingB: [...unit.metadataProjection.missingB],
          missingC: [...unit.metadataProjection.missingC],
          validBFallbacks: [...unit.metadataProjection.validBFallbacks],
        },
        seasonNumber: unit.seasonNumber,
        subtitleContract,
        taskId: task.id,
        unitKind: unit.unitKind,
      };
    });
  }

  /** 结合现有主来源校验新来源角色与内容类型。 */
  private assertClassification(
    task: MediaGovernanceTask,
    input: Pick<
      MediaGovernanceSourceClassificationDto,
      'contentKind' | 'sourceRole'
    >,
  ) {
    const primary = task.sources.find(
      (source) => source.sourceRole === 'primary_media',
    );
    let linkedTask = null;
    if (input.sourceRole === 'supplemental_subtitle' && primary) {
      linkedTask = {
        contentKind: primary.contentKind,
        runState: task.runState,
        stage: task.stage,
      };
    }
    try {
      return assertSourceClassification({
        contentKind: input.contentKind,
        linkedTask,
        sourceRole: input.sourceRole,
      });
    } catch {
      throwVbenError('来源角色与内容类型不匹配', HttpStatus.BAD_REQUEST);
    }
  }

  /** 校验调用方期望版本与当前任务版本一致。 */
  private assertRevision(task: MediaGovernanceTask, expectedRevision: number) {
    if (task.revision !== expectedRevision) {
      throwVbenError(
        `任务版本已变化，当前版本为 ${task.revision}`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** 返回任务不能删除的首个确定性原因，允许删除时返回空值。 */
  private getDiscardDisabledReason(task: MediaGovernanceTask) {
    if (
      task.stage !== 'intake' ||
      !['blocked', 'draft'].includes(task.runState)
    ) {
      return '仅接收资料阶段且尚未产生载荷的任务可以删除。';
    }
    if (
      task.activeRunId !== null ||
      task.payloadSeal !== null ||
      task.sealedPlan !== null ||
      task.sealedPlanSha256 !== null
    ) {
      return '任务已进入执行阶段，不能删除。';
    }
    if (task.sources.some((source) => source.descriptorTombstonedAt !== null)) {
      return '来源运行态仍在精确清理，完成后才能删除任务。';
    }
    if (
      task.closedAt !== null ||
      task.closedMode !== null ||
      task.agentSession !== null ||
      task.metadataIdentity !== null ||
      task.metadataStatus !== 'pending'
    ) {
      return '任务已有治理结果或验收证据，不能删除。';
    }
    if (
      task.units.some(
        (unit) => unit.evidenceSha256 !== null || unit.localAcceptedAt !== null,
      )
    ) {
      return '任务已有治理结果或验收证据，不能删除。';
    }
    return null;
  }

  /** 预留运行身份、密封执行信封并通过发件箱派发。 */
  private async reserveExecution(
    task: MediaGovernanceTask,
    action: MediaGovernanceExecutorAction,
    sources?: MediaGovernanceSource[],
  ) {
    if (task.activeRunId) {
      throwVbenError('任务已有运行中的操作', HttpStatus.CONFLICT);
    }
    if (
      !this.databaseReady() ||
      !this.executionGateway ||
      !this.stateStore?.reserveRunDispatch ||
      !this.stateStore.acknowledgeRunDispatch
    ) {
      throwVbenError(
        '媒体执行器持久化链路暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const previous = {
      activeRunId: task.activeRunId,
      nextCommandLabel: task.nextCommandLabel,
      progress: structuredClone(task.progress),
      revision: task.revision,
      runState: task.runState,
      semanticProjection: structuredClone(task.semanticProjection),
      stage: task.stage,
    };
    const runId = `media-run-${randomUUID()}`;
    task.activeRunId = runId;
    const queuedAt = new Date().toISOString();
    if (action === 'source.resume') {
      task.progress.observedAt = queuedAt;
      task.progress.heartbeatLabel = '刚刚';
      task.progress.etaLabel = '等待续传执行器';
      task.progress.progressLabel = '已入队，等待恢复下载';
    } else {
      task.progress = {
        completedBytes: 0,
        completedItems: 0,
        etaLabel: '等待执行器',
        heartbeatLabel: '刚刚',
        observedAt: queuedAt,
        percent: 0,
        progressLabel: '已入队，等待 Jenkins 调度',
        speedLabel: '0 B/s',
        totalBytes: 0,
        totalItems: 0,
      };
    }
    task.runState = 'queued';
    task.stage = 'governance';
    if (action.startsWith('acceptance.')) task.stage = 'acceptance';
    if (action.startsWith('metadata.')) task.stage = 'metadata';
    if (action.startsWith('source.')) {
      task.stage = 'intake';
      if (action === 'source.download' || action === 'source.resume') {
        task.stage = 'download';
      }
    }
    task.nextCommandLabel = '已入队，等待 Jenkins 调度';
    this.bumpRevision(task);
    const executionInput: Parameters<
      typeof buildMediaGovernanceExecutionEnvelope
    >[0] = {
      action,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      inputSnapshotSha256: task.inputSnapshotSha256,
      replayKey: `${task.id}:${action}:r${task.revision}`,
      runId,
      taskId: task.id,
      taskRevision: task.revision,
      unitIds: task.units.map((unit) => unit.id),
    };
    if (action === 'metadata.repair') {
      executionInput.metadataRepairAttempt =
        this.metadataRepairAttempts(task) + 1;
    }
    if (
      task.sealedPlan &&
      task.sealedPlanSha256 &&
      !action.startsWith('source.')
    ) {
      executionInput.plan = {
        planGrantId: `media-plan-grant-${createHash('sha256')
          .update(`${runId}:${task.sealedPlanSha256}`)
          .digest('hex')
          .slice(0, 40)}`,
        planSha256: task.sealedPlanSha256,
        schemaVersion: '1.2.0',
        strategy: task.governanceProfile!,
      };
    }
    if (sources) {
      executionInput.sources = sources.map((source) => ({
        descriptorGrantId: `media-grant-${createHash('sha256')
          .update(`${runId}:${source.id}`)
          .digest('hex')
          .slice(0, 48)}`,
        descriptorRevision: source.descriptorRevision,
        descriptorSha256: source.descriptorSha256,
        infoHash: source.infoHash,
        manifestSha256: source.manifestSha256,
        selectedBytes: source.selectedBytes,
        selectedFileCount: source.selectedFileCount,
        selectedFileIndices: source.selectedFileIndices,
        sourceId: source.id,
        transportKind: source.transportKind,
      }));
    }
    const envelope = buildMediaGovernanceExecutionEnvelope(executionInput);
    try {
      await this.stateStore.reserveRunDispatch(task, envelope);
    } catch (error) {
      Object.assign(task, previous);
      throw error;
    }
    await this.dispatchEnvelope(task, envelope);
    return envelope;
  }

  /** 向执行器派发密封信封，并记录确认或有界重试状态。 */
  private async dispatchEnvelope(
    task: MediaGovernanceTask,
    envelope: MediaGovernanceExecutionEnvelope,
  ) {
    try {
      const result = await this.executionGateway!.dispatch(envelope);
      await this.stateStore!.acknowledgeRunDispatch!(
        envelope.runId,
        result.executionId,
      );
      task.nextCommandLabel = 'Jenkins 已接单，等待执行器进度';
    } catch {
      let attempts = 1;
      if (this.stateStore?.recordRunDispatchFailure) {
        attempts = await this.stateStore.recordRunDispatchFailure(
          envelope.runId,
        );
      }
      if (
        attempts >= MAX_DISPATCH_ATTEMPTS ||
        Date.parse(envelope.expiresAt) <= Date.now()
      ) {
        await this.failDispatch(task, envelope.runId, attempts);
        return;
      }
      task.nextCommandLabel = `Jenkins 暂不可用，正在进行第 ${attempts + 1}/${MAX_DISPATCH_ATTEMPTS} 次调度`;
    }
    this.refreshSemanticProjection(task);
    await this.persistTask(task);
  }

  /** 串行重试未确认且尚未过期的发件箱运行。 */
  private async retryPendingDispatches() {
    if (
      !this.executionGateway?.enabled() ||
      !this.stateStore?.pendingRunDispatches ||
      !this.stateStore.acknowledgeRunDispatch
    ) {
      return;
    }
    if (this.dispatchRetryActive) return;
    this.dispatchRetryActive = true;
    let envelopes: MediaGovernanceExecutionEnvelope[];
    try {
      envelopes = await this.stateStore.pendingRunDispatches();
    } catch {
      this.dispatchRetryActive = false;
      return;
    }
    try {
      for (const envelope of envelopes) {
        const task = this.tasks.find(
          (candidate) => candidate.id === envelope.taskId,
        );
        if (!task || task.activeRunId !== envelope.runId) continue;
        if (Date.parse(envelope.expiresAt) <= Date.now()) {
          await this.failDispatch(task, envelope.runId, MAX_DISPATCH_ATTEMPTS);
          continue;
        }
        await this.dispatchEnvelope(task, envelope);
      }
    } finally {
      this.dispatchRetryActive = false;
    }
  }

  /** 轮询活动运行并仅应用身份完整的可验证终态事件。 */
  private async reconcileActiveExecutions() {
    if (
      !this.executionGateway?.enabled() ||
      !this.stateStore?.readRunEnvelope ||
      !this.stateStore.readRunSequence
    ) {
      return;
    }
    if (this.executionReconcileActive) return;
    this.executionReconcileActive = true;
    try {
      for (const task of [...this.tasks]) {
        const runId = task.activeRunId;
        if (!runId) continue;
        try {
          const envelope = await this.stateStore.readRunEnvelope(runId);
          if (
            !envelope ||
            envelope.runId !== runId ||
            envelope.taskId !== task.id ||
            envelope.taskRevision !== task.revision
          ) {
            continue;
          }
          const observed = await this.executionGateway.status({
            runId,
            sealedInputSha256: envelope.sealedInputSha256,
            taskId: task.id,
          });
          if (observed.status === 'queued' || observed.status === 'running') {
            continue;
          }
          let summary = 'NAS 执行单元已退出或被回收，但未返回可验证终态';
          if (observed.status === 'exited') {
            summary = `NAS 执行器已退出（退出码 ${observed.exitCode}），但未返回可验证终态`;
          }
          const terminal = observed.terminalEvent;
          const previousSequence = await this.stateStore.readRunSequence(runId);
          if (
            !observed.manifestSha256 ||
            !terminal ||
            terminal.action !== envelope.action ||
            !['run-failed', 'run-succeeded'].includes(terminal.eventType)
          ) {
            continue;
          }
          if (
            terminal.runId !== runId ||
            terminal.taskId !== task.id ||
            terminal.taskRevision !== envelope.taskRevision ||
            terminal.sequence !== previousSequence + 1
          ) {
            continue;
          }
          if (
            terminal.eventType === 'run-failed' &&
            terminal.summary !== summary
          ) {
            continue;
          }
          if (
            terminal.eventType === 'run-succeeded' &&
            !/^[a-f0-9]{64}$/u.test(terminal.evidenceSha256 ?? '')
          ) {
            continue;
          }
          await this.applyExecutorEvent(terminal);
        } catch {
          // 单个状态探针失败不得覆盖仍可能运行的任务，下一轮继续核对。
        }
      }
    } finally {
      this.executionReconcileActive = false;
    }
  }

  /** 在派发耗尽后关闭活动运行并持久化稳定阻塞原因。 */
  private async failDispatch(
    task: MediaGovernanceTask,
    runId: string,
    attempts: number,
  ) {
    if (task.activeRunId !== runId) return;
    task.activeRunId = null;
    task.runState = 'blocked';
    task.gateReason = `Jenkins 调度连续失败 ${attempts} 次，未启动任何 NAS 执行器`;
    task.nextCommandLabel = '检查 Jenkins 后从当前任务重新发起';
    this.bumpRevision(task);
    if (this.stateStore?.failRunDispatch) {
      await this.stateStore.failRunDispatch(task, runId);
    } else {
      await this.persistTask(task);
    }
    this.publishTaskPatch(task, 'state-updated');
  }

  /** 确保单个任务最多存在一个主媒体下载所有者。 */
  private assertSourceOwnerAvailable(
    task: MediaGovernanceTask,
    sourceRole: MediaGovernanceSourceRole,
  ) {
    if (
      sourceRole === 'primary_media' &&
      task.sources.some((source) => source.sourceRole === 'primary_media')
    ) {
      throwVbenError('同一任务只能有一个主媒体下载 owner', HttpStatus.CONFLICT);
    }
  }

  /** 持久化任务及可选 Agent 事件后发布任务变更。 */
  private async commitTask(
    task: MediaGovernanceTask,
    changeType: 'source-updated' | 'state-updated',
    event?: MediaGovernanceAgentEventDto,
  ) {
    await this.persistTask(task, event);
    this.publishTaskPatch(task, changeType);
  }

  /** 发布完整或进度任务补丁，并附带当前全局摘要。 */
  private publishTaskPatch(
    task: MediaGovernanceTask,
    changeType: 'created' | 'deleted' | 'source-updated' | 'state-updated',
    runId: null | string = null,
    runSequence: null | number = null,
    deleted = false,
    compact = false,
  ) {
    let patchMode: 'full' | 'progress' = 'full';
    if (compact) patchMode = 'progress';
    let taskPatch = null;
    if (!deleted) taskPatch = this.projectTaskEventPatch(task, compact);
    this.eventStream?.publishTaskChanged({
      changeType,
      patchMode,
      revision: task.revision,
      runId,
      runSequence,
      summary: this.summary(),
      task: taskPatch,
      taskId: task.id,
      updatedAt: new Date().toISOString(),
    });
  }

  /** 按事件频率裁剪任务补丁并移除敏感密封载荷。 */
  private projectTaskEventPatch(task: MediaGovernanceTask, compact: boolean) {
    if (compact) {
      return structuredClone({
        activeRunId: task.activeRunId,
        agentSession: task.agentSession,
        gateReason: task.gateReason,
        governanceProfile: task.governanceProfile,
        id: task.id,
        metadataStatus: task.metadataStatus,
        nextCommandLabel: task.nextCommandLabel,
        progress: task.progress,
        revision: task.revision,
        runState: task.runState,
        semanticProjection: task.semanticProjection,
        stage: task.stage,
        titleHint: task.titleHint,
        workItemId: task.workItemId,
      });
    }
    const taskPatch = structuredClone(task) as Partial<MediaGovernanceTask>;
    delete taskPatch.payloadSeal;
    delete taskPatch.sealedPlan;
    return taskPatch as Omit<MediaGovernanceTask, 'payloadSeal' | 'sealedPlan'>;
  }

  /** 判断可选状态存储是否已完成数据库初始化。 */
  private databaseReady() {
    return this.stateStore?.isReady() === true;
  }

  /** 校验远端 Agent 会话是否匹配本地预留身份。 */
  private agentSessionMatchesReservation(
    task: MediaGovernanceTask,
    session: Awaited<ReturnType<MediaGovernanceCodexAgentGateway['startTurn']>>,
  ) {
    const reserved = task.agentSession;
    return Boolean(
      reserved &&
      session.taskId === task.id &&
      session.taskRevision === task.revision &&
      session.policySha256 === reserved.policySha256 &&
      session.policyVersion === reserved.policyVersion &&
      session.capsuleSha256 === reserved.capsuleSha256 &&
      (reserved.threadId === this.pendingAgentThreadId(task.id) ||
        reserved.threadId === session.threadId),
    );
  }

  /** 识别旧版以人工等待状态表达的 Agent 失败会话。 */
  private isLegacyFailedAgentSession(
    session: NonNullable<MediaGovernanceTask['agentSession']>,
  ) {
    return (
      session.status === 'needs-operator' &&
      session.pendingPlanSha256 === null &&
      session.statusLabel === 'Agent 已阻塞' &&
      session.currentActionLabel === 'Agent 回合异常结束，未重放动作'
    );
  }

  /** 生成 Agent 会话创建期间使用的临时线程标识。 */
  private pendingAgentThreadId(taskId: string) {
    return `pending-${taskId}`;
  }

  /** 根据任务版本或活动运行身份生成 Agent 重放键。 */
  private agentReplayKey(task: MediaGovernanceTask, taskRevision: number) {
    if (!task.activeRunId) return `${task.id}-agent-r${taskRevision}`;
    const runDigest = createHash('sha256')
      .update(task.activeRunId)
      .digest('hex')
      .slice(0, 12);
    return `${task.id}-agent-a${runDigest}`;
  }

  /** 保存任务并在失败时从数据库恢复权威内存状态。 */
  private async persistTask(
    task: MediaGovernanceTask,
    event?: MediaGovernanceAgentEventDto,
  ) {
    if (!this.stateStore) return;
    try {
      if (event) {
        await this.stateStore.saveTaskWithAgentEvent(task, event);
      } else {
        await this.stateStore.saveTask(task);
      }
    } catch {
      try {
        const storedTasks = await this.stateStore.loadTasks();
        this.tasks.splice(
          0,
          this.tasks.length,
          ...storedTasks.map((storedTask) =>
            this.restoreStoredTask(storedTask),
          ),
        );
      } catch {
        this.tasks.splice(0, this.tasks.length);
      }
      throwVbenError(
        '媒体治理数据库持久化暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** 补齐派生字段并恢复数据库任务的当前语义投影。 */
  private restoreStoredTask(
    storedTask: MediaGovernanceStoredTask,
  ): MediaGovernanceTask {
    const restored: MediaGovernanceTask = {
      ...storedTask,
      identityPreview: this.buildIdentityPreview({
        mediaType: storedTask.mediaType,
        metadataIdentity: storedTask.metadataIdentity,
        providerRef: storedTask.providerRef,
        releaseYear: storedTask.releaseYear,
        seasonNumbers: storedTask.units
          .map((unit) => unit.seasonNumber)
          .filter((season): season is string => Boolean(season)),
        titleHint: storedTask.titleHint,
      }),
      persistenceMode: 'database',
      semanticProjection: {
        currentActionLabel: '',
        discardAllowed: false,
        discardReasonLabel: '正在恢复任务状态',
        gateReasonLabel: '',
        metadataStatusLabel: '',
        runStateLabel: '',
        sourceHealthLabel: '',
        stageLabel: '',
      },
    };
    const legacyDeferredIdentityState =
      restored.units.every(
        (unit) => unit.metadataProjection.identityRefreshAttempts === undefined,
      ) && this.hasDeferredMetadataIdentityGap(restored);
    if (legacyDeferredIdentityState) {
      for (const unit of restored.units) {
        unit.metadataProjection.identityRefreshAttempts = 1;
      }
      restored.nextCommandLabel = '启动 CodexAgent 有界人工治理';
    }
    this.deriveBundledSubtitleContracts(restored);
    if (this.canRefreshLegacyMetadata(restored)) {
      restored.nextCommandLabel = '重新采集 A/B/C 分档元数据事实';
    }
    if (
      restored.activeRunId === null &&
      restored.runState === 'succeeded' &&
      restored.progress.percent < 100
    ) {
      let summary = '当前阶段已完成';
      if (restored.stage === 'closed') summary = '本地治理验收已完成';
      this.finalizeSucceededProgress(
        restored,
        restored.progress.observedAt,
        summary,
      );
    }
    this.refreshSemanticProjection(restored);
    return restored;
  }

  /** 递增任务版本并同步刷新语义投影。 */
  private bumpRevision(task: MediaGovernanceTask) {
    task.revision += 1;
    this.refreshSemanticProjection(task);
  }

  /** 按来源标识查找任务内来源，不存在时返回统一错误。 */
  private findSource(task: MediaGovernanceTask, sourceId: string) {
    const source = task.sources.find((item) => item.id === sourceId);
    if (!source) {
      throwVbenError('媒体来源不存在', HttpStatus.NOT_FOUND);
    }
    return source;
  }

  /** 规范化来源季号并限制在任务声明范围内。 */
  private normalizeSourceSeasons(
    task: MediaGovernanceTask,
    values: string[] | undefined,
  ) {
    const declared = task.units
      .map((unit) => unit.seasonNumber)
      .filter((season): season is string => Boolean(season));
    const seasons = (values ?? declared).map((season) =>
      season.trim().toUpperCase(),
    );
    if (
      new Set(seasons).size !== seasons.length ||
      seasons.some((season) => !declared.includes(season))
    ) {
      throwVbenError('来源季范围必须属于任务已声明季', HttpStatus.BAD_REQUEST);
    }
    if (task.mediaType !== 'tv' && seasons.length > 0) {
      throwVbenError('电影来源不能声明季范围', HttpStatus.BAD_REQUEST);
    }
    return seasons;
  }

  /** 解析磁力链接的 BTIH、显示名和脱敏追踪器数量。 */
  private parseMagnetUri(magnetUri: string) {
    let url: URL;
    try {
      url = new URL(magnetUri);
    } catch {
      throwVbenError('磁链格式不正确', HttpStatus.BAD_REQUEST);
    }
    if (url.protocol !== 'magnet:') {
      throwVbenError('只接受 magnet URI', HttpStatus.BAD_REQUEST);
    }
    const xt = url.searchParams
      .getAll('xt')
      .find((value) => /^urn:btih:/i.test(value));
    const match = xt?.match(/^urn:btih:([a-f\d]{40})$/i);
    if (!match) {
      throwVbenError('磁链缺少受支持的 BTIH 身份', HttpStatus.BAD_REQUEST);
    }
    const displayName = (url.searchParams.get('dn') ?? '').trim().slice(0, 160);
    return {
      displayName,
      infoHash: match[1].toLowerCase(),
      trackerCount: Math.min(url.searchParams.getAll('tr').length, 64),
    };
  }

  /** 根据任务原始状态刷新面向管理端的语义标签。 */
  private refreshSemanticProjection(task: MediaGovernanceTask) {
    const stageLabels: Record<MediaGovernanceTask['stage'], string> = {
      acceptance: '独立验收',
      closed: '已闭环',
      download: 'NAS 下载',
      governance: '本地治理',
      intake: '接收资料',
      metadata: '元数据核验',
    };
    const runStateLabels: Record<MediaGovernanceTask['runState'], string> = {
      blocked: '等待处理',
      draft: '草稿',
      queued: '已排队',
      running: '执行中',
      succeeded: '已完成',
    };
    const metadataLabels: Record<
      MediaGovernanceTask['metadataStatus'],
      string
    > = {
      pending: '待校验',
      'requires-agent': '需要人工治理',
      verified: '已验证',
    };
    const discardReasonLabel = this.getDiscardDisabledReason(task);
    task.semanticProjection = {
      currentActionLabel: task.nextCommandLabel,
      discardAllowed: discardReasonLabel === null,
      discardReasonLabel,
      gateReasonLabel: task.gateReason ?? '无阻塞',
      metadataStatusLabel: metadataLabels[task.metadataStatus],
      runStateLabel: runStateLabels[task.runState],
      sourceHealthLabel:
        task.sources.find((source) => source.sourceRole === 'primary_media')
          ?.sourceHealthLabel ?? '未检查',
      stageLabel: stageLabels[task.stage],
    };
  }

  /** 将每秒字节数格式化为合适量级的可读速率。 */
  private formatSpeed(bytesPerSecond: number) {
    if (bytesPerSecond < 1_024) return `${bytesPerSecond} B/s`;
    if (bytesPerSecond < 1_024 * 1_024) {
      return `${(bytesPerSecond / 1_024).toFixed(1)} KiB/s`;
    }
    if (bytesPerSecond < 1_024 * 1_024 * 1_024) {
      return `${(bytesPerSecond / 1_024 / 1_024).toFixed(1)} MiB/s`;
    }
    return `${(bytesPerSecond / 1_024 / 1_024 / 1_024).toFixed(1)} GiB/s`;
  }

  /** 将成功运行的进度补齐至终态并记录完成摘要。 */
  private finalizeSucceededProgress(
    task: MediaGovernanceTask,
    observedAt: null | string,
    summary: string,
  ) {
    let completedBytes = task.progress.completedBytes;
    if (task.progress.totalBytes > 0) {
      completedBytes = task.progress.totalBytes;
    }
    let completedItems = task.progress.completedItems;
    if (task.progress.totalItems > 0) {
      completedItems = task.progress.totalItems;
    }
    task.progress = {
      ...task.progress,
      completedBytes,
      completedItems,
      etaLabel: '已完成',
      heartbeatLabel: '刚刚',
      observedAt,
      percent: 100,
      progressLabel: summary.slice(0, 160),
      speedLabel: '0 B/s',
    };
  }

  /** 根据最近观测时间更新任务心跳相对时间。 */
  private refreshHeartbeatLabel(
    task: MediaGovernanceTask,
    now = Date.now(),
  ): MediaGovernanceTask {
    const observedAt = task.progress.observedAt;
    if (!observedAt) return task;
    const elapsedMs = Math.max(0, now - Date.parse(observedAt));
    if (!Number.isFinite(elapsedMs)) {
      task.progress.heartbeatLabel = '时间未知';
    } else if (elapsedMs < 60_000) {
      task.progress.heartbeatLabel = '刚刚';
    } else if (elapsedMs < 60 * 60_000) {
      task.progress.heartbeatLabel = `${Math.floor(elapsedMs / 60_000)} 分钟前`;
    } else if (elapsedMs < 24 * 60 * 60_000) {
      task.progress.heartbeatLabel = `${Math.floor(elapsedMs / (60 * 60_000))} 小时前`;
    } else {
      task.progress.heartbeatLabel = `${Math.floor(elapsedMs / (24 * 60 * 60_000))} 天前`;
    }
    return task;
  }

  /** 根据运行身份与心跳时效判断数据库任务是否卡住。 */
  private isStuckRun(task: MediaGovernanceTask, now: number): boolean {
    if (task.persistenceMode !== 'database') return false;
    const activeState =
      task.runState === 'queued' || task.runState === 'running';
    if (activeState && !task.activeRunId) return true;
    if (!activeState) {
      return Boolean(task.activeRunId) && task.runState !== 'blocked';
    }
    if (!task.progress.observedAt) return true;
    const observedAt = Date.parse(task.progress.observedAt);
    return (
      !Number.isFinite(observedAt) || now - observedAt > STALE_RUN_THRESHOLD_MS
    );
  }

  /** 统计同一治理单元使用多个字幕发布组的任务与季数。 */
  private mixedSubtitleSummary(): {
    seasonCount: number;
    taskIds: Set<string>;
  } {
    let seasonCount = 0;
    const taskIds = new Set<string>();
    for (const task of this.tasks) {
      const groupsByUnit = new Map<string, Set<string>>();
      for (const source of task.sources) {
        for (const mapping of source.selectedFileMappings) {
          if (mapping.fileRole !== 'subtitle') continue;
          const groups = groupsByUnit.get(mapping.unitId) ?? new Set<string>();
          groups.add(source.releaseGroup?.trim() || '未声明发布组');
          groupsByUnit.set(mapping.unitId, groups);
        }
      }
      const mixedSeasonCount = [...groupsByUnit.values()].filter(
        (groups) => groups.size > 1,
      ).length;
      if (mixedSeasonCount > 0) taskIds.add(task.id);
      seasonCount += mixedSeasonCount;
    }
    return { seasonCount, taskIds };
  }

  /** 在模拟模式调度中间与完成进度更新。 */
  private scheduleProgress(
    task: MediaGovernanceTask,
    source: Pick<MediaGovernanceSource, 'selectedBytes' | 'selectedFileCount'>,
  ) {
    const halfway = setTimeout(() => {
      task.progress = {
        ...task.progress,
        completedBytes: Math.floor(source.selectedBytes * 0.55),
        completedItems: Math.max(
          1,
          Math.floor(source.selectedFileCount * 0.55),
        ),
        etaLabel: '约 1 秒',
        heartbeatLabel: '刚刚',
        observedAt: new Date().toISOString(),
        percent: 55,
        progressLabel: `正在下载 ${Math.max(1, Math.floor(source.selectedFileCount * 0.55))}/${source.selectedFileCount} 个文件`,
        speedLabel: '演示模式 55 MB/s',
      };
      void this.commitTask(task, 'state-updated').catch(() => undefined);
    }, 250);
    const complete = setTimeout(() => {
      task.runState = 'succeeded';
      task.nextCommandLabel = '开始本地治理';
      task.progress = {
        ...task.progress,
        completedBytes: source.selectedBytes,
        completedItems: source.selectedFileCount,
        etaLabel: '已完成',
        heartbeatLabel: '刚刚',
        observedAt: new Date().toISOString(),
        percent: 100,
        progressLabel: '来源载荷已就绪',
        speedLabel: '0 B/s',
      };
      this.refreshSemanticProjection(task);
      void this.commitTask(task, 'state-updated').catch(() => undefined);
    }, 500);
    halfway.unref?.();
    complete.unref?.();
  }

  /** 校验媒体类型与季号声明的结构合同。 */
  private assertUnitContract(
    mediaType: MediaGovernanceMediaType,
    seasonNumbers: string[],
  ) {
    if (mediaType === 'tv' && seasonNumbers.length === 0) {
      throwVbenError('TV 正常剧集必须至少声明一个季号', HttpStatus.BAD_REQUEST);
    }
    if (mediaType !== 'tv' && seasonNumbers.length > 0) {
      throwVbenError(
        '电影或剧场版不能填写季号，也不能使用 S00 代替作品类型',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (new Set(seasonNumbers).size !== seasonNumbers.length) {
      throwVbenError('同一任务不能重复声明季号', HttpStatus.BAD_REQUEST);
    }
  }

  /** 将作品身份字段转换为管理端可读的验证状态预览。 */
  private buildIdentityPreview(input: {
    mediaType: MediaGovernanceMediaType;
    metadataIdentity?: MediaGovernanceTask['metadataIdentity'];
    providerRef: MediaGovernanceProviderRef | null;
    releaseYear: null | number;
    seasonNumbers: string[];
    titleHint: string;
  }): MediaGovernanceTask['identityPreview'] {
    const providerRef = input.metadataIdentity ?? input.providerRef;
    const releaseYear =
      input.metadataIdentity?.releaseYear ?? input.releaseYear;
    const identityVerified =
      input.metadataIdentity !== null && input.metadataIdentity !== undefined;
    let providerLabel = '未填写（后续由资料源候选核验）';
    if (providerRef) {
      providerLabel = `${PROVIDER_LABELS[providerRef.provider]} · ${providerRef.providerId}`;
    }
    let releaseYearLabel = '未填写（后续按候选消歧）';
    if (releaseYear) releaseYearLabel = `${releaseYear} 年`;
    let seasonLabel = '电影单元（不使用 S00）';
    if (input.mediaType === 'tv') {
      seasonLabel = input.seasonNumbers.join('、');
    }
    let status: MediaGovernanceTask['identityPreview']['status'] =
      'pending-provider-verification';
    let statusLabel: MediaGovernanceTask['identityPreview']['statusLabel'] =
      '待资料源核验';
    if (identityVerified) {
      status = 'verified-provider-identity';
      statusLabel = '元数据身份已验证';
    }
    return {
      mediaTypeLabel: MEDIA_TYPE_LABELS[input.mediaType],
      providerLabel,
      releaseYearLabel,
      seasonLabel,
      status,
      statusLabel,
      title: input.titleHint,
    };
  }

  /** 根据媒体类型创建电影单元或逐季治理单元。 */
  private createUnits(
    mediaType: MediaGovernanceMediaType,
    seasonNumbers: string[],
  ): MediaGovernanceUnit[] {
    if (mediaType !== 'tv') {
      return [
        {
          evidenceSha256: null,
          expectedEpisodeNumbers: [],
          id: `media-unit-${randomUUID()}`,
          localAcceptedAt: null,
          metadataProjection: {
            identityRefreshAttempts: 0,
            missingA: [],
            missingB: [],
            missingC: [],
            repairAttempts: 0,
            validBFallbacks: [],
          },
          seasonNumber: null,
          subtitleContract: null,
          unitKind: 'movie',
        },
      ];
    }
    return seasonNumbers.map((seasonNumber) => ({
      evidenceSha256: null,
      expectedEpisodeNumbers: [],
      id: `media-unit-${randomUUID()}`,
      localAcceptedAt: null,
      metadataProjection: {
        identityRefreshAttempts: 0,
        missingA: [],
        missingB: [],
        missingC: [],
        repairAttempts: 0,
        validBFallbacks: [],
      },
      seasonNumber,
      subtitleContract: null,
      unitKind: 'season',
    }));
  }
}
