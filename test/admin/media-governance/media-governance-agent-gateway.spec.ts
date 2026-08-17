import { HttpException } from '@nestjs/common';
import {
  MEDIA_CODEX_AGENT_POLICY_VERSION,
  sha256Json,
} from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  buildMediaCodexAgentCapsule,
  buildMediaCodexAgentPolicy,
} from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';
import type { MediaGovernanceCodexAgentGateway } from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-codex-agent.gateway';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceService CodexAgent gateway adapter', () => {
  afterEach(() => jest.restoreAllMocks());

  async function fixture(
    options: {
      eventStream?: MediaGovernanceEventStreamService;
      prepareMetadataStage?: boolean;
    } = {},
  ) {
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
        result: null,
        status: 'active' as const,
        taskId: request.taskId,
        taskRevision: request.taskRevision,
        terminalKind: null,
        threadId: 'thread-media-agent-001',
        turnId: 'turn-media-agent-001',
      };
    });
    const gateway: MediaGovernanceCodexAgentGateway = {
      enabled: () => true,
      session: jest.fn(async () => null),
      startTurn,
    };
    const service = new MediaGovernanceService(
      options.eventStream,
      undefined,
      gateway,
    );
    const task = await service.create({
      mediaType: 'tv',
      providerRef: { provider: 'tmdb', providerId: '105476' },
      seasonNumbers: ['S01'],
      titleHint: 'Agent 网关测试作品',
    });
    if (options.prepareMetadataStage !== false) {
      task.governanceProfile = 'embedded';
      task.metadataStatus = 'requires-agent';
      task.runState = 'blocked';
      task.stage = 'metadata';
    }
    return { gateway, service, startTurn, task };
  }

  it('starts a read-only Agent turn from an intake draft without a governance profile', async () => {
    const { service, startTurn, task } = await fixture({
      prepareMetadataStage: false,
    });

    const session = await service.startAgent(task.id, { expectedRevision: 1 });
    const request = startTurn.mock.calls[0]?.[0];

    expect(request).toMatchObject({
      currentStage: 'intake',
      replayKey: `${task.id}-agent-r2`,
      taskRevision: 2,
    });
    expect(request?.compactContext).toMatchObject({
      workflow: {
        activeRun: false,
        hasGovernanceProfile: false,
        hasSealedPlan: false,
        runState: 'draft',
        stage: 'intake',
      },
    });
    expect(request?.operatorCommand).toContain(
      '缺少治理类型、来源或清单时语义化列出缺口',
    );
    await expect(
      service.agentToolCall({
        arguments: {},
        capsuleSha256: session!.capsuleSha256,
        manifestSha256: task.inputSnapshotSha256,
        policySha256: session!.policySha256,
        taskId: task.id,
        taskRevision: 2,
        tool: 'media.identity.read',
      }),
    ).resolves.toMatchObject({ taskId: task.id });
  });

  it.each([
    ['intake', '接收资料阶段只核对作品名'],
    ['download', 'NAS 下载阶段只核对来源健康'],
    ['governance', '本地治理阶段核对身份'],
    ['metadata', '元数据阶段按 A/B/C 三档核对缺口'],
    ['acceptance', '独立验收阶段只解释现有证据'],
  ] as const)(
    'binds the %s stage to its trusted operator pre-prompt',
    async (stage, expectedInstruction) => {
      const { service, startTurn, task } = await fixture({
        prepareMetadataStage: false,
      });
      task.stage = stage;

      await service.startAgent(task.id, { expectedRevision: 1 });

      expect(startTurn.mock.calls[0]?.[0]).toMatchObject({
        currentStage: stage,
      });
      expect(startTurn.mock.calls[0]?.[0].operatorCommand).toContain(
        expectedInstruction,
      );
    },
  );

  it('keeps an active media run immutable while Agent works as a sidecar', async () => {
    const { service, startTurn, task } = await fixture({
      prepareMetadataStage: false,
    });
    task.activeRunId = 'media-run-active-download-001';
    task.runState = 'running';
    task.stage = 'download';
    const inputSnapshotSha256 = task.inputSnapshotSha256;
    const nextCommandLabel = task.nextCommandLabel;

    const session = await service.startAgent(task.id, { expectedRevision: 1 });

    expect(startTurn.mock.calls[0]?.[0]).toMatchObject({
      currentStage: 'download',
      manifestSha256: inputSnapshotSha256,
      taskRevision: 1,
    });
    expect(startTurn.mock.calls[0]?.[0].replayKey).toMatch(
      new RegExp(`^${task.id}-agent-a[a-f0-9]{12}$`),
    );
    expect(task).toMatchObject({
      activeRunId: 'media-run-active-download-001',
      inputSnapshotSha256,
      nextCommandLabel,
      revision: 1,
      runState: 'running',
      stage: 'download',
    });

    await service.applyAgentEvent({
      capsuleSha256: session!.capsuleSha256,
      eventId: 'media-agent-event-sidecar-blocked-001',
      observedAt: '2026-08-11T00:00:01.000Z',
      planSha256: null,
      policySha256: session!.policySha256,
      sequence: 1,
      status: 'blocked',
      summary: '旁路核对缺少下载清单事实',
      taskId: task.id,
      taskRevision: 1,
      threadId: session!.threadId,
      turnId: 'turn-media-agent-001',
      type: 'agent-blocked',
    });
    expect(task).toMatchObject({
      activeRunId: 'media-run-active-download-001',
      nextCommandLabel,
      revision: 1,
      runState: 'running',
      stage: 'download',
    });
    expect(task.agentSession).toMatchObject({ status: 'failed' });
  });

  it('publishes the same-revision Task patch after a conversation-only reply', async () => {
    const eventStream = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
    });
    const { service, task } = await fixture({ eventStream });
    const session = await service.startAgent(task.id, { expectedRevision: 1 });
    const events: any[] = [];
    const subscription = eventStream
      .stream()
      .subscribe((event) => events.push(event));

    await service.applyAgentConversationEvent({
      capsuleSha256: session!.capsuleSha256,
      changeType: 'turn-completed',
      content: '当前任务可以继续治理',
      conversationRevision: 2,
      eventSequence: 100,
      messageId: 'media-agent-message-001',
      observedAt: '2026-08-17T10:00:00.000Z',
      phase: 'final_answer',
      policySha256: session!.policySha256,
      result: {
        candidateSummaries: [],
        candidates: [],
        nextActionLabel: '等待下一条消息',
        planSha256: null,
        status: 'conversation-response',
        summary: '当前任务可以继续治理',
      },
      role: 'assistant',
      status: 'completed',
      taskId: task.id,
      taskRevision: task.revision,
      threadId: session!.threadId,
      turnId: 'turn-media-agent-001',
    });

    expect(events.map((event) => event.type)).toEqual([
      'agent-conversation-changed',
      'task-changed',
    ]);
    expect(events[1]).toMatchObject({
      data: {
        patchMode: 'full',
        revision: task.revision,
        task: {
          agentSession: {
            currentActionLabel: '当前任务可以继续治理',
            statusLabel: 'Agent 已回复，可继续对话',
          },
        },
        taskId: task.id,
      },
    });
    subscription.unsubscribe();
  });

  it('refreshes authority once before continuing the same Agent thread', async () => {
    const { gateway, service, startTurn, task } = await fixture();
    const started = await service.startAgent(task.id, { expectedRevision: 1 });
    const remoteSession = {
      capsuleSha256: started!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      conversationRevision: 2,
      currentUnitId: task.units[0]?.id ?? null,
      hasMoreMessages: false,
      historyComplete: true,
      lastClientMessageId: 'media-user-previous-001',
      lastEventSequence: 3,
      lastHeartbeatAt: '2026-08-17T10:00:00.000Z',
      messages: [],
      policySha256: started!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      result: {
        candidateSummaries: [],
        candidates: [],
        nextActionLabel: '等待下一条消息',
        planSha256: null,
        status: 'conversation-response' as const,
        summary: '上一轮已回复',
      },
      status: 'blocked' as const,
      taskId: task.id,
      taskRevision: task.revision,
      terminalKind: 'completed' as const,
      threadId: started!.threadId,
      turnId: 'turn-media-agent-001',
    };
    (gateway.session as jest.Mock).mockResolvedValue(remoteSession);
    startTurn.mockClear();

    await service.continueAgentConversation(task.id, {
      clientMessageId: 'media-user-follow-up-001',
      content: '继续核对当前元数据缺口',
      expectedConversationRevision: 2,
      threadId: started!.threadId,
    });

    expect(gateway.session).toHaveBeenCalledWith(task.id, {
      afterSequence: 0,
      limit: 1,
    });
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: 'media-user-follow-up-001',
        operatorCommand: '继续核对当前元数据缺口',
      }),
    );
  });

  it('rejects a new Agent turn after the task is closed', async () => {
    const { service, startTurn, task } = await fixture({
      prepareMetadataStage: false,
    });
    task.runState = 'succeeded';
    task.stage = 'closed';

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).rejects.toThrow(HttpException);
    expect(startTurn).not.toHaveBeenCalled();
  });

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
      planSha256: (sealed as { planSha256: string }).planSha256,
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
      sealedPlanSha256: null,
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
      result: {
        candidateSummaries: [
          'tmdb:105473｜2020 年 OVA，特别篇按 S00 收录',
          'tmdb:105476｜同系列常规季度，非当前 OVA',
        ],
        candidates: [
          {
            id: 'tmdb:105473',
            summary: 'tmdb:105473｜2020 年 OVA，特别篇按 S00 收录',
          },
          {
            id: 'tmdb:105476',
            summary: 'tmdb:105476｜同系列常规季度，非当前 OVA',
          },
        ],
        nextActionLabel: '请选择正确作品',
        planSha256: null,
        status: 'requires-operator',
        summary: '存在两个候选',
      },
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

  it('returns an immutable historical Agent session after later task revisions', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    task.agentSession!.status = 'succeeded';
    task.agentSession!.statusLabel = 'TMDB 身份已密封应用';
    task.nextCommandLabel = '继续当前元数据核验';
    task.revision = 7;
    task.runState = 'blocked';
    const persistedSession = structuredClone(task.agentSession);
    const historicalResult = {
      candidateSummaries: ['tmdb:105476｜已核对唯一候选'],
      candidates: [
        { id: 'tmdb:105476', summary: 'tmdb:105476｜已核对唯一候选' },
      ],
      nextActionLabel: '继续当前元数据核验',
      planSha256: 'f'.repeat(64),
      status: 'plan-submitted' as const,
      summary: '已完成历史 Agent 回合的作品身份核对',
    };
    (gateway.session as jest.Mock).mockResolvedValue({
      capsuleSha256: task.agentSession!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      currentUnitId: task.units[0]?.id ?? null,
      lastEventSequence: 3,
      lastHeartbeatAt: '2026-08-11T00:00:03.000Z',
      policySha256: task.agentSession!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      result: historicalResult,
      status: 'blocked',
      taskId: task.id,
      taskRevision: 2,
      terminalKind: 'completed',
      threadId: task.agentSession!.threadId,
      turnId: 'turn-media-agent-001',
    });

    await expect(service.agentSession(task.id)).resolves.toMatchObject({
      ...persistedSession,
      conversationRevision: 0,
      hasMoreMessages: false,
      historyComplete: true,
      messages: [],
      result: historicalResult,
    });
    expect(task).toMatchObject({
      agentSession: persistedSession,
      nextCommandLabel: '继续当前元数据核验',
      revision: 7,
      runState: 'blocked',
    });
  });

  it('rejects an Agent session from a future task revision', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    (gateway.session as jest.Mock).mockResolvedValue({
      capsuleSha256: task.agentSession!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      currentUnitId: task.units[0]?.id ?? null,
      lastEventSequence: 0,
      lastHeartbeatAt: '2026-08-11T00:00:03.000Z',
      policySha256: task.agentSession!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      result: null,
      status: 'active',
      taskId: task.id,
      taskRevision: 3,
      terminalKind: null,
      threadId: task.agentSession!.threadId,
      turnId: 'turn-media-agent-001',
    });

    await expect(service.agentSession(task.id)).rejects.toThrow(HttpException);
  });

  it('shows a closed task historical conversation without mutating the task', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    task.agentSession!.status = 'needs-operator';
    task.agentSession!.statusLabel = '历史 Agent 会话待复核';
    task.revision = 40;
    task.runState = 'succeeded';
    task.stage = 'closed';
    const persistedSession = structuredClone(task.agentSession);
    (gateway.session as jest.Mock).mockResolvedValue({
      capsuleSha256: task.agentSession!.capsuleSha256,
      checkpointSha256: 'e'.repeat(64),
      conversationRevision: 1,
      currentUnitId: task.units[0]?.id ?? null,
      hasMoreMessages: false,
      historyComplete: true,
      lastClientMessageId: 'media-user-closed-001',
      lastEventSequence: 3,
      lastHeartbeatAt: '2026-08-11T00:00:03.000Z',
      messages: [
        {
          content: '总结本任务治理结果',
          messageId: 'media-user-closed-001',
          observedAt: '2026-08-11T00:00:00.000Z',
          phase: 'user',
          result: null,
          role: 'user',
          sequence: 1,
          status: 'completed',
          turnId: 'turn-media-agent-001',
        },
      ],
      policySha256: task.agentSession!.policySha256,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      replayed: false,
      result: null,
      status: 'blocked',
      taskId: task.id,
      taskRevision: 2,
      terminalKind: 'completed',
      threadId: task.agentSession!.threadId,
      turnId: 'turn-media-agent-001',
    });

    await expect(service.agentSession(task.id)).resolves.toMatchObject({
      ...persistedSession,
      conversationRevision: 1,
      messages: [{ content: '总结本任务治理结果', role: 'user' }],
    });
    expect(gateway.session).toHaveBeenCalledWith(task.id, {
      afterSequence: 0,
      limit: 200,
    });
    expect(task).toMatchObject({
      agentSession: persistedSession,
      revision: 40,
      runState: 'succeeded',
      stage: 'closed',
    });
  });

  it('seals a pending Agent plan exactly once when refresh observes a completed turn', async () => {
    const { gateway, service, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    const sealed = await service.agentToolCall({
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
      result: {
        candidateSummaries: [],
        candidates: [],
        nextActionLabel: '等待密封执行器处理',
        planSha256: (sealed as { planSha256: string }).planSha256,
        status: 'plan-submitted',
        summary: '提交恢复测试计划',
      },
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
      statusLabel: '密封文件计划待人工复核',
    });
    expect(task.revision).toBe(3);
    expect(task.sealedPlanSha256).toBeNull();

    await service.agentSession(task.id);
    expect(task.revision).toBe(3);
  });

  it('retries an explicitly failed Agent turn with a new revision and accepts the monotonic thread mapping', async () => {
    const { gateway, service, startTurn, task } = await fixture();
    const first = await service.startAgent(task.id, { expectedRevision: 1 });
    await service.applyAgentEvent({
      capsuleSha256: first!.capsuleSha256,
      eventId: 'media-agent-event-failed-001',
      observedAt: '2026-08-11T00:00:01.000Z',
      planSha256: null,
      policySha256: first!.policySha256,
      sequence: 1,
      status: 'blocked',
      summary: 'Agent 回合异常结束，未重放动作',
      taskId: task.id,
      taskRevision: 2,
      threadId: first!.threadId,
      turnId: 'turn-media-agent-001',
      type: 'agent-blocked',
    });
    expect(task.agentSession).toMatchObject({
      lastSequence: 1,
      status: 'failed',
      statusLabel: 'Agent 已阻塞，可安全重试',
    });

    (gateway.startTurn as jest.Mock).mockImplementationOnce(async (request) => {
      const policy = buildMediaCodexAgentPolicy(request.taskId);
      const capsule = buildMediaCodexAgentCapsule(request, policy);
      await service.applyAgentEvent({
        capsuleSha256: capsule.capsuleSha256,
        eventId: 'media-agent-event-remapped-002',
        observedAt: '2026-08-11T00:00:02.000Z',
        planSha256: null,
        policySha256: policy.policySha256,
        sequence: 2,
        status: 'active',
        summary: 'Agent 会话已绑定',
        taskId: task.id,
        taskRevision: request.taskRevision,
        threadId: 'thread-media-agent-002',
        turnId: 'turn-media-agent-002',
        type: 'agent-thread-mapped',
      });
      return {
        capsuleSha256: capsule.capsuleSha256,
        checkpointSha256: 'e'.repeat(64),
        currentUnitId: request.currentUnitId,
        lastEventSequence: 2,
        lastHeartbeatAt: '2026-08-11T00:00:02.000Z',
        policySha256: policy.policySha256,
        policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
        replayed: false,
        result: null,
        status: 'active' as const,
        taskId: task.id,
        taskRevision: request.taskRevision,
        terminalKind: null,
        threadId: 'thread-media-agent-002',
        turnId: 'turn-media-agent-002',
      };
    });

    await expect(
      service.startAgent(task.id, { expectedRevision: 2 }),
    ).resolves.toMatchObject({
      lastSequence: 2,
      status: 'running',
      threadId: 'thread-media-agent-002',
    });
    expect(startTurn.mock.calls[1]?.[0]).toMatchObject({
      recoveryMode: 'restart-failed-turn',
      replayKey: `${task.id}-agent-r3`,
      taskRevision: 3,
    });
  });

  it('applies one verified TMDB identity amendment only when the terminal hash matches', async () => {
    const { service, startTurn, task } = await fixture();
    task.titleHint = '刀使巫女 刻印一闪的灯火 OVA';
    task.releaseYear = 2020;
    task.providerRef = { provider: 'bangumi', providerId: '296798' };
    task.metadataIdentity = {
      provider: 'bangumi',
      providerId: '296798',
      releaseYear: 2020,
    };
    task.units[0]!.seasonNumber = 'S00';
    task.units[0]!.metadataProjection.missingA = [
      'identity.provider',
      'identity.providerId',
    ];
    task.sealedPlan = {
      identity: {
        mediaType: 'tv',
        providerRef: task.providerRef,
        releaseYear: 2020,
        title: task.titleHint,
      },
      schemaVersion: '1.2.0',
      sealed: true,
    };
    task.sealedPlanSha256 = sha256Json(task.sealedPlan);
    const html = `
      <a href="/tv/105473?language=zh-CN">
        <img alt="刀使巫女 刻印一闪的灯火" src="https://media.themoviedb.org/t/p/w94/test.jpg" />
      </a>
      <span class="release_date">2020年10月25日</span>
    `;
    jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        }),
    );

    const session = await service.startAgent(task.id, { expectedRevision: 1 });
    expect(startTurn.mock.calls[0]?.[0].operatorCommand).toContain(
      'operations 必须为 []',
    );
    await expect(
      service.agentToolCall({
        arguments: {},
        capsuleSha256: session!.capsuleSha256,
        manifestSha256: task.inputSnapshotSha256,
        policySha256: session!.policySha256,
        taskId: task.id,
        taskRevision: 2,
        tool: 'provider.metadata.read',
      }),
    ).resolves.toMatchObject({
      candidates: [
        {
          candidateId: 'tmdb:105473',
          providerId: '105473',
          releaseYear: 2020,
        },
      ],
      networkLookupPerformed: true,
    });
    await expect(
      service.agentToolCall({
        arguments: {
          identity: {
            provider: 'tmdb',
            providerId: '105473',
            releaseYear: 2020,
          },
          operations: [
            {
              action: 'stage-media-copy',
              targetPath: `/vol2/1000/.kt-media-governance-staging/${task.id}/work/S00E01.mkv`,
            },
          ],
          replayKey: `${task.id}-agent-r2`,
          summary: '身份修正不能混入重复媒体治理动作',
        },
        capsuleSha256: session!.capsuleSha256,
        manifestSha256: task.inputSnapshotSha256,
        policySha256: session!.policySha256,
        taskId: task.id,
        taskRevision: 2,
        tool: 'plan.submit.sealed',
      }),
    ).rejects.toThrow(HttpException);
    const sealed = (await service.agentToolCall({
      arguments: {
        identity: {
          provider: 'tmdb',
          providerId: '105473',
          releaseYear: 2020,
        },
        operations: [],
        replayKey: `${task.id}-agent-r2`,
        summary: '唯一 TMDB 候选与当前 S00 OVA 身份一致',
      },
      capsuleSha256: session!.capsuleSha256,
      manifestSha256: task.inputSnapshotSha256,
      policySha256: session!.policySha256,
      taskId: task.id,
      taskRevision: 2,
      tool: 'plan.submit.sealed',
    })) as { planSha256: string };
    const completed = {
      capsuleSha256: session!.capsuleSha256,
      eventId: 'media-agent-event-identity-001',
      observedAt: '2026-08-11T00:00:01.000Z',
      planSha256: sealed.planSha256,
      policySha256: session!.policySha256,
      sequence: 1,
      status: 'blocked' as const,
      summary: 'TMDB 身份修正计划已提交',
      taskId: task.id,
      taskRevision: 2,
      threadId: session!.threadId,
      turnId: 'turn-media-agent-001',
      type: 'agent-turn-completed' as const,
    };

    await expect(
      service.applyAgentEvent({ ...completed, planSha256: 'c'.repeat(64) }),
    ).rejects.toThrow(HttpException);
    await expect(service.applyAgentEvent(completed)).resolves.toEqual({
      applied: true,
      revision: 3,
    });
    expect(task).toMatchObject({
      agentSession: {
        pendingPlanSha256: null,
        status: 'succeeded',
      },
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '105473',
        releaseYear: 2020,
      },
      metadataStatus: 'pending',
      providerRef: { provider: 'tmdb', providerId: '105473' },
      revision: 3,
      runState: 'succeeded',
    });
    expect(task.sealedPlan).not.toHaveProperty('agentPendingAmendment');
    expect(task.sealedPlan).toMatchObject({
      identity: { providerTitle: '刀使巫女 刻印一闪的灯火' },
    });
    expect(task.sealedPlanSha256).toBe(sha256Json(task.sealedPlan));
  });

  it('migrates the deployed legacy blocked projection through the same fail-closed retry', async () => {
    const { service, startTurn, task } = await fixture();
    await service.startAgent(task.id, { expectedRevision: 1 });
    task.agentSession!.status = 'needs-operator';
    task.agentSession!.statusLabel = 'Agent 已阻塞';
    task.agentSession!.currentActionLabel = 'Agent 回合异常结束，未重放动作';
    task.runState = 'blocked';

    await expect(
      service.startAgent(task.id, { expectedRevision: 2 }),
    ).resolves.toMatchObject({ status: 'running' });
    expect(startTurn.mock.calls[1]?.[0]).toMatchObject({
      recoveryMode: 'restart-failed-turn',
      replayKey: `${task.id}-agent-r3`,
      taskRevision: 3,
    });
  });
});
