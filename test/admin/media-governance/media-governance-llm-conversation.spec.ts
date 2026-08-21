import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceService LLM conversation binding', () => {
  it('creates one media-governance LLM conversation and binds only its id', async () => {
    let sceneRefId = '';
    const llmConfigs = {
      resolveModel: jest.fn(async () => 'gpt-test'),
      runtimeForProvider: jest.fn(async () => ({
        entity: { id: '2041700000000100002' },
      })),
    };
    const llmConversations = {
      createScene: jest.fn(
        async (
          _configId: string,
          _title: string,
          _scene: string,
          currentSceneRefId: string,
        ) => {
          sceneRefId = String(currentSceneRefId);
          return { id: '2041700000000190001' };
        },
      ),
      detail: jest.fn(async () => ({
        config: { id: '2041700000000100002' },
        conversation: {
          active: false,
          scene: 'media-governance',
          sceneRefId,
          selectedModel: 'gpt-test',
        },
        messages: [],
      })),
      resolveIdentity: jest.fn(async (input: Record<string, unknown>) => ({
        activeTurnId: input.activeTurnId || null,
        conversationId: input.conversationId,
        providerThreadId: null,
        scene: input.scene,
        sceneRefId: input.sceneRefId,
      })),
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      llmConfigs as never,
      llmConversations as never,
    );
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '统一对话测试',
    });

    const session = await service.startAgent(task.id, {
      expectedRevision: task.revision,
    });

    expect(llmConfigs.runtimeForProvider).toHaveBeenCalledWith('codex');
    expect(llmConversations.createScene).toHaveBeenCalledWith(
      '2041700000000100002',
      '统一对话测试 · 媒体治理',
      'media-governance',
      task.id,
    );
    expect(service.detail(task.id)).toMatchObject({
      llmConversationId: '2041700000000190001',
      revision: 2,
    });
    expect(session).toMatchObject({
      status: 'needs-operator',
      threadId: '2041700000000190001',
    });
    await expect(
      service.startAgent(task.id, { expectedRevision: 2 }),
    ).resolves.toMatchObject({
      status: 'needs-operator',
      threadId: '2041700000000190001',
    });
    expect(llmConversations.createScene).toHaveBeenCalledTimes(1);
    expect(llmConversations.resolveIdentity).toHaveBeenCalledWith({
      conversationId: '2041700000000190001',
      scene: 'media-governance',
      sceneRefId: task.id,
    });

    const storedTask = structuredClone(service.detail(task.id));
    storedTask.agentSession!.threadId = 'thread-stale-legacy-001';
    const stateStore = {
      loadTasks: jest.fn(async () => [storedTask]),
    };
    const restarted = new MediaGovernanceService(
      undefined,
      undefined,
      stateStore as never,
      undefined,
      undefined,
      llmConfigs as never,
      llmConversations as never,
    );

    await restarted.onModuleInit();

    expect(restarted.detail(task.id)).toMatchObject({
      agentSession: { threadId: '2041700000000190001' },
      llmConversationId: '2041700000000190001',
    });
  });
});
