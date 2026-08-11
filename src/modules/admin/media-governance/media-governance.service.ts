import { createHash, randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Inject,
  Injectable,
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
  MediaGovernanceMagnetSourceCreateDto,
  MediaGovernanceMediaType,
  MediaGovernanceOperatorDecisionDto,
  MediaGovernanceProvider,
  MediaGovernanceRevisionCommandDto,
  MediaGovernanceSourceClassificationDto,
  MediaGovernanceSourceRole,
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

type MediaGovernanceProviderRef = {
  provider: MediaGovernanceProvider;
  providerId: string;
};

export type MediaGovernanceUnit = {
  expectedEpisodeNumbers: number[];
  id: string;
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
  contentKind: MediaGovernanceContentKind;
  descriptorObjectId: string;
  descriptorSha256: string;
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
  sourceHealth: 'inconclusive' | 'unchecked' | 'viable';
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

export type MediaGovernanceTask = {
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
    status: 'needs-operator' | 'running' | 'succeeded';
    statusLabel: string;
    threadId: string;
  };
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
  metadataStatus: 'pending' | 'requires-agent' | 'verified';
  nextCommandLabel: string;
  persistenceMode: 'database' | 'process-simulator';
  progress: MediaGovernanceProgress;
  providerRef: MediaGovernanceProviderRef | null;
  releaseYear: null | number;
  revision: number;
  runState: 'blocked' | 'draft' | 'running' | 'succeeded';
  semanticProjection: {
    currentActionLabel: string;
    gateReasonLabel: string;
    metadataStatusLabel: string;
    runStateLabel: string;
    sourceHealthLabel: string;
    stageLabel: string;
  };
  sealedPlanSha256: null | string;
  sources: MediaGovernanceSource[];
  stage: 'closed' | 'download' | 'governance' | 'intake' | 'metadata';
  titleHint: string;
  units: MediaGovernanceUnit[];
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

@Injectable()
export class MediaGovernanceService implements OnModuleInit {
  private readonly tasks: MediaGovernanceTask[] = [];

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
  ) {}

  async onModuleInit() {
    if (!this.stateStore) return;
    const tasks = await this.stateStore.loadTasks();
    this.tasks.splice(
      0,
      this.tasks.length,
      ...tasks.map((task) => this.restoreStoredTask(task)),
    );
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
    };
    const task: MediaGovernanceTask = {
      agentSession: null,
      gateReason: null,
      governanceProfile: null,
      id: `media-task-${randomUUID()}`,
      identityPreview: this.buildIdentityPreview(normalizedInput),
      inputSnapshotSha256: createHash('sha256')
        .update(JSON.stringify(normalizedInput))
        .digest('hex'),
      mediaType: input.mediaType,
      metadataStatus: 'pending',
      nextCommandLabel: '补充并检查来源',
      persistenceMode: this.databaseReady() ? 'database' : 'process-simulator',
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
      sources: [],
      stage: 'intake',
      titleHint,
      units: this.createUnits(input.mediaType, seasonNumbers),
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
          task.agentSession?.status === 'needs-operator' ||
          task.agentSession?.status === 'running',
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
      descriptorObjectId:
        stored?.objectId ?? `simulator-private/${sourceId}/${descriptorSha256}`,
      descriptorSha256,
      id: sourceId,
      infoHash,
      manifest: [],
      manifestSha256: null,
      manifestState: 'pending-inspection',
      releaseGroup: input.releaseGroup?.trim() || displayName || null,
      seasonNumbers,
      selectedBytes: 0,
      selectedFileCount: 0,
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
      descriptorObjectId: parsed.objectId,
      descriptorSha256: parsed.descriptorSha256,
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
    source.releaseGroup = input.releaseGroup?.trim() || source.releaseGroup;
    if (governanceProfile) task.governanceProfile = governanceProfile;
    this.bumpRevision(task);
    await this.commitTask(task, 'source-updated');
    return source;
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
    if (!primary || primary.sourceHealth !== 'viable') {
      throwVbenError('主媒体来源尚未通过运行时探针', HttpStatus.CONFLICT);
    }
    if (
      task.sources.some(
        (source) =>
          source.manifestState !== 'inspected' ||
          source.sourceHealth !== 'viable',
      )
    ) {
      throwVbenError('仍有来源未完成清单检查或运行时探针', HttpStatus.CONFLICT);
    }
    if (
      primary.contentKind === 'subtitleless_media' &&
      task.units.some((unit) => unit.seasonNumber && !unit.subtitleContract)
    ) {
      throwVbenError('无字幕媒体仍有季缺少完整字幕合同', HttpStatus.CONFLICT);
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

  async startGovernance(
    taskId: string,
    input: MediaGovernanceRevisionCommandDto,
  ): Promise<MediaGovernanceTask> {
    const task = this.detail(taskId);
    this.assertRevision(task, input.expectedRevision);
    if (task.stage !== 'download' || task.runState !== 'succeeded') {
      throwVbenError('来源载荷尚未就绪', HttpStatus.CONFLICT);
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
      task.agentSession?.status === 'running' ||
      task.agentSession?.status === 'needs-operator'
    ) {
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
        lastSequence: 0,
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
        status: session.status === 'active' ? 'running' : 'needs-operator',
        statusLabel:
          session.status === 'active' ? 'Agent 正在治理' : '等待人工放行',
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
            : 'needs-operator',
      statusLabel:
        remoteSession.status === 'active'
          ? 'Agent 正在治理'
          : remoteSession.status === 'closed'
            ? 'Agent 治理已完成'
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
      input.sequence === 1 &&
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
      session.status = 'needs-operator';
      session.statusLabel = 'Agent 已阻塞';
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
    this.assertRevision(task, input.expectedRevision);
    if (task.agentSession?.status !== 'needs-operator') {
      throwVbenError('当前没有待处理的 Agent 候选', HttpStatus.CONFLICT);
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
    task.progress = {
      ...task.progress,
      etaLabel: '已完成',
      percent: 100,
      progressLabel: '本地闭环演示已完成',
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
      closedAt: null,
      closedMode: null,
      declaredUnitIds: task.units.map((unit) => unit.id),
      gateReason: task.gateReason,
      governanceProfile: task.governanceProfile,
      id: task.id,
      inputSnapshotSha256: task.inputSnapshotSha256,
      mediaType: task.mediaType,
      metadataIdentity: null,
      providerRef: task.providerRef,
      releaseYear: task.releaseYear,
      revision: task.revision,
      runState: task.runState,
      sealedPlanSha256: task.sealedPlanSha256,
      stage: task.stage,
      titleHint: task.titleHint,
      workItemId: null,
    };
  }

  private projectAgentUnits(
    task: MediaGovernanceTask,
  ): MediaGovernanceUnitProjection[] {
    return task.units.map((unit) => ({
      evidenceSha256: null,
      expectedEpisodeNumbers: unit.expectedEpisodeNumbers,
      id: unit.id,
      localAcceptedAt: null,
      metadataProjection: {
        missingA: [],
        missingB: [],
        missingC: [],
        validBFallbacks: [],
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
      closed: '已闭环',
      download: 'NAS 下载',
      governance: '本地治理',
      intake: '接收资料',
      metadata: '元数据核验',
    };
    const runStateLabels: Record<MediaGovernanceTask['runState'], string> = {
      blocked: '等待处理',
      draft: '草稿',
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
          expectedEpisodeNumbers: [],
          id: `media-unit-${randomUUID()}`,
          seasonNumber: null,
          subtitleContract: null,
          unitKind: 'movie',
        },
      ];
    }
    return seasonNumbers.map((seasonNumber) => ({
      expectedEpisodeNumbers: [],
      id: `media-unit-${randomUUID()}`,
      seasonNumber,
      subtitleContract: null,
      unitKind: 'season',
    }));
  }
}
