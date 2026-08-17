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
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import {
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceMetadataExceptionEntity,
  MediaGovernanceOperatorDecisionEntity,
  MediaGovernanceOutboxEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from './media-governance.entities';
import type { MediaGovernanceExecutionEnvelope } from '@/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import type {
  MediaGovernanceSource,
  MediaGovernanceTask,
  MediaGovernanceUnit,
} from '@/modules/admin/media-governance/application/media-governance.service';

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
  deleteTask?(input: {
    expectedRevision: number;
    expectedWorkItemId: null | string;
    taskId: string;
  }): Promise<{ clearedWorkItemId: null | string }>;
  isReady(): boolean;
  loadTasks(): Promise<MediaGovernanceStoredTask[]>;
  pendingRunDispatches?(): Promise<MediaGovernanceExecutionEnvelope[]>;
  recordRunDispatchFailure?(runId: string): Promise<number>;
  readRunEnvelope?(
    runId: string,
  ): Promise<MediaGovernanceExecutionEnvelope | null>;
  readRunSequence?(runId: string): Promise<number>;
  saveExecutorProgressSnapshot?(
    task: MediaGovernanceTask,
    event: MediaGovernanceExecutorEventDto,
  ): Promise<void>;
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

  /** 返回状态存储是否已成功完成初始化读取。 */
  isReady() {
    return this.ready;
  }

  /** 并行读取任务关联实体并恢复为内存治理任务。 */
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

  /** 在单个数据库事务中保存任务及全部关联投影。 */
  async saveTask(task: MediaGovernanceTask) {
    this.assertReady();
    await this.dataSource.transaction((manager) =>
      this.saveTaskWithManager(manager, task),
    );
  }

  /** 校验任务版本和工作项身份后事务性删除完整任务账本。 */
  async deleteTask(input: {
    expectedRevision: number;
    expectedWorkItemId: null | string;
    taskId: string;
  }) {
    this.assertReady();
    return this.dataSource.transaction(async (manager) => {
      const taskRepository = manager.getRepository(MediaGovernanceTaskEntity);
      const unitRepository = manager.getRepository(MediaGovernanceUnitEntity);
      const sourceRepository = manager.getRepository(
        MediaGovernanceSourceEntity,
      );
      const task = await taskRepository.findOneBy({ id: input.taskId });
      if (!task) throw new Error('media-governance-task-not-found');
      if (
        task.revision !== input.expectedRevision ||
        task.workItemId !== input.expectedWorkItemId
      ) {
        throw new Error('media-governance-task-delete-identity-mismatch');
      }

      const units = (
        await unitRepository.find({ where: { taskId: input.taskId } })
      ).filter((unit) => unit.taskId === input.taskId);
      const sources = (
        await sourceRepository.find({ where: { taskId: input.taskId } })
      ).filter((source) => source.taskId === input.taskId);
      const metadataExceptionRepository = manager.getRepository(
        MediaGovernanceMetadataExceptionEntity,
      );
      for (const unit of units) {
        await metadataExceptionRepository.delete({ unitId: unit.id });
      }
      const descriptorRepository = manager.getRepository(
        MediaGovernanceDescriptorRevisionEntity,
      );
      for (const source of sources) {
        await descriptorRepository.delete({ sourceId: source.id });
      }

      await manager
        .getRepository(MediaGovernanceOperatorDecisionEntity)
        .delete({ taskId: input.taskId });
      await manager
        .getRepository(MediaGovernanceAgentSessionEntity)
        .delete({ taskId: input.taskId });
      await manager
        .getRepository(MediaGovernanceOutboxEntity)
        .delete({ taskId: input.taskId });
      await manager
        .getRepository(MediaGovernanceEventEntity)
        .delete({ taskId: input.taskId });
      await manager
        .getRepository(MediaGovernanceRunEntity)
        .delete({ taskId: input.taskId });
      await sourceRepository.delete({ taskId: input.taskId });
      await unitRepository.delete({ taskId: input.taskId });
      await taskRepository.delete({ id: input.taskId });
      return { clearedWorkItemId: task.workItemId };
    });
  }

  /** 在保存任务的同一事务中追加 Agent 语义事件。 */
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

  /** 在数据库互斥锁内为任务分配全局唯一工作项编号。 */
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
            if (match) return Math.max(highest, Number(match[1]));
            return highest;
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

  /** 校验运行信封身份，并原子保存任务、运行与发件箱预留。 */
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

  /** 读取尚未确认且未耗尽重试次数的密封运行信封。 */
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

  /** 按运行标识读取并验证密封执行信封。 */
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

  /** 记录一次派发失败并释放发件箱租约。 */
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

  /** 在重试耗尽后原子标记派发和运行失败。 */
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

  /** 确认执行器已接管运行，并原子更新发件箱与运行状态。 */
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

  /** 合并事件账本与进度快照，返回已持久化的最大运行序号。 */
  async readRunSequence(runId: string) {
    this.assertReady();
    const [event, run] = await Promise.all([
      this.eventRepository.findOne({
        order: { sequence: 'DESC' },
        where: { runId },
      }),
      this.dataSource
        .getRepository(MediaGovernanceRunEntity)
        .findOneBy({ id: runId }),
    ]);
    const snapshotSequence = Number(run?.progress?.eventSequence ?? 0);
    let safeSnapshotSequence = 0;
    if (Number.isSafeInteger(snapshotSequence)) {
      safeSnapshotSequence = snapshotSequence;
    }
    return Math.max(event?.sequence ?? 0, safeSnapshotSequence);
  }

  /** 在运行锁内持久化高频进度快照，并忽略陈旧序号。 */
  async saveExecutorProgressSnapshot(
    task: MediaGovernanceTask,
    event: MediaGovernanceExecutorEventDto,
  ) {
    this.assertReady();
    await this.dataSource.transaction(async (manager) => {
      const runRepository = manager.getRepository(MediaGovernanceRunEntity);
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
      const currentSequence = Number(run.progress?.eventSequence ?? 0);
      if (
        Number.isSafeInteger(currentSequence) &&
        currentSequence >= event.sequence
      ) {
        return;
      }
      await this.saveTaskWithManager(manager, task);
      let progress = run.progress;
      if (event.progress) progress = { ...event.progress };
      run.progress = {
        ...progress,
        eventSequence: event.sequence,
      };
      await runRepository.save(run);
    });
  }

  /** 幂等应用执行器事件，并在同一事务中更新任务、运行和事件账本。 */
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
      run.status = 'running';
      if (event.eventType === 'run-succeeded') {
        run.status = 'succeeded';
      } else if (event.eventType === 'run-failed') {
        run.status = 'failed';
      } else if (event.eventType === 'run-paused') {
        run.status = 'paused';
      }
      let progress = run.progress;
      if (event.progress) progress = { ...event.progress };
      run.progress = {
        ...progress,
        eventSequence: event.sequence,
      };
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

  /** 单次消费与运行绑定的描述符授权，并返回私有对象引用。 */
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
      if (!outbox || !outbox.executionId || !sourceContract || !envelope) {
        throw new Error('media-governance-descriptor-grant-invalid');
      }
      if (
        envelope.expiresAt < new Date().toISOString() ||
        envelope.taskId !== input.taskId ||
        sourceContract.descriptorGrantId !== input.descriptorGrantId
      ) {
        throw new Error('media-governance-descriptor-grant-invalid');
      }
      if (sourceContract.descriptorSha256 !== input.descriptorSha256) {
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

  /** 单次消费与运行绑定的治理计划授权，并返回密封计划副本。 */
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
      if (!outbox || !outbox.executionId || !task || !task.sealedPlan) {
        throw new Error('media-governance-plan-grant-invalid');
      }
      if (!envelope?.plan || envelope.expiresAt < new Date().toISOString()) {
        throw new Error('media-governance-plan-grant-invalid');
      }
      if (
        ![
          'acceptance.verify',
          'governance.execute',
          'metadata.repair',
          'metadata.verify',
        ].includes(envelope.action) ||
        envelope.taskId !== input.taskId
      ) {
        throw new Error('media-governance-plan-grant-invalid');
      }
      if (
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

  /** 将描述符修订标记为墓碑，并幂等返回墓碑时间。 */
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

  /** 在任何数据库操作前确保状态存储已完成初始化。 */
  private assertReady() {
    if (!this.ready) {
      throw new Error('media-governance-state-store-not-ready');
    }
  }

  /** 使用给定事务管理器同步任务及全部关联实体。 */
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
    let closedAt = null;
    if (task.closedAt) closedAt = new Date(task.closedAt);
    await taskRepository.save(
      taskRepository.create({
        activeRunId: task.activeRunId,
        closedAt,
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
    const declaredUnitIds = new Set(task.units.map((unit) => unit.id));
    const persistedUnits = (
      await unitRepository.find({ where: { taskId: task.id } })
    ).filter((unit) => unit.taskId === task.id);
    const staleUnits = persistedUnits.filter(
      (unit) => !declaredUnitIds.has(unit.id),
    );
    for (const unit of staleUnits) {
      await manager
        .getRepository(MediaGovernanceMetadataExceptionEntity)
        .delete({ unitId: unit.id });
      await manager
        .getRepository(MediaGovernanceOperatorDecisionEntity)
        .delete({ taskId: task.id, unitId: unit.id });
      await unitRepository.delete({ id: unit.id });
    }
    if (task.units.length > 0) {
      await unitRepository.save(
        task.units.map((unit) => {
          let localAcceptedAt = null;
          if (unit.localAcceptedAt) {
            localAcceptedAt = new Date(unit.localAcceptedAt);
          }
          return unitRepository.create({
            evidenceSha256: unit.evidenceSha256,
            expectedEpisodeNumbers: unit.expectedEpisodeNumbers.map(String),
            id: unit.id,
            localAcceptedAt,
            metadataProjection: unit.metadataProjection,
            seasonNumber: unit.seasonNumber,
            subtitleContract: unit.subtitleContract,
            taskId: task.id,
            unitKind: unit.unitKind,
          });
        }),
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
        task.sources.map((source) => {
          let tombstonedAt = null;
          if (source.descriptorTombstonedAt) {
            tombstonedAt = new Date(source.descriptorTombstonedAt);
          }
          return descriptorRepository.create({
            active: source.descriptorTombstonedAt === null,
            bytes: String(source.descriptorBytes),
            id: `${source.id}-descriptor-r${source.descriptorRevision}`,
            infoHash: source.infoHash || null,
            manifestSha256: source.manifestSha256,
            objectId: source.descriptorObjectId,
            revision: source.descriptorRevision,
            sha256: source.descriptorSha256,
            sourceId: source.id,
            tombstonedAt,
          });
        }),
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

  /** 将任务实体及关联实体恢复为内存治理任务投影。 */
  private restoreTask(
    task: MediaGovernanceTaskEntity,
    units: MediaGovernanceUnitEntity[],
    sources: MediaGovernanceSourceEntity[],
    session: MediaGovernanceAgentSessionEntity | null,
    descriptors: MediaGovernanceDescriptorRevisionEntity[],
  ): MediaGovernanceStoredTask {
    let agentSession: MediaGovernanceTask['agentSession'] = null;
    if (session) {
      agentSession = {
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
      };
    }
    let closedMode = task.closedMode as MediaGovernanceTask['closedMode'];
    const closedModeMissing = closedMode === null || closedMode === undefined;
    if (closedModeMissing && task.stage === 'closed') {
      closedMode = 'automatic';
      if (session?.status === 'succeeded') closedMode = 'agent_verified';
    }
    return {
      agentSession,
      activeRunId: task.activeRunId,
      closedAt: task.closedAt?.toISOString() ?? null,
      closedMode,
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
      progress: {
        ...(task.progressProjection as MediaGovernanceTask['progress']),
        observedAt:
          (task.progressProjection as Partial<MediaGovernanceTask['progress']>)
            .observedAt ??
          task.updateTime?.toISOString?.() ??
          null,
      },
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

  /** 将来源实体与描述符修订恢复为领域来源。 */
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

  /** 将治理单元实体恢复为领域单元，并补齐旧数据默认投影。 */
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
