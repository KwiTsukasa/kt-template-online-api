import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  IsNull,
  LessThan,
  type EntityManager,
  Repository,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import type {
  MediaGovernanceAgentEventDto,
  MediaGovernanceExecutorEventDto,
} from './media-governance.dto';
import {
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceOutboxEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from './media-governance.entities';
import type { MediaGovernanceExecutionEnvelope } from './media-governance-execution.gateway';
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
  acknowledgeRunDispatch?(runId: string, executionId: string): Promise<void>;
  applyExecutorEvent?(
    task: MediaGovernanceTask,
    event: MediaGovernanceExecutorEventDto,
  ): Promise<boolean>;
  consumeDescriptorGrant?(input: {
    descriptorGrantId: string;
    descriptorSha256: string;
    runId: string;
    sourceId: string;
    taskId: string;
  }): Promise<{ descriptorObjectId: string }>;
  consumePlanGrant?(input: {
    planGrantId: string;
    planSha256: string;
    runId: string;
    taskId: string;
  }): Promise<Record<string, unknown>>;
  isReady(): boolean;
  loadTasks(): Promise<MediaGovernanceStoredTask[]>;
  pendingRunDispatches?(): Promise<MediaGovernanceExecutionEnvelope[]>;
  recordRunDispatchFailure?(runId: string): Promise<number>;
  readRunEnvelope?(
    runId: string,
  ): Promise<MediaGovernanceExecutionEnvelope | null>;
  readRunSequence?(runId: string): Promise<number>;
  reserveWorkItemId?(taskId: string): Promise<string>;
  reserveRunDispatch?(
    task: MediaGovernanceTask,
    envelope: MediaGovernanceExecutionEnvelope,
  ): Promise<void>;
  failRunDispatch?(task: MediaGovernanceTask, runId: string): Promise<void>;
  tombstoneDescriptor?(
    sourceId: string,
    descriptorRevision: number,
  ): Promise<string>;
  saveTask(task: MediaGovernanceTask): Promise<void>;
  saveTaskWithAgentEvent(
    task: MediaGovernanceTask,
    event: MediaGovernanceAgentEventDto,
  ): Promise<void>;
}

@Injectable()
export class MediaGovernanceTypeOrmStateStore implements MediaGovernanceStateStore {
  private static readonly WORK_ITEM_ALLOCATION_LOCK =
    'kt-media-governance-work-item-allocation-v1';

  private static readonly WORK_ITEM_RESERVED_MAX = 62;

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
    @InjectRepository(MediaGovernanceDescriptorRevisionEntity)
    private readonly descriptorRevisionRepository: Repository<MediaGovernanceDescriptorRevisionEntity>,
    @InjectRepository(MediaGovernanceEventEntity)
    private readonly eventRepository: Repository<MediaGovernanceEventEntity>,
    @InjectRepository(MediaGovernanceOutboxEntity)
    private readonly outboxRepository: Repository<MediaGovernanceOutboxEntity>,
  ) {}

  isReady() {
    return this.ready;
  }

  async loadTasks(): Promise<MediaGovernanceStoredTask[]> {
    try {
      const [tasks, units, sources, sessions, descriptors] = await Promise.all([
        this.taskRepository.find({ order: { createTime: 'DESC' } }),
        this.unitRepository.find(),
        this.sourceRepository.find(),
        this.agentSessionRepository.find(),
        this.descriptorRevisionRepository.find(),
      ]);
      this.ready = true;
      return tasks.map((task) =>
        this.restoreTask(
          task,
          units.filter((unit) => unit.taskId === task.id),
          sources.filter((source) => source.taskId === task.id),
          sessions.find((session) => session.taskId === task.id) ?? null,
          descriptors,
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

  async reserveWorkItemId(taskId: string) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const lockRows = (await manager.query(
        'SELECT GET_LOCK(?, 5) AS acquired',
        [MediaGovernanceTypeOrmStateStore.WORK_ITEM_ALLOCATION_LOCK],
      )) as Array<{ acquired: number | string }>;
      if (Number(lockRows[0]?.acquired) !== 1) {
        throw new Error('media-governance-work-item-allocation-lock-timeout');
      }
      try {
        const repository = manager.getRepository(MediaGovernanceTaskEntity);
        const task = await repository.findOneBy({ id: taskId });
        if (!task) throw new Error('media-governance-task-not-found');
        if (task.workItemId) return task.workItemId;

        const highestAssigned = (await repository.find()).reduce(
          (highest, candidate) => {
            const match = /^media-(\d{3})$/u.exec(candidate.workItemId ?? '');
            return match ? Math.max(highest, Number(match[1])) : highest;
          },
          MediaGovernanceTypeOrmStateStore.WORK_ITEM_RESERVED_MAX,
        );
        if (highestAssigned >= 999) {
          throw new Error('media-governance-work-item-allocation-exhausted');
        }
        task.workItemId = `media-${String(highestAssigned + 1).padStart(3, '0')}`;
        await repository.save(task);
        return task.workItemId;
      } finally {
        await manager.query('SELECT RELEASE_LOCK(?) AS released', [
          MediaGovernanceTypeOrmStateStore.WORK_ITEM_ALLOCATION_LOCK,
        ]);
      }
    });
  }

  async reserveRunDispatch(
    task: MediaGovernanceTask,
    envelope: MediaGovernanceExecutionEnvelope,
  ) {
    this.assertReady();
    if (
      task.activeRunId !== envelope.runId ||
      task.id !== envelope.taskId ||
      task.revision !== envelope.taskRevision ||
      task.inputSnapshotSha256 !== envelope.inputSnapshotSha256
    ) {
      throw new Error('media-governance-run-reservation-identity-mismatch');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.saveTaskWithManager(manager, task);
      await manager.getRepository(MediaGovernanceRunEntity).insert(
        manager.getRepository(MediaGovernanceRunEntity).create({
          action: envelope.action,
          evidenceSha256: null,
          finishedAt: null,
          id: envelope.runId,
          inputSnapshotSha256: envelope.inputSnapshotSha256,
          planSha256: envelope.plan?.planSha256 ?? null,
          progress: {
            completedBytes: 0,
            completedItems: 0,
            sourceIds: envelope.sources?.map((source) => source.sourceId) ?? [],
            totalBytes:
              envelope.sources?.reduce(
                (total, source) => total + source.selectedBytes,
                0,
              ) ?? 0,
            totalItems:
              envelope.sources?.reduce(
                (total, source) => total + source.selectedFileCount,
                0,
              ) ?? 0,
          },
          replayKey: envelope.replayKey,
          runnerSha256: null,
          startedAt: new Date(),
          status: 'queued',
          taskId: envelope.taskId,
          taskRevision: envelope.taskRevision,
        }),
      );
      await manager.getRepository(MediaGovernanceOutboxEntity).insert(
        manager.getRepository(MediaGovernanceOutboxEntity).create({
          attempts: 0,
          executionId: null,
          flowId: envelope.flowId,
          id: envelope.runId,
          idempotencyKey: envelope.replayKey,
          leaseUntil: null,
          sealedInput: envelope,
          sealedInputSha256: envelope.sealedInputSha256,
          taskId: envelope.taskId,
        }),
      );
    });
  }

  async pendingRunDispatches() {
    this.assertReady();
    const rows = await this.outboxRepository.find({
      order: { createTime: 'ASC' },
      take: 32,
      where: {
        attempts: LessThan(5),
        executionId: IsNull(),
      },
    });
    return rows.map((row) => {
      if (
        row.sealedInputSha256 !== row.sealedInput.sealedInputSha256 ||
        row.id !== row.sealedInput.runId ||
        row.taskId !== row.sealedInput.taskId
      ) {
        throw new Error('media-governance-outbox-envelope-mismatch');
      }
      return row.sealedInput as MediaGovernanceExecutionEnvelope;
    });
  }

  async readRunEnvelope(runId: string) {
    this.assertReady();
    const row = await this.outboxRepository.findOneBy({ id: runId });
    if (!row) return null;
    if (
      row.id !== row.sealedInput.runId ||
      row.taskId !== row.sealedInput.taskId ||
      row.sealedInputSha256 !== row.sealedInput.sealedInputSha256
    ) {
      throw new Error('media-governance-run-envelope-identity-mismatch');
    }
    return structuredClone(
      row.sealedInput as unknown as MediaGovernanceExecutionEnvelope,
    );
  }

  async recordRunDispatchFailure(runId: string) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(MediaGovernanceOutboxEntity);
      const row = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: runId },
      });
      if (!row) throw new Error('media-governance-run-dispatch-not-found');
      if (row.executionId) return row.attempts;
      row.attempts += 1;
      row.leaseUntil = null;
      await repository.save(row);
      return row.attempts;
    });
  }

  async failRunDispatch(task: MediaGovernanceTask, runId: string) {
    this.assertReady();
    await this.dataSource.transaction(async (manager) => {
      const runRepository = manager.getRepository(MediaGovernanceRunEntity);
      const outboxRepository = manager.getRepository(
        MediaGovernanceOutboxEntity,
      );
      const run = await runRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: runId },
      });
      const outbox = await outboxRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: runId },
      });
      if (
        !run ||
        !outbox ||
        run.taskId !== task.id ||
        outbox.taskId !== task.id
      ) {
        throw new Error('media-governance-run-dispatch-identity-mismatch');
      }
      if (outbox.executionId) {
        throw new Error('media-governance-run-dispatch-already-acknowledged');
      }
      await this.saveTaskWithManager(manager, task);
      outbox.attempts = Math.max(outbox.attempts, 5);
      outbox.leaseUntil = null;
      run.status = 'failed';
      run.finishedAt = new Date();
      await Promise.all([
        outboxRepository.save(outbox),
        runRepository.save(run),
      ]);
    });
  }

  async acknowledgeRunDispatch(runId: string, executionId: string) {
    this.assertReady();
    await this.dataSource.transaction(async (manager) => {
      const outboxRepository = manager.getRepository(
        MediaGovernanceOutboxEntity,
      );
      const runRepository = manager.getRepository(MediaGovernanceRunEntity);
      const outbox = await outboxRepository.findOneBy({ id: runId });
      const run = await runRepository.findOneBy({ id: runId });
      if (!outbox || !run) {
        throw new Error('media-governance-run-dispatch-not-found');
      }
      if (outbox.executionId && outbox.executionId !== executionId) {
        throw new Error('media-governance-run-execution-identity-mismatch');
      }
      outbox.attempts += 1;
      outbox.executionId = executionId;
      outbox.leaseUntil = null;
      run.status = 'running';
      await Promise.all([
        outboxRepository.save(outbox),
        runRepository.save(run),
      ]);
    });
  }

  async readRunSequence(runId: string) {
    this.assertReady();
    const event = await this.eventRepository.findOne({
      order: { sequence: 'DESC' },
      where: { runId },
    });
    return event?.sequence ?? 0;
  }

  async applyExecutorEvent(
    task: MediaGovernanceTask,
    event: MediaGovernanceExecutorEventDto,
  ) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const eventRepository = manager.getRepository(MediaGovernanceEventEntity);
      const runRepository = manager.getRepository(MediaGovernanceRunEntity);
      const existing = await eventRepository.findOneBy({
        runId: event.runId,
        sequence: event.sequence,
        taskId: event.taskId,
      });
      if (existing) return false;
      const previous = await eventRepository.findOne({
        order: { sequence: 'DESC' },
        where: { runId: event.runId, taskId: event.taskId },
      });
      if (event.sequence !== (previous?.sequence ?? 0) + 1) {
        throw new Error('media-governance-executor-event-sequence-gap');
      }
      const run = await runRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: event.runId },
      });
      if (
        !run ||
        run.taskId !== event.taskId ||
        run.taskRevision !== event.taskRevision ||
        run.action !== event.action
      ) {
        throw new Error('media-governance-executor-event-identity-mismatch');
      }
      await this.saveTaskWithManager(manager, task);
      if (
        event.action === 'source.cleanup' &&
        event.eventType === 'run-succeeded' &&
        event.sourceId
      ) {
        await manager.getRepository(MediaGovernanceSourceEntity).delete({
          id: event.sourceId,
          taskId: task.id,
        });
      }
      run.status =
        event.eventType === 'run-succeeded'
          ? 'succeeded'
          : event.eventType === 'run-failed'
            ? 'failed'
            : event.eventType === 'run-paused'
              ? 'paused'
              : event.eventType === 'run-resumed'
                ? 'running'
                : 'running';
      run.progress = event.progress ? { ...event.progress } : run.progress;
      run.evidenceSha256 = event.evidenceSha256 ?? run.evidenceSha256;
      if (
        event.eventType === 'run-succeeded' ||
        event.eventType === 'run-failed'
      ) {
        run.finishedAt = new Date(event.observedAt);
      }
      await runRepository.save(run);
      await eventRepository.insert(
        eventRepository.create({
          eventId: `executor:${event.runId}:${event.sequence}`,
          id: `media-event-${createHash('sha256')
            .update(`executor:${event.runId}:${event.sequence}`)
            .digest('hex')
            .slice(0, 48)}`,
          observedAt: new Date(event.observedAt),
          runId: event.runId,
          runState: task.runState,
          sequence: event.sequence,
          stage: task.stage,
          summary: event.summary,
          taskId: event.taskId,
          type: event.eventType,
        }),
      );
      return true;
    });
  }

  async consumeDescriptorGrant(input: {
    descriptorGrantId: string;
    descriptorSha256: string;
    runId: string;
    sourceId: string;
    taskId: string;
  }) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const outboxRepository = manager.getRepository(
        MediaGovernanceOutboxEntity,
      );
      const sourceRepository = manager.getRepository(
        MediaGovernanceSourceEntity,
      );
      const eventRepository = manager.getRepository(MediaGovernanceEventEntity);
      const outbox = await outboxRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: input.runId },
      });
      const envelope = outbox?.sealedInput as
        | MediaGovernanceExecutionEnvelope
        | undefined;
      const sourceContract = envelope?.sources?.find(
        (source) => source.sourceId === input.sourceId,
      );
      if (
        !outbox ||
        !outbox.executionId ||
        !sourceContract ||
        envelope.expiresAt < new Date().toISOString() ||
        envelope.taskId !== input.taskId ||
        sourceContract.descriptorGrantId !== input.descriptorGrantId ||
        sourceContract.descriptorSha256 !== input.descriptorSha256
      ) {
        throw new Error('media-governance-descriptor-grant-invalid');
      }
      const source = await sourceRepository.findOneBy({ id: input.sourceId });
      if (
        !source ||
        source.taskId !== input.taskId ||
        source.descriptorSha256 !== input.descriptorSha256
      ) {
        throw new Error('media-governance-descriptor-grant-identity-mismatch');
      }
      await eventRepository.insert(
        eventRepository.create({
          eventId: `descriptor-grant-consumed:${input.descriptorGrantId}`,
          id: `media-event-${createHash('sha256')
            .update(`descriptor-grant:${input.descriptorGrantId}`)
            .digest('hex')
            .slice(0, 48)}`,
          observedAt: new Date(),
          runId: null,
          runState: 'running',
          sequence: 0,
          stage: 'intake',
          summary: '描述文件授权已单次消费',
          taskId: input.taskId,
          type: 'descriptor-grant-consumed',
        }),
      );
      return { descriptorObjectId: source.descriptorObjectId };
    });
  }

  async consumePlanGrant(input: {
    planGrantId: string;
    planSha256: string;
    runId: string;
    taskId: string;
  }) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const outboxRepository = manager.getRepository(
        MediaGovernanceOutboxEntity,
      );
      const taskRepository = manager.getRepository(MediaGovernanceTaskEntity);
      const eventRepository = manager.getRepository(MediaGovernanceEventEntity);
      const outbox = await outboxRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: input.runId },
      });
      const task = await taskRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: input.taskId },
      });
      const envelope = outbox?.sealedInput as
        | MediaGovernanceExecutionEnvelope
        | undefined;
      if (
        !outbox ||
        !outbox.executionId ||
        !task ||
        !task.sealedPlan ||
        !envelope?.plan ||
        envelope.expiresAt < new Date().toISOString() ||
        ![
          'acceptance.verify',
          'governance.execute',
          'metadata.repair',
          'metadata.verify',
        ].includes(envelope.action) ||
        envelope.taskId !== input.taskId ||
        envelope.plan.planGrantId !== input.planGrantId ||
        envelope.plan.planSha256 !== input.planSha256 ||
        task.sealedPlanSha256 !== input.planSha256
      ) {
        throw new Error('media-governance-plan-grant-invalid');
      }
      await eventRepository.insert(
        eventRepository.create({
          eventId: `plan-grant-consumed:${input.planGrantId}`,
          id: `media-event-${createHash('sha256')
            .update(`plan-grant:${input.planGrantId}`)
            .digest('hex')
            .slice(0, 48)}`,
          observedAt: new Date(),
          runId: null,
          runState: 'running',
          sequence: 0,
          stage: 'governance',
          summary: 'Schema 1.2.0 本地计划授权已单次消费',
          taskId: input.taskId,
          type: 'plan-grant-consumed',
        }),
      );
      return structuredClone(task.sealedPlan);
    });
  }

  async tombstoneDescriptor(sourceId: string, descriptorRevision: number) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(
        MediaGovernanceDescriptorRevisionEntity,
      );
      const row = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: `${sourceId}-descriptor-r${descriptorRevision}` },
      });
      if (!row) throw new Error('media-governance-descriptor-not-found');
      if (row.tombstonedAt) return row.tombstonedAt.toISOString();
      row.active = false;
      row.tombstonedAt = new Date();
      await repository.save(row);
      return row.tombstonedAt.toISOString();
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
    const descriptorRepository = manager.getRepository(
      MediaGovernanceDescriptorRevisionEntity,
    );
    const sessionRepository = manager.getRepository(
      MediaGovernanceAgentSessionEntity,
    );
    await taskRepository.save(
      taskRepository.create({
        activeRunId: task.activeRunId,
        closedAt: task.closedAt ? new Date(task.closedAt) : null,
        closedMode: task.closedMode,
        declaredUnitIds: task.units.map((unit) => unit.id),
        gateReason: task.gateReason,
        governanceProfile: task.governanceProfile,
        id: task.id,
        inputSnapshotSha256: task.inputSnapshotSha256,
        mediaType: task.mediaType,
        metadataIdentity: task.metadataIdentity,
        metadataStatus: task.metadataStatus,
        nextCommandLabel: task.nextCommandLabel,
        progressProjection: task.progress,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        revision: task.revision,
        runState: task.runState,
        sealedPlanSha256: task.sealedPlanSha256,
        sealedPlan: task.sealedPlan,
        payloadSeal: task.payloadSeal,
        stage: task.stage,
        titleHint: task.titleHint,
        workItemId: task.workItemId,
      }),
    );
    if (task.units.length > 0) {
      await unitRepository.save(
        task.units.map((unit) =>
          unitRepository.create({
            evidenceSha256: unit.evidenceSha256,
            expectedEpisodeNumbers: unit.expectedEpisodeNumbers.map(String),
            id: unit.id,
            localAcceptedAt: unit.localAcceptedAt
              ? new Date(unit.localAcceptedAt)
              : null,
            metadataProjection: unit.metadataProjection,
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
            selectedFileIndices: source.selectedFileIndices,
            selectedFileMappings: source.selectedFileMappings,
            sourceHealth: source.sourceHealth,
            sourceHealthLabel: source.sourceHealthLabel,
            sourceHealthReason: source.sourceHealthReasonLabel,
            sourceRole: source.sourceRole,
            taskId: task.id,
            transportKind: source.transportKind,
          }),
        ),
      );
      await descriptorRepository.save(
        task.sources.map((source) =>
          descriptorRepository.create({
            active: source.descriptorTombstonedAt === null,
            bytes: String(source.descriptorBytes),
            id: `${source.id}-descriptor-r${source.descriptorRevision}`,
            infoHash: source.infoHash || null,
            manifestSha256: source.manifestSha256,
            objectId: source.descriptorObjectId,
            revision: source.descriptorRevision,
            sha256: source.descriptorSha256,
            sourceId: source.id,
            tombstonedAt: source.descriptorTombstonedAt
              ? new Date(source.descriptorTombstonedAt)
              : null,
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
    descriptors: MediaGovernanceDescriptorRevisionEntity[],
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
      activeRunId: task.activeRunId,
      closedAt: task.closedAt?.toISOString() ?? null,
      closedMode: (task.closedMode ??
        (task.stage === 'closed'
          ? session?.status === 'succeeded'
            ? 'agent_verified'
            : 'automatic'
          : null)) as MediaGovernanceTask['closedMode'],
      gateReason: task.gateReason,
      governanceProfile:
        task.governanceProfile as MediaGovernanceTask['governanceProfile'],
      id: task.id,
      inputSnapshotSha256: task.inputSnapshotSha256,
      mediaType: task.mediaType as MediaGovernanceTask['mediaType'],
      metadataIdentity:
        task.metadataIdentity as MediaGovernanceTask['metadataIdentity'],
      metadataStatus:
        task.metadataStatus as MediaGovernanceTask['metadataStatus'],
      nextCommandLabel: task.nextCommandLabel,
      progress: task.progressProjection as MediaGovernanceTask['progress'],
      providerRef: task.providerRef as MediaGovernanceTask['providerRef'],
      releaseYear: task.releaseYear,
      revision: task.revision,
      runState: task.runState as MediaGovernanceTask['runState'],
      sealedPlanSha256: task.sealedPlanSha256,
      sealedPlan: task.sealedPlan,
      payloadSeal: task.payloadSeal as MediaGovernanceTask['payloadSeal'],
      sources: sources.map((source) =>
        this.restoreSource(
          source,
          descriptors.find(
            (descriptor) =>
              descriptor.sourceId === source.id &&
              descriptor.revision === source.descriptorRevision,
          ) ?? null,
        ),
      ),
      stage: task.stage as MediaGovernanceTask['stage'],
      titleHint: task.titleHint,
      units: units.map((unit) => this.restoreUnit(unit)),
      workItemId: task.workItemId,
    };
  }

  private restoreSource(
    source: MediaGovernanceSourceEntity,
    descriptor: MediaGovernanceDescriptorRevisionEntity | null,
  ): MediaGovernanceSource {
    return {
      contentKind: source.contentKind as MediaGovernanceSource['contentKind'],
      descriptorBytes: Number(descriptor?.bytes ?? 0),
      descriptorObjectId: source.descriptorObjectId,
      descriptorRevision: source.descriptorRevision,
      descriptorSha256: source.descriptorSha256,
      descriptorTombstonedAt: descriptor?.tombstonedAt?.toISOString() ?? null,
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
      selectedFileIndices:
        source.selectedFileIndices ??
        (source.manifestProjection as MediaGovernanceSource['manifest']).map(
          (entry) => entry.index,
        ),
      selectedFileMappings:
        (source.selectedFileMappings as MediaGovernanceSource['selectedFileMappings']) ??
        [],
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
      evidenceSha256: unit.evidenceSha256,
      expectedEpisodeNumbers: unit.expectedEpisodeNumbers.map(Number),
      id: unit.id,
      localAcceptedAt: unit.localAcceptedAt?.toISOString() ?? null,
      metadataProjection:
        (unit.metadataProjection as MediaGovernanceUnit['metadataProjection']) ?? {
          missingA: [],
          missingB: [],
          missingC: [],
          repairAttempts: 0,
          validBFallbacks: [],
        },
      seasonNumber: unit.seasonNumber,
      subtitleContract:
        unit.subtitleContract as MediaGovernanceUnit['subtitleContract'],
      unitKind: unit.unitKind as MediaGovernanceUnit['unitKind'],
    };
  }
}
