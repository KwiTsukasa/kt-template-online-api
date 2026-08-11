import { HttpException } from '@nestjs/common';
import { MEDIA_CODEX_AGENT_POLICY_VERSION } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type { MediaGovernanceCodexAgentGateway } from '../../../src/modules/admin/media-governance/media-governance-codex-agent.gateway';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

describe('MediaGovernanceService CodexAgent gateway adapter', () => {
  async function fixture() {
    const startTurn = jest.fn(async (request) => {
      const policy = buildMediaCodexAgentPolicy(request.taskId);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      return {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: 'd'.repeat(64),
        currentUnitId: request.currentUnitId,
        lastEventSequence: 0,
        lastHeartbeatAt: '2026-08-11T00:00:00.000Z',
        policySha256: policy.policySha256,
        policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
        replayed: false,
        status: 'active' as const,
        taskId: request.taskId,
        taskRevision: request.taskRevision,
        threadId: 'thread-media-agent-001',
        turnId: 'turn-media-agent-001',
      };
    });
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session: jest.fn(async () => null),
      startTurn,
    };
    const service = new MediaGovernanceService(undefined, undefined, gateway);
    const task = await service.create({
      mediaType: 'tv',
      providerRef: { provider: 'tmdb', providerId: '105476' },
      seasonNumbers: ['S01'],
      titleHint: 'Agent 网关测试作品',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'requires-agent';
    task.runState = 'blocked';
    task.stage = 'metadata';
    return { gateway, service, startTurn, task };
  }

  it('binds one revision to one gateway turn and seals a task-local plan', async () => {
    const { service, startTurn, task } = await fixture();
    const previousManifestSha256 = task.inputSnapshotSha256;

    const session = await service.startAgent(task.id, { expectedRevision: 1 });
    const request = startTurn.mock.calls[0]?.[0];

    expect(request).toMatchObject({
      currentStage: 'metadata',
      replayKey: `${task.id}-agent-r2`,
      taskId: task.id,
      taskRevision: 2,
    });
    expect(request?.compactContext).toMatchObject({
      boundaries: {
        cloudGate: false,
        databaseWrite: false,
        formalMediaWrite: false,
      },
      unitCount: 1,
    });
    expect(task.inputSnapshotSha256).toBe(request?.manifestSha256);
    expect(task.inputSnapshotSha256).not.toBe(previousManifestSha256);
    expect(session).toMatchObject({
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      status: 'running',
      threadId: 'thread-media-agent-001',
    });

    const identity = await service.agentToolCall({
      arguments: {},
      capsuleSha256: session!.capsuleSha256,
      manifestSha256: task.inputSnapshotSha256,
      policySha256: session!.policySha256,
      taskId: task.id,
      taskRevision: 2,
      tool: 'media.identity.read',
    });
    expect(identity).toMatchObject({
      providerRef: { provider: 'tmdb', providerId: '105476' },
      taskId: task.id,
    });

    const sealed = await service.agentToolCall({
      arguments: {
        operations: [
          {
            action: 'write-nfo',
            targetPath: `/vol2/1000/.kt-media-governance-staging/${task.id}/work/tvshow.nfo`,
          },
        ],
        replayKey: `${task.id}-agent-r2`,
        summary: '已核对身份并生成任务内 NFO 计划',
      },
      capsuleSha256: session!.capsuleSha256,
      manifestSha256: task.inputSnapshotSha256,
      policySha256: session!.policySha256,
      taskId: task.id,
      taskRevision: 2,
      tool: 'plan.submit.sealed',
    });
    expect(sealed).toMatchObject({
      accepted: true,
      writeBoundaries: { cloud: 0, database: 0, formalMedia: 0 },
    });

    const completed = {
      capsuleSha256: session!.capsuleSha256,
      eventId: 'media-agent-event-complete-001',
      observedAt: '2026-08-11T00:00:01.000Z',
      policySha256: session!.policySha256,
      sequence: 1,
      status: 'blocked' as const,
      summary: 'Agent 回合已完成，等待密封结果验收',
      taskId: task.id,
      taskRevision: 2,
      threadId: 'thread-media-agent-001',
      turnId: 'turn-media-agent-001',
      type: 'agent-turn-completed' as const,
    };
    await expect(service.applyAgentEvent(completed)).resolves.toEqual({
      applied: true,
      revision: 3,
    });
    expect(task).toMatchObject({
      revision: 3,
      runState: 'blocked',
      sealedPlanSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(service.applyAgentEvent(completed)).resolves.toEqual({
      applied: false,
      reason: 'duplicate-sequence',
    });
  });

  it('rejects replay drift and paths outside the task staging root', async () => {
    const { service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    const base = {
      capsuleSha256: task.agentSession!.capsuleSha256,
      manifestSha256: task.inputSnapshotSha256,
      policySha256: task.agentSession!.policySha256,
      taskId: task.id,
      taskRevision: 2,
      tool: 'plan.submit.sealed' as const,
    };

    await expect(
      service.agentToolCall({
        ...base,
        arguments: {
          operations: [
            {
              action: 'write-nfo',
              targetPath: `/vol2/1000/.kt-media-governance-staging/${task.id}/work/tvshow.nfo`,
            },
          ],
          replayKey: `${task.id}-agent-r99`,
          summary: '错误重放键',
        },
      }),
    ).rejects.toThrow(HttpException);

    await expect(
      service.agentToolCall({
        ...base,
        arguments: {
          operations: [
            {
              action: 'write-nfo',
              targetPath: '/vol2/1000/Media/TV/outside/tvshow.nfo',
            },
          ],
          replayKey: `${task.id}-agent-r2`,
          summary: '错误越界路径',
        },
      }),
    ).rejects.toThrow(HttpException);
    expect(task.sealedPlanSha256).toBeNull();
  });

  it('refreshes the semantic projection from the persisted gateway session', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    (gateway.session as jest.Mock).mockResolvedValue({
      capsuleSha256: task.agentSession!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      currentUnitId: task.units[0]?.id ?? null,
      lastEventSequence: 3,
      lastHeartbeatAt: '2026-08-11T00:00:03.000Z',
      policySha256: task.agentSession!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      status: 'blocked',
      taskId: task.id,
      taskRevision: 2,
      threadId: 'thread-media-agent-001',
      turnId: 'turn-media-agent-001',
    });

    await expect(service.agentSession(task.id)).resolves.toMatchObject({
      checkpointSha256: 'e'.repeat(64),
      lastSequence: 3,
      status: 'needs-operator',
      threadId: 'thread-media-agent-001',
    });
  });

  it('seals a pending Agent plan exactly once when refresh observes a completed turn', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    await service.agentToolCall({
      arguments: {
        operations: [
          {
            action: 'write-nfo',
            targetPath: `/vol2/1000/.kt-media-governance-staging/${task.id}/work/tvshow.nfo`,
          },
        ],
        replayKey: `${task.id}-agent-r2`,
        summary: '提交恢复测试计划',
      },
      capsuleSha256: task.agentSession!.capsuleSha256,
      manifestSha256: task.inputSnapshotSha256,
      policySha256: task.agentSession!.policySha256,
      taskId: task.id,
      taskRevision: 2,
      tool: 'plan.submit.sealed',
    });
    (gateway.session as jest.Mock).mockResolvedValue({
      capsuleSha256: task.agentSession!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      currentUnitId: task.units[0]?.id ?? null,
      lastEventSequence: 3,
      lastHeartbeatAt: '2026-08-11T00:00:03.000Z',
      policySha256: task.agentSession!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      status: 'blocked',
      taskId: task.id,
      taskRevision: 2,
      threadId: 'thread-media-agent-001',
      turnId: 'turn-media-agent-001',
    });

    const first = await service.agentSession(task.id);
    expect(first).toMatchObject({
      pendingPlanSha256: null,
      status: 'needs-operator',
      statusLabel: '密封计划待执行器接入',
    });
    expect(task.revision).toBe(3);
    expect(task.sealedPlanSha256).toMatch(/^[a-f0-9]{64}$/);

    await service.agentSession(task.id);
    expect(task.revision).toBe(3);
  });
});
