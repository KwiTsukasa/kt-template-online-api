import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import {
  CodexAppServerClient,
  type CodexAppServerRpcTransport,
  UnixWebSocketRpcTransport,
} from '../../../src/apps/media-codex-agent-gateway/infrastructure/codex-app-server.client';
import { buildMediaCodexAgentPolicy } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.policy';

class FakeTransport implements CodexAppServerRpcTransport {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: number | string; response: unknown }> = [];
  notificationHandler: ((value: any) => unknown) | undefined;
  disconnectHandler: (() => void) | undefined;
  requestHandler: ((value: any) => Promise<void>) | undefined;

  constructor(private readonly permissionProfileId = 'media-agent') {}

  async connect() {}

  async notify(method: string, params?: unknown) {
    this.calls.push({ method, params });
  }

  onDisconnect(handler: () => void) {
    this.disconnectHandler = handler;
  }

  onNotification(handler: (value: any) => unknown) {
    this.notificationHandler = handler;
  }

  onRequest(handler: (value: any) => Promise<void>) {
    this.requestHandler = handler;
  }

  async request(method: string, params?: unknown) {
    this.calls.push({ method, params });
    if (method === 'initialize') return { userAgent: 'fixture' };
    if (method === 'thread/start' || method === 'thread/resume') {
      return {
        activePermissionProfile: {
          extends: null,
          id: this.permissionProfileId,
        },
        approvalPolicy: 'never',
        cwd: '/tmp/kt-media-agent-clean',
        sandbox: { networkAccess: false, type: 'readOnly' },
        thread: {
          id: '019fbc48-c50e-7453-89b1-9c1b40234b3a',
          turns:
            method === 'thread/resume'
              ? [{ id: 'media-turn-001', status: 'completed' }]
              : [],
        },
      };
    }
    if (method === 'turn/start') {
      return { turn: { id: 'media-turn-001', status: 'inProgress' } };
    }
    throw new Error('unexpected-method');
  }

  async respond(id: number | string, response: unknown) {
    this.responses.push({ id, response });
  }

  emitDisconnect() {
    this.disconnectHandler?.();
  }
}

describe('CodexAppServerClient', () => {
  const policy = buildMediaCodexAgentPolicy('media-task-001', {
    cleanCwd: '/tmp/kt-media-agent-clean',
    evidenceRoot: '/tmp/kt-media-agent-evidence',
    stagingRoot: '/tmp/kt-media-agent-staging',
  });

  it('uses the official initialize/thread/turn protocol with fixed boundaries', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);

    const thread = await client.startThread(policy);
    const turn = await client.startTurn(
      thread.threadId,
      'bounded prompt',
      policy,
    );

    expect(turn.turnId).toBe('media-turn-001');
    expect(transport.calls.map((call) => call.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
    expect(
      transport.calls.find((call) => call.method === 'thread/start')?.params,
    ).toMatchObject({
      approvalPolicy: 'never',
      cwd: policy.cleanCwd,
      dynamicTools: expect.arrayContaining([
        expect.objectContaining({ name: 'plan_submit_sealed' }),
      ]),
      environments: [],
      permissions: 'media-agent',
      runtimeWorkspaceRoots: [],
      selectedCapabilityRoots: [],
    });
    const threadStart = transport.calls.find(
      (call) => call.method === 'thread/start',
    )?.params as Record<string, unknown>;
    expect(threadStart).not.toHaveProperty('sandbox');
    const turnStart = transport.calls.find(
      (call) => call.method === 'turn/start',
    )?.params as Record<string, unknown>;
    expect(turnStart).toMatchObject({
      approvalPolicy: 'never',
      cwd: policy.cleanCwd,
      permissions: 'media-agent',
    });
    expect(turnStart).not.toHaveProperty('sandboxPolicy');
  });

  it('resumes the same thread and exposes only the last turn status', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const state = await client.resumeThread(
      '019fbc48-c50e-7453-89b1-9c1b40234b3a',
      policy,
    );
    expect(state).toEqual({
      lastTurn: { id: 'media-turn-001', status: 'completed' },
      threadId: '019fbc48-c50e-7453-89b1-9c1b40234b3a',
    });
    const resume = transport.calls.find(
      (call) => call.method === 'thread/resume',
    )?.params as Record<string, unknown>;
    expect(resume).toMatchObject({ permissions: 'media-agent' });
    expect(resume).not.toHaveProperty('sandbox');
  });

  it('repeats the initialize handshake after the transport disconnects', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);

    await client.initialize();
    transport.emitDisconnect();
    await client.initialize();

    expect(transport.calls.map((call) => call.method)).toEqual([
      'initialize',
      'initialized',
      'initialize',
      'initialized',
    ]);
  });

  it('fails closed when App Server does not activate the named permission profile', async () => {
    const client = new CodexAppServerClient(
      new FakeTransport('unexpected-profile'),
    );

    await expect(client.startThread(policy)).rejects.toThrow(
      'app-server-thread-boundary-mismatch',
    );
  });

  it('routes only declared dynamic tools and denies every other server request', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    client.onToolCall(async (request) => ({ tool: request.tool }));

    await transport.requestHandler?.({
      id: 1,
      method: 'item/tool/call',
      params: {
        arguments: {},
        callId: 'call-001',
        threadId: 'thread-001',
        tool: 'media_identity_read',
        turnId: 'turn-001',
      },
    });
    await transport.requestHandler?.({
      id: 2,
      method: 'item/commandExecution/requestApproval',
      params: {},
    });

    expect(transport.responses[0]).toMatchObject({
      id: 1,
      response: {
        result: {
          contentItems: [{ text: '{"tool":"media.identity.read"}' }],
          success: true,
        },
      },
    });
    expect(transport.responses[1]).toMatchObject({
      id: 2,
      response: {
        error: { message: 'media-codex-agent-boundary-denied' },
      },
    });
  });
});

describe('UnixWebSocketRpcTransport', () => {
  let httpServer: Server;
  let socketRoot: string;
  let webSocketServer: WebSocketServer;

  afterEach(async () => {
    webSocketServer?.clients.forEach((client) => client.terminate());
    if (webSocketServer) {
      await new Promise<void>((resolve) =>
        webSocketServer.close(() => resolve()),
      );
    }
    if (httpServer?.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    if (socketRoot) rmSync(socketRoot, { force: true, recursive: true });
  });

  it('uses a WebSocket HTTP upgrade over the Unix socket and omits jsonrpc on the wire', async () => {
    socketRoot = mkdtempSync('/tmp/kt-app-server-');
    const socketPath = join(socketRoot, 'app-server.sock');
    httpServer = createServer();
    webSocketServer = new WebSocketServer({ server: httpServer });
    const received: Array<Record<string, unknown>> = [];
    webSocketServer.on('connection', (socket) => {
      socket.on('message', (data) => {
        const request = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(request);
        socket.send(
          JSON.stringify({ id: request.id, result: { ready: true } }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(socketPath, resolve);
    });

    const transport = new UnixWebSocketRpcTransport(socketPath, 1_000);
    await expect(
      transport.request('initialize', {
        clientInfo: { name: 'kt-test', title: 'KT test', version: '1.0.0' },
      }),
    ).resolves.toEqual({ ready: true });

    expect(received).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'kt-test', title: 'KT test', version: '1.0.0' },
        },
      },
    ]);
    expect(received[0]).not.toHaveProperty('jsonrpc');
  });
});
