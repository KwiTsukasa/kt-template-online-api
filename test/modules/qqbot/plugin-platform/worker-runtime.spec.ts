import {
  QqbotPluginRuntimeError,
  QqbotPluginWorkerRuntime,
  type QqbotPluginWorkerDriver,
  type QqbotPluginWorkerRequest,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/runtime';
import { createQqbotPluginSdk } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/sdk';

class RecordingDriver implements QqbotPluginWorkerDriver {
  disposed = false;
  readonly requests: QqbotPluginWorkerRequest[] = [];
  readonly responses = new Map<string, unknown>();

  constructor(private readonly rejectTypes = new Map<string, Error>()) {}

  async dispose() {
    this.disposed = true;
  }

  async request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    this.requests.push(message);

    const rejection = this.rejectTypes.get(message.type);
    if (rejection) throw rejection;

    if (this.responses.has(message.type)) {
      return this.responses.get(message.type);
    }

    return {
      ok: true,
      type: message.type,
    };
  }
}

const createRuntime = (driver = new RecordingDriver()) => {
  const runtime = new QqbotPluginWorkerRuntime(driver, {
    defaultTimeoutMs: 50,
    installationId: 'install-1',
    pluginKey: 'demo-plugin',
  });

  return { driver, runtime };
};

describe('QQBot plugin worker runtime', () => {
  it('sends lifecycle and execution RPC messages with correlation IDs and safe input summaries', async () => {
    const { driver, runtime } = createRuntime();
    driver.responses.set('executeOperation', { replyText: 'ok' });
    driver.responses.set('handleEvent', { handled: true });

    await runtime.load({
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    });
    await runtime.activate();
    await expect(
      runtime.executeOperation({
        input: {
          authMarker: 'sample-value',
          text: 'hello',
        },
        operationId: 'op-1',
        operationKey: 'demo-plugin.echo',
        timeoutMs: 30,
      }),
    ).resolves.toEqual({ replyText: 'ok' });
    await expect(
      runtime.handleEvent({
        event: {
          message: 'hello',
          rawEvent: {
            traceMarker: 'sample-event',
          },
        },
        eventKey: 'demo-plugin.message',
      }),
    ).resolves.toEqual({ handled: true });
    await runtime.health();
    await runtime.deactivate();
    await runtime.dispose();

    expect(driver.requests.map((request) => request.type)).toEqual([
      'load',
      'activate',
      'executeOperation',
      'handleEvent',
      'health',
      'deactivate',
      'dispose',
    ]);
    expect(driver.requests.every((request) => request.correlationId)).toBe(
      true,
    );
    expect(driver.requests[2]).toMatchObject({
      operationId: 'op-1',
      operationKey: 'demo-plugin.echo',
      safeInputSummary: {
        fieldCount: 2,
        keys: ['authMarker', 'text'],
      },
      timeoutMs: 30,
      type: 'executeOperation',
    });
    expect(JSON.stringify(driver.requests[2].safeInputSummary)).not.toContain(
      'sample-value',
    );
    expect(JSON.stringify(driver.requests[3].safeInputSummary)).not.toContain(
      'sample-event',
    );
    expect(driver.disposed).toBe(true);
  });

  it('isolates worker crashes as plugin runtime events without throwing raw errors', async () => {
    const { runtime } = createRuntime(
      new RecordingDriver(
        new Map([['executeOperation', new Error('worker crashed')]]),
      ),
    );

    await expect(
      runtime.executeOperation({
        input: { text: 'boom' },
        operationId: 'op-crash',
        operationKey: 'demo-plugin.echo',
      }),
    ).rejects.toMatchObject({
      code: 'PLUGIN_WORKER_CRASH',
      pluginKey: 'demo-plugin',
    });
    expect(runtime.status).toBe('failed');
    expect(runtime.listRuntimeEvents()).toEqual([
      expect.objectContaining({
        eventType: 'worker-crash',
        level: 'error',
        safeSummary: expect.objectContaining({
          message: 'worker crashed',
          operationId: 'op-crash',
        }),
      }),
    ]);
  });

  it('times out slow worker calls and disposes the driver boundary', async () => {
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      ),
    };
    const runtime = new QqbotPluginWorkerRuntime(driver, {
      defaultTimeoutMs: 5,
      installationId: 'install-timeout',
      pluginKey: 'demo-plugin',
    });

    await expect(
      runtime.executeOperation({
        input: { text: 'slow' },
        operationId: 'op-timeout',
        operationKey: 'demo-plugin.echo',
      }),
    ).rejects.toBeInstanceOf(QqbotPluginRuntimeError);
    await expect(
      runtime.executeOperation({
        input: { text: 'slow' },
        operationId: 'op-timeout-2',
        operationKey: 'demo-plugin.echo',
      }),
    ).rejects.toMatchObject({
      code: 'PLUGIN_WORKER_TIMEOUT',
    });
    expect(driver.dispose).toHaveBeenCalled();
    expect(runtime.status).toBe('failed');
  });

  it('keeps successful worker calls alive after the timeout window', async () => {
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async () => ({ ok: true })),
    };
    const runtime = new QqbotPluginWorkerRuntime(driver, {
      defaultTimeoutMs: 5,
      installationId: 'install-success',
      pluginKey: 'demo-plugin',
    });

    await runtime.load({
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    });
    await runtime.activate();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(driver.dispose).not.toHaveBeenCalled();
    expect(runtime.status).toBe('active');
    expect(runtime.listRuntimeEvents()).toEqual([]);
  });
});

describe('QQBot plugin SDK contract', () => {
  it('exposes only host-controlled capabilities to plugin code', () => {
    const sdk = createQqbotPluginSdk({
      assets: {
        readAsset: jest.fn(),
      },
      config: {
        getConfig: jest.fn(),
        setConfig: jest.fn(),
      },
      eventContext: {
        eventKey: 'demo-plugin.message',
      },
      events: {
        emitRuntimeEvent: jest.fn(),
      },
      http: {
        request: jest.fn(),
      },
      operationContext: {
        operationKey: 'demo-plugin.echo',
      },
      sendQueue: {
        sendMessage: jest.fn(),
      },
      storage: {
        get: jest.fn(),
        set: jest.fn(),
      },
    });

    expect(Object.keys(sdk).sort()).toEqual([
      'assets',
      'config',
      'eventContext',
      'events',
      'http',
      'operationContext',
      'sendQueue',
      'storage',
    ]);
    expect('env' in sdk).toBe(false);
    expect('fs' in sdk).toBe(false);
    expect('nest' in sdk).toBe(false);
    expect('repository' in sdk).toBe(false);
  });
});
