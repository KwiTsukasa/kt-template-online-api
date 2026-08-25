import type { DeepPartial } from 'typeorm';
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
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import { MediaGovernanceTaskEpisodeBindingEntity } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import { MediaGovernanceTypeOrmStateStore } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';
import { buildMediaGovernanceExecutionEnvelope } from '../../../src/modules/admin/media-governance/contract/media-governance-executor.contract';
import { sha256Json } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';

class MemoryRepository<T extends { id: string }> {
  lastFindOptions: unknown;
  readonly rows = new Map<string, T>();

  create(value: DeepPartial<T>) {
    return value as T;
  }

  async find(options?: unknown) {
    this.lastFindOptions = options;
    return [...this.rows.values()];
  }

  async findOne(options: { where: Partial<T> }) {
    return this.findOneBy(options.where);
  }

  async findOneBy(criteria: Partial<T>) {
    return (
      [...this.rows.values()].find((row) =>
        Object.entries(criteria).every(
          ([key, value]) => row[key as keyof T] === value,
        ),
      ) ?? null
    );
  }

  async delete(criteria: Partial<T>) {
    for (const [id, row] of this.rows) {
      if (
        Object.entries(criteria).every(
          ([key, value]) => row[key as keyof T] === value,
        )
      ) {
        this.rows.delete(id);
      }
    }
  }

  async insert(value: T) {
    if (this.rows.has(value.id)) throw new Error('duplicate');
    this.rows.set(value.id, structuredClone(value));
  }

  async save(value: T | T[]) {
    for (const row of Array.isArray(value) ? value : [value]) {
      this.rows.set(row.id, structuredClone(row));
    }
    return value;
  }
}

describe('MediaGovernanceTypeOrmStateStore', () => {
  it('restores the descriptor revision that exactly matches the current Source object', () => {
    const store = Object.create(
      MediaGovernanceTypeOrmStateStore.prototype,
    ) as MediaGovernanceTypeOrmStateStore;
    const source = {
      contentKind: 'embedded_subtitle_media',
      descriptorObjectId: 'tasks/task/sources/source/revisions/2-current.torrent',
      descriptorRevision: 1,
      descriptorSha256: 'b'.repeat(64),
      id: 'media-source-descriptor-drift',
      infoHash: 'a'.repeat(40),
      manifestProjection: [],
      manifestSha256: null,
      manifestState: 'inspected',
      releaseGroup: 'LoliHouse',
      seasonNumbers: ['S02'],
      selectedBytes: '0',
      selectedFileCount: 0,
      selectedFileIndices: [],
      selectedFileMappings: [],
      sourceHealth: 'viable',
      sourceHealthLabel: '来源可用',
      sourceHealthReason: '来源已产生有效数据，可进入隔离下载',
      sourceRole: 'primary_media',
      taskId: 'media-task-descriptor-drift',
      transportKind: 'torrent',
    } as MediaGovernanceSourceEntity;
    const revisions = [
      {
        active: true,
        bytes: '60',
        id: `${source.id}-descriptor-r1`,
        objectId: 'tasks/task/sources/source/revisions/1-old.magnet',
        revision: 1,
        sha256: 'c'.repeat(64),
        sourceId: source.id,
        tombstonedAt: null,
      },
      {
        active: true,
        bytes: '1024',
        id: `${source.id}-descriptor-r2`,
        objectId: source.descriptorObjectId,
        revision: 2,
        sha256: source.descriptorSha256,
        sourceId: source.id,
        tombstonedAt: null,
      },
    ] as MediaGovernanceDescriptorRevisionEntity[];
    const resolveCurrentDescriptor = Reflect.get(
      store,
      'resolveCurrentDescriptor',
    ).bind(store) as (
      current: MediaGovernanceSourceEntity,
      candidates: MediaGovernanceDescriptorRevisionEntity[],
    ) => MediaGovernanceDescriptorRevisionEntity | null;
    const restoreSource = Reflect.get(store, 'restoreSource').bind(store) as (
      current: MediaGovernanceSourceEntity,
      descriptor: MediaGovernanceDescriptorRevisionEntity | null,
    ) => { descriptorBytes: number; descriptorRevision: number };

    const descriptor = resolveCurrentDescriptor(source, revisions);
    const restored = restoreSource(source, descriptor);

    expect(descriptor?.id).toBe(`${source.id}-descriptor-r2`);
    expect(restored).toMatchObject({
      descriptorBytes: 1024,
      descriptorRevision: 2,
    });
  });

  it('writes Task, Unit, Agent session and event in one transaction projection', async () => {
    const tasks = new MemoryRepository<MediaGovernanceTaskEntity>();
    const units = new MemoryRepository<MediaGovernanceUnitEntity>();
    const sources = new MemoryRepository<MediaGovernanceSourceEntity>();
    const sessions = new MemoryRepository<MediaGovernanceAgentSessionEntity>();
    const events = new MemoryRepository<MediaGovernanceEventEntity>();
    const outbox = new MemoryRepository<MediaGovernanceOutboxEntity>();
    const runs = new MemoryRepository<MediaGovernanceRunEntity>();
    const descriptors =
      new MemoryRepository<MediaGovernanceDescriptorRevisionEntity>();
    const metadataExceptions =
      new MemoryRepository<MediaGovernanceMetadataExceptionEntity>();
    const operatorDecisions =
      new MemoryRepository<MediaGovernanceOperatorDecisionEntity>();
    const taskEpisodeBindings =
      new MemoryRepository<MediaGovernanceTaskEpisodeBindingEntity>();
    const repositories = new Map<unknown, MemoryRepository<{ id: string }>>([
      [MediaGovernanceTaskEntity, tasks],
      [MediaGovernanceUnitEntity, units],
      [MediaGovernanceSourceEntity, sources],
      [MediaGovernanceAgentSessionEntity, sessions],
      [MediaGovernanceEventEntity, events],
      [MediaGovernanceOutboxEntity, outbox],
      [MediaGovernanceRunEntity, runs],
      [MediaGovernanceDescriptorRevisionEntity, descriptors],
      [MediaGovernanceMetadataExceptionEntity, metadataExceptions],
      [MediaGovernanceOperatorDecisionEntity, operatorDecisions],
      [MediaGovernanceTaskEpisodeBindingEntity, taskEpisodeBindings],
    ]);
    const dataSource = {
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work({
          getRepository: (entity: unknown) => repositories.get(entity),
          query: async (sql: string) =>
            sql.includes('GET_LOCK') ? [{ acquired: 1 }] : [{ released: 1 }],
        }),
    };
    const store = new MediaGovernanceTypeOrmStateStore(
      dataSource as never,
      tasks as never,
      units as never,
      sources as never,
      sessions as never,
      descriptors as never,
      events as never,
      outbox as never,
    );
    await store.loadTasks();
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: 'TypeORM 状态仓库测试',
    });
    task.agentSession = {
      capsuleSha256: 'c'.repeat(64),
      checkpointSha256: 'd'.repeat(64),
      currentActionLabel: '正在验证持久化',
      currentUnitId: task.units[0].id,
      lastHeartbeatLabel: '刚刚',
      lastSequence: 7,
      pendingPlanSha256: null,
      policyBoundaryLabel: '五层边界已启用',
      policySha256: 'b'.repeat(64),
      policyVersion: 'media-agent-policy-v1',
      status: 'running',
      statusLabel: 'Agent 正在治理',
      threadId: 'thread-typeorm-store-0001',
    };
    await store.saveTask(task);

    task.workItemId = await store.reserveWorkItemId(task.id);
    expect(task.workItemId).toBe('media-063');
    await expect(store.reserveWorkItemId(task.id)).resolves.toBe('media-063');

    expect(tasks.rows.get(task.id)).toMatchObject({
      metadataStatus: 'pending',
      progressProjection: { percent: 0 },
      revision: 1,
    });
    expect(units.rows.size).toBe(1);
    expect([...sessions.rows.values()][0]).toMatchObject({
      lastSequence: 7,
      taskId: task.id,
      threadId: 'thread-typeorm-store-0001',
    });
    expect(events.rows.size).toBe(0);
    await expect(store.loadTasks()).resolves.toEqual([
      expect.objectContaining({
        agentSession: null,
        id: task.id,
      }),
    ]);

    task.llmConversationId = '2041700000000190001';
    await store.saveTask(task);
    expect(sessions.rows.size).toBe(0);
    expect(tasks.rows.get(task.id)).toMatchObject({
      llmConversationId: '2041700000000190001',
    });
    await expect(store.loadTasks()).resolves.toEqual([
      expect.objectContaining({
        agentSession: null,
        llmConversationId: '2041700000000190001',
      }),
    ]);
    task.agentSession = null;

    const source = await service.addMagnetSource(task.id, {
      contentKind: 'subtitleless_media',
      expectedRevision: task.revision,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    const subtitleSource = await service.addMagnetSource(task.id, {
      contentKind: 'sidecar_subtitle_package',
      expectedRevision: task.revision,
      magnetUri: 'magnet:?xt=urn:btih:89abcdef0123456789abcdef0123456789abcdef',
      seasonNumbers: ['S01'],
      sourceRole: 'supplemental_subtitle',
    });
    const envelope = buildMediaGovernanceExecutionEnvelope({
      action: 'source.download',
      expiresAt: '2099-08-11T12:10:00.000Z',
      inputSnapshotSha256: task.inputSnapshotSha256,
      replayKey: `${task.id}-source-inspect-r${task.revision}`,
      runId: `media-run-${'a'.repeat(40)}`,
      sources: [
        {
          descriptorGrantId: `media-grant-${'a'.repeat(32)}`,
          descriptorRevision: 1,
          descriptorSha256: source.descriptorSha256,
          infoHash: source.infoHash,
          manifestSha256: null,
          selectedBytes: 0,
          selectedFileCount: 0,
          selectedFileIndices: [],
          sourceId: source.id,
          transportKind: 'magnet',
        },
        {
          descriptorGrantId: `media-grant-${'b'.repeat(32)}`,
          descriptorRevision: 1,
          descriptorSha256: subtitleSource.descriptorSha256,
          infoHash: subtitleSource.infoHash,
          manifestSha256: null,
          selectedBytes: 0,
          selectedFileCount: 0,
          selectedFileIndices: [],
          sourceId: subtitleSource.id,
          transportKind: 'magnet',
        },
      ],
      taskId: task.id,
      taskRevision: task.revision,
      unitIds: task.units.map((unit) => unit.id),
    });
    task.activeRunId = envelope.runId;
    await store.reserveRunDispatch(task, envelope);
    await expect(store.pendingRunDispatches()).resolves.toEqual([envelope]);
    expect(outbox.lastFindOptions).toMatchObject({
      take: 32,
      where: {
        attempts: { _type: 'lessThan', _value: 5 },
      },
    });
    await store.acknowledgeRunDispatch(envelope.runId, 'jenkins-queue-1001');
    expect(outbox.rows.get(envelope.runId)).toMatchObject({
      attempts: 1,
      executionId: 'jenkins-queue-1001',
    });
    await expect(
      store.consumeDescriptorGrant({
        descriptorGrantId: envelope.sources[0].descriptorGrantId,
        descriptorSha256: source.descriptorSha256,
        runId: envelope.runId,
        sourceId: source.id,
        taskId: task.id,
      }),
    ).resolves.toEqual({ descriptorObjectId: source.descriptorObjectId });
    await expect(
      store.consumeDescriptorGrant({
        descriptorGrantId: envelope.sources[1].descriptorGrantId,
        descriptorSha256: subtitleSource.descriptorSha256,
        runId: envelope.runId,
        sourceId: subtitleSource.id,
        taskId: task.id,
      }),
    ).resolves.toEqual({
      descriptorObjectId: subtitleSource.descriptorObjectId,
    });
    expect(
      [...events.rows.values()]
        .filter((event) => event.type === 'descriptor-grant-consumed')
        .map((event) => event.runId),
    ).toEqual([null, null]);
    await expect(
      store.consumeDescriptorGrant({
        descriptorGrantId: envelope.sources[0].descriptorGrantId,
        descriptorSha256: source.descriptorSha256,
        runId: envelope.runId,
        sourceId: source.id,
        taskId: task.id,
      }),
    ).rejects.toThrow('duplicate');

    source.descriptorTombstonedAt = '2026-08-11T12:20:00.000Z';
    const cleanupEnvelope = buildMediaGovernanceExecutionEnvelope({
      action: 'source.cleanup',
      expiresAt: '2099-08-11T12:30:00.000Z',
      inputSnapshotSha256: task.inputSnapshotSha256,
      replayKey: `${task.id}:source.cleanup:r${task.revision}`,
      runId: `media-run-${'c'.repeat(40)}`,
      sources: [
        {
          descriptorGrantId: `media-grant-${'c'.repeat(32)}`,
          descriptorRevision: source.descriptorRevision,
          descriptorSha256: source.descriptorSha256,
          infoHash: source.infoHash,
          manifestSha256: source.manifestSha256,
          selectedBytes: source.selectedBytes,
          selectedFileCount: source.selectedFileCount,
          selectedFileIndices: source.selectedFileIndices,
          sourceId: source.id,
          transportKind: source.transportKind,
        },
      ],
      taskId: task.id,
      taskRevision: task.revision,
      unitIds: task.units.map((unit) => unit.id),
    });
    task.activeRunId = cleanupEnvelope.runId;
    await store.reserveRunDispatch(task, cleanupEnvelope);
    expect(sources.rows.has(source.id)).toBe(true);
    expect(
      descriptors.rows.get(
        `${source.id}-descriptor-r${source.descriptorRevision}`,
      )?.tombstonedAt,
    ).toEqual(new Date(source.descriptorTombstonedAt));

    task.sources.splice(task.sources.indexOf(source), 1);
    task.activeRunId = null;
    task.revision += 1;
    task.runState = 'draft';
    task.stage = 'intake';
    await expect(
      store.applyExecutorEvent(task, {
        action: 'source.cleanup',
        eventType: 'run-succeeded',
        evidenceSha256: 'e'.repeat(64),
        observedAt: '2026-08-11T12:21:00.000Z',
        runId: cleanupEnvelope.runId,
        sequence: 1,
        sourceId: source.id,
        summary: '来源运行时已精确清理',
        taskId: task.id,
        taskRevision: cleanupEnvelope.taskRevision,
      }),
    ).resolves.toBe(true);
    expect(sources.rows.has(source.id)).toBe(false);
    expect(sources.rows.has(subtitleSource.id)).toBe(true);
    expect(
      descriptors.rows.get(
        `${source.id}-descriptor-r${source.descriptorRevision}`,
      ),
    ).toMatchObject({ active: false });

    task.sealedPlan = {
      schemaVersion: '1.2.0',
      sealed: true,
      workItemId: 'media-063',
    };
    task.sealedPlanSha256 = sha256Json(task.sealedPlan);
    const planEnvelope = buildMediaGovernanceExecutionEnvelope({
      action: 'governance.execute',
      expiresAt: '2099-08-11T12:10:00.000Z',
      inputSnapshotSha256: task.inputSnapshotSha256,
      plan: {
        planGrantId: 'media-plan-grant-typeorm-0001',
        planSha256: task.sealedPlanSha256,
        schemaVersion: '1.2.0',
        strategy: 'embedded',
      },
      replayKey: `${task.id}:governance:r${task.revision}`,
      runId: `media-run-${'b'.repeat(40)}`,
      taskId: task.id,
      taskRevision: task.revision,
      unitIds: task.units.map((unit) => unit.id),
    });
    task.activeRunId = planEnvelope.runId;
    await store.reserveRunDispatch(task, planEnvelope);
    await store.acknowledgeRunDispatch(
      planEnvelope.runId,
      'jenkins-queue-plan-1001',
    );
    const planGrant = {
      planGrantId: planEnvelope.plan.planGrantId,
      planSha256: planEnvelope.plan.planSha256,
      runId: planEnvelope.runId,
      taskId: task.id,
    };
    await expect(store.consumePlanGrant(planGrant)).resolves.toEqual(
      task.sealedPlan,
    );
    await expect(store.consumePlanGrant(planGrant)).rejects.toThrow(
      'duplicate',
    );

    await metadataExceptions.save({
      id: 'metadata-exception-delete-fixture',
      unitId: task.units[0].id,
    } as MediaGovernanceMetadataExceptionEntity);
    await operatorDecisions.save({
      id: 'operator-decision-delete-fixture',
      taskId: task.id,
    } as MediaGovernanceOperatorDecisionEntity);
    await taskEpisodeBindings.save({
      id: 'media-task-binding-delete-fixture',
      taskId: task.id,
    } as MediaGovernanceTaskEpisodeBindingEntity);
    const persistedSourceIds = new Set(
      [...sources.rows.values()]
        .filter((row) => row.taskId === task.id)
        .map((row) => row.id),
    );

    await expect(
      store.deleteTask({
        expectedRevision: task.revision - 1,
        expectedWorkItemId: 'media-063',
        taskId: task.id,
      }),
    ).rejects.toThrow('identity-mismatch');
    expect(tasks.rows.has(task.id)).toBe(true);

    await expect(
      store.deleteTask({
        expectedRevision: task.revision,
        expectedWorkItemId: 'media-063',
        taskId: task.id,
      }),
    ).resolves.toEqual({ clearedWorkItemId: 'media-063' });
    expect(tasks.rows.has(task.id)).toBe(false);
    expect([...units.rows.values()].some((row) => row.taskId === task.id)).toBe(
      false,
    );
    expect(
      [...sources.rows.values()].some((row) => row.taskId === task.id),
    ).toBe(false);
    expect(
      [...descriptors.rows.values()].some((row) =>
        persistedSourceIds.has(row.sourceId),
      ),
    ).toBe(false);
    expect(
      [...sessions.rows.values()].some((row) => row.taskId === task.id),
    ).toBe(false);
    expect([...runs.rows.values()].some((row) => row.taskId === task.id)).toBe(
      false,
    );
    expect(
      [...events.rows.values()].some((row) => row.taskId === task.id),
    ).toBe(false);
    expect(
      [...outbox.rows.values()].some((row) => row.taskId === task.id),
    ).toBe(false);
    expect(metadataExceptions.rows.size).toBe(0);
    expect(operatorDecisions.rows.size).toBe(0);
    expect(
      [...taskEpisodeBindings.rows.values()].some(
        (row) => row.taskId === task.id,
      ),
    ).toBe(false);

    const replacement = await service.create({
      mediaType: 'movie',
      titleHint: '账本编号复用验证',
    });
    await store.saveTask(replacement);
    await expect(store.reserveWorkItemId(replacement.id)).resolves.toBe(
      'media-063',
    );
    const replacedUnitId = replacement.units[0].id;
    replacement.units = [
      {
        ...replacement.units[0],
        id: 'media-unit-replacement-persistence-test',
      },
    ];
    await store.saveTask(replacement);
    expect(units.rows.has(replacedUnitId)).toBe(false);
    expect(units.rows.has('media-unit-replacement-persistence-test')).toBe(
      true,
    );
  });
});
