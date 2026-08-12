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
  sha256Json,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '@/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type {
  MediaGovernanceAgentEventDto,
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
  MediaGovernanceTaskPageQueryDto,
} from './media-governance.dto';
import {
  MEDIA_GOVERNANCE_TYPED_AGENT_TOOLS,
  assertSourceClassification,
  type MediaGovernanceTaskProjection,
  type MediaGovernanceUnitProjection,
  validateAgentBoundaryRequest,
  validateDescriptorManifestEntry,
  validateSubtitleContracts,
} from './media-governance-domain';
import { MediaDescriptorStore } from './media-descriptor.store';
import { MediaGovernanceEventStreamService } from './media-governance-event-stream.service';
import { parseTorrentDescriptor } from './media-torrent-descriptor';
import {
  MEDIA_GOVERNANCE_CODEX_AGENT_GATEWAY,
  type MediaGovernanceCodexAgentGateway,
} from './media-governance-codex-agent.gateway';
import {
  MEDIA_GOVERNANCE_STATE_STORE,
  type MediaGovernanceStateStore,
  type MediaGovernanceStoredTask,
} from './media-governance-state.store';
import {
  buildMediaGovernanceExecutionEnvelope,
  type MediaGovernanceExecutorAction,
} from './media-governance-executor.contract';
import {
  MEDIA_GOVERNANCE_EXECUTION_GATEWAY,
  type MediaGovernanceExecutionEnvelope,
  type MediaGovernanceExecutionGateway,
} from './media-governance-execution.gateway';
import { buildAdminMediaGovernancePlan } from './media-governance-plan';

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
  percent: number;
  progressLabel: string;
  speedLabel: string;
  totalBytes: number;
  totalItems: number;
};

type MediaGovernanceAgentSealedPlan = {
  operations: Array<{
    action: string;
    sourcePath?: string;
    targetPath: string;
  }>;
  replayKey: string;
  summary: string;
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
    status: 'pending-provider-verification';
    statusLabel: '待资料源核验';
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

@Injectable()
export class MediaGovernanceService implements OnModuleDestroy, OnModuleInit {
  private readonly tasks: MediaGovernanceTask[] = [];
  private dispatchTimer: null | NodeJS.Timeout = null;
  private dispatchRetryActive = false;
  private executionReconcileActive = false;

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

  async create(
    input: MediaGovernanceTaskCreateDto,
  ): Promise<MediaGovernanceTask> {
    const titleHint = input.titleHint.trim();
    const seasonNumbers = (input.seasonNumbers ?? []).map((season) =>
      season.trim().toUpperCase(),
    );
    this.assertUnitContract(input.mediaType, seasonNumbers);

    const providerRef = input.providerRef
      ? {
          provider: input.providerRef.provider,
          providerId: input.providerRef.providerId.trim(),
        }
      : null;
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
      persistenceMode: this.databaseReady() ? 'database' : 'process-simulator',
      payloadSeal: null,
      progress: {
        completedBytes: 0,
        completedItems: 0,
        etaLabel: '尚未开始',
        heartbeatLabel: '尚未开始',
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
    this.eventStream?.publishTaskChanged({
      changeType: 'created',
      revision: task.revision,
      taskId: task.id,
    });
    return task;
  }

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

  async redeemPlan(input: MediaGovernancePlanRedeemDto) {
    if (!this.databaseReady() || !this.stateStore?.consumePlanGrant) {
      throwVbenError(
        '媒体治理计划授权服务暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stateStore.consumePlanGrant(input);
  }

  executionCallbackHealth() {
    return {
      persistenceMode: this.databaseReady() ? 'database' : 'process-simulator',
      status:
        this.databaseReady() &&
        this.stateStore?.applyExecutorEvent &&
        this.stateStore.readRunSequence
          ? 'ready'
          : 'not-ready',
    } as const;
  }

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
    const previousSequence = await this.stateStore.readRunSequence(input.runId);
    if (input.sequence <= previousSequence) {
      return { applied: false, reason: 'duplicate-sequence' };
    }
    if (input.sequence !== previousSequence + 1) {
      throwVbenError('媒体执行器回调序号不连续', HttpStatus.CONFLICT);
    }
    this.applyExecutorProjection(task, input);
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
    this.eventStream?.publishTaskChanged({
      changeType: 'state-updated',
      revision: task.revision,
      taskId: task.id,
    });
    return { applied: true, revision: task.revision };
  }

  private applyExecutorProjection(
    task: MediaGovernanceTask,
    input: MediaGovernanceExecutorEventDto,
  ) {
    const source = input.sourceId
      ? this.findSource(task, input.sourceId)
      : null;
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
    if (input.progress) {
      if (
        input.progress.completedBytes > input.progress.totalBytes ||
        input.progress.completedItems > input.progress.totalItems
      ) {
        throwVbenError('执行器进度超出总量', HttpStatus.BAD_REQUEST);
      }
      const percent =
        input.progress.totalBytes === 0
          ? 0
          : Number(
              (
                (input.progress.completedBytes / input.progress.totalBytes) *
                100
              ).toFixed(1),
            );
      task.progress = {
        completedBytes: input.progress.completedBytes,
        completedItems: input.progress.completedItems,
        etaLabel: input.progress.etaLabel,
        heartbeatLabel: '刚刚',
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
      const cancelledDownload =
        ['source.download', 'source.resume'].includes(input.action) &&
        input.summary.includes('download_cancelled');
      task.gateReason = cancelledDownload
        ? '下载已取消，现有载荷等待精确清理'
        : input.summary.slice(0, 160);
      task.nextCommandLabel = cancelledDownload
        ? '移除低效来源并上传替换来源'
        : '查看失败原因后重试';
    } else if (input.eventType === 'run-succeeded') {
      if (!input.evidenceSha256) {
        throwVbenError('执行器终态缺少密封证据', HttpStatus.BAD_REQUEST);
      }
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
        task.runState = source.sourceHealth === 'viable' ? 'draft' : 'blocked';
        task.gateReason =
          source.sourceHealth === 'viable'
            ? null
            : source.sourceHealthReasonLabel;
        task.nextCommandLabel =
          source.sourceHealth === 'viable'
            ? '检查其余来源或开始下载'
            : '更换来源后重新探针';
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
        this.applyMetadataEvidence(task, input);
        const metadata = input.metadata!;
        task.stage = 'metadata';
        task.metadataStatus = metadata.canAccept
          ? 'verified'
          : 'requires-agent';
        task.runState = metadata.canAccept ? 'succeeded' : 'blocked';
        task.gateReason = metadata.canAccept
          ? null
          : `元数据仍缺少 A 级 ${metadata.units.reduce(
              (count, unit) => count + unit.missingA.length,
              0,
            )} 项、B 级 ${metadata.units.reduce(
              (count, unit) => count + unit.missingB.length,
              0,
            )} 项`;
        const canRepair = this.canRunBoundedMetadataRepair(task);
        const canRefreshDeferredIdentity =
          this.canRefreshDeferredMetadataIdentity(task);
        const canEnrichAutomatically =
          this.canRunAutomaticMetadataEnrichment(task);
        if (!metadata.canAccept && task.closedMode === 'automatic') {
          task.closedMode = null;
        }
        task.nextCommandLabel = metadata.canAccept
          ? '运行独立本地验收'
          : canRefreshDeferredIdentity
            ? 'fnOS 身份回填尚未稳定，重新采集元数据事实'
            : canEnrichAutomatically
              ? '自动补齐 LocalNFO 与作品/季海报'
              : canRepair
                ? `运行第 ${this.metadataRepairAttempts(task) + 1}/2 次有界元数据修复`
                : '启动 CodexAgent 有界人工治理';
      } else if (input.action === 'acceptance.verify') {
        const acceptance = input.acceptance;
        if (
          !acceptance ||
          !acceptance.canClose ||
          acceptance.acceptedUnits !== task.units.length ||
          acceptance.activeDownloadOwners !== 0 ||
          acceptance.cloudWrites !== 0 ||
          acceptance.databaseDirectWrites !== 0 ||
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
        task.closedMode =
          task.agentSession?.status === 'succeeded'
            ? 'agent_verified'
            : task.closedMode === 'automatic'
              ? 'automatic'
              : this.metadataRepairAttempts(task) > 0
                ? 'bounded_repair'
                : 'automatic';
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

  private applyMetadataEvidence(
    task: MediaGovernanceTask,
    input: MediaGovernanceExecutorEventDto,
  ) {
    const metadata = input.metadata;
    if (
      !metadata ||
      !input.evidenceSha256 ||
      metadata.units.length !== task.units.length ||
      new Set(metadata.units.map((unit) => unit.unitId)).size !==
        task.units.length ||
      metadata.units.some(
        (unit) =>
          !task.units.some((candidate) => candidate.id === unit.unitId) ||
          unit.accepted !==
            (unit.missingA.length === 0 && unit.missingB.length === 0),
      ) ||
      metadata.canAccept !== metadata.units.every((unit) => unit.accepted) ||
      Object.values(metadata.writeBoundaries).some((count) => count !== 0)
    ) {
      throwVbenError('元数据分档证据不完整', HttpStatus.BAD_REQUEST);
    }
    const identity = metadata.identity ?? task.providerRef;
    if (identity) {
      const observedReleaseYear = (identity as { releaseYear?: null | number })
        .releaseYear;
      task.metadataIdentity = {
        provider: identity.provider,
        providerId: identity.providerId,
        releaseYear:
          typeof observedReleaseYear === 'number'
            ? observedReleaseYear
            : task.releaseYear,
      };
    } else if (metadata.canAccept) {
      throwVbenError('元数据身份硬门禁未闭合', HttpStatus.CONFLICT);
    }
    for (const projection of metadata.units) {
      const unit = task.units.find(
        (candidate) => candidate.id === projection.unitId,
      )!;
      unit.evidenceSha256 = input.evidenceSha256;
      unit.metadataProjection = {
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

  private metadataRepairAttempts(task: MediaGovernanceTask) {
    return Math.max(
      0,
      ...task.units.map((unit) => unit.metadataProjection.repairAttempts),
    );
  }

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

  private canRefreshLegacyMetadata(task: MediaGovernanceTask) {
    return (
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.metadataStatus === 'requires-agent' &&
      Boolean(task.sealedPlan) &&
      this.hasLegacyEmptyMetadataProjection(task)
    );
  }

  private canRefreshDeferredMetadataIdentity(task: MediaGovernanceTask) {
    const providerIdentityFields = new Set([
      'identity.provider',
      'identity.providerId',
    ]);
    return (
      task.stage === 'metadata' &&
      task.runState === 'blocked' &&
      task.metadataStatus === 'requires-agent' &&
      Boolean(task.sealedPlan) &&
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

  private canRunBoundedMetadataRepair(task: MediaGovernanceTask) {
    const projections = task.units.map((unit) => unit.metadataProjection);
    return (
      this.metadataRepairAttempts(task) < 2 &&
      projections.every((projection) => projection.missingA.length === 0) &&
      projections.some((projection) => projection.missingB.length > 0)
    );
  }

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

  detail(taskId: string): MediaGovernanceTask {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) {
      throwVbenError('媒体治理任务不存在', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  summary() {
    const closed = this.tasks.filter((task) => task.stage === 'closed').length;
    return {
      agentPending: this.tasks.filter(
        (task) =>
          task.stage !== 'closed' &&
          (task.agentSession?.status === 'failed' ||
            task.agentSession?.status === 'needs-operator' ||
            task.agentSession?.status === 'running'),
      ).length,
      closed,
      downloading: this.tasks.filter(
        (task) => task.stage === 'download' && task.runState === 'running',
      ).length,
      governing: this.tasks.filter(
        (task) => task.stage === 'governance' && task.runState === 'running',
      ).length,
      metadataAutoClosureRate:
        this.tasks.length === 0
          ? 0
          : Number(((closed / this.tasks.length) * 100).toFixed(1)),
      mixedSubtitleSeasonCount: 0,
      stagingResidualCount: 0,
      total: this.tasks.length,
    };
  }

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
      sourceHealthReasonLabel:
        trackerCount > 0
          ? `已脱敏记录 ${trackerCount} 个追踪器，等待运行时探针`
          : '未声明追踪器，等待运行时探针',
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

  async removeSource(
    taskId: string,
    sourceId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const source = this.findSource(task, sourceId);
    if (
      task.activeRunId ||
      !['intake', 'download'].includes(task.stage) ||
      task.payloadSeal ||
      task.sealedPlan ||
      task.workItemId
    ) {
      throwVbenError('当前阶段不能移除来源', HttpStatus.CONFLICT);
    }
    if (
      task.units.some((unit) => unit.subtitleContract?.sourceId === source.id)
    ) {
      throwVbenError('来源仍被整季字幕合同引用', HttpStatus.CONFLICT);
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

  private finalizeSourceRemoval(
    task: MediaGovernanceTask,
    source: MediaGovernanceSource,
  ) {
    task.sources.splice(task.sources.indexOf(source), 1);
    if (source.sourceRole === 'primary_media') task.governanceProfile = null;
    task.gateReason = null;
    task.progress = {
      completedBytes: 0,
      completedItems: 0,
      etaLabel: '尚未开始',
      heartbeatLabel: '尚未开始',
      percent: 0,
      progressLabel: '等待替换来源',
      speedLabel: '0 B/s',
      totalBytes: 0,
      totalItems: 0,
    };
    task.runState = 'draft';
    task.stage = 'intake';
    task.nextCommandLabel =
      source.sourceRole === 'primary_media'
        ? '添加新的主媒体来源'
        : '添加新的补充字幕来源';
  }

  private assertSelectedFileRole(
    relativePath: string,
    fileRole: MediaGovernanceSelectedFileRole,
  ) {
    const lower = relativePath.toLowerCase();
    const valid =
      fileRole === 'video'
        ? /\.(?:avi|m2ts|m4v|mkv|mov|mp4|ts|webm)$/u.test(lower)
        : fileRole === 'subtitle'
          ? /\.(?:ass|ssa|srt|sup|vtt)$/u.test(lower)
          : /\.(?:otf|ttf|woff2?)$/u.test(lower) ||
            /(?:^|\/)[^/]*fonts?[^/]*\.(?:7z|rar|zip)$/u.test(lower);
    if (!valid) {
      throwVbenError('文件扩展名与治理角色不匹配', HttpStatus.BAD_REQUEST);
    }
  }

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
      const source = sources.length === 1 ? sources[0] : null;
      const releaseGroup = source?.releaseGroup?.trim();
      const mappings = source
        ? source.selectedFileMappings
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
            .sort((left, right) => left.episodeNumber - right.episodeNumber)
        : [];
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
      source.sourceHealthReasonLabel = '已密封描述文件授权和来源身份';
      await this.reserveExecution(task, 'source.inspect', [source]);
      return source;
    }
    if (source.manifestState === 'pending-inspection') {
      let manifestIndex = 0;
      source.manifest =
        source.sourceRole === 'supplemental_subtitle'
          ? task.units.flatMap((unit) =>
              unit.subtitleContract?.sourceId === source.id
                ? unit.subtitleContract.mappings.map((mapping) => ({
                    executable: false,
                    index: manifestIndex++,
                    relativePath: mapping.relativePath,
                    sizeBytes: 2 * 1024 * 1024,
                  }))
                : [],
            )
          : task.units.map((unit, index) => ({
              executable: false,
              index,
              relativePath: validateDescriptorManifestEntry({
                entryType: 'file',
                executable: false,
                relativePath: unit.seasonNumber
                  ? `${unit.seasonNumber}/Episode-${String(index + 1).padStart(2, '0')}.mkv`
                  : 'Movie.mkv',
              }),
              sizeBytes: 1024 * 1024 * 1024,
            }));
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
      const action =
        task.stage === 'download' && task.runState === 'blocked'
          ? 'source.resume'
          : 'source.download';
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
      const expectedEpisodes =
        task.mediaType === 'tv' ? unit.expectedEpisodeNumbers : [null];
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
        const manifestEntry = selectedMapping
          ? contractSource.manifest.find(
              (entry) => entry.index === selectedMapping.index,
            )
          : null;
        if (
          !manifestEntry ||
          manifestEntry.relativePath !== mapping.relativePath
        ) {
          throwVbenError('字幕合同与密封文件映射不一致', HttpStatus.CONFLICT);
        }
      }
    }
  }

  async pauseDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'pause');
  }

  async cancelDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'cancel');
  }

  async resumeDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    return this.controlDownload(taskId, input.expectedRevision, 'resume');
  }

  private async controlDownload(
    taskId: string,
    expectedRevision: number,
    command: 'cancel' | 'pause' | 'resume',
  ) {
    const task = this.detail(taskId);
    this.assertRevision(task, expectedRevision);
    if (
      task.stage !== 'download' ||
      !task.activeRunId ||
      (command === 'pause' && task.runState !== 'running') ||
      (command === 'resume' && task.runState !== 'blocked') ||
      (command === 'cancel' &&
        task.runState !== 'running' &&
        task.runState !== 'blocked')
    ) {
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
    task.runState = command === 'resume' ? 'running' : 'blocked';
    task.gateReason =
      command === 'pause'
        ? '下载暂停请求已送达'
        : command === 'cancel'
          ? '下载取消请求已送达'
          : null;
    task.nextCommandLabel = {
      cancel: '等待执行器停止并保留待清理载荷',
      pause: '等待执行器确认安全暂停',
      resume: '正在从同一 Run 续传',
    }[command];
    this.refreshSemanticProjection(task);
    await this.persistTask(task);
    this.eventStream?.publishTaskChanged({
      changeType: 'state-updated',
      revision: task.revision,
      taskId: task.id,
    });
    return task;
  }

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
          task.gateReason =
            error instanceof Error
              ? `本地计划无法安全密封：${error.message}`.slice(0, 160)
              : '本地计划无法安全密封';
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
    await this.reserveExecution(
      task,
      'acceptance.verify',
      task.sources.length > 0 ? task.sources : undefined,
    );
    return task;
  }

  async startAgent(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask['agentSession']> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.metadataStatus !== 'requires-agent') {
      throwVbenError('当前任务不需要启动 Agent', HttpStatus.CONFLICT);
    }
    if (
      this.canRefreshLegacyMetadata(task) ||
      this.canRefreshDeferredMetadataIdentity(task)
    ) {
      throwVbenError('当前任务应先重新采集元数据事实', HttpStatus.CONFLICT);
    }
    if (this.canRunBoundedMetadataRepair(task)) {
      throwVbenError(
        '当前缺口应先执行确定性有界元数据修复',
        HttpStatus.CONFLICT,
      );
    }
    const previousAgentSession = task.agentSession;
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
      const nextRevision = task.revision + 1;
      const replayKey = `${task.id}-agent-r${nextRevision}`;
      const compactContext = this.buildAgentCompactContext(task, nextRevision);
      const manifestSha256 = sha256Json({
        compactContext,
        taskId: task.id,
        taskRevision: nextRevision,
      });
      const request = {
        compactContext,
        currentStage: task.stage,
        currentUnitId: task.units[0]?.id ?? null,
        manifestSha256,
        operatorCommand:
          '核对当前媒体身份、季集映射、元数据与字幕合同，并只提交密封治理计划。',
        ...(retryFailedTurn
          ? { recoveryMode: 'restart-failed-turn' as const }
          : {}),
        replayKey,
        taskId: task.id,
        taskRevision: nextRevision,
      };
      const policy = buildMediaCodexAgentPolicy(task.id);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      const previousTask = structuredClone(task);
      task.inputSnapshotSha256 = manifestSha256;
      task.revision = nextRevision;
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
      task.runState = 'running';
      task.nextCommandLabel = '等待 Agent 会话绑定';
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
        Object.assign(task, previousTask);
        await this.commitTask(task, 'state-updated');
        throwVbenError(
          session
            ? 'NAS CodexAgent 会话身份不匹配'
            : 'NAS CodexAgent gateway 当前不可用',
          session ? HttpStatus.CONFLICT : HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const reservedSession = task.agentSession!;
      const failedRemoteSession = ['failed', 'interrupted'].includes(
        String(session.terminalKind),
      );
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
        status:
          session.status === 'active'
            ? 'running'
            : failedRemoteSession
              ? 'failed'
              : 'needs-operator',
        statusLabel:
          session.status === 'active'
            ? 'Agent 正在治理'
            : failedRemoteSession
              ? 'Agent 已阻塞，可安全重试'
              : '等待人工放行',
        threadId: session.threadId,
      };
      task.runState = session.status === 'active' ? 'running' : 'blocked';
      task.nextCommandLabel = '观察 Agent 语义进度';
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
    task.runState = 'running';
    task.nextCommandLabel = '观察 Agent 语义进度';
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    const timer = setTimeout(() => {
      if (!task.agentSession) return;
      task.agentSession.currentActionLabel = '等待操作员确认候选身份';
      task.agentSession.lastHeartbeatLabel = '刚刚';
      task.agentSession.status = 'needs-operator';
      task.agentSession.statusLabel = '等待人工放行';
      task.runState = 'blocked';
      task.nextCommandLabel = '选择候选并填写放行理由';
      this.refreshSemanticProjection(task);
      void this.commitTask(task, 'state-updated').catch(() => undefined);
    }, 500);
    timer.unref?.();
    return task.agentSession;
  }

  agentCallbackHealth() {
    return this.databaseReady()
      ? ({ persistenceMode: 'database', status: 'ready' } as const)
      : ({
          persistenceMode: 'process-simulator',
          status: 'not-ready',
        } as const);
  }

  async agentSession(taskId: string) {
    const task = this.detail(taskId);
    if (!task.agentSession || !this.agentGateway?.enabled()) {
      return task.agentSession;
    }
    let remoteSession;
    try {
      remoteSession = await this.agentGateway.session(taskId);
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
      ![task.revision, task.revision - 1].includes(remoteSession.taskRevision)
    ) {
      throwVbenError('NAS CodexAgent 会话身份不匹配', HttpStatus.CONFLICT);
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
      currentUnitId: remoteSession.currentUnitId,
      lastHeartbeatLabel: '刚刚',
      lastSequence: Math.max(
        task.agentSession.lastSequence,
        remoteSession.lastEventSequence,
      ),
      status:
        remoteSession.status === 'active'
          ? 'running'
          : remoteSession.status === 'closed'
            ? 'succeeded'
            : failedRemoteSession || retainedLegacyFailure
              ? 'failed'
              : 'needs-operator',
      statusLabel:
        remoteSession.status === 'active'
          ? 'Agent 正在治理'
          : remoteSession.status === 'closed'
            ? 'Agent 治理已完成'
            : failedRemoteSession || retainedLegacyFailure
              ? 'Agent 已阻塞，可安全重试'
              : hasPendingPlan
                ? '密封计划待执行器接入'
                : '等待密封结果验收',
    };
    if (remoteSession.status === 'blocked' && hasPendingPlan) {
      task.sealedPlanSha256 = task.agentSession.pendingPlanSha256;
      task.agentSession.pendingPlanSha256 = null;
      task.revision += 1;
    }
    task.runState =
      remoteSession.status === 'active'
        ? 'running'
        : remoteSession.status === 'closed'
          ? 'succeeded'
          : 'blocked';
    this.refreshSemanticProjection(task);
    await this.commitTask(task, 'state-updated');
    return task.agentSession;
  }

  async agentToolCall(input: MediaGovernanceAgentToolCallDto) {
    const task = this.detail(input.taskId);
    const session = task.agentSession;
    if (
      !session ||
      session.status !== 'running' ||
      input.taskRevision !== task.revision ||
      input.manifestSha256 !== task.inputSnapshotSha256 ||
      input.policySha256 !== session.policySha256 ||
      input.capsuleSha256 !== session.capsuleSha256 ||
      !(MEDIA_CODEX_AGENT_TOOLS as readonly string[]).includes(input.tool)
    ) {
      throwVbenError('Agent 工具调用身份不匹配', HttpStatus.CONFLICT);
    }
    const sealedPlan =
      input.tool === 'plan.submit.sealed'
        ? this.parseAgentSealedPlan(
            input.arguments,
            task.id,
            `${task.id}-agent-r${task.revision}`,
          )
        : null;
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
        return {
          declaredProvider: task.providerRef,
          identityPreview: task.identityPreview,
          verifiedIdentity: task.metadataIdentity,
          networkLookupPerformed: false,
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
        const planSha256 = sha256Json({
          capsuleSha256: input.capsuleSha256,
          manifestSha256: input.manifestSha256,
          plan: sealedPlan,
          policySha256: input.policySha256,
          taskId: task.id,
          taskRevision: task.revision,
        });
        session.pendingPlanSha256 = planSha256;
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

  async applyAgentEvent(input: MediaGovernanceAgentEventDto) {
    const task = this.detail(input.taskId);
    const session = task.agentSession;
    const pendingThreadMapping = Boolean(
      session &&
      session.threadId === this.pendingAgentThreadId(task.id) &&
      input.type === 'agent-thread-mapped' &&
      input.sequence === session.lastSequence + 1 &&
      input.status === 'active' &&
      input.taskRevision === task.revision,
    );
    if (
      !session ||
      (session.threadId === this.pendingAgentThreadId(task.id)
        ? !pendingThreadMapping
        : input.threadId !== session.threadId) ||
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
    if (
      input.taskRevision !== task.revision ||
      session.status !== 'running' ||
      (terminalEvent && input.status !== 'blocked') ||
      (!terminalEvent && input.status !== 'active')
    ) {
      throwVbenError('Agent 事件状态不匹配', HttpStatus.CONFLICT);
    }
    if (pendingThreadMapping) session.threadId = input.threadId;
    session.lastSequence = input.sequence;
    session.lastHeartbeatLabel = '刚刚';
    session.currentActionLabel = input.summary;
    if (input.type === 'agent-turn-completed') {
      session.status = 'needs-operator';
      session.statusLabel = session.pendingPlanSha256
        ? '密封计划待执行器接入'
        : '等待人工放行';
      task.runState = 'blocked';
      task.nextCommandLabel = session.statusLabel;
      if (session.pendingPlanSha256) {
        task.sealedPlanSha256 = session.pendingPlanSha256;
        session.pendingPlanSha256 = null;
        task.revision += 1;
      }
    } else if (input.type === 'agent-blocked') {
      session.status = 'failed';
      session.statusLabel = 'Agent 已阻塞，可安全重试';
      task.runState = 'blocked';
      task.nextCommandLabel = input.summary;
    }
    this.refreshSemanticProjection(task);
    await this.commitTask(task, 'state-updated', input);
    return { applied: true, revision: task.revision };
  }

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
    task.agentSession = {
      ...task.agentSession,
      currentActionLabel: `已选择候选 ${input.selectedCandidateId}`,
      status: 'succeeded',
      statusLabel: productionExecution ? '人工治理已放行' : '人工治理已闭环',
    };
    task.stage = productionExecution ? 'metadata' : 'closed';
    task.runState = 'succeeded';
    task.metadataStatus = productionExecution ? 'pending' : 'verified';
    task.nextCommandLabel = productionExecution
      ? '重新运行 A/B/C 分档元数据核验'
      : '查看验收证据';
    task.progress = {
      ...task.progress,
      etaLabel: '已完成',
      percent: 100,
      progressLabel: productionExecution
        ? '人工治理已放行，等待独立复核'
        : '本地闭环演示已完成',
    };
    this.bumpRevision(task);
    await this.commitTask(task, 'state-updated');
    return task;
  }

  evidence(taskId: string) {
    const task = this.detail(taskId);
    return {
      agentStatusLabel: task.agentSession?.statusLabel ?? '未启动',
      descriptorCount: task.sources.length,
      eventProjection: '实时事件热层（进程内演示）',
      localAcceptedUnitCount: task.stage === 'closed' ? task.units.length : 0,
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

  page(query: MediaGovernanceTaskPageQueryDto = {}) {
    const pageNo = query.pageNo ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (pageNo - 1) * pageSize;
    const filtered = this.tasks.filter(
      (task) =>
        (!query.stage || task.stage === query.stage) &&
        (!query.runState || task.runState === query.runState) &&
        (!query.governanceProfile ||
          task.governanceProfile === query.governanceProfile) &&
        (!query.gateReason || task.gateReason === query.gateReason) &&
        (!query.metadataStatus || task.metadataStatus === query.metadataStatus),
    );
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  }

  private agentToolPaths(
    tool: MediaGovernanceAgentToolCallDto['tool'],
    plan: MediaGovernanceAgentSealedPlan | null,
  ) {
    if (tool !== 'plan.submit.sealed' || !plan) return [];
    return plan.operations.flatMap((operation) =>
      operation.sourcePath
        ? [operation.sourcePath, operation.targetPath]
        : [operation.targetPath],
    );
  }

  private assertAgentReadArguments(value: Record<string, unknown>) {
    const keys = Object.keys(value);
    const sourceId = value.sourceId;
    const unitId = value.unitId;
    const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
    if (
      keys.some((key) => key !== 'sourceId' && key !== 'unitId') ||
      (sourceId !== undefined &&
        (typeof sourceId !== 'string' || !safeId.test(sourceId))) ||
      (unitId !== undefined &&
        (typeof unitId !== 'string' || !safeId.test(unitId)))
    ) {
      throwVbenError('Agent 只读工具参数无效', HttpStatus.BAD_REQUEST);
    }
    return {
      sourceId: typeof sourceId === 'string' ? sourceId : null,
      unitId: typeof unitId === 'string' ? unitId : null,
    };
  }

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
    return {
      boundaries: {
        cloudGate: false,
        databaseWrite: false,
        formalMediaWrite: false,
        uiWrite: false,
      },
      currentUnit: currentUnit
        ? {
            expectedEpisodeNumbers: currentUnit.expectedEpisodeNumbers,
            id: currentUnit.id,
            metadataProjection: currentUnit.metadataProjection,
            seasonNumber: currentUnit.seasonNumber,
            subtitleContract: currentUnit.subtitleContract
              ? {
                  expectedEpisodeNumbers:
                    currentUnit.subtitleContract.expectedEpisodeNumbers,
                  releaseGroup: currentUnit.subtitleContract.releaseGroup,
                  sourceId: currentUnit.subtitleContract.sourceId,
                }
              : null,
            unitKind: currentUnit.unitKind,
          }
        : null,
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
    };
  }

  private parseAgentSealedPlan(
    value: Record<string, unknown>,
    taskId: string,
    expectedReplayKey: string,
  ): MediaGovernanceAgentSealedPlan {
    const operations = value.operations;
    if (
      Object.keys(value).some(
        (key) => !['operations', 'replayKey', 'summary'].includes(key),
      ) ||
      !Array.isArray(operations) ||
      operations.length < 1 ||
      operations.length > 500 ||
      value.replayKey !== expectedReplayKey ||
      typeof value.summary !== 'string' ||
      !value.summary.trim() ||
      value.summary.length > 800
    ) {
      throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
    }
    const stagingRoot = `/vol2/1000/.kt-media-governance-staging/${taskId}`;
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
        entry.action.length > 80 ||
        typeof entry.targetPath !== 'string' ||
        entry.targetPath.length > 600 ||
        (entry.targetPath !== stagingRoot &&
          !entry.targetPath.startsWith(`${stagingRoot}/`)) ||
        (entry.sourcePath !== undefined &&
          (typeof entry.sourcePath !== 'string' ||
            entry.sourcePath.length > 600))
      ) {
        throwVbenError('Agent 密封计划无效', HttpStatus.BAD_REQUEST);
      }
      return {
        action: entry.action as string,
        ...(typeof entry.sourcePath === 'string'
          ? { sourcePath: entry.sourcePath }
          : {}),
        targetPath: entry.targetPath as string,
      };
    });
    return {
      operations: normalizedOperations,
      replayKey: expectedReplayKey,
      summary: value.summary as string,
    };
  }

  private projectAgentTask(
    task: MediaGovernanceTask,
  ): MediaGovernanceTaskProjection {
    if (!task.governanceProfile) {
      throwVbenError('Agent 任务缺少治理策略', HttpStatus.CONFLICT);
    }
    return {
      activeRunId: null,
      closedAt: task.closedAt,
      closedMode: task.closedMode,
      declaredUnitIds: task.units.map((unit) => unit.id),
      gateReason: task.gateReason,
      governanceProfile: task.governanceProfile,
      id: task.id,
      inputSnapshotSha256: task.inputSnapshotSha256,
      mediaType: task.mediaType,
      metadataIdentity: task.metadataIdentity
        ? {
            provider: task.metadataIdentity.provider,
            providerId: task.metadataIdentity.providerId,
          }
        : null,
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

  private projectAgentUnits(
    task: MediaGovernanceTask,
  ): MediaGovernanceUnitProjection[] {
    return task.units.map((unit) => ({
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
      subtitleContract:
        unit.subtitleContract && unit.seasonNumber
          ? {
              expectedEpisodeNumbers:
                unit.subtitleContract.expectedEpisodeNumbers,
              mappings: unit.subtitleContract.mappings.map((mapping) => ({
                episodeNumber: mapping.episodeNumber,
                releaseGroup: unit.subtitleContract!.releaseGroup,
              })),
              releaseGroup: unit.subtitleContract.releaseGroup,
              seasonNumber: unit.seasonNumber,
              sourceId: unit.subtitleContract.sourceId,
            }
          : null,
      taskId: task.id,
      unitKind: unit.unitKind,
    }));
  }

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
    try {
      return assertSourceClassification({
        contentKind: input.contentKind,
        linkedTask:
          input.sourceRole === 'supplemental_subtitle' && primary
            ? {
                contentKind: primary.contentKind,
                runState: task.runState,
                stage: task.stage,
              }
            : null,
        sourceRole: input.sourceRole,
      });
    } catch {
      throwVbenError('来源角色与内容类型不匹配', HttpStatus.BAD_REQUEST);
    }
  }

  private assertRevision(task: MediaGovernanceTask, expectedRevision: number) {
    if (task.revision !== expectedRevision) {
      throwVbenError(
        `任务版本已变化，当前版本为 ${task.revision}`,
        HttpStatus.CONFLICT,
      );
    }
  }

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
      revision: task.revision,
      runState: task.runState,
      semanticProjection: structuredClone(task.semanticProjection),
      stage: task.stage,
    };
    const runId = `media-run-${randomUUID()}`;
    task.activeRunId = runId;
    task.runState = 'queued';
    task.stage = action.startsWith('source.')
      ? action === 'source.download' || action === 'source.resume'
        ? 'download'
        : 'intake'
      : action.startsWith('metadata.')
        ? 'metadata'
        : action.startsWith('acceptance.')
          ? 'acceptance'
          : 'governance';
    task.nextCommandLabel = '已入队，等待 Jenkins 调度';
    this.bumpRevision(task);
    const envelope = buildMediaGovernanceExecutionEnvelope({
      action,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      inputSnapshotSha256: task.inputSnapshotSha256,
      ...(action === 'metadata.repair'
        ? { metadataRepairAttempt: this.metadataRepairAttempts(task) + 1 }
        : {}),
      replayKey: `${task.id}:${action}:r${task.revision}`,
      runId,
      ...(task.sealedPlan &&
      task.sealedPlanSha256 &&
      !action.startsWith('source.')
        ? {
            plan: {
              planGrantId: `media-plan-grant-${createHash('sha256')
                .update(`${runId}:${task.sealedPlanSha256}`)
                .digest('hex')
                .slice(0, 40)}`,
              planSha256: task.sealedPlanSha256,
              schemaVersion: '1.2.0' as const,
              strategy: task.governanceProfile!,
            },
          }
        : {}),
      ...(sources
        ? {
            sources: sources.map((source) => ({
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
            })),
          }
        : {}),
      taskId: task.id,
      taskRevision: task.revision,
      unitIds: task.units.map((unit) => unit.id),
    });
    try {
      await this.stateStore.reserveRunDispatch(task, envelope);
    } catch (error) {
      Object.assign(task, previous);
      throw error;
    }
    await this.dispatchEnvelope(task, envelope);
    return envelope;
  }

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
      const attempts = this.stateStore?.recordRunDispatchFailure
        ? await this.stateStore.recordRunDispatchFailure(envelope.runId)
        : 1;
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
          const summary =
            observed.status === 'exited'
              ? `NAS 执行器已退出（退出码 ${observed.exitCode}），但未返回可验证终态`
              : 'NAS 执行单元已退出或被回收，但未返回可验证终态';
          await this.applyExecutorEvent({
            action: envelope.action,
            eventType: 'run-failed',
            observedAt: new Date().toISOString(),
            runId,
            sequence: (await this.stateStore.readRunSequence(runId)) + 1,
            summary,
            taskId: task.id,
            taskRevision: task.revision,
          });
        } catch {
          // 单个状态探针失败不得覆盖仍可能运行的任务，下一轮继续核对。
        }
      }
    } finally {
      this.executionReconcileActive = false;
    }
  }

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
    this.eventStream?.publishTaskChanged({
      changeType: 'state-updated',
      revision: task.revision,
      taskId: task.id,
    });
  }

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

  private async commitTask(
    task: MediaGovernanceTask,
    changeType: 'source-updated' | 'state-updated',
    event?: MediaGovernanceAgentEventDto,
  ) {
    await this.persistTask(task, event);
    this.eventStream?.publishTaskChanged({
      changeType,
      revision: task.revision,
      taskId: task.id,
    });
  }

  private databaseReady() {
    return this.stateStore?.isReady() === true;
  }

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

  private pendingAgentThreadId(taskId: string) {
    return `pending-${taskId}`;
  }

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

  private restoreStoredTask(
    storedTask: MediaGovernanceStoredTask,
  ): MediaGovernanceTask {
    const restored: MediaGovernanceTask = {
      ...storedTask,
      identityPreview: this.buildIdentityPreview({
        mediaType: storedTask.mediaType,
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
        gateReasonLabel: '',
        metadataStatusLabel: '',
        runStateLabel: '',
        sourceHealthLabel: '',
        stageLabel: '',
      },
    };
    this.deriveBundledSubtitleContracts(restored);
    if (this.canRefreshLegacyMetadata(restored)) {
      restored.nextCommandLabel = '重新采集 A/B/C 分档元数据事实';
    }
    this.refreshSemanticProjection(restored);
    return restored;
  }

  private bumpRevision(task: MediaGovernanceTask) {
    task.revision += 1;
    this.refreshSemanticProjection(task);
  }

  private findSource(task: MediaGovernanceTask, sourceId: string) {
    const source = task.sources.find((item) => item.id === sourceId);
    if (!source) {
      throwVbenError('媒体来源不存在', HttpStatus.NOT_FOUND);
    }
    return source;
  }

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
    task.semanticProjection = {
      currentActionLabel: task.nextCommandLabel,
      gateReasonLabel: task.gateReason ?? '无阻塞',
      metadataStatusLabel: metadataLabels[task.metadataStatus],
      runStateLabel: runStateLabels[task.runState],
      sourceHealthLabel:
        task.sources.find((source) => source.sourceRole === 'primary_media')
          ?.sourceHealthLabel ?? '未检查',
      stageLabel: stageLabels[task.stage],
    };
  }

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

  private buildIdentityPreview(input: {
    mediaType: MediaGovernanceMediaType;
    providerRef: MediaGovernanceProviderRef | null;
    releaseYear: null | number;
    seasonNumbers: string[];
    titleHint: string;
  }): MediaGovernanceTask['identityPreview'] {
    return {
      mediaTypeLabel: MEDIA_TYPE_LABELS[input.mediaType],
      providerLabel: input.providerRef
        ? `${PROVIDER_LABELS[input.providerRef.provider]} · ${input.providerRef.providerId}`
        : '未填写（后续由资料源候选核验）',
      releaseYearLabel: input.releaseYear
        ? `${input.releaseYear} 年`
        : '未填写（后续按候选消歧）',
      seasonLabel:
        input.mediaType === 'tv'
          ? input.seasonNumbers.join('、')
          : '电影单元（不使用 S00）',
      status: 'pending-provider-verification',
      statusLabel: '待资料源核验',
      title: input.titleHint,
    };
  }

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
