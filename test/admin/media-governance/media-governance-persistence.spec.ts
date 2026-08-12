import type { MediaGovernanceAgentEventDto } from '../../../src/modules/admin/media-governance/media-governance.dto';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type { MediaGovernanceCodexAgentGateway } from '../../../src/modules/admin/media-governance/media-governance-codex-agent.gateway';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/media-governance.service';
import type { MediaGovernanceStateStore } from '../../../src/modules/admin/media-governance/media-governance-state.store';

class DurableMemoryStateStore implements MediaGovernanceStateStore {
  private initialized = false;
  private readonly tasks = new Map<string, MediaGovernanceTask>();

  isReady() {
    return this.initialized;
  }

  async loadTasks() {
    this.initialized = true;
    return [...this.tasks.values()].map((task) => structuredClone(task));
  }

  async saveTask(task: MediaGovernanceTask) {
    this.tasks.set(task.id, structuredClone(task));
  }

  async saveTaskWithAgentEvent(
    task: MediaGovernanceTask,
    event: MediaGovernanceAgentEventDto,
  ) {
    void event;
    await this.saveTask(task);
  }
}

describe('media governance database persistence boundary', () => {
  const gatewaySession = {
    capsuleSha256: 'b'.repeat(64),
    checkpointSha256: 'c'.repeat(64),
    currentUnitId: null,
    lastEventSequence: 0,
    lastHeartbeatAt: '2026-08-11T00:00:00.000Z',
    policySha256: 'a'.repeat(64),
    policyVersion: 'media-agent-policy-v1' as const,
    replayed: false,
    status: 'active' as const,
    taskId: '',
    taskRevision: 2,
    terminalKind: null,
    threadId: 'thread-durable-media-governance-0001',
    turnId: 'turn-durable-media-governance-0001',
  };

  it('restores the same Task/thread and agent sequence after service reconstruction', async () => {
    const store = new DurableMemoryStateStore();
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session: async (taskId) => ({ ...gatewaySession, taskId }),
      startTurn: async (request) => {
        const policy = buildMediaCodexAgentPolicy(request.taskId);
        const capsule = buildMediaCodexAgentCapsule(request, policy);
        return {
          ...gatewaySession,
          capsuleSha256: capsule.capsuleSha256,
          currentUnitId: request.currentUnitId,
          policySha256: policy.policySha256,
          policyVersion: policy.policyVersion,
          taskId: request.taskId,
          taskRevision: request.taskRevision,
        };
      },
    };
    const first = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    await first.onModuleInit();
    expect(first.agentCallbackHealth()).toEqual({
      persistenceMode: 'database',
      status: 'ready',
    });

    const task = await first.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '持久化恢复测试',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'requires-agent';
    const session = await first.startAgent(task.id, { expectedRevision: 1 });
    const event: MediaGovernanceAgentEventDto = {
      capsuleSha256: session!.capsuleSha256,
      eventId: 'event-durable-media-governance-0001',
      observedAt: '2026-08-11T00:00:01.000Z',
      policySha256: session!.policySha256,
      sequence: 1,
      status: 'active',
      summary: '正在核对季级字幕合同',
      taskId: task.id,
      taskRevision: 2,
      threadId: session!.threadId,
      turnId: 'turn-durable-media-governance-0001',
      type: 'agent-heartbeat',
    };
    await expect(first.applyAgentEvent(event)).resolves.toEqual({
      applied: true,
      revision: 2,
    });

    const resumed = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    await resumed.onModuleInit();
    expect(resumed.detail(task.id)).toMatchObject({
      agentSession: {
        lastSequence: 1,
        threadId: session!.threadId,
      },
      id: task.id,
      persistenceMode: 'database',
      revision: 2,
    });
    await expect(resumed.applyAgentEvent(event)).resolves.toEqual({
      applied: false,
      reason: 'duplicate-sequence',
    });
  });

  it('persists a reservation before the gateway can publish its first callbacks', async () => {
    const store = new DurableMemoryStateStore();
    const startTurn = jest.fn(async (request) => {
      const policy = buildMediaCodexAgentPolicy(request.taskId);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      const commonEvent = {
        capsuleSha256: capsule.capsuleSha256,
        observedAt: '2026-08-11T00:00:00.000Z',
        policySha256: policy.policySha256,
        status: 'active' as const,
        taskId: request.taskId,
        taskRevision: request.taskRevision,
        threadId: 'thread-callback-before-response-0001',
        turnId: 'turn-callback-before-response-0001',
      };
      await service.applyAgentEvent({
        ...commonEvent,
        eventId: 'event-callback-before-response-0001',
        sequence: 1,
        summary: 'Agent 会话已绑定',
        type: 'agent-thread-mapped',
      });
      await service.applyAgentEvent({
        ...commonEvent,
        eventId: 'event-callback-before-response-0002',
        sequence: 2,
        summary: 'Agent 正在核对当前治理单元',
        type: 'agent-turn-started',
      });
      return {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: 'd'.repeat(64),
        currentUnitId: request.currentUnitId,
        lastEventSequence: 2,
        lastHeartbeatAt: '2026-08-11T00:00:00.000Z',
        policySha256: policy.policySha256,
        policyVersion: policy.policyVersion,
        replayed: false,
        status: 'active' as const,
        taskId: request.taskId,
        taskRevision: request.taskRevision,
        terminalKind: null,
        threadId: commonEvent.threadId,
        turnId: commonEvent.turnId,
      };
    });
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session: jest.fn(async () => null),
      startTurn,
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '回调竞态测试',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'requires-agent';

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).resolves.toMatchObject({
      lastSequence: 2,
      status: 'running',
      threadId: 'thread-callback-before-response-0001',
    });
    expect(startTurn).toHaveBeenCalledTimes(1);

    const resumed = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    await resumed.onModuleInit();
    expect(resumed.detail(task.id)).toMatchObject({
      agentSession: {
        lastSequence: 2,
        threadId: 'thread-callback-before-response-0001',
      },
      revision: 2,
    });
  });

  it('does not call the gateway when the starting reservation cannot persist', async () => {
    const store = new DurableMemoryStateStore();
    await store.loadTasks();
    const startTurn = jest.fn();
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session: jest.fn(async () => null),
      startTurn,
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '预留失败测试',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'requires-agent';
    const saveTask = jest
      .spyOn(store, 'saveTask')
      .mockRejectedValueOnce(new Error('database-unavailable'));

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({
      response: { msg: '媒体治理数据库持久化暂不可用' },
      status: 503,
    });
    expect(startTurn).not.toHaveBeenCalled();
    expect(saveTask).toHaveBeenCalledTimes(1);
  });

  it('reconciles the persisted reservation when start response delivery fails', async () => {
    const store = new DurableMemoryStateStore();
    let requested: Parameters<MediaGovernanceCodexAgentGateway['startTurn']>[0];
    const session = jest.fn(async () => {
      const policy = buildMediaCodexAgentPolicy(requested.taskId);
      const capsule = buildMediaCodexAgentCapsule(requested, policy);
      return {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: 'e'.repeat(64),
        currentUnitId: requested.currentUnitId,
        lastEventSequence: 2,
        lastHeartbeatAt: '2026-08-11T00:00:02.000Z',
        policySha256: policy.policySha256,
        policyVersion: policy.policyVersion,
        replayed: true,
        status: 'active' as const,
        taskId: requested.taskId,
        taskRevision: requested.taskRevision,
        terminalKind: null,
        threadId: 'thread-recovered-after-timeout-0001',
        turnId: 'turn-recovered-after-timeout-0001',
      };
    });
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session,
      startTurn: jest.fn(async (request) => {
        requested = request;
        throw new Error('response-timeout');
      }),
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      gateway,
      store,
    );
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '超时恢复测试',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'requires-agent';

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).resolves.toMatchObject({
      lastSequence: 2,
      threadId: 'thread-recovered-after-timeout-0001',
    });
    expect(session).toHaveBeenCalledWith(task.id);
  });
});
