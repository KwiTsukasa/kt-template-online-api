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
import { sha256MediaGovernanceJson } from '@/modules/admin/media-governance/contract/media-governance-hash';
import type {
  MediaGovernanceDescriptorRedeemDto,
  MediaGovernanceExecutorEventDto,
  MediaGovernancePlanRedeemDto,
  MediaGovernanceMagnetSourceCreateDto,
  MediaGovernanceMediaType,
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
  assertSourceClassification,
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
import { readMediaGovernanceCanonicalReplacement } from '@/modules/admin/media-governance/contract/media-governance-plan.contract';
import {
  MEDIA_GOVERNANCE_EXECUTION_GATEWAY,
  type MediaGovernanceExecutionEnvelope,
  type MediaGovernanceExecutionGateway,
} from '@/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import {
  assertAdminMediaGovernancePlanCanonicalIdentity,
  buildAdminMediaGovernancePlan,
  buildCanonicalIdentityRebasePlan,
  buildMovieCanonicalReplacementPlan,
  isCanonicalIdentityRebasePlan,
} from './media-governance-plan';
import {
  MEDIA_GOVERNANCE_PROGRESS_HOT_STORE,
  type MediaGovernanceProgressHotStore,
} from '@/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';
import {
  MEDIA_SCRAPE_VALIDATION_SINK,
  type MediaScrapeValidationSink,
} from '@/modules/admin/media-scrape-validation/application/media-scrape-validation.service';

type MediaGovernanceProviderRef = {
  provider: MediaGovernanceProvider;
  providerId: string;
};

export type MediaGovernanceUnit = {
  evidenceSha256: null | string;
  expectedEpisodeNumbers: number[];
  id: string;
  localAcceptedAt: null | string;
  seasonNumber: null | string;
  subtitleContract: null | {
    expectedEpisodeNumbers: number[];
    mappings: Array<{
      episodeNumber: number;
      relativePath: string;
      sourceId?: string;
    }>;
    releaseGroup: string;
    sourceId: string;
    sourceIds?: string[];
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
  closedAt: null | string;
  closedMode:
    | 'agent_verified'
    | 'automatic'
    | 'bounded_repair'
    | 'mechanical'
    | null;
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
    providerTitle?: string;
    releaseYear: null | number;
  };
  nextCommandLabel: string;
  operationKind:
    | null
    | 'legacy-pipeline'
    | 'magnet-batch'
    | 'rss-intake'
    | 'rss-intake-auto'
    | 'source-intake';
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
    runStateLabel: string;
    sourceHealthLabel: string;
    stageLabel: string;
  };
  sealedPlanSha256: null | string;
  sealedPlan: null | Record<string, unknown>;
  seriesId: null | string;
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
  workId: null | string;
  workItemId: null | string;
};

type MediaGovernanceTaskCreateInput = MediaGovernanceTaskCreateDto & {
  metadataIdentity?: MediaGovernanceTask['metadataIdentity'];
  operationKind?: NonNullable<MediaGovernanceTask['operationKind']>;
  seriesId?: string;
  workId?: string;
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
  private readonly rssContinuationTasks = new Set<string>();
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
    @Inject(MEDIA_SCRAPE_VALIDATION_SINK)
    private readonly scrapeValidationSink?: MediaScrapeValidationSink,
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
      if (this.detachLegacyScrapeStage(task)) {
        await this.persistTask(task);
      }
    }
    if (this.executionGateway?.enabled()) {
      for (const task of this.tasks) {
        await this.continueMechanicalPipeline(task).catch(() => false);
        await this.continueRssIntakePipeline(task).catch(() => false);
      }
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
    input: MediaGovernanceTaskCreateInput,
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
    let metadataIdentity: MediaGovernanceTask['metadataIdentity'] = null;
    if (input.metadataIdentity) {
      metadataIdentity = structuredClone(input.metadataIdentity);
    }
    const normalizedInput = {
      mediaType: input.mediaType,
      metadataIdentity,
      operationKind: input.operationKind ?? null,
      providerRef,
      releaseYear: input.releaseYear ?? null,
      seasonNumbers,
      seriesId: input.seriesId ?? null,
      titleHint,
      workId: input.workId ?? null,
      workItemId: input.workItemId ?? null,
    };
    const task: MediaGovernanceTask = {
      activeRunId: null,
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
      metadataIdentity,
      nextCommandLabel: '补充并检查来源',
      operationKind: input.operationKind ?? null,
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
        runStateLabel: '草稿',
        sourceHealthLabel: '未检查',
        stageLabel: '接收资料',
      },
      sealedPlanSha256: null,
      sealedPlan: null,
      seriesId: input.seriesId ?? null,
      sources: [],
      stage: 'intake',
      titleHint,
      units: this.createUnits(input.mediaType, seasonNumbers),
      workId: input.workId ?? null,
      workItemId: input.workItemId ?? null,
    };
    await this.persistTask(task);
    this.tasks.unshift(task);
    this.publishTaskPatch(task, 'created');
    return task;
  }

  /**
   * 仅为精确身份已确认的遗留 Task 持久化 Series/Work 所有权，并保持 revision、密封与身份快照原值。
   *
   * @param taskId - 需要绑定到目录 Work 的既有 Task。
   * @param input - 唯一 Series/Work 与遗留执行类型。
   * @returns 已持久化目录上下文的同一 Task。
   */
  async bindWorkContext(
    taskId: string,
    input: {
      operationKind: NonNullable<MediaGovernanceTask['operationKind']>;
      seriesId: string;
      workId: string;
    },
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    if (
      task.workId &&
      (task.workId !== input.workId || task.seriesId !== input.seriesId)
    ) {
      throwVbenError('Task 已绑定其他 Series Work', HttpStatus.CONFLICT);
    }
    task.operationKind = input.operationKind;
    task.seriesId = input.seriesId;
    task.workId = input.workId;
    await this.persistTask(task);
    return task;
  }

  /**
   * 在目录事务直接修正持久化上下文后重新加载权威 Task，并向现有 SSE 订阅发布更新投影。
   * @param taskIds - 本次目录事务实际修改且必须能从数据库重新读取的 Task 标识。
   * @returns 重新加载后的精确 Task 快照。
   */
  async reloadCatalogRepairedTasks(
    taskIds: string[],
  ): Promise<MediaGovernanceTask[]> {
    if (!this.stateStore || !this.databaseReady()) {
      throwVbenError(
        '媒体治理数据库持久化暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const storedTasks = await this.stateStore.loadTasks();
    const restoredTasks = storedTasks.map((storedTask) =>
      this.restoreStoredTask(storedTask),
    );
    const repairedTaskIds = new Set(taskIds);
    const repairedTasks = restoredTasks.filter((task) =>
      repairedTaskIds.has(task.id),
    );
    if (repairedTasks.length !== repairedTaskIds.size) {
      throwVbenError('目录修复后的 Task 投影不完整', HttpStatus.CONFLICT);
    }
    this.tasks.splice(0, this.tasks.length, ...restoredTasks);
    for (const task of repairedTasks) {
      this.publishTaskPatch(task, 'state-updated');
    }
    return repairedTasks.map((task) => structuredClone(task));
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
    if (task.seriesId || task.workId) {
      throwVbenError(
        'Work 绑定任务的身份只能从 Series 详情管理',
        HttpStatus.CONFLICT,
      );
    }
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
      task.metadataIdentity !== null
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
    let grant: { descriptorObjectId: string };
    try {
      grant = await this.stateStore.consumeDescriptorGrant(input);
    } catch (error) {
      let message = '';
      if (error instanceof Error) message = error.message;
      if (
        message.includes('media-governance-descriptor-grant') ||
        message.includes('Duplicate entry')
      ) {
        throwVbenError('媒体描述文件授权已失效', HttpStatus.CONFLICT);
      }
      throwVbenError(
        '媒体描述文件授权服务暂不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
    let replacedTaskId: null | string = null;
    if (
      input.action === 'acceptance.verify' &&
      input.eventType === 'run-succeeded' &&
      task.stage === 'closed'
    ) {
      const replacement = readMediaGovernanceCanonicalReplacement(
        task.sealedPlan,
      );
      if (replacement) replacedTaskId = replacement.replacedTaskId;
    }
    if (replacedTaskId) {
      const replacedIndex = this.tasks.findIndex(
        (candidate) => candidate.id === replacedTaskId,
      );
      if (replacedIndex >= 0) {
        const replaced = this.tasks[replacedIndex];
        this.tasks.splice(replacedIndex, 1);
        this.publishTaskPatch(replaced, 'deleted', null, null, true);
      }
    }
    this.publishTaskPatch(task, 'state-updated', input.runId, input.sequence);
    if (
      input.action === 'acceptance.verify' &&
      input.eventType === 'run-succeeded' &&
      task.stage === 'closed'
    ) {
      this.scheduleScrapeValidation(task);
    }
    if (input.eventType === 'run-failed') {
      await this.continueStalledInitialDownload(task, input).catch(() => false);
    }
    if (input.eventType === 'run-succeeded') {
      const mechanicalContinued = await this.continueMechanicalPipeline(
        task,
      ).catch(() => false);
      if (!mechanicalContinued) {
        await this.continueRssIntakePipeline(task).catch(() => false);
      }
    }
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
        if (this.isSourceDownloadable(source)) {
          task.runState = 'draft';
          task.gateReason = null;
          task.nextCommandLabel = '检查其余来源或开始下载';
          if (source.sourceHealth === 'degraded') {
            task.nextCommandLabel = '来源速度较慢，可继续开始下载';
          }
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
        task.stage = 'acceptance';
        task.runState = 'succeeded';
        task.gateReason = null;
        task.nextCommandLabel = '运行机械文件验收';
      } else if (input.action === 'acceptance.verify') {
        this.assertCanonicalSealedPlan(task);
        const acceptance = input.acceptance;
        const operations = (
          task.sealedPlan?.manifests as
            | { local?: { forward?: unknown[] } }
            | undefined
        )?.local?.forward;
        if (
          !acceptance ||
          !acceptance.canClose ||
          acceptance.acceptedUnits !== task.units.length ||
          !Array.isArray(operations) ||
          operations.length === 0 ||
          acceptance.acceptedFiles !== operations.length
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
        task.closedAt = input.observedAt;
        task.closedMode = 'mechanical';
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
   * 把历史 metadata 阶段迁移到机械验收或治理阻断态，并丢弃其刮削缺项投影。
   * @param task - 从持久层恢复的历史媒体治理任务。
   * @returns 任务原先位于 metadata 阶段并完成迁移时返回 `true`。
   */
  private detachLegacyScrapeStage(task: MediaGovernanceTask): boolean {
    if (task.stage !== 'metadata') return false;
    task.activeRunId = null;
    task.closedAt = null;
    task.closedMode = null;
    task.gateReason = null;
    task.runState = 'succeeded';
    task.stage = 'acceptance';
    task.nextCommandLabel = '运行机械文件验收';
    if (!task.sealedPlan || !task.sealedPlanSha256) {
      task.runState = 'blocked';
      task.stage = 'governance';
      task.gateReason = '历史任务缺少机械治理密封计划';
      task.nextCommandLabel = '重新生成机械治理计划';
    }
    for (const unit of task.units) {
      unit.evidenceSha256 = null;
      unit.localAcceptedAt = null;
    }
    task.progress = {
      ...task.progress,
      etaLabel: '等待机械验收',
      progressLabel: '历史刮削状态已从治理任务分离',
    };
    this.bumpRevision(task);
    return true;
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
   * @returns 包含任务阻塞、关闭、下载、治理、证据漂移和字幕发布组等语义指标。
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
    let mechanicalClosureRate = 0;
    if (this.tasks.length !== 0) {
      mechanicalClosureRate = Number(
        ((closed / this.tasks.length) * 100).toFixed(1),
      );
    }
    return {
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
      mechanicalClosureRate,
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
    if (
      task.sources.some(
        (source) =>
          source.descriptorTombstonedAt === null &&
          source.infoHash === infoHash,
      )
    ) {
      throwVbenError('同一任务不能重复添加相同 BTIH', HttpStatus.CONFLICT);
    }
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
   * 判断既有 RSS 来源是否仍把已验证的 torrent enclosure 降格为裸磁链，并且当前状态允许原地升级描述符。
   * @param taskId - RSS 自动接收任务标识。
   * @param sourceId - 与 RSS 条目绑定的来源标识。
   * @param infoHash - 当前 Feed 重新解析得到的 BTIH。
   * @returns 同一任务、来源与 BTIH 仍匹配且只缺 torrent 描述符时返回 `true`。
   * @throws {HttpException} 当任务或来源标识不存在时拒绝判断。
   */
  requiresRssTorrentDescriptorUpgrade(
    taskId: string,
    sourceId: string,
    infoHash: string,
  ) {
    const task = this.detail(taskId);
    const source = this.findSource(task, sourceId);
    return (
      task.operationKind === 'rss-intake-auto' &&
      task.stage === 'intake' &&
      task.activeRunId === null &&
      task.payloadSeal === null &&
      task.sealedPlan === null &&
      source.descriptorTombstonedAt === null &&
      source.transportKind === 'magnet' &&
      source.infoHash === infoHash
    );
  }

  /**
   * 用同一 Feed 重新取得的原始 torrent 字节批量原地升级 RSS 来源，一次提交前保持状态机不可见。
   * @param taskId - RSS 自动接收任务标识。
   * @param upgrades - 需要保留来源身份的描述符升级集合。
   * @returns 升级后的同一来源集合。
   * @throws {HttpException} 当任务阶段、来源集合或任一描述符 BTIH 不匹配时拒绝整批升级。
   */
  async upgradeRssTorrentDescriptors(
    taskId: string,
    upgrades: Array<{ descriptor: Buffer; sourceId: string }>,
  ) {
    const task = this.detail(taskId);
    if (
      upgrades.length === 0 ||
      upgrades.length > 16 ||
      new Set(upgrades.map((upgrade) => upgrade.sourceId)).size !==
        upgrades.length
    ) {
      throwVbenError('RSS torrent 描述符升级集合无效', HttpStatus.BAD_REQUEST);
    }
    const candidates = upgrades.map((upgrade) => {
      const source = this.findSource(task, upgrade.sourceId);
      const parsed = parseTorrentDescriptor(upgrade.descriptor);
      if (
        !this.requiresRssTorrentDescriptorUpgrade(
          taskId,
          source.id,
          parsed.infoHash,
        )
      ) {
        throwVbenError('RSS torrent 描述符升级身份不匹配', HttpStatus.CONFLICT);
      }
      return { ...upgrade, parsed, source };
    });
    const prepared: Array<{
      descriptorBytes: number;
      descriptorObjectId: string;
      descriptorRevision: number;
      descriptorSha256: string;
      manifest: MediaGovernanceSource['manifest'];
      manifestSha256: string;
      source: MediaGovernanceSource;
    }> = [];
    for (const candidate of candidates) {
      const descriptorRevision = candidate.source.descriptorRevision + 1;
      const stored = await this.descriptorStore?.putTorrentDescriptor({
        bytes: candidate.descriptor,
        revision: descriptorRevision,
        sourceId: candidate.source.id,
        taskId,
      });
      const upgraded = stored ?? {
        ...candidate.parsed,
        bytes: candidate.descriptor.length,
        objectId: `simulator-private/${candidate.source.id}/${candidate.parsed.descriptorSha256}`,
      };
      prepared.push({
        descriptorBytes: upgraded.bytes,
        descriptorObjectId: upgraded.objectId,
        descriptorRevision,
        descriptorSha256: upgraded.descriptorSha256,
        manifest: upgraded.manifest,
        manifestSha256: upgraded.manifestSha256,
        source: candidate.source,
      });
    }
    for (const upgraded of prepared) {
      upgraded.source.descriptorBytes = upgraded.descriptorBytes;
      upgraded.source.descriptorObjectId = upgraded.descriptorObjectId;
      upgraded.source.descriptorRevision = upgraded.descriptorRevision;
      upgraded.source.descriptorSha256 = upgraded.descriptorSha256;
      upgraded.source.manifest = upgraded.manifest;
      upgraded.source.manifestSha256 = upgraded.manifestSha256;
      upgraded.source.manifestState = 'inspected';
      upgraded.source.selectedBytes = 0;
      upgraded.source.selectedFileCount = 0;
      upgraded.source.selectedFileIndices = [];
      upgraded.source.selectedFileMappings = [];
      upgraded.source.sourceHealth = 'unchecked';
      upgraded.source.sourceHealthLabel = '来源清单已检查';
      upgraded.source.sourceHealthReasonLabel =
        '原始 torrent 描述符已恢复，等待运行时探针';
      upgraded.source.transportKind = 'torrent';
    }
    this.refreshExpectedEpisodeNumbers(task);
    task.gateReason = null;
    task.runState = 'succeeded';
    task.nextCommandLabel = '继续运行 RSS 来源探针';
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return prepared.map((upgrade) => upgrade.source);
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
   * @throws {HttpException} 当修订、来源、文件索引、治理身份或字幕合同不满足约束时拒绝写入。
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
    const previousSelection = {
      selectedBytes: source.selectedBytes,
      selectedFileCount: source.selectedFileCount,
      selectedFileIndices: [...source.selectedFileIndices],
      selectedFileMappings: structuredClone(source.selectedFileMappings),
    };
    const previousUnits = task.units.map((unit) => ({
      expectedEpisodeNumbers: [...unit.expectedEpisodeNumbers],
      id: unit.id,
      subtitleContract: structuredClone(unit.subtitleContract),
    }));
    source.selectedFileIndices = selectedFileIndices;
    source.selectedFileMappings = selectedFileMappings;
    source.selectedFileCount = selectedEntries.length;
    source.selectedBytes = selectedEntries.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    );
    try {
      this.refreshExpectedEpisodeNumbers(task);
      this.deriveBundledSubtitleContracts(task, true);
    } catch (error) {
      Object.assign(source, previousSelection);
      for (const unit of task.units) {
        const previousUnit = previousUnits.find(
          (candidate) => candidate.id === unit.id,
        )!;
        unit.expectedEpisodeNumbers = previousUnit.expectedEpisodeNumbers;
        unit.subtitleContract = previousUnit.subtitleContract;
      }
      throw error;
    }
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
    this.assertExecutionMode(task);
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
      task.units.every(
        (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
      );
    const stoppedPreGovernanceFailure =
      task.stage === 'governance' &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.closedAt === null;
    const sealedPreGovernanceArtifacts =
      task.workItemId !== null &&
      task.payloadSeal !== null &&
      task.sealedPlan !== null &&
      task.sealedPlanSha256 !== null;
    const knownPreTransactionGovernanceFailure = [
      'governance-local-move-state-invalid',
      'Target already exists:',
    ].some((reason) => task.gateReason?.includes(reason) === true);
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
      (knownPreTransactionGovernanceFailure || dryRunOnlyGovernanceProgress) &&
      preGovernanceUnitsUntouched;
    const resettableCompletedDownload =
      task.runState === 'succeeded' &&
      task.activeRunId === null &&
      this.hasReplaceableCompletedDownloadPayload(task, source);
    const stageBlocksSourceRemoval =
      !['intake', 'download'].includes(task.stage) &&
      !resettableUnboundResidue &&
      !resettablePreGovernanceFailure;
    const sealedArtifactsBlockSourceRemoval =
      Boolean(task.payloadSeal || task.sealedPlan) &&
      !resettablePreGovernanceFailure &&
      !resettableCompletedDownload;
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
   * 只允许尚未进入治理的单一主来源已完成载荷回到接收阶段，避免把不完整或错误影片永久密封。
   * @param task - 已完成下载且可能持有载荷密封的媒体任务。
   * @param source - 操作者准备精确清理并替换的唯一主来源。
   * @returns 载荷、来源、计划、作品编号和单元验收均满足可恢复边界时返回 true。
   */
  private hasReplaceableCompletedDownloadPayload(
    task: MediaGovernanceTask,
    source: MediaGovernanceSource,
  ) {
    const payloadFiles = task.payloadSeal?.files ?? [];
    const hasOtherLiveSource = task.sources.some(
      (candidate) =>
        candidate.id !== source.id && candidate.descriptorTombstonedAt === null,
    );
    const unitsUntouched = task.units.every(
      (unit) => unit.evidenceSha256 === null && unit.localAcceptedAt === null,
    );
    return (
      source.sourceRole === 'primary_media' &&
      ['download', 'intake'].includes(task.stage) &&
      task.closedAt === null &&
      task.workItemId === null &&
      task.sealedPlan === null &&
      task.sealedPlanSha256 === null &&
      !hasOtherLiveSource &&
      payloadFiles.length > 0 &&
      payloadFiles.every((file) => file.sourceId === source.id) &&
      unitsUntouched
    );
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
    const resetCompletedDownload = this.hasReplaceableCompletedDownloadPayload(
      task,
      source,
    );
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
      sealedPreGovernanceArtifacts &&
      preGovernanceUnitsUntouched;
    task.sources.splice(task.sources.indexOf(source), 1);
    for (const unit of task.units) {
      const contract = unit.subtitleContract;
      const sourceIds = contract?.sourceIds ?? [];
      if (contract?.sourceId === source.id || sourceIds.includes(source.id)) {
        unit.subtitleContract = null;
      }
    }
    this.refreshExpectedEpisodeNumbers(task);
    if (source.sourceRole === 'primary_media') task.governanceProfile = null;
    if (resetSealedPreGovernanceFailure) {
      task.payloadSeal = null;
      task.sealedPlan = null;
      task.sealedPlanSha256 = null;
      task.workItemId = null;
    }
    if (resetCompletedDownload) task.payloadSeal = null;
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
      task.closedMode = null;
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
          source.contentKind === 'bundled_sidecar_media',
      );
      const mappings = sources.flatMap((source) =>
        source.selectedFileMappings
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
            sourceId: source.id,
          })),
      );
      mappings.sort((left, right) => left.episodeNumber - right.episodeNumber);
      const releaseGroups = new Set(
        sources
          .map((source) => source.releaseGroup?.trim())
          .filter((value): value is string => Boolean(value)),
      );
      const sourceIds = [
        ...new Set(mappings.map((mapping) => mapping.sourceId)),
      ];
      let releaseGroup = null;
      if (releaseGroups.size === 1) releaseGroup = [...releaseGroups][0];
      const complete =
        Boolean(releaseGroup) &&
        sourceIds.length > 0 &&
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
          sourceId: sourceIds[0],
        },
      ]);
      unit.subtitleContract = {
        expectedEpisodeNumbers: validated.expectedEpisodeNumbers,
        mappings,
        releaseGroup: validated.releaseGroup,
        sourceId: validated.sourceId,
        sourceIds,
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
      sourceId: input.sourceId,
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
      sourceIds: [validated.sourceId],
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
    this.assertExecutionMode(task);
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
    this.assertExecutionMode(task);
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
   * 把已取得真实数据但预计超过二十四小时的来源视为可下载降级态，其他探针失败仍保持阻断。
   * @param source - 已完成运行时探针的来源。
   * @returns 来源已正常可用，或仅因吞吐预估不足而降级时返回 `true`。
   */
  private isSourceDownloadable(source: MediaGovernanceSource): boolean {
    if (source.sourceHealth === 'viable') return true;
    if (source.sourceHealth !== 'degraded') return false;
    return (
      source.sourceHealthReasonLabel ===
      SOURCE_HEALTH_REASON_LABELS.insufficient_throughput
    );
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
    this.assertExecutionMode(task);
    if (task.runState === 'running') {
      throwVbenError('任务已有运行中的操作', HttpStatus.CONFLICT);
    }
    const primary = task.sources.find(
      (source) => source.sourceRole === 'primary_media',
    );
    if (
      !primary ||
      primary.descriptorTombstonedAt !== null ||
      !this.isSourceDownloadable(primary)
    ) {
      throwVbenError('主媒体来源尚未通过运行时探针', HttpStatus.CONFLICT);
    }
    if (
      task.sources.some(
        (source) =>
          source.descriptorTombstonedAt !== null ||
          source.manifestState !== 'inspected' ||
          !this.isSourceDownloadable(source),
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
      if (task.mediaType !== 'tv') {
        const sourceIds = new Set(
          subtitleMappings
            .filter(
              ({ mapping, source }) =>
                mapping.unitId === unit.id &&
                mapping.episodeNumber === null &&
                mapping.language === 'zh-CN' &&
                source.sourceRole === 'supplemental_subtitle' &&
                Boolean(source.releaseGroup),
            )
            .map(({ source }) => source.id),
        );
        if (sourceIds.size !== 1) {
          throwVbenError(
            '电影外挂简体中文字幕必须由唯一补充来源提供',
            HttpStatus.CONFLICT,
          );
        }
        continue;
      }
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
   * 活动 runner 存在时只发送继续控制；closeout 已清空活动身份时创建新信封并复用原 profile。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 用于从同一运行身份继续已暂停下载的结构化输入，包含 `expectedRevision` 字段。
   * @returns 已接受控制或已进入新恢复运行的下载任务。
   */
  async resumeDownload(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (
      task.stage === 'download' &&
      task.runState === 'blocked' &&
      task.activeRunId === null
    ) {
      return this.startDownload(taskId, input);
    }
    return this.controlDownload(taskId, input.expectedRevision, 'resume');
  }

  /**
   * 把已有真实进度的首次停滞下载转换为唯一一个新续传 Run，并让 `source.resume` 终态承担重试上限。
   * @param task - 已提交失败终态、清空活动 Run 且保留下载进度的媒体任务。
   * @param input - 携带失败动作与来源原因的权威执行器终态事件。
   * @returns 成功预约一次 `source.resume` 时为 `true`；零载荷、非停滞或已是续传动作时为 `false`。
   */
  private async continueStalledInitialDownload(
    task: MediaGovernanceTask,
    input: MediaGovernanceExecutorEventDto,
  ): Promise<boolean> {
    const partialPayloadAvailable =
      task.progress.totalBytes > 0 &&
      task.progress.completedBytes > 0 &&
      task.progress.completedBytes < task.progress.totalBytes;
    const initialDownloadStalled =
      input.eventType === 'run-failed' &&
      input.action === 'source.download' &&
      input.sourceHealthReason === 'download_stalled' &&
      !input.summary.includes('download_cancelled');
    const taskCanResume =
      task.stage === 'download' &&
      task.runState === 'blocked' &&
      task.activeRunId === null;
    if (!initialDownloadStalled || !taskCanResume || !partialPayloadAvailable) {
      return false;
    }
    await this.resumeDownload(task.id, { expectedRevision: task.revision });
    this.publishTaskPatch(task, 'state-updated');
    return true;
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
    this.assertExecutionMode(task);
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
      try {
        if (!task.sealedPlan) {
          task.sealedPlan = buildAdminMediaGovernancePlan(
            task,
            task.payloadSeal,
          );
          task.sealedPlanSha256 = sha256MediaGovernanceJson(task.sealedPlan);
        }
        this.bindMovieCanonicalReplacement(task);
      } catch (error) {
        task.runState = 'blocked';
        task.gateReason = '本地计划无法安全密封';
        if (error instanceof Error) {
          task.gateReason = `本地计划无法安全密封：${error.message}`.slice(
            0,
            160,
          );
        }
        task.nextCommandLabel = '修正作品编号、来源映射或替换目标后重试';
        this.bumpRevision(task);
        await this.commitTask(task, 'state-updated');
        throwVbenError(task.gateReason, HttpStatus.CONFLICT);
      }
      await this.reserveExecution(task, 'governance.execute');
      return task;
    }
    task.stage = 'governance';
    task.runState = 'running';
    task.nextCommandLabel = '等待目录与文件名归一化';
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
      const observedAt = new Date().toISOString();
      const evidenceSha256 = sha256MediaGovernanceJson({
        taskId: task.id,
        taskRevision: task.revision,
        units: task.units.map((unit) => unit.id),
      });
      task.stage = 'closed';
      task.runState = 'succeeded';
      task.gateReason = null;
      task.closedAt = observedAt;
      task.closedMode = 'mechanical';
      task.nextCommandLabel = '查看机械验收证据';
      for (const unit of task.units) {
        unit.evidenceSha256 = evidenceSha256;
        unit.localAcceptedAt = observedAt;
      }
      task.progress = {
        ...task.progress,
        completedItems: 6,
        etaLabel: '已完成',
        percent: 100,
        progressLabel: '目录与文件名归一化已完成',
      };
      this.refreshSemanticProjection(task);
      void this.commitTask(task, 'state-updated')
        .then(() => this.scheduleScrapeValidation(task))
        .catch(() => undefined);
    }, 500);
    timer.unref?.();
    return task;
  }

  /**
   * 当电影 Work 已有唯一闭环规范 Task 时，把该 Task 的目标证据密封进当前候选计划。
   * @param task - 已持有下载载荷与本地计划、准备进入治理执行的 Work Task。
   * @returns 新增替换合同或已存在替换合同时为 `true`，首个电影与 TV Task 返回 `false`。
   * @throws 当同 Work 存在多个闭环规范 Task 或替换身份无法精确匹配时抛出。
   */
  private bindMovieCanonicalReplacement(task: MediaGovernanceTask) {
    if (!task.workId || task.mediaType === 'tv' || !task.sealedPlan) {
      return false;
    }
    if (readMediaGovernanceCanonicalReplacement(task.sealedPlan)) {
      return true;
    }
    const replacedCandidates = this.tasks.filter(
      (candidate) =>
        candidate.id !== task.id &&
        candidate.workId === task.workId &&
        candidate.stage === 'closed' &&
        candidate.runState === 'succeeded' &&
        candidate.activeRunId === null &&
        candidate.closedAt !== null &&
        candidate.closedMode !== null &&
        candidate.units.every(
          (unit) =>
            unit.localAcceptedAt !== null && unit.evidenceSha256 !== null,
        ),
    );
    if (replacedCandidates.length === 0) return false;
    if (replacedCandidates.length !== 1) {
      throw new Error('canonical-replacement-current-task-ambiguous');
    }
    const replaced = replacedCandidates[0];
    this.assertCanonicalSealedPlan(task);
    this.assertCanonicalSealedPlan(replaced);
    task.sealedPlan = buildMovieCanonicalReplacementPlan(task, replaced);
    task.sealedPlanSha256 = sha256MediaGovernanceJson(task.sealedPlan);
    return true;
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
        const providerTitle = task.metadataIdentity?.providerTitle?.trim();
        if (!providerTitle) {
          throw new Error('governance-fixed-identity-title-missing');
        }
        task.sealedPlan = buildCanonicalIdentityRebasePlan(
          task,
          task.sealedPlan,
          {
            amendmentPlanSha256: sha256MediaGovernanceJson({
              metadataIdentity: task.metadataIdentity,
              providerRef: task.providerRef,
              releaseYear: task.releaseYear,
            }),
            previousPlanSha256: task.sealedPlanSha256,
            providerTitle,
            summary: '按当前固化身份重建规范目录',
          },
        );
        task.sealedPlanSha256 = sha256MediaGovernanceJson(task.sealedPlan);
      }
      this.assertCanonicalSealedPlan(task);
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
   * 在文件治理完成后启动只校验路径、命名与写边界的机械验收。
   * @param taskId - 用于精确定位任务的标识。
   * @param input - 包含当前任务期望修订号的机械验收命令。
   * @returns 预约机械验收后的最新治理任务。
   */
  async startAcceptanceVerification(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    const retryingFailedVerification =
      task.stage === 'acceptance' &&
      task.runState === 'blocked' &&
      task.activeRunId === null &&
      task.sealedPlan !== null;
    if (
      ((task.stage !== 'acceptance' || task.runState !== 'succeeded') &&
        !retryingFailedVerification) ||
      !task.sealedPlan
    ) {
      throwVbenError('当前任务尚未完成文件治理', HttpStatus.CONFLICT);
    }
    this.assertCanonicalSealedPlan(task);
    let sources: MediaGovernanceSource[] | undefined;
    if (task.sources.length > 0) sources = task.sources;
    await this.reserveExecution(task, 'acceptance.verify', sources);
    return task;
  }

  /**
   * 按规范字段顺序计算任务的脱敏验收摘要及固定零写边界。
   * @param taskId - 用于精确定位任务的标识。
   * @returns 包含来源、事件、机械验收状态与零写边界的证据投影。
   */
  evidence(taskId: string) {
    const task = this.detail(taskId);
    let localAcceptedUnitCount = 0;
    if (task.stage === 'closed') {
      localAcceptedUnitCount = task.units.length;
    }
    let acceptanceStatusLabel = '机械验收未完成';
    if (task.stage === 'closed') acceptanceStatusLabel = '机械验收已完成';
    return {
      acceptanceStatusLabel,
      descriptorCount: task.sources.length,
      eventProjection: 'Redis Stream 实时进度热层',
      localAcceptedUnitCount,
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
        (!query.gateReason || task.gateReason === query.gateReason),
    );
    return {
      items: filtered
        .slice(start, start + pageSize)
        .map((task) => this.refreshHeartbeatLabel(task)),
      total: filtered.length,
    };
  }

  /**
   * 从文件治理成功边界自动预约机械验收，不读取或等待 NAS 刮削状态。
   * @param task - 已提交当前终态且可能等待机械验收的媒体治理任务。
   * @returns 成功预约机械验收时返回 `true`；其他阶段或已闭环时返回 `false`。
   */
  private async continueMechanicalPipeline(
    task: MediaGovernanceTask,
  ): Promise<boolean> {
    if (
      task.activeRunId ||
      !this.executionGateway?.enabled() ||
      task.stage !== 'acceptance' ||
      task.runState !== 'succeeded'
    ) {
      return false;
    }
    await this.startAcceptanceVerification(task.id, {
      expectedRevision: task.revision,
    });
    this.publishTaskPatch(task, 'state-updated');
    return true;
  }

  /**
   * 让 RSS 入队 Task 依次完成清单检查、保守自动映射、来源探针和下载派发，人工映射失败时停止在可见阻断态。
   *
   * @param task - 可能处于接收阶段任一持久化边界的 RSS Task。
   * @returns 本轮成功预约后继 Run 或完成一个自动映射步骤时返回 `true`。
   */
  private async continueRssIntakePipeline(
    task: MediaGovernanceTask,
  ): Promise<boolean> {
    const retryableSelectionFailure =
      task.runState === 'blocked' &&
      task.gateReason === 'RSS 来源无法安全自动映射文件';
    if (task.operationKind !== 'rss-intake-auto') return false;
    if (task.stage !== 'intake' || task.activeRunId) return false;
    if (
      ['blocked', 'queued', 'running'].includes(task.runState) &&
      !retryableSelectionFailure
    ) {
      return false;
    }
    if (this.rssContinuationTasks.has(task.id)) return false;
    this.rssContinuationTasks.add(task.id);
    try {
      if (retryableSelectionFailure) {
        task.runState = 'succeeded';
        task.gateReason = null;
        task.nextCommandLabel = '继续检查 RSS 来源清单';
      }
      const pendingInspection = task.sources.find(
        (source) =>
          source.descriptorTombstonedAt === null &&
          source.manifestState === 'pending-inspection',
      );
      if (pendingInspection) {
        await this.inspectSource(task.id, pendingInspection.id, {
          expectedRevision: task.revision,
        });
        return true;
      }
      this.normalizeExplicitEmbeddedRssSources(task);
      const unmapped = task.sources.find(
        (source) =>
          source.descriptorTombstonedAt === null &&
          source.manifestState === 'inspected' &&
          (source.selectedFileCount === 0 ||
            source.selectedFileMappings.length !== source.selectedFileCount),
      );
      if (unmapped) {
        try {
          await this.applyAutomaticSourceSelection(task, {
            sourceId: unmapped.id,
            subtitleLanguage: 'zh-CN',
          });
        } catch {
          task.runState = 'blocked';
          task.gateReason = 'RSS 来源无法安全自动映射文件';
          task.nextCommandLabel = '手动配置当前来源的逐文件治理映射';
          this.bumpRevision(task);
          await this.commitTask(task, 'state-updated');
          return false;
        }
      }
      const unchecked = task.sources.find(
        (source) =>
          source.descriptorTombstonedAt === null &&
          source.manifestState === 'inspected' &&
          source.selectedFileCount > 0 &&
          source.selectedFileMappings.length === source.selectedFileCount &&
          source.sourceHealth === 'unchecked',
      );
      if (unchecked) {
        await this.probeRuntimeSource(task.id, unchecked.id, {
          expectedRevision: task.revision,
        });
        return true;
      }
      if (
        task.sources.length > 0 &&
        task.sources.every((source) => this.isSourceDownloadable(source))
      ) {
        await this.startDownload(task.id, { expectedRevision: task.revision });
        return true;
      }
      return Boolean(unmapped);
    } finally {
      this.rssContinuationTasks.delete(task.id);
    }
  }

  /**
   * 将全部清单都明确标注内封字幕的 RSS 主来源从错误的外挂分类原子纠偏，并清除失败调用遗留的部分映射。
   * @param task - 已完成全部来源清单检查的 RSS 接收任务。
   */
  private normalizeExplicitEmbeddedRssSources(task: MediaGovernanceTask) {
    if (
      task.operationKind !== 'rss-intake-auto' ||
      task.governanceProfile !== 'sidecar-bundled'
    ) {
      return;
    }
    const primarySources = task.sources.filter(
      (source) =>
        source.descriptorTombstonedAt === null &&
        source.sourceRole === 'primary_media',
    );
    if (
      primarySources.length === 0 ||
      primarySources.some(
        (source) =>
          source.manifestState !== 'inspected' ||
          source.manifest.length === 0 ||
          source.contentKind !== 'bundled_sidecar_media',
      )
    ) {
      return;
    }
    const embeddedMarker =
      /(?:^|[^a-z0-9])(?:sc[_+&-]?tc|chs[_+&-]?cht|简繁内封|简繁内嵌|内封|内嵌)(?:[^a-z0-9]|$)/iu;
    const explicitlyEmbedded = primarySources.every((source) => {
      const videos = source.manifest.filter(
        (entry) => this.selectedFileRole(entry.relativePath) === 'video',
      );
      const hasSidecarSubtitle = source.manifest.some(
        (entry) => this.selectedFileRole(entry.relativePath) === 'subtitle',
      );
      return (
        videos.length > 0 &&
        !hasSidecarSubtitle &&
        videos.every((entry) => embeddedMarker.test(entry.relativePath))
      );
    });
    if (!explicitlyEmbedded) return;
    for (const source of primarySources) {
      source.contentKind = 'embedded_subtitle_media';
      source.selectedBytes = 0;
      source.selectedFileCount = 0;
      source.selectedFileIndices = [];
      source.selectedFileMappings = [];
    }
    task.governanceProfile = 'embedded';
    for (const unit of task.units) unit.subtitleContract = null;
    this.refreshExpectedEpisodeNumbers(task);
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
   * 以保守命名规则推断唯一视频、目标语言字幕和字体映射，任何重复或不明归属都会失败关闭。
   * @param task - 当前接收阶段媒体任务。
   * @param value - 指定来源与首选中文字幕语言的机械选择参数。
   * @returns 文件选择写入后的数量、字节数和新 revision 回执。
   */
  private async applyAutomaticSourceSelection(
    task: MediaGovernanceTask,
    value: Record<string, unknown>,
  ) {
    const sourceId = this.sourceIdFromSelection(value);
    const subtitleLanguage = value.subtitleLanguage;
    if (!['zh-CN', 'zh-TW'].includes(String(subtitleLanguage))) {
      throwVbenError('自动选择字幕语言无效', HttpStatus.BAD_REQUEST);
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
        const role = this.selectedFileRole(entry.relativePath);
        const episode = this.selectedEpisodeIdentity(
          entry.relativePath,
          source,
          task,
        );
        if (!role || !episode) continue;
        if (role === 'subtitle') {
          const language = this.selectedSubtitleLanguage(entry.relativePath);
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
        .filter(
          (entry) => this.selectedFileRole(entry.relativePath) === 'video',
        )
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
   * 从自动选择参数中读取并校验精确来源标识。
   * @param value - 动态工具参数对象。
   * @returns 通过安全格式校验的来源 ID。
   */
  private sourceIdFromSelection(value: Record<string, unknown>): string {
    const sourceId = value.sourceId;
    if (
      typeof sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/u.test(sourceId)
    ) {
      throwVbenError('来源标识无效', HttpStatus.BAD_REQUEST);
    }
    return String(sourceId);
  }

  /**
   * 根据扩展名识别自动选择可处理的视频或字幕角色，其他文件保持未选。
   * @param relativePath - 来源清单相对路径。
   * @returns 视频、字幕或空角色。
   */
  private selectedFileRole(relativePath: string) {
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
  private selectedSubtitleLanguage(relativePath: string) {
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
  private selectedEpisodeIdentity(
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
    let governanceProfile;
    try {
      governanceProfile = assertSourceClassification({
        contentKind: input.contentKind,
        linkedTask,
        sourceRole: input.sourceRole,
      });
    } catch {
      throwVbenError('来源角色与内容类型不匹配', HttpStatus.BAD_REQUEST);
    }
    if (
      input.sourceRole === 'primary_media' &&
      primary &&
      task.governanceProfile &&
      task.governanceProfile !== governanceProfile
    ) {
      throwVbenError(
        '同一任务的主媒体来源必须使用一致治理类型',
        HttpStatus.CONFLICT,
      );
    }
    return governanceProfile;
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
      task.metadataIdentity !== null
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

  /**
   * 轮询活动运行，先补齐 NAS journal 缺口并持久化热进度游标，再应用精确下一终态。
   * @throws 当补投事件身份、顺序或热进度持久能力不符合密封运行合同时抛出。
   */
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
          const previousSequence = await this.stateStore.readRunSequence(runId);
          const observed = await this.executionGateway.status({
            afterSequence: previousSequence,
            runId,
            sealedInputSha256: envelope.sealedInputSha256,
            taskId: task.id,
          });
          const pendingEvents = observed.pendingEvents ?? [];
          for (const [index, event] of pendingEvents.entries()) {
            const identityInvalid =
              event.action !== envelope.action ||
              event.runId !== runId ||
              event.taskId !== task.id ||
              event.taskRevision !== envelope.taskRevision;
            const sequenceInvalid =
              event.sequence !== previousSequence + index + 1;
            const terminalInvalid = ['run-failed', 'run-succeeded'].includes(
              event.eventType,
            );
            if (identityInvalid || sequenceInvalid || terminalInvalid) {
              throw new Error('media-governance-executor-replay-invalid');
            }
            await this.applyExecutorEvent(event);
          }
          if (pendingEvents.length > 0 && this.progressHotStore) {
            if (!this.stateStore.saveExecutorProgressSnapshot) {
              throw new Error(
                'media-governance-executor-replay-snapshot-unavailable',
              );
            }
            await this.progressSnapshotQueue.catch(() => undefined);
            const lastPendingEvent = pendingEvents.at(-1)!;
            await this.stateStore.saveExecutorProgressSnapshot(
              structuredClone(task),
              structuredClone(lastPendingEvent),
            );
          }
          if (observed.status === 'queued' || observed.status === 'running') {
            continue;
          }
          let summary = 'NAS 执行单元已退出或被回收，但未返回可验证终态';
          if (observed.status === 'exited') {
            summary = `NAS 执行器已退出（退出码 ${observed.exitCode}），但未返回可验证终态`;
          }
          const terminal = observed.terminalEvent;
          const replayedSequence = previousSequence + pendingEvents.length;
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
            terminal.sequence !== replayedSequence + 1
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
      for (const task of [...this.tasks]) {
        if (task.activeRunId) continue;
        await this.continueRssIntakePipeline(task).catch(() => false);
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
   * 校验任务主媒体来源未超过执行器一次可密封的十六个来源上限。
   * @param task - 包含当前来源集合的媒体任务。
   * @param sourceRole - 本次准备新增或转换的来源角色。
   */
  private assertSourceOwnerAvailable(
    task: MediaGovernanceTask,
    sourceRole: MediaGovernanceSourceRole,
  ) {
    if (
      sourceRole === 'primary_media' &&
      task.sources.filter((source) => source.sourceRole === 'primary_media')
        .length >= 16
    ) {
      throwVbenError('同一任务最多包含 16 个主媒体来源', HttpStatus.CONFLICT);
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
   * @param task - 用于按事件频率裁剪任务补丁并移除敏感密封载荷的领域对象，包含 `activeRunId`、`gateReason`、`governanceProfile` 字段。
   * @param compact - 决定按事件频率裁剪任务补丁并移除敏感密封载荷内容、边界或目标的 `compact` 值。
   * @returns 按事件频率裁剪任务补丁并移除敏感密封载荷。
   */
  private projectTaskEventPatch(task: MediaGovernanceTask, compact: boolean) {
    if (compact) {
      return structuredClone({
        activeRunId: task.activeRunId,
        gateReason: task.gateReason,
        governanceProfile: task.governanceProfile,
        id: task.id,
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
   * 只允许未注入任何持久化或网关的内存夹具使用模拟执行，正式任务在网关缺失时失败关闭。
   * @param task - 准备执行 NAS 副作用的当前任务。
   * @throws 正式执行器缺失或配置不可用时返回服务不可用，且不改变任务状态。
   */
  private assertExecutionMode(task: MediaGovernanceTask) {
    if (this.executionGateway?.enabled()) return;
    if (
      this.stateStore ||
      this.executionGateway ||
      task.persistenceMode === 'database'
    ) {
      throwVbenError(
        '媒体执行器暂不可用，不能使用模拟执行',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * 在治理 Task 已提交关闭后异步登记独立刮削校验，登记失败不会回滚或阻塞媒体入库。
   * @param task - 已完成机械验收的治理任务。
   */
  private scheduleScrapeValidation(task: MediaGovernanceTask) {
    if (!this.scrapeValidationSink) return;
    const snapshot = structuredClone(task);
    void this.scrapeValidationSink.enqueueTask(snapshot).catch(() => undefined);
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
        runStateLabel: '',
        sourceHealthLabel: '',
        stageLabel: '',
      },
    };
    this.deriveBundledSubtitleContracts(restored);
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
   * @param task - 用于刷新阶段、运行态、阻塞原因和来源健康标签的媒体任务。
   */
  private refreshSemanticProjection(task: MediaGovernanceTask) {
    const stageLabels: Record<MediaGovernanceTask['stage'], string> = {
      acceptance: '机械验收',
      closed: '已闭环',
      download: 'NAS 下载',
      governance: '本地治理',
      intake: '接收资料',
      metadata: '历史刮削状态迁移中',
    };
    const runStateLabels: Record<MediaGovernanceTask['runState'], string> = {
      blocked: '等待处理',
      draft: '草稿',
      queued: '已排队',
      running: '执行中',
      succeeded: '已完成',
    };
    const discardReasonLabel = this.getDiscardDisabledReason(task);
    task.semanticProjection = {
      currentActionLabel: task.nextCommandLabel,
      discardAllowed: discardReasonLabel === null,
      discardReasonLabel,
      gateReasonLabel: task.gateReason ?? '无阻塞',
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
    const providerRef = input.providerRef ?? input.metadataIdentity;
    const releaseYear =
      input.releaseYear ?? input.metadataIdentity?.releaseYear;
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
      seasonNumber,
      subtitleContract: null,
      unitKind: 'season',
    }));
  }
}
