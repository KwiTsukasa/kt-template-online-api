import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { UnixWebSocketRpcTransport } from '../../../src/apps/llm-codex-gateway/infrastructure/llm-codex-rpc.transport';

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
    transport.close();
  });
});
