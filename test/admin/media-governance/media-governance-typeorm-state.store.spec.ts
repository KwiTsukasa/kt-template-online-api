import type { DeepPartial } from 'typeorm';
import {
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceOutboxEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '../../../src/modules/admin/media-governance/media-governance.entities';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';
import { MediaGovernanceTypeOrmStateStore } from '../../../src/modules/admin/media-governance/media-governance-state.store';
import { buildMediaGovernanceExecutionEnvelope } from '../../../src/modules/admin/media-governance/media-governance-executor.contract';
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
    const repositories = new Map<unknown, MemoryRepository<{ id: string }>>([
      [MediaGovernanceTaskEntity, tasks],
      [MediaGovernanceUnitEntity, units],
      [MediaGovernanceSourceEntity, sources],
      [MediaGovernanceAgentSessionEntity, sessions],
      [MediaGovernanceEventEntity, events],
      [MediaGovernanceOutboxEntity, outbox],
      [MediaGovernanceRunEntity, runs],
      [MediaGovernanceDescriptorRevisionEntity, descriptors],
    ]);
    const dataSource = {
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work({
          getRepository: (entity: unknown) => repositories.get(entity),
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
    await store.saveTaskWithAgentEvent(task, {
      capsuleSha256: task.agentSession.capsuleSha256,
      eventId: 'event-typeorm-store-0001',
      observedAt: '2026-08-11T00:00:07.000Z',
      policySha256: task.agentSession.policySha256,
      sequence: 7,
      status: 'active',
      summary: '正在验证持久化',
      taskId: task.id,
      taskRevision: 1,
      threadId: task.agentSession.threadId,
      turnId: 'turn-typeorm-store-0001',
      type: 'agent-heartbeat',
    });

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
    expect([...events.rows.values()][0]).toMatchObject({
      eventId: 'event-typeorm-store-0001',
      sequence: 7,
      taskId: task.id,
    });
    await expect(store.loadTasks()).resolves.toEqual([
      expect.objectContaining({
        agentSession: expect.objectContaining({
          lastSequence: 7,
          threadId: 'thread-typeorm-store-0001',
        }),
        id: task.id,
      }),
    ]);

    task.agentSession = null;
    await store.saveTask(task);
    expect(sessions.rows.size).toBe(0);

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
  });
});
