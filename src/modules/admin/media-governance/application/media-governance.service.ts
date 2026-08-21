import { createHash, randomUUID } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { throwVbenError } from '@/common';
import { LlmConfigService } from '@/modules/admin/llm/application/llm-config.service';
import { LlmConversationService } from '@/modules/admin/llm/application/llm-conversation.service';
import {
  MEDIA_CODEX_AGENT_TOOLS,
  parseMediaCodexAgentResult,
  sha256Json,
  type MediaCodexAgentTool,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import { LLM_CODEX_PERMISSION_PROFILE } from '@/apps/media-codex-agent-gateway/domain/llm-codex-runtime.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type {
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
import {
  assertAdminMediaGovernancePlanCanonicalIdentity,
  buildAdminMediaGovernancePlan,
  buildCanonicalIdentityRebasePlan,
  isCanonicalIdentityRebasePlan,
} from './media-governance-plan';
import {
  MEDIA_GOVERNANCE_PROGRESS_HOT_STORE,
  type MediaGovernanceProgressHotStore,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';
import {
  searchTmdbMediaCandidates,
  type MediaGovernanceTmdbCandidate,
  verifyTmdbMediaCandidate,
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
  llmConversationId: null | string;
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
  private readonly llmAgentResults = new Map<
    string,
    NonNullable<ReturnType<typeof parseMediaCodexAgentResult>>
  >();
  private progressSnapshotQueue: Promise<unknown> = Promise.resolve();

  constructor(
    @Optional()
    private readonly eventStream?: MediaGovernanceEventStreamService,
    @Optional()
    private readonly descriptorStore?: MediaDescriptorStore,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_STATE_STORE)
    private readonly stateStore?: MediaGovernanceStateStore,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_EXECUTION_GATEWAY)
    private readonly executionGateway?: MediaGovernanceExecutionGateway,
    @Optional()
    @Inject(MEDIA_GOVERNANCE_PROGRESS_HOT_STORE)
    private readonly progressHotStore?: MediaGovernanceProgressHotStore,
    @Optional()
    private readonly llmConfigs?: LlmConfigService,
    @Optional()
    private readonly llmConversations?: LlmConversationService,
  ) {}

  async onModuleInit() {
    if (!this.stateStore) return;
    const tasks = await this.stateStore.loadTasks();
    this.tasks.splice(
      0,
      this.tasks.length,
      ...tasks.map((task) => this.restoreStoredTask(task)),
    );
    for (const task of this.tasks) {
      if (task.llmConversationId) await this.hydrateLlmAgentProjection(task);
    }
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

  /**
   * 规范化作品身份与季号后创建并持久化媒体治理任务草稿。
   * @param input - 用于作品身份与季号后创建并持久化媒体治理任务草稿的结构化输入，包含 `titleHint`、`seasonNumbers`、`mediaType`、`providerRef` 字段。
   * @returns 作品身份与季号后创建并持久化媒体治理任务草稿。
   */
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
      llmConversationId: null,
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

  /**
   * 在执行前校验任务状态，并修正作品身份及关联单元结构。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于身份的结构化输入，包含 `expectedRevision`、`mediaType`、`providerRef`、`releaseYear` 字段。
   * @returns 身份。
   */
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
      this.hasAgentConversation(task) ||
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

  /**
   * 按期望版本删除可丢弃草稿，并同步清除持久化账本。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于discard任务的结构化输入，包含 `expectedRevision` 字段。
   * @returns 包含 `clearedWorkItemId`、`deletedTaskId` 字段的discard任务。
   */
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

  /**
   * 消费一次性描述符授权，并返回经摘要校验的私有内容。
   * @param input - 用于redeem描述信息的结构化输入，包含 `descriptorSha256` 字段。
   * @returns redeem描述信息。
   */
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

  /**
   * 消费一次性计划授权，并返回与运行绑定的密封治理计划。
   * @param input - 用于redeemPlan的结构化输入。
   * @returns 与任务和运行身份匹配、且已完成单次授权消费的密封治理计划。
   */
  async redeemPlan(input: MediaGovernancePlanRedeemDto) {
    if (!this.databaseReady() || !this.stateStore?.consumePlanGrant) {
      throwVbenError(
        '媒体治理计划授权服务暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stateStore.consumePlanGrant(input);
  }

  /**
   * 按输入分支映射执行器回调链路的持久化模式与就绪状态，并输出固定投影 `persistenceMode`、`status` 字段。
   * @returns 包含 `persistenceMode`、`status` 字段的executionCallback健康状态。
   */
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

  /**
   * 按运行序号应用执行器事件，并协调热层、数据库与任务投影。
   * @param input - 用于Executor事件的结构化输入，包含 `taskId`、`runId`、`taskRevision`、`observedAt` 字段。
   * @returns 包含 `applied`、`revision`、`runSequence` 字段的Executor事件。
   */
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

  /**
   * 将已校验执行器事件投影到任务、来源和进度状态。
   * @param task - 用于将已校验执行器事件投影到任务、来源和进度状态的领域对象，包含 `progress`、`runState`、`gateReason`、`nextCommandLabel` 字段。
   * @param input - 用于将已校验执行器事件投影到任务、来源和进度状态的结构化输入，包含 `sourceId`、`eventType`、`manifest`、`manifestSha256` 字段。
   */
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
        this.assertCanonicalSealedPlan(task);
        task.stage = 'metadata';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.metadataStatus = 'pending';
        task.nextCommandLabel = '运行 A/B/C 分档元数据核验';
      } else if (input.action === 'metadata.repair') {
        this.assertCanonicalSealedPlan(task);
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
        this.assertCanonicalSealedPlan(task);
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
        this.assertCanonicalSealedPlan(task);
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

  /**
   * 校验分档元数据证据，并更新任务身份与单元缺项投影。
   * @param task - 用于元数据Evidence的领域对象，包含 `units`、`providerRef`、`releaseYear`、`metadataIdentity` 字段。
   * @param input - 用于元数据Evidence的结构化输入，包含 `metadata`、`evidenceSha256` 字段。
   */
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

  /**
   * 返回任务各单元中已记录的最大元数据修复次数。
   * @param task - 用于任务各单元中已记录的最大元数据修复次数的领域对象，包含 `units` 字段。
   * @returns 任务各单元中已记录的最大元数据修复次数。
   */
  private metadataRepairAttempts(task: MediaGovernanceTask) {
    return Math.max(
      0,
      ...task.units.map((unit) => unit.metadataProjection.repairAttempts),
    );
  }

  /**
   * 从任务全部治理单元中取已记录身份回填次数的最大值；没有单元时返回 `0`。
   * @param task - 用于从任务全部治理单元中取已记录身份回填次数的最大值的领域对象，包含 `units` 字段。
   * @returns 从任务全部治理单元中取已记录身份回填次数的最大值。
   */
  private metadataIdentityRefreshAttempts(task: MediaGovernanceTask) {
    return Math.max(
      0,
      ...task.units.map(
        (unit) => unit.metadataProjection.identityRefreshAttempts ?? 0,
      ),
    );
  }

  /**
   * 判断任务是否仅剩可延后处理的元数据身份缺口。
   * @param task - 用于任务是否仅剩可延后处理的元数据身份缺口的领域对象，包含 `metadataIdentity`、`units` 字段。
   * @returns 满足任务是否仅剩可延后处理的元数据身份缺口约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
   */
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

  /**
   * 根据分档事实是否缺失判断任务是否仍使用旧版空投影。
   * @param task - 用于根据分档事实是否缺失判断任务是否仍使用旧版空的领域对象，包含 `units` 字段。
   * @returns 满足根据分档事实是否缺失判断任务是否仍使用旧版空约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 根据参数 `task`，判断旧版空元数据投影是否可以重新采集事实。
   * @param task - 用于根据参数 `task`，判断旧版空元数据投影是否可以重新采集事实的领域对象，包含 `stage`、`runState`、`metadataStatus`、`sealedPlan` 字段。
   * @returns 满足根据参数 `task`，判断旧版空元数据投影是否可以重新采集事实约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private canRefreshLegacyMetadata(task: MediaGovernanceTask) {
    return (
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.metadataStatus === 'requires-agent' &&
      Boolean(task.sealedPlan) &&
      this.hasLegacyEmptyMetadataProjection(task)
    );
  }

  /**
   * 根据参数 `task`，判断延后身份缺口是否仍可执行一次受限回填。
   * @param task - 用于根据参数 `task`，判断延后身份缺口是否仍可执行一次受限回填的领域对象，包含 `stage`、`runState`、`metadataStatus`、`sealedPlan` 字段。
   * @returns 满足根据参数 `task`，判断延后身份缺口是否仍可执行一次受限回填约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 判断失败的元数据或验收运行是否可从同一阶段重试。
   * @param task - 用于失败的元数据或验收运行是否可从同一阶段重试的领域对象，包含 `stage`、`runState`、`activeRunId`、`metadataStatus` 字段。
   * @param stage - 决定失败的元数据或验收运行是否可从同一阶段重试内容、边界或目标的 `stage` 值。
   * @param metadataStatus - 决定失败的元数据或验收运行是否可从同一阶段重试内容、边界或目标的 `metadataStatus` 值。
   * @returns 满足失败的元数据或验收运行是否可从同一阶段重试约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
   */
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

  /**
   * 判断当前 B 级缺项是否仍满足最多两次修复边界。
   * @param task - 用于当前 B 级缺项是否仍满足最多两次修复边界的领域对象，包含 `units` 字段。
   * @returns 满足当前 B 级缺项是否仍满足最多两次修复边界约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private canRunBoundedMetadataRepair(task: MediaGovernanceTask) {
    const projections = task.units.map((unit) => unit.metadataProjection);
    return (
      this.metadataRepairAttempts(task) < 2 &&
      projections.every((projection) => projection.missingA.length === 0) &&
      projections.some((projection) => projection.missingB.length > 0)
    );
  }

  /**
   * 判断缺项是否仅涉及可确定生成的本地元数据资源。
   * @param task - 用于缺项是否仅涉及可确定生成的本地元数据资源的领域对象，包含 `governanceProfile`、`metadataIdentity`、`units` 字段。
   * @returns 满足缺项是否仅涉及可确定生成的本地元数据资源约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 读取指定任务并刷新其心跳显示，任务不存在时返回统一错误。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 指定任务并刷新其心跳显示，任务不存在时返回统一错误。
   */
  detail(taskId: string): MediaGovernanceTask {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      throwVbenError('媒体治理任务不存在', HttpStatus.NOT_FOUND);
    }
    return this.refreshHeartbeatLabel(task);
  }

  /**
   * 根据当前领域状态，汇总任务阻塞、运行、证据漂移和字幕发布组等语义指标。
   * @returns 包含 `agentPending`、`attentionRequired`、`blocked`、`closed`、`downloading` 字段的根据当前领域状态，汇总任务阻塞、运行、证据漂移和字幕发布组等语义指标。
   */
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

  /**
   * 解析并脱敏保存磁力来源，初始化其治理与健康投影。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于并脱敏保存磁力来源，初始化其治理与健康的结构化输入，包含 `expectedRevision`、`sourceRole`、`seasonNumbers`、`magnetUri` 字段。
   * @returns 并脱敏保存磁力来源，初始化其治理与健康。
   */
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

  /**
   * 安全解析并保存种子描述符，初始化来源文件清单。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于安全解析并保存种子描述符，初始化来源文件清单的结构化输入，包含 `expectedRevision`、`sourceRole`、`seasonNumbers`、`contentKind` 字段。
   * @param file - 用于安全解析并保存种子描述符，初始化来源文件清单的领域对象，包含 `buffer`、`size` 字段。
   * @returns 安全解析并保存种子描述符，初始化来源文件清单。
   */
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

  /**
   * 修订来源角色、内容类型及适用季范围，并清除旧映射。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param input - 用于来源Classification的结构化输入，包含 `expectedRevision`、`sourceRole`、`contentKind`、`seasonNumbers` 字段。
   * @returns 来源Classification。
   */
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

  /**
   * 按文件选择与治理身份的一一对应关系校验后密封来源映射。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param input - 用于按文件选择与治理身份的一一对应关系校验后密封来源映射的结构化输入，包含 `expectedRevision`、`selectedFileIndices`、`fileMappings` 字段。
   * @returns 按文件选择与治理身份的一一对应关系校验后密封来源映射。
   */
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

  /**
   * 在允许阶段停用描述符，并触发来源运行态的精确清理。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param input - 用于来源的结构化输入，包含 `expectedRevision` 字段。
   * @returns 来源。
   * @throws 当 `reserveExecution` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
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
    const stoppedPreGovernanceFailure =
      task.stage === 'governance' &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.closedAt === null &&
      task.metadataStatus === 'pending';
    const sealedPreGovernanceArtifacts =
      task.workItemId !== null &&
      task.payloadSeal !== null &&
      task.sealedPlan !== null &&
      task.sealedPlanSha256 !== null;
    const dryRunOnlyGovernanceProgress =
      task.progress.totalItems === 5 &&
      task.progress.completedItems >= 0 &&
      task.progress.completedItems <= 1;
    const preGovernanceUnitsUntouched = task.units.every(
      (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
    );
    const resettablePreGovernanceFailure =
      stoppedPreGovernanceFailure &&
      sealedPreGovernanceArtifacts &&
      dryRunOnlyGovernanceProgress &&
      preGovernanceUnitsUntouched;
    const stageBlocksSourceRemoval =
      !['intake', 'download'].includes(task.stage) &&
      !resettableUnboundResidue &&
      !resettablePreGovernanceFailure;
    const sealedArtifactsBlockSourceRemoval =
      Boolean(task.payloadSeal || task.sealedPlan) &&
      !resettablePreGovernanceFailure;
    if (
      task.activeRunId ||
      stageBlocksSourceRemoval ||
      sealedArtifactsBlockSourceRemoval
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

  /**
   * 移除已清理来源，并重置相关字幕合同和可恢复任务状态。
   * @param task - 用于finalize来源Removal的领域对象，包含 `sources`、`units`、`governanceProfile`、`workItemId` 字段。
   * @param source - 用于finalize来源Removal的领域对象，包含 `id`、`sourceRole` 字段。
   */
  private finalizeSourceRemoval(
    task: MediaGovernanceTask,
    source: MediaGovernanceSource,
  ) {
    const sealedPreGovernanceArtifacts =
      task.workItemId !== null &&
      task.payloadSeal !== null &&
      task.sealedPlan !== null &&
      task.sealedPlanSha256 !== null;
    const preGovernanceUnitsUntouched = task.units.every(
      (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
    );
    const resetSealedPreGovernanceFailure =
      task.stage === 'governance' &&
      task.closedAt === null &&
      task.metadataStatus === 'pending' &&
      sealedPreGovernanceArtifacts &&
      preGovernanceUnitsUntouched;
    task.sources.splice(task.sources.indexOf(source), 1);
    for (const unit of task.units) {
      if (unit.subtitleContract?.sourceId === source.id) {
        unit.subtitleContract = null;
      }
    }
    this.refreshExpectedEpisodeNumbers(task);
    if (source.sourceRole === 'primary_media') task.governanceProfile = null;
    if (resetSealedPreGovernanceFailure) {
      task.payloadSeal = null;
      task.sealedPlan = null;
      task.sealedPlanSha256 = null;
    }
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

  /**
   * 按视频、字幕或字体角色约束校验所选文件扩展名。
   * @param relativePath - 必须保持在受控根目录内的relative路径。
   * @param fileRole - 决定按视频、字幕或字体角色约束校验所选文件扩展名内容、边界或目标的 `fileRole` 值。
   */
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

  /**
   * 从主媒体文件映射重新计算各季预期集号。
   * @param task - 用于从主媒体文件映射重新计算各季预期集号的领域对象，包含 `mediaType`、`sources`、`units` 字段。
   */
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

  /**
   * 从同包简体字幕映射推导逐季单一发布组合同。
   * @param task - 用于从同包简体字幕映射推导逐季单一发布组合同的领域对象，包含 `governanceProfile`、`units`、`sources` 字段。
   * @param strict - 决定是否启用“strict”分支的布尔选项；省略时默认采用 `false`。
   */
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

  /**
   * 按参数 `taskId`，校验补充字幕来源后绑定完整逐季字幕合同。
   * @param taskId - 用于精确定位任务的标识。
   * @param unitId - 用于精确定位unit的标识。
   * @param input - 用于按参数 `taskId`，校验补充字幕来源后绑定完整逐季字幕合同的结构化输入，包含 `expectedRevision`、`sourceId`、`releaseGroup`、`mappings` 字段。
   * @returns 按参数 `taskId`，校验补充字幕来源后绑定完整逐季字幕合同。
   */
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

  /**
   * 通过启动正式来源清单检查，或在模拟模式构造受限清单。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param input - 用于通过启动正式来源清单检查，或在模拟模式构造受限清单的结构化输入，包含 `expectedRevision` 字段。
   * @returns 通过启动正式来源清单检查，或在模拟模式构造受限清单。
   */
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

  /**
   * 启动来源运行时可用性探针，或返回模拟探针结果。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param input - 用于来源运行时可用性探针，或返回模拟探针结果的结构化输入，包含 `expectedRevision` 字段。
   * @returns 来源运行时可用性探针，或返回模拟探针。
   */
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

  /**
   * 根据来源与文件映射的完整性校验结果启动或续接隔离下载。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于下载任务的结构化输入，包含 `expectedRevision` 字段。
   * @returns 下载任务。
   */
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

  /**
   * 按下载来源身份核对文件映射、视频覆盖与字幕合同完整性。
   * @param task - 用于按下载来源身份核对文件映射、视频覆盖与字幕合同完整性的领域对象，包含 `sources`、`units`、`governanceProfile`、`mediaType` 字段。
   */
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

  /**
   * 根据`taskId`、`input`处理安全暂停当前下载运行。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于安全暂停当前下载运行的结构化输入，包含 `expectedRevision` 字段。
   * @returns 安全暂停当前下载运行。
   */
  async pauseDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'pause');
  }

  /**
   * 请求取消当前下载并保留后续精确清理所需载荷。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于取消当前下载并保留后续精确清理所需载荷的结构化输入，包含 `expectedRevision` 字段。
   * @returns 满足取消当前下载并保留后续精确清理所需载荷约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async cancelDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'cancel');
  }

  /**
   * 根据`taskId`、`input`处理从同一运行身份继续已暂停下载。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于从同一运行身份继续已暂停下载的结构化输入，包含 `expectedRevision` 字段。
   * @returns 从同一运行身份继续已暂停下载。
   */
  async resumeDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'resume');
  }

  /**
   * 根据下载运行身份校验结果发送幂等暂停、取消或续传命令。
   * @param taskId - 用于精确定位任务的标识。
   * @param expectedRevision - 决定根据下载运行身份校验结果发送幂等暂停、取消或续传命令内容、边界或目标的 `expectedRevision` 值。
   * @param command - 决定根据下载运行身份校验结果发送幂等暂停、取消或续传命令内容、边界或目标的 `command` 值。
   * @returns 根据下载运行身份校验结果发送幂等暂停、取消或续传命令。
   */
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

  /**
   * 密封本地治理计划，并启动正式执行或受限模拟流程。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于治理任务的结构化输入，包含 `expectedRevision` 字段。
   * @returns 治理任务。
   */
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

  /**
   * 在期望版本门内把既有错误身份目录重封为规范身份重排计划并立即派发本地事务。
   * @param taskId - 用于精确定位待恢复任务的标识。
   * @param input - 携带调用方已读取任务版本的并发控制输入。
   * @returns 已进入规范身份重排运行的最新任务状态。
   * @throws 当任务已有运行、身份或计划证据不完整、目录已一致或执行链路不可用时抛出。
   */
  async startCanonicalIdentityRebase(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.activeRunId || task.stage === 'closed') {
      throwVbenError('当前任务不满足规范身份重排条件', HttpStatus.CONFLICT);
    }
    if (
      !task.sealedPlan ||
      !task.sealedPlanSha256 ||
      !task.governanceProfile ||
      !task.workItemId
    ) {
      throwVbenError('当前任务不满足规范身份重排条件', HttpStatus.CONFLICT);
    }
    if (!task.providerRef || task.providerRef.provider !== 'tmdb') {
      throwVbenError('当前任务不满足规范身份重排条件', HttpStatus.CONFLICT);
    }
    const previous = structuredClone(task);
    try {
      if (!isCanonicalIdentityRebasePlan(task.sealedPlan)) {
        const amendment = this.latestAppliedIdentityAmendment(task);
        task.sealedPlan = buildCanonicalIdentityRebasePlan(
          task,
          task.sealedPlan,
          {
            amendmentPlanSha256: amendment.planSha256,
            previousPlanSha256: task.sealedPlanSha256,
            providerTitle: amendment.providerTitle,
            summary: amendment.summary,
          },
        );
        task.sealedPlanSha256 = sha256Json(task.sealedPlan);
      }
      this.assertCanonicalSealedPlan(task);
      task.metadataStatus = 'pending';
      task.runState = 'succeeded';
      task.stage = 'governance';
      task.gateReason = null;
      task.nextCommandLabel = '正在执行规范身份目录重排';
      task.progress = {
        ...task.progress,
        etaLabel: '等待本地事务',
        progressLabel: '规范身份重排计划已密封',
      };
      await this.reserveExecution(task, 'governance.execute');
    } catch (error) {
      Object.assign(task, previous);
      if (error instanceof HttpException) throw error;
      throwVbenError(
        `规范身份重排计划无法安全密封：${String(error)}`.slice(0, 200),
        HttpStatus.CONFLICT,
      );
    }
    return task;
  }

  /**
   * 按参数 `taskId`，校验元数据门状态后启动分档事实核验。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于按参数 `taskId`，校验元数据门状态后启动分档事实核验的结构化输入，包含 `expectedRevision` 字段。
   * @returns 按参数 `taskId`，校验元数据门状态后启动分档事实核验。
   */
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
    this.assertCanonicalSealedPlan(task);
    await this.reserveExecution(task, 'metadata.verify');
    return task;
  }

  /**
   * 通过在次数与缺项边界内启动确定性元数据修复。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于通过在次数与缺项边界内启动确定性元数据修复的结构化输入，包含 `expectedRevision` 字段。
   * @returns 通过在次数与缺项边界内启动确定性元数据修复。
   */
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
    this.assertCanonicalSealedPlan(task);
    await this.reserveExecution(task, 'metadata.repair');
    return task;
  }

  /**
   * 通过在元数据门闭合后启动独立本地验收。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于通过在元数据门闭合后启动独立本地验收的结构化输入，包含 `expectedRevision` 字段。
   * @returns 通过在元数据门闭合后启动独立本地验收。
   */
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
    this.assertCanonicalSealedPlan(task);
    let sources: MediaGovernanceSource[] | undefined;
    if (task.sources.length > 0) sources = task.sources;
    await this.reserveExecution(task, 'acceptance.verify', sources);
    return task;
  }

  /**
   * 为当前任务创建或返回唯一绑定的本地 Codex LLM 对话。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于保留当前运行边界并启动或安全重试 Codex Agent 会话的结构化输入，包含 `expectedRevision` 字段。
   * @returns 从唯一 LLM conversation 派生的初始治理投影。
   */
  async startAgent(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask['agentSession']> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.stage === 'closed') {
      throwVbenError('已完成任务不能启动 Agent', HttpStatus.CONFLICT);
    }
    if (task.llmConversationId) {
      await this.hydrateLlmAgentProjection(task);
      if (!task.agentSession) {
        throwVbenError('任务绑定的本地 Codex 对话不可用', HttpStatus.CONFLICT);
      }
      return task.agentSession;
    }
    if (!this.llmConfigs || !this.llmConversations) {
      throwVbenError(
        '本地 Codex LLM 对话服务尚未就绪',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.startLlmAgentConversation(task);
  }

  /**
   * 从默认 Codex 连接建立或复用唯一媒体场景对话，并在同一次任务保存中清除旧 session 投影。
   * @param task - 当前媒体治理任务。
   * @returns 从 LLM conversation 派生的 Agent 投影。
   */
  private async startLlmAgentConversation(task: MediaGovernanceTask) {
    const runtime = await this.llmConfigs!.runtimeForProvider('codex');
    const model = await this.llmConfigs!.resolveModel(runtime);
    const conversation = await this.llmConversations!.createScene(
      runtime.entity.id,
      `${task.titleHint} · 媒体治理`,
      'media-governance',
      task.id,
    );
    const identity = await this.llmConversations!.resolveIdentity({
      conversationId: conversation.id,
      scene: 'media-governance',
      sceneRefId: task.id,
    });
    task.llmConversationId = identity.conversationId;
    this.llmAgentResults.delete(task.id);
    if (!task.activeRunId) {
      task.revision += 1;
      task.runState = 'blocked';
      task.nextCommandLabel = '进入本地 Codex 对话继续治理';
    }
    const request = this.buildLlmAgentTurnRequest(
      task,
      model,
      '请分析当前媒体治理任务并给出下一步。',
      `media-user-${randomUUID()}`,
    );
    const policy = buildMediaCodexAgentPolicy(task.id);
    const capsule = buildMediaCodexAgentCapsule(request, policy);
    task.agentSession = {
      capsuleSha256: capsule.capsuleSha256,
      checkpointSha256: sha256Json({
        conversationId: identity.conversationId,
        taskId: task.id,
      }),
      currentActionLabel: '等待在统一 LLM 对话页发送消息',
      currentUnitId: request.currentUnitId,
      lastHeartbeatLabel: '刚刚',
      lastSequence: 0,
      pendingPlanSha256: null,
      policyBoundaryLabel:
        '会话、模型、流式状态与 Codex thread 由 LLM 模块统一管理',
      policySha256: policy.policySha256,
      policyVersion: policy.policyVersion,
      status: 'needs-operator',
      statusLabel: '等待进入本地 Codex 对话',
      threadId: identity.conversationId,
    };
    this.refreshSemanticProjection(task);
    await this.commitTask(task, 'state-updated');
    return task.agentSession;
  }

  /**
   * 为绑定的 LLM 对话生成当前媒体任务动态工具边界。
   * @param input - 对话、任务、模型和本轮用户消息。
   * @returns 可交给 App Server 的媒体治理回合请求。
   */
  async llmConversationContext(input: {
    clientMessageId: string;
    content: string;
    conversationId: string;
    conversationTurnId: string;
    model: string;
    providerThreadId: null | string;
    taskId: string;
  }) {
    const task = this.detail(input.taskId);
    if (task.llmConversationId !== input.conversationId) {
      throwVbenError('LLM 对话未绑定当前媒体任务', HttpStatus.CONFLICT);
    }
    if (!this.llmConversations) {
      throwVbenError(
        '本地 Codex LLM 对话服务尚未就绪',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const identity = await this.llmConversations.resolveIdentity({
      activeTurnId: input.conversationTurnId,
      conversationId: input.conversationId,
      providerThreadId: input.providerThreadId,
      scene: 'media-governance',
      sceneRefId: task.id,
    });
    await this.llmConversations.updateSceneTitle({
      conversationId: input.conversationId,
      scene: 'media-governance',
      sceneRefId: task.id,
      title: `${task.titleHint} · 媒体治理`,
    });
    const request = this.buildLlmAgentTurnRequest(
      task,
      input.model,
      input.content,
      input.clientMessageId,
    );
    const policy = buildMediaCodexAgentPolicy(task.id);
    const providerThreadResetRequired = Boolean(
      identity.providerThreadId &&
      task.agentSession?.policyVersion !== policy.policyVersion,
    );
    const capsule = buildMediaCodexAgentCapsule(request, policy);
    task.agentSession = {
      capsuleSha256: capsule.capsuleSha256,
      checkpointSha256: sha256Json({
        clientMessageId: input.clientMessageId,
        conversationId: input.conversationId,
      }),
      currentActionLabel: '本地 Codex 正在处理当前消息',
      currentUnitId: request.currentUnitId,
      lastHeartbeatLabel: '刚刚',
      lastSequence: task.agentSession?.lastSequence ?? 0,
      pendingPlanSha256: task.agentSession?.pendingPlanSha256 ?? null,
      policyBoundaryLabel: '媒体任务仅绑定 LLM conversationId',
      policySha256: policy.policySha256,
      policyVersion: policy.policyVersion,
      status: 'running',
      statusLabel: '本地 Codex 正在生成',
      threadId: input.conversationId,
    };
    this.refreshSemanticProjection(task);
    this.publishTaskPatch(task, 'state-updated');
    return {
      identity: { ...identity, providerThreadResetRequired },
      request,
    };
  }

  /**
   * 在 App Server turn 启动前按 Task 绑定执行 provider thread CAS，消除首轮结果快于 SSE start 的竞态。
   * @param input - 对话、任务、旧线程比较值与 App Server 实际线程。
   * @returns 绑定完成后的权威媒体对话身份。
   */
  async bindLlmConversationProviderThread(input: {
    conversationId: string;
    conversationTurnId: string;
    expectedProviderThreadId: null | string;
    providerThreadId: string;
    replaceProviderThread?: boolean;
    taskId: string;
  }) {
    const task = this.detail(input.taskId);
    if (task.llmConversationId !== input.conversationId) {
      throwVbenError('LLM 对话未绑定当前媒体任务', HttpStatus.CONFLICT);
    }
    if (!this.llmConversations) {
      throwVbenError(
        '本地 Codex LLM 对话服务尚未就绪',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.llmConversations.bindProviderThread({
      allowReplace: input.replaceProviderThread,
      conversationId: input.conversationId,
      conversationTurnId: input.conversationTurnId,
      expectedProviderThreadId: input.expectedProviderThreadId,
      providerThreadId: input.providerThreadId,
      scene: 'media-governance',
      sceneRefId: task.id,
    });
  }

  /**
   * 先核对任务与对话身份，再把严格结构化结果同步到计划、Agent 状态和任务版本。
   * @param input - 对话、任务和最终结构化结果。
   * @returns 结果应用状态与当前任务版本。
   */
  async applyLlmConversationResult(input: {
    conversationId: string;
    conversationTurnId: string;
    providerThreadId: string;
    result: Record<string, unknown>;
    taskId: string;
  }) {
    const task = this.detail(input.taskId);
    if (task.llmConversationId !== input.conversationId) {
      throwVbenError('LLM 对话未绑定当前媒体任务', HttpStatus.CONFLICT);
    }
    if (!this.llmConversations) {
      throwVbenError(
        '本地 Codex LLM 对话服务尚未就绪',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.llmConversations.resolveIdentity({
      activeTurnId: input.conversationTurnId,
      conversationId: input.conversationId,
      providerThreadId: input.providerThreadId,
      scene: 'media-governance',
      sceneRefId: task.id,
    });
    const result = parseMediaCodexAgentResult(input.result);
    if (!result) {
      throwVbenError('媒体治理结构化结果无效', HttpStatus.BAD_REQUEST);
    }
    this.llmAgentResults.set(task.id, result);
    const session = task.agentSession;
    if (session) {
      session.currentActionLabel = result.summary;
      session.lastHeartbeatLabel = '刚刚';
      session.status = 'needs-operator';
      session.statusLabel = '本地 Codex 已回复';
      if (result.status === 'blocked') {
        session.status = 'failed';
        session.statusLabel = '本地 Codex 本轮受阻';
      }
      if (result.status === 'plan-submitted') {
        session.statusLabel = '密封计划已提交，等待人工复核';
        if (
          !result.planSha256 ||
          result.planSha256 !== session.pendingPlanSha256
        ) {
          throwVbenError(
            'LLM 对话结果与已提交密封计划不一致',
            HttpStatus.CONFLICT,
          );
        }
        if (this.agentPendingAmendment(task)) {
          this.finalizeAgentIdentityAmendment(task, result.planSha256);
          session.status = 'succeeded';
          session.statusLabel = 'TMDB 身份已密封应用';
          task.revision += 1;
        }
        session.pendingPlanSha256 = null;
      }
      if (result.status === 'requires-operator') {
        session.statusLabel = '等待人工选择候选';
      }
    }
    if (!task.activeRunId) {
      task.runState = 'blocked';
      task.nextCommandLabel = session?.statusLabel ?? result.nextActionLabel;
    }
    this.refreshSemanticProjection(task);
    await this.commitTask(task, 'state-updated');
    return { applied: true, revision: task.revision };
  }

  /**
   * 生成当前媒体任务在 LLM 对话中的回合请求。
   * @param task - 当前媒体治理任务。
   * @param model - 当前 Codex 模型。
   * @param content - 本轮用户消息。
   * @param clientMessageId - 客户端幂等消息标识。
   * @returns 含当前 revision、manifest 和任务事实的回合请求。
   */
  private buildLlmAgentTurnRequest(
    task: MediaGovernanceTask,
    model: string,
    content: string,
    clientMessageId: string,
  ) {
    return {
      clientMessageId,
      compactContext: this.buildAgentCompactContext(task, task.revision),
      currentStage: task.stage,
      currentUnitId: task.units[0]?.id ?? null,
      manifestSha256: task.inputSnapshotSha256,
      model,
      operatorCommand: content,
      replayKey: this.agentReplayKey(task, task.revision),
      taskId: task.id,
      taskRevision: task.revision,
    };
  }

  /**
   * 从 LLM 对话消息恢复媒体任务的瞬时 Agent 展示与结果缓存。
   * @param task - 已绑定 conversationId 的媒体任务。
   */
  private async hydrateLlmAgentProjection(task: MediaGovernanceTask) {
    if (!task.llmConversationId || !this.llmConversations) return;
    try {
      const conversationIdentity = await this.llmConversations.resolveIdentity({
        conversationId: task.llmConversationId,
        scene: 'media-governance',
        sceneRefId: task.id,
      });
      await this.llmConversations.updateSceneTitle({
        conversationId: task.llmConversationId,
        scene: 'media-governance',
        sceneRefId: task.id,
        title: `${task.titleHint} · 媒体治理`,
      });
      const detail = await this.llmConversations.detail(task.llmConversationId);
      let model = detail.conversation.selectedModel || '';
      if (!model) {
        const runtime = await this.llmConfigs!.runtime(detail.config.id);
        model = await this.llmConfigs!.resolveModel(runtime);
      }
      const request = this.buildLlmAgentTurnRequest(
        task,
        model,
        '恢复媒体治理对话',
        `media-user-${randomUUID()}`,
      );
      const policy = buildMediaCodexAgentPolicy(task.id);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      let status: NonNullable<MediaGovernanceTask['agentSession']>['status'] =
        'needs-operator';
      let statusLabel = '等待继续本地 Codex 对话';
      if (detail.conversation.active) {
        status = 'running';
        statusLabel = '本地 Codex 正在生成';
      }
      const lastAssistant = [...detail.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      if (
        lastAssistant?.status === 'failed' ||
        lastAssistant?.status === 'interrupted'
      ) {
        status = 'failed';
        statusLabel = '上轮对话未完成，可继续发送消息';
      }
      const rawResult = lastAssistant?.metadata?.mediaGovernanceResult;
      let restoredPolicyVersion = policy.policyVersion;
      if (
        conversationIdentity.providerThreadId &&
        (!rawResult ||
          typeof rawResult !== 'object' ||
          Array.isArray(rawResult) ||
          typeof (rawResult as Record<string, unknown>).answer !== 'string')
      ) {
        restoredPolicyVersion = 'media-codex-agent-policy-v2';
      }
      const result = parseMediaCodexAgentResult(rawResult);
      if (result) {
        this.llmAgentResults.set(task.id, result);
        statusLabel = result.nextActionLabel;
      }
      task.agentSession = {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: sha256Json({
          conversationId: task.llmConversationId,
        }),
        currentActionLabel: result?.summary ?? statusLabel,
        currentUnitId: request.currentUnitId,
        lastHeartbeatLabel: '已从 LLM 对话恢复',
        lastSequence: detail.messages.length,
        pendingPlanSha256: result?.planSha256 ?? null,
        policyBoundaryLabel: '媒体任务仅绑定 LLM conversationId',
        policySha256: policy.policySha256,
        policyVersion: restoredPolicyVersion,
        status,
        statusLabel,
        threadId: task.llmConversationId,
      };
    } catch {
      task.agentSession = null;
    }
  }

  /**
   * 返回 Agent 回调持久化链路的就绪状态。
   * @returns 包含 `persistenceMode`、`status` 字段的Agent 回调持久化链路的就绪状态。
   */
  agentCallbackHealth() {
    if (this.databaseReady()) {
      return { persistenceMode: 'database', status: 'ready' } as const;
    }
    return {
      persistenceMode: 'process-simulator',
      status: 'not-ready',
    } as const;
  }

  /**
   * 同步远端 Agent 会话，并投影最新状态、结果与对话增量。
   * @param taskId - 用于精确定位任务的标识。
   * @param query - 限定Agent会话筛选、排序与分页范围的查询条件；省略时默认采用 `{ afterSequence: 0, limit: 200, }`。
   * @returns Agent会话。
   */
  async agentSession(
    taskId: string,
    query: MediaGovernanceAgentSessionQueryDto = {
      afterSequence: 0,
      limit: 200,
    },
  ) {
    const task = this.detail(taskId);
    void query;
    if (!task.llmConversationId || !this.llmConversations) return null;
    await this.hydrateLlmAgentProjection(task);
    const detail = await this.llmConversations.detail(task.llmConversationId);
    const result = this.llmAgentResults.get(task.id) ?? null;
    return {
      ...structuredClone(task.agentSession),
      conversationRevision: detail.messages.length,
      hasMoreMessages: false,
      historyComplete: true,
      messages: detail.messages.map((message) => {
        let phase: 'commentary' | 'final_answer' | 'user' = 'user';
        if (message.role === 'assistant') phase = 'final_answer';
        let status: 'completed' | 'streaming' = 'completed';
        if (message.status === 'streaming') status = 'streaming';
        return {
          content: message.content,
          messageId: message.id,
          observedAt: String(message.createTime),
          phase,
          result: parseMediaCodexAgentResult(
            message.metadata?.mediaGovernanceResult,
          ),
          role: message.role,
          sequence: message.sequence,
          status,
          turnId: message.id,
        };
      }),
      recommendations: this.agentConversationRecommendations(task, result),
      result,
    };
  }

  /**
   * 根据 Agent 结果或任务阶段生成有限的建议提问。
   * @param task - 用于根据 Agent 结果或任务阶段生成有限的建议提问的领域对象，包含 `stage`、`nextCommandLabel` 字段。
   * @param result - 用于根据 Agent 结果或任务阶段生成有限的建议提问的领域对象，包含 `status`、`candidates` 字段。
   * @returns 按输入顺序得到的根据 Agent 结果或任务阶段生成有限的建议提问列表；没有匹配项时为空数组。
   */
  private agentConversationRecommendations(
    task: MediaGovernanceTask,
    result: ReturnType<typeof parseMediaCodexAgentResult>,
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

  /**
   * 根据 Agent 工具身份与边界校验结果执行受支持的类型化调用。
   * @param input - 用于根据 Agent 工具身份与边界校验结果执行受支持的类型化调用的结构化输入，包含 `taskId`、`taskRevision`、`manifestSha256`、`policySha256` 字段。
   * @returns 包含 `accepted`、`planSha256`、`taskId`、`taskRevision`、`writeBoundaries` 字段的根据 Agent 工具身份与边界校验结果执行受支持的类型化调用。
   */
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
    const availableActions = this.agentAvailableActions(task);
    if (!availableActions.includes(input.tool)) {
      throwVbenError('当前阶段不允许执行该 Agent 动作', HttpStatus.CONFLICT);
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
          permissionProfile: LLM_CODEX_PERMISSION_PROFILE,
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
      case 'media.identity.confirm':
        return this.confirmAgentIdentity(task, input.arguments);
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
        return this.agentManifestPage(task, input.arguments);
      case 'media.source.add-magnet': {
        const contentKind = input.arguments.contentKind;
        const magnetUri = input.arguments.magnetUri;
        const releaseGroup = input.arguments.releaseGroup;
        if (
          typeof contentKind !== 'string' ||
          typeof magnetUri !== 'string' ||
          typeof releaseGroup !== 'string'
        ) {
          throwVbenError('Agent 磁链来源参数无效', HttpStatus.BAD_REQUEST);
        }
        const normalizedMagnetUri = String(magnetUri);
        const normalizedReleaseGroup = String(releaseGroup);
        await this.addMagnetSource(task.id, {
          contentKind: contentKind as MediaGovernanceContentKind,
          expectedRevision: task.revision,
          magnetUri: normalizedMagnetUri,
          releaseGroup: normalizedReleaseGroup,
          seasonNumbers: task.units
            .map((unit) => unit.seasonNumber)
            .filter((season): season is string => Boolean(season)),
          sourceRole: 'primary_media',
        });
        return this.agentActionReceipt(task, input.tool);
      }
      case 'media.source.inspect': {
        const sourceId = this.agentSourceId(input.arguments);
        await this.inspectSource(task.id, sourceId, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      }
      case 'media.source.remove': {
        const sourceId = this.agentSourceId(input.arguments);
        await this.removeSource(task.id, sourceId, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      }
      case 'media.selection.auto':
        return this.applyAgentAutomaticSelection(task, input.arguments);
      case 'media.probe.read':
        this.assertAgentReadArguments(input.arguments);
        return task.sources.map((source) => ({
          id: source.id,
          sourceHealth: source.sourceHealth,
          sourceHealthLabel: source.sourceHealthLabel,
          sourceHealthReasonLabel: source.sourceHealthReasonLabel,
        }));
      case 'media.probe.start': {
        const sourceId = this.agentSourceId(input.arguments);
        await this.probeRuntimeSource(task.id, sourceId, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      }
      case 'media.download.start':
        await this.startDownload(task.id, { expectedRevision: task.revision });
        return this.agentActionReceipt(task, input.tool);
      case 'media.governance.start':
        await this.startGovernance(task.id, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      case 'media.metadata.verify':
        await this.startMetadataVerification(task.id, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      case 'media.metadata.repair':
        await this.startMetadataRepair(task.id, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      case 'media.acceptance.verify':
        await this.startAcceptanceVerification(task.id, {
          expectedRevision: task.revision,
        });
        return this.agentActionReceipt(task, input.tool);
      case 'provider.metadata.read':
        this.assertAgentReadArguments(input.arguments);
        let candidates: MediaGovernanceTmdbCandidate[] = [];
        let lookupAvailable = true;
        try {
          candidates = await this.searchAgentIdentityCandidates(task);
        } catch {
          lookupAvailable = false;
        }
        return {
          candidates,
          declaredProvider: task.providerRef,
          identityPreview: task.identityPreview,
          lookupAvailable,
          networkLookupPerformed: true,
          verifiedIdentity: task.metadataIdentity,
        };
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

  /**
   * 复核操作员选择的候选，并推进正式或模拟治理状态。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于operatorDecision的结构化输入，包含 `expectedRevision`、`selectedCandidateId`、`reason` 字段。
   * @returns 应用操作员候选选择后得到的最新治理任务视图。
   */
  async operatorDecision(
    taskId: string,
    input: MediaGovernanceOperatorDecisionDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    const productionExecution = this.executionGateway?.enabled() === true;
    this.assertRevision(task, input.expectedRevision);
    if (task.agentSession?.status !== 'needs-operator') {
      throwVbenError('当前没有待处理的 Agent 候选', HttpStatus.CONFLICT);
    }
    if (task.llmConversationId) {
      const remoteResult = this.llmAgentResults.get(task.id) ?? null;
      if (
        remoteResult?.status !== 'requires-operator' ||
        !remoteResult.candidates.some(
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

  /**
   * 按规范字段顺序计算任务的脱敏验收摘要及固定零写边界，并输出固定投影 `agentStatusLabel`、`descriptorCount`、`eventProjection`、`localAcceptedUnitCount`、`metadataStatusLabel` 字段。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 包含 `agentStatusLabel`、`descriptorCount`、`eventProjection`、`localAcceptedUnitCount`、`metadataStatusLabel` 字段的evidence。
   */
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

  /**
   * 按关键词与语义筛选条件分页返回任务列表。
   * @param query - 限定按关键词与语义筛选条件分页返回任务列表筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize`、`keyword`、`stage` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的按关键词与语义筛选条件分页返回任务列表。
   */
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

  /**
   * 按任务标题、类型和年份查询 TMDB 身份候选。
   * @param task - 用于按任务标题、类型和年份查询 TMDB 身份候选的领域对象，包含 `mediaType`、`releaseYear`、`titleHint` 字段。
   * @returns 按任务标题、类型和年份查询 TMDB 身份候选。
   */
  private searchAgentIdentityCandidates(task: MediaGovernanceTask) {
    return searchTmdbMediaCandidates({
      mediaType: task.mediaType,
      releaseYear: task.releaseYear,
      title: task.titleHint,
    });
  }

  /**
   * 根据 A 级缺项内容判断是否要求 Agent 修正资料源身份。
   * @param task - 用于根据 A 级缺项内容判断是否要求 Agent 修正资料源身份的领域对象，包含 `units` 字段。
   * @returns 满足根据 A 级缺项内容判断是否要求 Agent 修正资料源身份约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 重新查询 TMDB 并确认 Agent 提交候选仍与声明一致。
   * @param task - 决定重新查询 TMDB 并确认 Agent 提交候选仍与声明一致内容、边界或目标的 `task` 值。
   * @param identity - 区分重新查询 TMDB 并确认 Agent 提交候选仍与声明一致所属账号、设备或运行实例的稳定身份。
   * @returns 重新查询 TMDB 并确认 Agent 提交候选仍与声明一致。
   */
  private async assertAgentIdentityCandidate(
    task: MediaGovernanceTask,
    identity: NonNullable<MediaGovernanceAgentSealedPlan['identity']>,
  ) {
    let candidates: MediaGovernanceTmdbCandidate[] = [];
    try {
      candidates = await this.searchAgentIdentityCandidates(task);
    } catch {}
    let candidate = candidates.find(
      (entry) => entry.providerId === identity.providerId,
    );
    if (!candidate) {
      try {
        candidate = await verifyTmdbMediaCandidate({
          mediaType: task.mediaType,
          providerId: identity.providerId,
          releaseYear: identity.releaseYear,
        });
      } catch {
        throwVbenError('TMDB 身份候选无法从官方页面核验', HttpStatus.CONFLICT);
      }
    }
    if (!candidate || candidate.releaseYear !== identity.releaseYear) {
      throwVbenError('Agent 提交的 TMDB 候选无法复核', HttpStatus.CONFLICT);
    }
    return candidate;
  }

  /**
   * 将待确认身份修正写入当前密封计划的临时区。
   * @param task - 用于将待确认身份修正写入当前密封计划的临时区的领域对象，包含 `sealedPlan` 字段。
   * @param amendment - 决定将待确认身份修正写入当前密封计划的临时区内容、边界或目标的 `amendment` 值。
   */
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

  /**
   * 从密封计划读取待确认的 Agent 身份修正；字段缺失或不符合身份格式时返回 `undefined`。
   * @param task - 用于从密封计划读取待确认的 Agent 身份修正的领域对象，包含 `sealedPlan` 字段。
   * @returns 从密封计划读取待确认的 Agent 身份修正；无法解析或未命中时为 `null`。
   */
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

  /**
   * 读取与任务当前 TMDB 身份一致的最后一条已应用修正，作为恢复重排的可审计来源。
   * @param task - 已写入资料源身份且保留 Agent 修正历史的媒体任务。
   * @returns 与当前任务身份、年份一致的最新修正摘要和密封计划摘要。
   * @throws 当修正历史缺失、格式非法或与当前任务身份不一致时抛出。
   */
  private latestAppliedIdentityAmendment(task: MediaGovernanceTask) {
    const amendments = task.sealedPlan?.agentAmendments;
    if (!Array.isArray(amendments) || !task.providerRef) {
      throw new Error('governance-identity-amendment-history-missing');
    }
    for (const value of [...amendments].reverse()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const amendment = value as Record<string, unknown>;
      if (
        amendment.kind !== 'identity' ||
        amendment.provider !== task.providerRef.provider ||
        amendment.providerId !== task.providerRef.providerId ||
        amendment.releaseYear !== task.releaseYear
      ) {
        continue;
      }
      if (
        typeof amendment.planSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(amendment.planSha256)
      ) {
        continue;
      }
      if (
        typeof amendment.providerTitle !== 'string' ||
        !amendment.providerTitle.trim() ||
        typeof amendment.summary !== 'string'
      ) {
        continue;
      }
      return {
        planSha256: amendment.planSha256,
        providerTitle: amendment.providerTitle,
        summary: amendment.summary,
      };
    }
    throw new Error('governance-identity-amendment-history-mismatch');
  }

  /**
   * 把计划身份或规范目标根漂移统一转换为前端可识别的冲突错误。
   * @param task - 准备执行治理后续阶段的任务。
   * @throws 当计划摘要、身份或全部目标根与任务当前身份不一致时抛出。
   */
  private assertCanonicalSealedPlan(task: MediaGovernanceTask) {
    try {
      assertAdminMediaGovernancePlanCanonicalIdentity(task);
    } catch {
      throwVbenError('密封计划身份与规范目录不一致', HttpStatus.CONFLICT);
    }
  }

  /**
   * 核对计划摘要后原子应用 TMDB 身份修正并重封计划。
   * @param task - 用于计划摘要后原子应用 TMDB 身份修正并重封计划的领域对象，包含 `revision`、`sealedPlan`、`providerRef`、`metadataIdentity` 字段。
   * @param planSha256 - 决定计划摘要后原子应用 TMDB 身份修正并重封计划内容、边界或目标的 `planSha256` 值。
   */
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
    const nextProviderRef: MediaGovernanceProviderRef = {
      provider: 'tmdb',
      providerId: amendment.identity.providerId,
    };
    const nextTask = {
      ...task,
      providerRef: nextProviderRef,
      releaseYear: amendment.identity.releaseYear,
    };
    const amendedPlan = {
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
        providerRef: nextProviderRef,
        providerTitle: amendment.providerTitle,
        releaseYear: amendment.identity.releaseYear,
      },
    };
    task.sealedPlan = buildCanonicalIdentityRebasePlan(nextTask, currentPlan, {
      amendmentPlanSha256: planSha256,
      previousPlanSha256: task.sealedPlanSha256!,
      providerTitle: amendment.providerTitle,
      summary: amendment.summary,
    });
    task.sealedPlan = {
      ...task.sealedPlan,
      agentAmendments: amendedPlan.agentAmendments,
    };
    task.providerRef = nextProviderRef;
    task.metadataIdentity = {
      ...nextProviderRef,
      releaseYear: amendment.identity.releaseYear,
    };
    task.releaseYear = amendment.identity.releaseYear;
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
    task.runState = 'blocked';
    task.stage = 'governance';
    task.gateReason = '身份修正已生成规范目录重排计划';
    task.nextCommandLabel = '执行规范身份目录重排';
    task.progress = {
      ...task.progress,
      etaLabel: '等待本地事务',
      progressLabel: 'TMDB 身份已密封，等待规范目录重排',
    };
  }

  /**
   * 根据参数 `tool`，提取密封计划操作涉及的来源与目标路径。
   * @param tool - 决定根据参数 `tool`，提取密封计划操作涉及的来源与目标路径内容、边界或目标的 `tool` 值。
   * @param plan - 用于根据参数 `tool`，提取密封计划操作涉及的来源与目标路径的领域对象，包含 `operations` 字段。
   * @returns 根据参数 `tool`，提取密封计划操作涉及的来源与目标路径。
   */
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

  /**
   * 校验 Agent 只读工具仅携带允许的来源或单元标识。
   * @param value - 参与Agent 只读工具仅携带允许的来源或单元标识比较、格式化或输出的候选值。
   * @returns 包含 `sourceId`、`unitId` 字段的Agent 只读工具仅携带允许的来源或单元标识。
   */
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

  /**
   * 按来源、偏移和上限分页投影文件清单，避免大来源超过 Gateway 响应体边界。
   * @param task - 当前媒体任务。
   * @param value - 含 sourceId、offset 和 limit 的动态工具参数。
   * @returns 包含总数、当前页、下一偏移和 manifest SHA 的有界清单页。
   */
  private agentManifestPage(
    task: MediaGovernanceTask,
    value: Record<string, unknown>,
  ) {
    const sourceId = this.agentSourceId(value);
    const offset = value.offset;
    const limit = value.limit;
    const offsetNumber = Number(offset);
    const offsetValid =
      Number.isInteger(offset) && offsetNumber >= 0 && offsetNumber <= 20000;
    const limitNumber = Number(limit);
    const limitValid =
      Number.isInteger(limit) && limitNumber >= 1 && limitNumber <= 200;
    if (!offsetValid || !limitValid) {
      throwVbenError('Agent 清单分页参数无效', HttpStatus.BAD_REQUEST);
    }
    const source = this.findSource(task, sourceId);
    const start = offsetNumber;
    const end = Math.min(source.manifest.length, start + limitNumber);
    let nextOffset: null | number = null;
    if (end < source.manifest.length) nextOffset = end;
    return {
      items: source.manifest.slice(start, end),
      limit: limitNumber,
      manifestSha256: source.manifestSha256,
      nextOffset,
      offset: start,
      sourceId: source.id,
      total: source.manifest.length,
    };
  }

  /**
   * 从当前 Task 的真实阶段、来源和运行门推导 Agent 本轮可调用动作，供提示词与服务端共用。
   * @param task - 当前媒体任务权威快照。
   * @returns 始终包含只读工具，并只加入当前阶段能够通过既有应用服务门禁的写动作。
   */
  private agentAvailableActions(task: MediaGovernanceTask) {
    const actions: MediaCodexAgentTool[] = [
      'media.identity.read',
      'media.manifest.read',
      'media.probe.read',
      'provider.metadata.read',
      'subtitle.contract.read',
      'evidence.read',
    ];
    if (task.stage === 'closed' || task.activeRunId) return actions;
    if (task.stage === 'intake') {
      if (!task.providerRef) actions.push('media.identity.confirm');
      if (
        !task.sources.some(
          (source) =>
            source.sourceRole === 'primary_media' &&
            source.descriptorTombstonedAt === null,
        )
      ) {
        actions.push('media.source.add-magnet');
      }
      if (
        task.sources.some(
          (source) => source.manifestState === 'pending-inspection',
        )
      ) {
        actions.push('media.source.inspect');
      }
      if (task.sources.length > 0) actions.push('media.source.remove');
      if (task.sources.some((source) => source.manifestState === 'inspected')) {
        actions.push('media.selection.auto');
      }
      if (
        task.sources.some(
          (source) =>
            source.manifestState === 'inspected' &&
            source.selectedFileCount > 0 &&
            source.selectedFileMappings.length === source.selectedFileCount &&
            source.sourceHealth !== 'probing',
        )
      ) {
        actions.push('media.probe.start');
      }
      if (
        task.sources.length > 0 &&
        task.sources.every(
          (source) =>
            source.sourceHealth === 'viable' &&
            source.selectedFileCount > 0 &&
            source.selectedFileMappings.length === source.selectedFileCount,
        )
      ) {
        actions.push('media.download.start');
      }
    }
    if (task.stage === 'download') {
      if (task.runState === 'blocked') actions.push('media.download.start');
      if (task.runState === 'succeeded') actions.push('media.governance.start');
    }
    if (task.stage === 'governance') {
      if (task.runState === 'blocked') actions.push('media.governance.start');
      actions.push('plan.submit.sealed');
    }
    if (task.stage === 'metadata') {
      actions.push('plan.submit.sealed');
      if (task.metadataStatus === 'pending') {
        actions.push('media.metadata.verify');
      }
      if (task.metadataStatus === 'requires-agent') {
        actions.push('media.metadata.repair');
      }
      if (task.metadataStatus === 'verified' && task.runState === 'succeeded') {
        actions.push('media.acceptance.verify');
      }
    }
    if (task.stage === 'acceptance' && task.runState === 'blocked') {
      actions.push('media.acceptance.verify');
    }
    return [...new Set(actions)];
  }

  /**
   * 在接收阶段应用经过实时资料源唯一核验的 TMDB 身份，并更新下一轮胶囊所需版本与快照。
   * @param task - 当前接收阶段媒体任务。
   * @param value - Agent 提交的 provider、providerId 与发行年份。
   * @returns 含新 revision 和下一动作的类型化成功回执。
   */
  private async confirmAgentIdentity(
    task: MediaGovernanceTask,
    value: Record<string, unknown>,
  ) {
    const identity = {
      provider: value.provider,
      providerId: value.providerId,
      releaseYear: value.releaseYear,
    };
    const providerValid =
      identity.provider === 'tmdb' &&
      typeof identity.providerId === 'string' &&
      /^[1-9]\d*$/u.test(identity.providerId);
    const releaseYear = Number(identity.releaseYear);
    const releaseYearValid =
      identity.releaseYear === null ||
      (Number.isInteger(identity.releaseYear) &&
        releaseYear >= 1870 &&
        releaseYear <= 2100);
    if (!providerValid || !releaseYearValid) {
      throwVbenError('Agent 身份确认参数无效', HttpStatus.BAD_REQUEST);
    }
    const providerId = String(identity.providerId);
    const candidate = await this.assertAgentIdentityCandidate(task, {
      provider: 'tmdb',
      providerId,
      releaseYear: identity.releaseYear as null | number,
    });
    const normalizedReleaseYear = identity.releaseYear as null | number;
    task.providerRef = {
      provider: 'tmdb',
      providerId,
    };
    task.metadataIdentity = {
      provider: 'tmdb',
      providerId,
      releaseYear: normalizedReleaseYear,
    };
    task.releaseYear = normalizedReleaseYear;
    task.identityPreview = this.buildIdentityPreview({
      mediaType: task.mediaType,
      providerRef: task.providerRef,
      releaseYear: normalizedReleaseYear,
      seasonNumbers: task.units
        .map((unit) => unit.seasonNumber)
        .filter((season): season is string => Boolean(season)),
      titleHint: task.titleHint,
    });
    task.inputSnapshotSha256 = createHash('sha256')
      .update(
        JSON.stringify({
          mediaType: task.mediaType,
          providerRef: task.providerRef,
          releaseYear: normalizedReleaseYear,
          seasonNumbers: task.units
            .map((unit) => unit.seasonNumber)
            .filter((season): season is string => Boolean(season)),
          titleHint: task.titleHint,
          workItemId: task.workItemId,
        }),
      )
      .digest('hex');
    task.gateReason = 'TMDB 身份已确认，等待密封文件选择';
    task.nextCommandLabel = '自动选择主媒体与中文字幕文件';
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    return {
      ...this.agentActionReceipt(task, 'media.identity.confirm'),
      providerTitle: candidate.title,
    };
  }

  /**
   * 以保守命名规则推断唯一视频、目标语言字幕和字体映射，任何重复或不明归属都会失败关闭。
   * @param task - 当前接收阶段媒体任务。
   * @param value - 指定来源与首选中文字幕语言的 Agent 参数。
   * @returns 文件选择写入后的数量、字节数和新 revision 回执。
   */
  private async applyAgentAutomaticSelection(
    task: MediaGovernanceTask,
    value: Record<string, unknown>,
  ) {
    const sourceId = this.agentSourceId(value);
    const subtitleLanguage = value.subtitleLanguage;
    if (!['zh-CN', 'zh-TW'].includes(String(subtitleLanguage))) {
      throwVbenError('Agent 自动选择字幕语言无效', HttpStatus.BAD_REQUEST);
    }
    const normalizedSubtitleLanguage = String(
      subtitleLanguage,
    ) as MediaGovernanceSubtitleLanguage;
    const source = this.findSource(task, sourceId);
    if (source.manifestState !== 'inspected') {
      throwVbenError('来源清单尚未完成检查', HttpStatus.CONFLICT);
    }
    const mappings: MediaGovernanceSourceSelectionDto['fileMappings'] = [];
    if (task.mediaType === 'tv') {
      for (const entry of source.manifest) {
        const role = this.agentFileRole(entry.relativePath);
        const episode = this.agentEpisodeIdentity(
          entry.relativePath,
          source,
          task,
        );
        if (!role || !episode) continue;
        if (role === 'subtitle') {
          const language = this.agentSubtitleLanguage(entry.relativePath);
          if (language !== normalizedSubtitleLanguage) continue;
          mappings.push({
            episodeNumber: episode.episodeNumber,
            fileRole: 'subtitle',
            index: entry.index,
            language,
            unitId: episode.unitId,
          });
          continue;
        }
        if (role === 'video') {
          mappings.push({
            episodeNumber: episode.episodeNumber,
            fileRole: 'video',
            index: entry.index,
            unitId: episode.unitId,
          });
        }
      }
    } else {
      const videoEntries = source.manifest
        .filter((entry) => this.agentFileRole(entry.relativePath) === 'video')
        .toSorted((left, right) => right.sizeBytes - left.sizeBytes);
      let selectedVideo = videoEntries[0];
      if (videoEntries.length > 1) {
        const runnerUp = videoEntries[1];
        const minimumFeatureBytes = 512 * 1024 * 1024;
        const maximumIncidentalBytes = 64 * 1024 * 1024;
        const minimumDominanceRatio = 8;
        if (
          !selectedVideo ||
          !runnerUp ||
          selectedVideo.sizeBytes < minimumFeatureBytes ||
          runnerUp.sizeBytes > maximumIncidentalBytes ||
          selectedVideo.sizeBytes < runnerUp.sizeBytes * minimumDominanceRatio
        ) {
          selectedVideo = undefined;
        }
      }
      if (!selectedVideo) {
        throwVbenError(
          '电影来源无法唯一自动判断正片，请手动选择',
          HttpStatus.CONFLICT,
        );
      }
      const unit = task.units[0];
      if (!unit) throwVbenError('任务缺少治理单元', HttpStatus.CONFLICT);
      mappings.push({
        fileRole: 'video',
        index: selectedVideo.index,
        unitId: unit.id,
      });
    }
    const videoKeys = mappings
      .filter((mapping) => mapping.fileRole === 'video')
      .map((mapping) => `${mapping.unitId}:${mapping.episodeNumber}`);
    const subtitleKeys = mappings
      .filter((mapping) => mapping.fileRole === 'subtitle')
      .map(
        (mapping) =>
          `${mapping.unitId}:${mapping.episodeNumber}:${mapping.language}`,
      );
    if (
      mappings.length === 0 ||
      !mappings.some((mapping) => mapping.fileRole === 'video') ||
      new Set(videoKeys).size !== videoKeys.length ||
      new Set(subtitleKeys).size !== subtitleKeys.length
    ) {
      throwVbenError(
        '来源自动选择存在重复或不完整映射，请手动复核',
        HttpStatus.CONFLICT,
      );
    }
    const selectedFileIndices = mappings
      .map((mapping) => mapping.index)
      .toSorted((left, right) => left - right);
    const selected = await this.updateSourceSelection(task.id, source.id, {
      expectedRevision: task.revision,
      fileMappings: mappings,
      selectedFileIndices,
    });
    return {
      ...this.agentActionReceipt(task, 'media.selection.auto'),
      selectedBytes: selected.selectedBytes,
      selectedFileCount: selected.selectedFileCount,
      subtitleCount: selected.selectedFileMappings.filter(
        (mapping) => mapping.fileRole === 'subtitle',
      ).length,
      videoCount: selected.selectedFileMappings.filter(
        (mapping) => mapping.fileRole === 'video',
      ).length,
    };
  }

  /**
   * 从需要来源参数的 Agent 命令中读取并校验精确来源标识。
   * @param value - 动态工具参数对象。
   * @returns 通过安全格式校验的来源 ID。
   */
  private agentSourceId(value: Record<string, unknown>): string {
    const sourceId = value.sourceId;
    if (
      typeof sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u.test(sourceId)
    ) {
      throwVbenError('Agent 来源标识无效', HttpStatus.BAD_REQUEST);
    }
    return String(sourceId);
  }

  /**
   * 将成功进入既有应用服务的 Agent 写动作投影为可读且可核对的新 Task 状态。
   * @param task - 动作执行后已原位更新的任务。
   * @param action - 本次通过门禁的类型化工具名。
   * @returns 带 accepted、revision、阶段和下一动作的稳定回执。
   */
  private agentActionReceipt(
    task: MediaGovernanceTask,
    action: MediaCodexAgentTool,
  ) {
    return {
      accepted: true,
      action,
      nextActionLabel: task.nextCommandLabel,
      runState: task.runState,
      stage: task.stage,
      taskId: task.id,
      taskRevision: task.revision,
    };
  }

  /**
   * 根据扩展名识别 Agent 自动选择可处理的视频或字幕角色，其他文件保持未选。
   * @param relativePath - 来源清单相对路径。
   * @returns 视频、字幕或空角色。
   */
  private agentFileRole(relativePath: string) {
    const lower = relativePath.toLowerCase();
    if (/\.(?:avi|m2ts|m4v|mkv|mov|mp4|ts|webm)$/u.test(lower)) {
      return 'video' as const;
    }
    if (/\.(?:ass|ssa|srt|sup|vtt)$/u.test(lower)) {
      return 'subtitle' as const;
    }
    return null;
  }

  /**
   * 从字幕文件名的明确边界标记推断简体或繁体中文，无法识别时拒绝自动选入。
   * @param relativePath - 字幕相对路径。
   * @returns 中文语言代码或 null。
   */
  private agentSubtitleLanguage(relativePath: string) {
    const lower = relativePath.toLowerCase();
    if (/(?:^|[._ -])(?:chs|sc|zh[-_.]?(?:cn|hans))(?=[._ -]|$)/u.test(lower)) {
      return 'zh-CN' as const;
    }
    if (/(?:^|[._ -])(?:cht|tc|zh[-_.]?tw)(?=[._ -]|$)/u.test(lower)) {
      return 'zh-TW' as const;
    }
    return null;
  }

  /**
   * 只接受 SxxExx 或根目录纯数字集号，并将其映射到来源声明范围内的唯一治理单元。
   * @param relativePath - 来源文件相对路径。
   * @param source - 声明季范围的来源。
   * @param task - 提供媒体类型和 Unit 的当前任务。
   * @returns 唯一单元与正整数集号；任何歧义返回 null。
   */
  private agentEpisodeIdentity(
    relativePath: string,
    source: MediaGovernanceSource,
    task: MediaGovernanceTask,
  ) {
    let episodeNumber: null | number = null;
    let seasonNumber: null | string = null;
    const explicit = relativePath.match(
      /(?:^|[^a-z0-9])S(\d{2})E(\d{1,3})(?!\d)/iu,
    );
    if (explicit) {
      seasonNumber = `S${explicit[1]}`;
      episodeNumber = Number(explicit[2]);
    } else if (!relativePath.includes('/')) {
      const brackets = [...relativePath.matchAll(/\[(\d{1,3})\]/gu)];
      const matched = brackets.at(-1);
      if (matched) episodeNumber = Number(matched[1]);
      if (episodeNumber === null) {
        const delimited = [
          ...relativePath.matchAll(/(?:^|[._ -])(\d{1,3})(?=$|[._ \[\]()-])/gu),
        ]
          .map((candidate) => Number(candidate[1]))
          .filter((candidate) => candidate > 0);
        const unique = [...new Set(delimited)];
        if (unique.length === 1) episodeNumber = unique[0];
      }
    }
    if (!Number.isInteger(episodeNumber) || Number(episodeNumber) < 1) {
      return null;
    }
    let unit: MediaGovernanceUnit | undefined;
    if (seasonNumber) {
      unit = task.units.find(
        (candidate) => candidate.seasonNumber === seasonNumber,
      );
    }
    if (!unit && source.seasonNumbers.length === 1) {
      unit = task.units.find(
        (candidate) => candidate.seasonNumber === source.seasonNumbers[0],
      );
    }
    if (!unit && task.units.length === 1) unit = task.units[0];
    if (!unit) return null;
    return { episodeNumber: Number(episodeNumber), unitId: unit.id };
  }

  /**
   * 构建有界任务、来源、单元和写边界上下文供 Agent 使用。
   * @param task - 用于有界任务、来源、单元和写边界上下文供 Agent 使用的领域对象，包含 `units`、`sources`、`mediaType`、`metadataIdentity` 字段。
   * @param taskRevision - 决定有界任务、来源、单元和写边界上下文供 Agent 使用内容、边界或目标的 `taskRevision` 值。
   * @returns 包含 `boundaries`、`currentUnit`、`identity`、`schemaVersion`、`sources` 字段的有界任务、来源、单元和写边界上下文供 Agent 使用。
   */
  private buildAgentCompactContext(
    task: MediaGovernanceTask,
    taskRevision: number,
  ) {
    const availableActions = this.agentAvailableActions(task);
    const sourceItems = task.sources.slice(0, 32).map((source) => ({
      contentKind: source.contentKind,
      id: source.id,
      manifestState: source.manifestState,
      manifestSha256: source.manifestSha256,
      seasonNumbers: source.seasonNumbers,
      selectedFileCount: source.selectedFileCount,
      selectedMappingCount: source.selectedFileMappings.length,
      sourceHealth: source.sourceHealth,
      sourceRole: source.sourceRole,
    }));
    const units = task.units.map((unit) => {
      let subtitleContract = null;
      if (unit.subtitleContract) {
        subtitleContract = {
          expectedEpisodeNumbers: unit.subtitleContract.expectedEpisodeNumbers,
          releaseGroup: unit.subtitleContract.releaseGroup,
          sourceId: unit.subtitleContract.sourceId,
        };
      }
      return {
        expectedEpisodeNumbers: unit.expectedEpisodeNumbers,
        id: unit.id,
        metadataProjection: unit.metadataProjection,
        seasonNumber: unit.seasonNumber,
        subtitleContract,
        unitKind: unit.unitKind,
      };
    });
    return {
      boundaries: {
        cloudGate: false,
        databaseDirectWrite: false,
        formalMediaWrite: false,
        typedExecutionOnly: true,
        uiWrite: false,
      },
      gateReason: task.gateReason,
      governanceProfile: task.governanceProfile,
      identity: {
        mediaType: task.mediaType,
        metadataIdentity: task.metadataIdentity,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        titleHint: task.titleHint,
      },
      metadataStatus: task.metadataStatus,
      nextCommandLabel: task.nextCommandLabel,
      progress: task.progress,
      schemaVersion: 'media-agent-compact-context-v2',
      sources: {
        count: task.sources.length,
        items: sourceItems,
        truncated: sourceItems.length < task.sources.length,
      },
      taskId: task.id,
      taskRevision,
      unitCount: task.units.length,
      units,
      workflow: {
        activeRun: Boolean(task.activeRunId),
        availableActions,
        hasGovernanceProfile: Boolean(task.governanceProfile),
        hasSealedPlan: Boolean(task.sealedPlan && task.sealedPlanSha256),
        planSubmitAllowed: availableActions.includes('plan.submit.sealed'),
        runState: task.runState,
        stage: task.stage,
      },
    };
  }

  /**
   * 严格解析 Agent 密封计划，并限制身份、操作和路径范围。
   * @param value - 待转换为Agent密封Plan的原始值。
   * @param taskId - 用于精确定位任务的标识。
   * @param expectedReplayKey - 用于读取或更新Agent密封Plan的稳定键。
   * @returns Agent密封Plan。
   */
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

  /**
   * 将完整任务裁剪为 Agent 边界校验所需领域投影。
   * @param task - 用于将完整任务裁剪为 Agent 边界校验所需领域的领域对象，包含 `metadataIdentity`、`activeRunId`、`closedAt`、`closedMode` 字段。
   * @returns 包含 `activeRunId`、`closedAt`、`closedMode`、`declaredUnitIds`、`gateReason` 字段的将完整任务裁剪为 Agent 边界校验所需领域。
   */
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

  /**
   * 将治理单元裁剪为 Agent 可见的元数据与字幕合同投影。
   * @param task - 用于将治理单元裁剪为 Agent 可见的元数据与字幕合同的领域对象，包含 `units`、`id` 字段。
   * @returns 按输入顺序得到的将治理单元裁剪为 Agent 可见的元数据与字幕合同列表；无法解析或未命中时为 `null`，没有匹配项时为空数组。
   */
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

  /**
   * 通过结合现有主来源校验新来源角色与内容类型。
   * @param task - 用于通过结合现有主来源校验新来源角色与内容类型的领域对象，包含 `sources`、`runState`、`stage` 字段。
   * @param input - 用于通过结合现有主来源校验新来源角色与内容类型的结构化输入，包含 `sourceRole`、`contentKind` 字段。
   * @returns 通过结合现有主来源校验新来源角色与内容类型。
   */
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

  /**
   * 校验`task`、`expectedRevision`是否满足调用方期望版本与当前任务版本一致约束，并拒绝不合法输入。
   * @param task - 用于调用方期望版本与当前任务版本一致的领域对象，包含 `revision` 字段。
   * @param expectedRevision - 决定调用方期望版本与当前任务版本一致内容、边界或目标的 `expectedRevision` 值。
   */
  private assertRevision(task: MediaGovernanceTask, expectedRevision: number) {
    if (task.revision !== expectedRevision) {
      throwVbenError(
        `任务版本已变化，当前版本为 ${task.revision}`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * 返回任务不能删除的首个确定性原因，允许删除时返回空值。
   * @param task - 用于任务不能删除的首个确定性原因，允许删除时返回空值的领域对象，包含 `stage`、`runState`、`activeRunId`、`payloadSeal` 字段。
   * @returns 当前状态对应的任务不能删除的首个确定性原因，允许删除时返回空值，取值为 `'仅接收资料阶段且尚未产生载荷的任务可以删除。'`、`'任务已进入执行阶段，不能删除。'`、`'来源运行态仍在精确清理，完成后才能删除任务。'`、`'任务已有治理结果或验收证据，不能删除。'`；无法解析或未命中时为 `null`。
   */
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
      this.hasAgentConversation(task) ||
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

  /**
   * 预留运行身份、密封执行信封并通过发件箱派发。
   * @param task - 用于预留运行身份、密封执行信封并通过发件箱派发的领域对象，包含 `activeRunId`、`nextCommandLabel`、`progress`、`revision` 字段。
   * @param action - 决定预留运行身份、密封执行信封并通过发件箱派发内容、边界或目标的 `action` 值。
   * @param sources - 决定预留运行身份、密封执行信封并通过发件箱派发内容、边界或目标的 `sources` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 预留运行身份、密封执行信封并通过发件箱派发。
   * @throws 当 `stateStore.reserveRunDispatch` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
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
      if (action === 'source.cleanup' && previous.stage === 'governance') {
        task.stage = 'governance';
      }
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

  /**
   * 向执行器派发密封信封，并记录确认或有界重试状态。
   * @param task - 用于Envelope的领域对象，包含 `nextCommandLabel` 字段。
   * @param envelope - 用于Envelope的领域对象，包含 `runId`、`expiresAt` 字段。
   */
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

  /** 通过串行重试未确认且尚未过期的发件箱运行。 */
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

  /**
   * 在派发耗尽后关闭活动运行并持久化稳定阻塞原因。
   * @param task - 用于在派发耗尽后关闭活动运行并持久化稳定阻塞原因的领域对象，包含 `activeRunId`、`runState`、`gateReason`、`nextCommandLabel` 字段。
   * @param runId - 用于精确定位`run` 对应结果的标识。
   * @param attempts - 决定在派发耗尽后关闭活动运行并持久化稳定阻塞原因内容、边界或目标的 `attempts` 值。
   */
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

  /**
   * 校验`task`、`sourceRole`是否满足单个任务最多存在一个主媒体下载所有者约束，并拒绝不合法输入。
   * @param task - 用于单个任务最多存在一个主媒体下载所有者的领域对象，包含 `sources` 字段。
   * @param sourceRole - 决定单个任务最多存在一个主媒体下载所有者内容、边界或目标的 `sourceRole` 值。
   */
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

  /**
   * 在任务成功写入权威状态仓后发布对应类型的 SSE 补丁，避免客户端观察到未落库状态。
   * @param task - 本次需要持久化并广播的媒体任务。
   * @param changeType - 区分来源更新与普通状态更新的事件类型。
   */
  private async commitTask(
    task: MediaGovernanceTask,
    changeType: 'source-updated' | 'state-updated',
  ) {
    await this.persistTask(task);
    this.publishTaskPatch(task, changeType);
  }

  /**
   * 发布完整或进度任务补丁，并附带当前全局摘要。
   * @param task - 用于任务Patch的领域对象，包含 `revision`、`id` 字段。
   * @param changeType - 决定任务Patch内容、边界或目标的 `changeType` 值。
   * @param runId - 用于精确定位`run` 对应结果的标识；省略时默认采用 `null`。
   * @param runSequence - 决定任务Patch内容、边界或目标的 `runSequence` 值；省略时默认采用 `null`。
   * @param deleted - 决定任务Patch内容、边界或目标的 `deleted` 值；省略时默认采用 `false`。
   * @param compact - 决定任务Patch内容、边界或目标的 `compact` 值；省略时默认采用 `false`。
   */
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

  /**
   * 按事件频率裁剪任务补丁并移除敏感密封载荷。
   * @param task - 用于按事件频率裁剪任务补丁并移除敏感密封载荷的领域对象，包含 `activeRunId`、`agentSession`、`gateReason`、`governanceProfile` 字段。
   * @param compact - 决定按事件频率裁剪任务补丁并移除敏感密封载荷内容、边界或目标的 `compact` 值。
   * @returns 按事件频率裁剪任务补丁并移除敏感密封载荷。
   */
  private projectTaskEventPatch(task: MediaGovernanceTask, compact: boolean) {
    if (compact) {
      return structuredClone({
        activeRunId: task.activeRunId,
        agentSession: task.agentSession,
        gateReason: task.gateReason,
        governanceProfile: task.governanceProfile,
        id: task.id,
        llmConversationId: task.llmConversationId,
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

  /**
   * 仅当可选状态存储已注入且完成数据库初始化时返回 `true`。
   * @returns 返回 `this.stateStore?.isReady() === true` 的判定结果；条件成立为 `true`，否则为 `false`。
   */
  private databaseReady() {
    return this.stateStore?.isReady() === true;
  }

  /**
   * 根据任务版本或活动运行身份生成 Agent 重放键。
   * @param task - 用于根据任务版本或活动运行身份生成 Agent 重放键的领域对象，包含 `activeRunId`、`id` 字段。
   * @param taskRevision - 决定根据任务版本或活动运行身份生成 Agent 重放键内容、边界或目标的 `taskRevision` 值。
   * @returns 按参数编码并拼接完成的根据任务版本或活动运行身份生成 Agent 重放键。
   */
  private agentReplayKey(task: MediaGovernanceTask, taskRevision: number) {
    if (!task.activeRunId) return `${task.id}-agent-r${taskRevision}`;
    const runDigest = createHash('sha256')
      .update(task.activeRunId)
      .digest('hex')
      .slice(0, 12);
    return `${task.id}-agent-a${runDigest}`;
  }

  /**
   * 把任务写入可选数据库状态仓；写入失败时回读全部权威任务替换内存投影并返回服务不可用。
   * @param task - 需要保存的当前媒体任务快照。
   */
  private async persistTask(task: MediaGovernanceTask) {
    if (!this.stateStore) return;
    try {
      await this.stateStore.saveTask(task);
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

  /**
   * 补齐派生字段并恢复数据库任务的当前语义投影。
   * @param storedTask - 用于补齐派生字段并恢复数据库任务的当前语义的领域对象，包含 `mediaType`、`metadataIdentity`、`providerRef`、`releaseYear` 字段。
   * @returns 补齐派生字段并恢复数据库任务的当前语义。
   */
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

  /**
   * 把旧 Agent 投影与标准 conversationId 归并为同一个“已有治理对话”门禁。
   * @param task - 当前媒体治理任务。
   * @returns 任一 Agent 会话绑定存在时返回 true。
   */
  private hasAgentConversation(task: MediaGovernanceTask) {
    return task.agentSession !== null || task.llmConversationId !== null;
  }

  /**
   * 递增任务版本并同步刷新语义投影。
   * @param task - 用于递增任务版本并同步刷新语义的领域对象，包含 `revision` 字段。
   */
  private bumpRevision(task: MediaGovernanceTask) {
    task.revision += 1;
    this.refreshSemanticProjection(task);
  }

  /**
   * 按来源标识查找任务内来源，不存在时返回统一错误。
   * @param task - 用于按来源标识查找任务内来源，不存在时返回统一错误的领域对象，包含 `sources` 字段。
   * @param sourceId - 用于精确定位来源的标识。
   * @returns 按来源标识查找任务内来源，不存在时返回统一错误。
   */
  private findSource(task: MediaGovernanceTask, sourceId: string) {
    const source = task.sources.find((item) => item.id === sourceId);
    if (!source) {
      throwVbenError('媒体来源不存在', HttpStatus.NOT_FOUND);
    }
    return source;
  }

  /**
   * 根据参数 `task`，规范化来源季号并限制在任务声明范围内。
   * @param task - 用于根据参数 `task`，规范化来源季号并限制在任务声明范围内的领域对象，包含 `units`、`mediaType` 字段。
   * @param values - 按原有顺序参与根据参数 `task`，规范化来源季号并限制在任务声明范围内筛选、合并或汇总的集合。
   * @returns 根据参数 `task`，规范化来源季号并限制在任务声明范围内。
   */
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

  /**
   * 根据参数 `magnetUri`，解析磁力链接的 BTIH、显示名和脱敏追踪器数量。
   * @param magnetUri - 决定根据参数 `magnetUri`，解析磁力链接的 BTIH、显示名和脱敏追踪器数量内容、边界或目标的 `magnetUri` 值。
   * @returns 包含 `displayName`、`infoHash`、`trackerCount` 字段的MagnetUri。
   */
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

  /**
   * 根据任务原始状态刷新面向管理端的语义标签。
   * @param task - 用于根据任务原始状态刷新面向管理端的语义标签的领域对象，包含 `semanticProjection`、`nextCommandLabel`、`gateReason`、`metadataStatus` 字段。
   */
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

  /**
   * 将每秒字节数格式化为合适量级的可读速率。
   * @param bytesPerSecond - 决定将每秒字节数格式化为合适量级的可读速率内容、边界或目标的 `bytesPerSecond` 值。
   * @returns 按参数编码并拼接完成的将每秒字节数格式化为合适量级的可读速率。
   */
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

  /**
   * 将成功运行的进度补齐至终态并记录完成摘要。
   * @param task - 用于将成功运行的进度补齐至终态并记录完成摘要的领域对象，包含 `progress` 字段。
   * @param observedAt - 用于过期、排序或租约判定的时间基准。
   * @param summary - 决定将成功运行的进度补齐至终态并记录完成摘要内容、边界或目标的 `summary` 值。
   */
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

  /**
   * 根据最近观测时间更新任务心跳相对时间。
   * @param task - 用于刷新结果心跳Label的领域对象，包含 `progress` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准；省略时默认采用 `Date.now()`。
   * @returns 刷新结果心跳Label。
   */
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

  /**
   * 根据运行身份与心跳时效判断数据库任务是否卡住。
   * @param task - 用于根据运行身份与心跳时效判断数据库任务是否卡住的领域对象，包含 `persistenceMode`、`runState`、`activeRunId`、`progress` 字段。
   * @param now - 用于过期、排序或租约判定的时间基准。
   * @returns 满足根据运行身份与心跳时效判断数据库任务是否卡住约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 根据当前领域状态，统计同一治理单元使用多个字幕发布组的任务与季数。
   * @returns 包含 `seasonCount`、`taskIds` 字段的根据当前领域状态，统计同一治理单元使用多个字幕发布组的任务与季数。
   */
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

  /**
   * 通过在模拟模式调度中间与完成进度更新。
   * @param task - 用于通过在模拟模式调度中间与完成进度更新的领域对象，包含 `progress`、`runState`、`nextCommandLabel` 字段。
   * @param source - 用于通过在模拟模式调度中间与完成进度更新的领域对象，包含 `selectedBytes`、`selectedFileCount` 字段。
   */
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

  /**
   * 校验`mediaType`、`seasonNumbers`是否满足媒体类型与季号声明的结构合同约束，并拒绝不合法输入。
   * @param mediaType - 决定媒体类型与季号声明的结构合同内容、边界或目标的 `mediaType` 值。
   * @param seasonNumbers - 用于媒体类型与季号声明的结构合同的领域对象，包含 `length` 字段。
   */
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

  /**
   * 将作品身份字段转换为管理端可读的验证状态预览。
   * @param input - 用于将作品身份字段转换为管理端可读的验证状态预览的结构化输入，包含 `metadataIdentity`、`providerRef`、`releaseYear`、`mediaType` 字段。
   * @returns 包含 `mediaTypeLabel`、`providerLabel`、`releaseYearLabel`、`seasonLabel`、`status` 字段的将作品身份字段转换为管理端可读的验证状态预览。
   */
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

  /**
   * 根据媒体类型创建电影单元或逐季治理单元。
   * @param mediaType - 决定根据媒体类型创建电影单元或逐季治理单元内容、边界或目标的 `mediaType` 值。
   * @param seasonNumbers - 决定根据媒体类型创建电影单元或逐季治理单元内容、边界或目标的 `seasonNumbers` 值。
   * @returns 按输入顺序得到的根据媒体类型创建电影单元或逐季治理单元列表；无法解析或未命中时为 `null`，没有匹配项时为空数组。
   */
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
