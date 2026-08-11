import type { DeepPartial } from 'typeorm';
import {
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '../../../src/modules/admin/media-governance/media-governance.entities';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';
import { MediaGovernanceTypeOrmStateStore } from '../../../src/modules/admin/media-governance/media-governance-state.store';

class MemoryRepository<T extends { id: string }> {
  readonly rows = new Map<string, T>();

  create(value: DeepPartial<T>) {
    return value as T;
  }

  async find() {
    return [...this.rows.values()];
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
    const repositories = new Map<unknown, MemoryRepository<{ id: string }>>([
      [MediaGovernanceTaskEntity, tasks],
      [MediaGovernanceUnitEntity, units],
      [MediaGovernanceSourceEntity, sources],
      [MediaGovernanceAgentSessionEntity, sessions],
      [MediaGovernanceEventEntity, events],
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
  });
});
