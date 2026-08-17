import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  MediaCodexAgentGatewayService,
  type MediaCodexAgentEventSink,
  type MediaCodexAgentToolClient,
} from '../../../src/apps/media-codex-agent-gateway/application/media-codex-agent-gateway.service';
import type {
  CodexAppServerAdapter,
  CodexAppServerNotification,
  CodexAppServerThreadState,
  CodexAppServerToolRequest,
} from '../../../src/apps/media-codex-agent-gateway/infrastructure/codex-app-server.client';
import { MediaCodexAgentSessionStore } from '../../../src/apps/media-codex-agent-gateway/infrastructure/media-codex-agent-session.store';
import type { MediaCodexAgentTurnRequest } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import { sha256Json } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';

class FakeAppServer implements CodexAppServerAdapter {
  notificationHandler:
    | ((notification: CodexAppServerNotification) => void | Promise<void>)
    | undefined;
  resumeCount = 0;
  startCount = 0;
  toolHandler:
    | ((request: CodexAppServerToolRequest) => Promise<unknown>)
    | undefined;
  turnCount = 0;

  async initialize() {}
  onNotification(
    handler: (notification: CodexAppServerNotification) => void | Promise<void>,
  ) {
    this.notificationHandler = handler;
  }
  onToolCall(
    handler: (request: CodexAppServerToolRequest) => Promise<unknown>,
  ) {
    this.toolHandler = handler;
  }
  async resumeThread(threadId: string): Promise<CodexAppServerThreadState> {
    this.resumeCount += 1;
    return {
      lastTurn: {
        id: 'media-turn-001',
        result: null,
        status: 'completed' as const,
      },
      threadId,
    };
  }
  async startThread(): Promise<CodexAppServerThreadState> {
    this.startCount += 1;
    return {
      lastTurn: null,
      threadId: '019fbc48-c50e-7453-89b1-9c1b40234b3a',
    };
  }
  async startTurn() {
    this.turnCount += 1;
    return { turnId: `media-turn-00${this.turnCount}` };
  }
}

describe('MediaCodexAgentSessionStore', () => {
  let root: string;
  let cleanCwd: string;
  let evidenceRoot: string;
  let stagingRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'kt-media-agent-state-'));
    cleanCwd = path.join(root, 'clean');
    evidenceRoot = path.join(root, 'evidence');
    stagingRoot = path.join(root, 'staging');
    for (const value of [cleanCwd, evidenceRoot, stagingRoot]) {
      mkdirSync(value, { mode: 0o700, recursive: true });
    }
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  function createService(appServer: FakeAppServer, callbackReady = true) {
    const conversationEvents: any[] = [];
    const events: any[] = [];
    const toolClient: MediaCodexAgentToolClient = {
      call: jest.fn(async (call) =>
        call.tool === 'plan.submit.sealed'
          ? { accepted: true, planSha256: 'b'.repeat(64) }
          : { ok: true },
      ),
    };
    const eventSink: MediaCodexAgentEventSink = {
      health: jest.fn(async () => {
        if (!callbackReady) throw new Error('callback-unavailable');
      }),
      publish: jest.fn(async (event) => {
        events.push(event);
      }),
      publishConversation: jest.fn(async (event) => {
        conversationEvents.push(event);
      }),
    };
    return {
      conversationEvents,
      events,
      service: new MediaCodexAgentGatewayService(
        new MediaCodexAgentSessionStore(root),
        appServer,
        toolClient,
        eventSink,
        { cleanCwd, evidenceRoot, stagingRoot },
      ),
    };
  }

  function request(revision = 7, replayKey = 'media-agent-replay-001') {
    return {
      compactContext: { title: '测试作品' },
      currentStage: 'metadata',
      currentUnitId: 'media-unit-001',
      manifestSha256: 'a'.repeat(64),
      operatorCommand: '核对当前单元',
      replayKey,
      taskId: 'media-task-001',
      taskRevision: revision,
    } satisfies MediaCodexAgentTurnRequest;
  }

  it('persists one Task/one thread and never replays the same replay key', async () => {
    const appServer = new FakeAppServer();
    const first = createService(appServer);
    const started = await first.service.startTurn(request());

    expect(started).toMatchObject({
      replayed: false,
      status: 'active',
      threadId: '019fbc48-c50e-7453-89b1-9c1b40234b3a',
      turnId: 'media-turn-001',
    });
    expect(appServer.startCount).toBe(1);
    expect(appServer.turnCount).toBe(1);

    const afterRestart = createService(appServer);
    const replay = await afterRestart.service.startTurn(request());
    expect(replay.replayed).toBe(true);
    expect(replay.threadId).toBe(started.threadId);
    expect(appServer.startCount).toBe(1);
    expect(appServer.turnCount).toBe(1);
  });

  it('persists semantic event sequence across gateway restarts', async () => {
    const appServer = new FakeAppServer();
    const first = createService(appServer);
    const started = await first.service.startTurn(request());
    expect(first.events.map((event) => event.sequence)).toEqual([1, 2]);

    const afterRestart = createService(appServer);
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'completed' },
      },
    });

    expect(afterRestart.events.map((event) => event.sequence)).toEqual([3]);
    await expect(
      afterRestart.service.session('media-task-001'),
    ).resolves.toMatchObject({
      lastEventSequence: 3,
      status: 'blocked',
      threadId: started.threadId,
    });
  });

  it('loads a v1 checkpoint created before event sequences were persisted', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    await service.startTurn(request());
    const sessionPath = path.join(root, 'task-sessions', 'media-task-001.json');
    const current = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const legacy = { ...current };
    delete legacy.checkpointSha256;
    delete legacy.lastEventSequence;
    delete legacy.terminalKind;
    writeFileSync(
      sessionPath,
      `${JSON.stringify({ ...legacy, checkpointSha256: sha256Json(legacy) })}\n`,
      'utf8',
    );

    expect(
      new MediaCodexAgentSessionStore(root).load('media-task-001'),
    ).toMatchObject({
      lastEventSequence: 0,
      taskId: 'media-task-001',
      terminalKind: null,
    });
  });

  it('fails before creating an App Server thread when the API callback is unavailable', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer, false);

    await expect(service.startTurn(request())).rejects.toThrow(
      'callback-unavailable',
    );
    expect(appServer.startCount).toBe(0);
    expect(appServer.turnCount).toBe(0);
    await expect(service.session('media-task-001')).resolves.toBeNull();
  });

  it('fails closed on stale revisions and concurrent new actions', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    await service.startTurn(request());

    await expect(
      service.startTurn(request(6, 'media-agent-replay-002')),
    ).rejects.toThrow('agent-task-revision-stale');
    await expect(
      service.startTurn(request(8, 'media-agent-replay-003')),
    ).rejects.toThrow('agent-session-active');
  });

  it('returns safe conversation history without login, reasoning, or tool output', async () => {
    const appServer = new FakeAppServer();
    const { events, service } = createService(appServer);
    const started = await service.startTurn(request());
    await emitFinalResult(appServer, started, {
      candidateSummaries: [
        'tmdb:105473｜当前 OVA',
        'tmdb:105476｜同系列常规季度',
      ],
      nextActionLabel: '请选择正确作品',
      planSha256: null,
      status: 'requires-operator',
      summary: '存在两个真实候选',
    });
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'completed' },
      },
    });

    const session = await service.session('media-task-001');
    expect(session).toMatchObject({
      conversationRevision: 2,
      messages: [
        { content: '核对当前单元', role: 'user', sequence: 1 },
        { content: '存在两个真实候选', role: 'assistant', sequence: 2 },
      ],
      status: 'blocked',
    });
    expect(JSON.stringify(session)).not.toMatch(
      /login|reasoning|token|tool-call|tool-output/i,
    );
    expect(events.map((event) => event.type)).toEqual([
      'agent-thread-mapped',
      'agent-turn-started',
      'agent-turn-completed',
    ]);
  });

  it('syncs official history once and serves later pages from the local session store', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    await service.startTurn(request());

    await service.session('media-task-001', 0, 1);
    await service.session('media-task-001', 1, 1);

    expect(appServer.resumeCount).toBe(1);
  });

  it('coalesces rapid commentary deltas and flushes them before item completion', async () => {
    const appServer = new FakeAppServer();
    const { conversationEvents, service } = createService(appServer);
    const started = await service.startTurn(request());
    conversationEvents.splice(0);
    await appServer.notificationHandler?.({
      method: 'item/started',
      params: {
        item: {
          id: 'media-commentary-item',
          phase: 'commentary',
          type: 'agentMessage',
        },
        threadId: started.threadId,
        turnId: started.turnId,
      },
    });
    await Promise.all(
      ['第', '一', '步'].map((delta) =>
        appServer.notificationHandler?.({
          method: 'item/agentMessage/delta',
          params: {
            delta,
            itemId: 'media-commentary-item',
            threadId: started.threadId,
            turnId: started.turnId,
          },
        }),
      ),
    );
    expect(conversationEvents).toHaveLength(0);

    await appServer.notificationHandler?.({
      method: 'item/completed',
      params: {
        item: {
          id: 'media-commentary-item',
          phase: 'commentary',
          text: '第一步',
          type: 'agentMessage',
        },
        threadId: started.threadId,
        turnId: started.turnId,
      },
    });

    expect(conversationEvents).toEqual([
      expect.objectContaining({
        changeType: 'assistant-delta',
        content: '第一步',
      }),
      expect.objectContaining({
        changeType: 'message-completed',
        content: '第一步',
      }),
    ]);
    expect(conversationEvents[1].eventSequence).toBeGreaterThan(
      conversationEvents[0].eventSequence,
    );
  });

  it('drops an unfinished streaming placeholder when its turn terminates', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    const started = await service.startTurn(request());
    await appServer.notificationHandler?.({
      method: 'item/started',
      params: {
        item: {
          id: 'media-unfinished-commentary',
          phase: 'commentary',
          type: 'agentMessage',
        },
        threadId: started.threadId,
        turnId: started.turnId,
      },
    });
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'failed' },
      },
    });

    await expect(service.session('media-task-001')).resolves.toMatchObject({
      messages: [{ role: 'user' }],
      status: 'blocked',
    });
  });

  it('persists the authoritative final agent item and binds it to an accepted plan hash', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    const started = await service.startTurn(request());
    const planSha256 = 'b'.repeat(64);
    const toolClient = appServer.toolHandler;
    expect(toolClient).toBeDefined();
    await toolClient?.({
      arguments: {
        operations: [
          {
            action: 'write-nfo',
            targetPath: path.join(stagingRoot, 'work', 'tvshow.nfo'),
          },
        ],
        replayKey: 'media-agent-replay-001',
        summary: '提交测试计划',
      },
      callId: 'media-call-001',
      threadId: started.threadId,
      tool: 'plan.submit.sealed',
      turnId: started.turnId!,
    });
    await appServer.notificationHandler?.({
      method: 'item/completed',
      params: {
        item: {
          id: 'media-item-001',
          phase: 'final_answer',
          text: JSON.stringify({
            candidateSummaries: [],
            nextActionLabel: '等待密封执行器处理',
            planSha256,
            status: 'plan-submitted',
            summary: '密封计划已提交',
          }),
          type: 'agentMessage',
        },
        threadId: started.threadId,
        turnId: started.turnId,
      },
    });
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'completed' },
      },
    });

    await expect(service.session('media-task-001')).resolves.toMatchObject({
      result: {
        planSha256,
        status: 'plan-submitted',
      },
      status: 'blocked',
      terminalKind: 'completed',
    });
  });

  it('fails closed when the final result hash differs from the accepted plan', async () => {
    const appServer = new FakeAppServer();
    const { events, service } = createService(appServer);
    const started = await service.startTurn(request());
    await appServer.toolHandler?.({
      arguments: {
        identity: {
          provider: 'tmdb',
          providerId: '105473',
          releaseYear: 2020,
        },
        operations: [],
        replayKey: 'media-agent-replay-001',
        summary: '提交身份修正',
      },
      callId: 'media-call-mismatch',
      threadId: started.threadId,
      tool: 'plan.submit.sealed',
      turnId: started.turnId!,
    });
    await emitFinalResult(appServer, started, {
      candidateSummaries: [],
      nextActionLabel: '等待密封执行器处理',
      planSha256: 'c'.repeat(64),
      status: 'plan-submitted',
      summary: '错误哈希结果',
    });
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'completed' },
      },
    });

    await expect(service.session('media-task-001')).resolves.toMatchObject({
      status: 'blocked',
      terminalKind: 'failed',
    });
    expect(events.at(-1)).toMatchObject({
      planSha256: null,
      type: 'agent-blocked',
    });
  });

  it('restarts only an explicitly failed turn on a fresh thread and keeps sequence monotonic', async () => {
    const appServer = new FakeAppServer();
    const { events, service } = createService(appServer);
    const started = await service.startTurn(request());
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'failed' },
      },
    });
    const resumeThread = jest
      .spyOn(appServer, 'resumeThread')
      .mockResolvedValueOnce({
        lastTurn: { id: started.turnId!, result: null, status: 'failed' },
        threadId: started.threadId,
      });
    jest.spyOn(appServer, 'startThread').mockResolvedValueOnce({
      lastTurn: null,
      threadId: '019ff55f-6258-7ef0-9c6b-6f3f59d9643d',
    });

    const retried = await service.startTurn({
      ...request(8, 'media-agent-replay-002'),
      recoveryMode: 'restart-failed-turn',
    });

    expect(retried).toMatchObject({
      lastEventSequence: 5,
      status: 'active',
      taskRevision: 8,
      terminalKind: null,
      threadId: '019ff55f-6258-7ef0-9c6b-6f3f59d9643d',
      turnId: 'media-turn-002',
    });
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(resumeThread).toHaveBeenCalledTimes(1);
    expect(appServer.turnCount).toBe(2);
  });

  it('refuses to restart a normally completed turn as a failed turn', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);
    const started = await service.startTurn(request());
    await emitFinalResult(appServer, started, {
      candidateSummaries: [
        'tmdb:105473｜当前 OVA',
        'tmdb:105476｜同系列常规季度',
      ],
      nextActionLabel: '请选择正确作品',
      planSha256: null,
      status: 'requires-operator',
      summary: '存在两个真实候选',
    });
    await appServer.notificationHandler?.({
      method: 'turn/completed',
      params: {
        threadId: started.threadId,
        turn: { id: started.turnId, status: 'completed' },
      },
    });

    await expect(
      service.startTurn({
        ...request(8, 'media-agent-replay-002'),
        recoveryMode: 'restart-failed-turn',
      }),
    ).rejects.toThrow('agent-retry-not-failed');
    expect(appServer.startCount).toBe(1);
    expect(appServer.turnCount).toBe(1);
  });

  it('refuses a failed-turn recovery request without a blocked session', async () => {
    const appServer = new FakeAppServer();
    const { service } = createService(appServer);

    await expect(
      service.startTurn({
        ...request(),
        recoveryMode: 'restart-failed-turn',
      }),
    ).rejects.toThrow('agent-retry-session-not-blocked');
    expect(appServer.startCount).toBe(0);
    expect(appServer.turnCount).toBe(0);
  });

  async function emitFinalResult(
    appServer: FakeAppServer,
    started: { threadId: string; turnId: null | string },
    result: Record<string, unknown>,
  ) {
    await appServer.notificationHandler?.({
      method: 'item/completed',
      params: {
        item: {
          id: 'media-final-result',
          phase: 'final_answer',
          text: JSON.stringify(result),
          type: 'agentMessage',
        },
        threadId: started.threadId,
        turnId: started.turnId,
      },
    });
  }
});
