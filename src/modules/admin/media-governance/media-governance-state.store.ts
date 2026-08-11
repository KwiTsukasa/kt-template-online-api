import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import type { MediaGovernanceAgentEventDto } from './media-governance.dto';
import {
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from './media-governance.entities';
import type {
  MediaGovernanceSource,
  MediaGovernanceTask,
  MediaGovernanceUnit,
} from './media-governance.service';

export const MEDIA_GOVERNANCE_STATE_STORE = Symbol(
  'MEDIA_GOVERNANCE_STATE_STORE',
);

export type MediaGovernanceStoredTask = Omit<
  MediaGovernanceTask,
  'identityPreview' | 'persistenceMode' | 'semanticProjection'
>;

export interface MediaGovernanceStateStore {
  isReady(): boolean;
  loadTasks(): Promise<MediaGovernanceStoredTask[]>;
  saveTask(task: MediaGovernanceTask): Promise<void>;
  saveTaskWithAgentEvent(
    task: MediaGovernanceTask,
    event: MediaGovernanceAgentEventDto,
  ): Promise<void>;
}

@Injectable()
export class MediaGovernanceTypeOrmStateStore implements MediaGovernanceStateStore {
  private ready = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MediaGovernanceTaskEntity)
    private readonly taskRepository: Repository<MediaGovernanceTaskEntity>,
    @InjectRepository(MediaGovernanceUnitEntity)
    private readonly unitRepository: Repository<MediaGovernanceUnitEntity>,
    @InjectRepository(MediaGovernanceSourceEntity)
    private readonly sourceRepository: Repository<MediaGovernanceSourceEntity>,
    @InjectRepository(MediaGovernanceAgentSessionEntity)
    private readonly agentSessionRepository: Repository<MediaGovernanceAgentSessionEntity>,
  ) {}

  isReady() {
    return this.ready;
  }

  async loadTasks(): Promise<MediaGovernanceStoredTask[]> {
    try {
      const [tasks, units, sources, sessions] = await Promise.all([
        this.taskRepository.find({ order: { createTime: 'DESC' } }),
        this.unitRepository.find(),
        this.sourceRepository.find(),
        this.agentSessionRepository.find(),
      ]);
      this.ready = true;
      return tasks.map((task) =>
        this.restoreTask(
          task,
          units.filter((unit) => unit.taskId === task.id),
          sources.filter((source) => source.taskId === task.id),
          sessions.find((session) => session.taskId === task.id) ?? null,
        ),
      );
    } catch (error) {
      this.ready = false;
      throw error;
    }
  }

  async saveTask(task: MediaGovernanceTask) {
    this.assertReady();
    await this.dataSource.transaction((manager) =>
      this.saveTaskWithManager(manager, task),
    );
  }

  async saveTaskWithAgentEvent(
    task: MediaGovernanceTask,
    event: MediaGovernanceAgentEventDto,
  ) {
    this.assertReady();
    await this.dataSource.transaction(async (manager) => {
      await this.saveTaskWithManager(manager, task);
      const eventRepository = manager.getRepository(MediaGovernanceEventEntity);
      await eventRepository.insert(
        eventRepository.create({
          eventId: event.eventId,
          id: `media-event-${createHash('sha256').update(event.eventId).digest('hex').slice(0, 48)}`,
          observedAt: new Date(event.observedAt),
          runId: event.turnId ?? event.threadId,
          runState: task.runState,
          sequence: event.sequence,
          stage: task.stage,
          summary: event.summary,
          taskId: task.id,
          type: event.type,
        }),
      );
    });
  }

  private assertReady() {
    if (!this.ready) {
      throw new Error('media-governance-state-store-not-ready');
    }
  }

  private async saveTaskWithManager(
    manager: EntityManager,
    task: MediaGovernanceTask,
  ) {
    const taskRepository = manager.getRepository(MediaGovernanceTaskEntity);
    const unitRepository = manager.getRepository(MediaGovernanceUnitEntity);
    const sourceRepository = manager.getRepository(MediaGovernanceSourceEntity);
    const sessionRepository = manager.getRepository(
      MediaGovernanceAgentSessionEntity,
    );
    await taskRepository.save(
      taskRepository.create({
        activeRunId: null,
        closedAt: task.stage === 'closed' ? new Date() : null,
        closedMode:
          task.stage === 'closed'
            ? task.agentSession?.status === 'succeeded'
              ? 'agent_verified'
              : 'automatic'
            : null,
        declaredUnitIds: task.units.map((unit) => unit.id),
        gateReason: task.gateReason,
        governanceProfile: task.governanceProfile,
        id: task.id,
        inputSnapshotSha256: task.inputSnapshotSha256,
        mediaType: task.mediaType,
        metadataIdentity: null,
        metadataStatus: task.metadataStatus,
        nextCommandLabel: task.nextCommandLabel,
        progressProjection: task.progress,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        revision: task.revision,
        runState: task.runState,
        sealedPlanSha256: task.sealedPlanSha256,
        stage: task.stage,
        titleHint: task.titleHint,
        workItemId: null,
      }),
    );
    if (task.units.length > 0) {
      await unitRepository.save(
        task.units.map((unit) =>
          unitRepository.create({
            evidenceSha256: null,
            expectedEpisodeNumbers: unit.expectedEpisodeNumbers.map(String),
            id: unit.id,
            localAcceptedAt: null,
            metadataProjection: null,
            seasonNumber: unit.seasonNumber,
            subtitleContract: unit.subtitleContract,
            taskId: task.id,
            unitKind: unit.unitKind,
          }),
        ),
      );
    }
    if (task.sources.length > 0) {
      await sourceRepository.save(
        task.sources.map((source) =>
          sourceRepository.create({
            contentKind: source.contentKind,
            descriptorObjectId: source.descriptorObjectId,
            descriptorRevision: 1,
            descriptorSha256: source.descriptorSha256,
            id: source.id,
            infoHash: source.infoHash,
            manifestProjection: source.manifest,
            manifestSha256: source.manifestSha256,
            manifestState: source.manifestState,
            releaseGroup: source.releaseGroup,
            seasonNumbers: source.seasonNumbers,
            selectedBytes: String(source.selectedBytes),
            selectedFileCount: source.selectedFileCount,
            sourceHealth: source.sourceHealth,
            sourceHealthLabel: source.sourceHealthLabel,
            sourceHealthReason: source.sourceHealthReasonLabel,
            sourceRole: source.sourceRole,
            taskId: task.id,
            transportKind: source.transportKind,
          }),
        ),
      );
    }
    if (task.agentSession) {
      await sessionRepository.save(
        sessionRepository.create({
          capsuleSha256: task.agentSession.capsuleSha256,
          checkpointSha256: task.agentSession.checkpointSha256,
          currentActionLabel: task.agentSession.currentActionLabel,
          currentUnitId: task.agentSession.currentUnitId,
          id: `${task.id}-agent-session`,
          lastHeartbeatAt: new Date(),
          lastSequence: task.agentSession.lastSequence,
          pendingPlanSha256: task.agentSession.pendingPlanSha256,
          policyBoundaryLabel: task.agentSession.policyBoundaryLabel,
          policySha256: task.agentSession.policySha256,
          policyVersion: task.agentSession.policyVersion,
          status: task.agentSession.status,
          statusLabel: task.agentSession.statusLabel,
          taskId: task.id,
          threadId: task.agentSession.threadId,
        }),
      );
    } else {
      await sessionRepository.delete({ taskId: task.id });
    }
  }

  private restoreTask(
    task: MediaGovernanceTaskEntity,
    units: MediaGovernanceUnitEntity[],
    sources: MediaGovernanceSourceEntity[],
    session: MediaGovernanceAgentSessionEntity | null,
  ): MediaGovernanceStoredTask {
    return {
      agentSession: session
        ? {
            capsuleSha256: session.capsuleSha256,
            checkpointSha256: session.checkpointSha256,
            currentActionLabel: session.currentActionLabel,
            currentUnitId: session.currentUnitId,
            lastHeartbeatLabel: '已从数据库恢复',
            lastSequence: session.lastSequence,
            pendingPlanSha256: session.pendingPlanSha256,
            policyBoundaryLabel: session.policyBoundaryLabel,
            policySha256: session.policySha256,
            policyVersion: session.policyVersion,
            status: session.status as NonNullable<
              MediaGovernanceTask['agentSession']
            >['status'],
            statusLabel: session.statusLabel,
            threadId: session.threadId,
          }
        : null,
      gateReason: task.gateReason,
      governanceProfile:
        task.governanceProfile as MediaGovernanceTask['governanceProfile'],
      id: task.id,
      inputSnapshotSha256: task.inputSnapshotSha256,
      mediaType: task.mediaType as MediaGovernanceTask['mediaType'],
      metadataStatus:
        task.metadataStatus as MediaGovernanceTask['metadataStatus'],
      nextCommandLabel: task.nextCommandLabel,
      progress: task.progressProjection as MediaGovernanceTask['progress'],
      providerRef: task.providerRef as MediaGovernanceTask['providerRef'],
      releaseYear: task.releaseYear,
      revision: task.revision,
      runState: task.runState as MediaGovernanceTask['runState'],
      sealedPlanSha256: task.sealedPlanSha256,
      sources: sources.map((source) => this.restoreSource(source)),
      stage: task.stage as MediaGovernanceTask['stage'],
      titleHint: task.titleHint,
      units: units.map((unit) => this.restoreUnit(unit)),
    };
  }

  private restoreSource(
    source: MediaGovernanceSourceEntity,
  ): MediaGovernanceSource {
    return {
      contentKind: source.contentKind as MediaGovernanceSource['contentKind'],
      descriptorObjectId: source.descriptorObjectId,
      descriptorSha256: source.descriptorSha256,
      id: source.id,
      infoHash: source.infoHash ?? '',
      manifest: source.manifestProjection as MediaGovernanceSource['manifest'],
      manifestSha256: source.manifestSha256,
      manifestState:
        source.manifestState as MediaGovernanceSource['manifestState'],
      releaseGroup: source.releaseGroup,
      seasonNumbers: source.seasonNumbers,
      selectedBytes: Number(source.selectedBytes),
      selectedFileCount: source.selectedFileCount,
      sourceHealth:
        source.sourceHealth as MediaGovernanceSource['sourceHealth'],
      sourceHealthLabel: source.sourceHealthLabel,
      sourceHealthReasonLabel: source.sourceHealthReason ?? '无原因记录',
      sourceRole: source.sourceRole as MediaGovernanceSource['sourceRole'],
      transportKind:
        source.transportKind as MediaGovernanceSource['transportKind'],
    };
  }

  private restoreUnit(unit: MediaGovernanceUnitEntity): MediaGovernanceUnit {
    return {
      expectedEpisodeNumbers: unit.expectedEpisodeNumbers.map(Number),
      id: unit.id,
      seasonNumber: unit.seasonNumber,
      subtitleContract:
        unit.subtitleContract as MediaGovernanceUnit['subtitleContract'],
      unitKind: unit.unitKind as MediaGovernanceUnit['unitKind'],
    };
  }
}
