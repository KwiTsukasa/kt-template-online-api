import type { ConfigService } from '@nestjs/config';
import {
  createQqbotBullmqWorkerQueueOptions,
  QqbotPluginRuntimeError,
  QqbotPluginWorkerResponseError,
  QqbotPluginWorkerRuntime,
  resolveQqbotPluginQueueConnection,
  type QqbotPluginWorkerDriver,
  type QqbotPluginWorkerRequest,
  type QqbotPluginWorkerRequestQueue,
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

class RecordingRequestQueue implements QqbotPluginWorkerRequestQueue {
  private previous = Promise.resolve();

  constructor(private readonly driver: QqbotPluginWorkerDriver) {}

  async close() {
    await this.driver.dispose();
  }

  request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    const run = this.previous
      .catch(() => undefined)
      .then(() => this.driver.request(message));
    this.previous = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async reset() {
    await this.driver.dispose();
  }
}

class GenerationAwareRequestQueue implements QqbotPluginWorkerRequestQueue {
  private generation = 0;
  private previous = Promise.resolve();

  constructor(private readonly driver: QqbotPluginWorkerDriver) {}

  async close() {
    await this.driver.dispose();
  }

  request(message: QqbotPluginWorkerRequest): Promise<unknown> {
    const generation = this.generation;
    const run = this.previous
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation) {
          const error = new Error('stale worker queue request');
          error.name = 'QqbotPluginWorkerStaleRequestError';
          throw error;
        }
        try {
          return await this.driver.request(message);
        } catch (error) {
          if (!(error instanceof QqbotPluginWorkerResponseError)) {
            this.generation += 1;
          }
          throw error;
        }
      });
    this.previous = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async reset() {
    this.generation += 1;
    await this.driver.dispose();
  }
}

class TimeoutAwareRecordingRequestQueue extends RecordingRequestQueue {
  readonly handlesRequestTimeout = true;
  readonly queueWaitTimeoutMs = 50;
}

const createRuntime = (driver = new RecordingDriver()) => {
  const runtime = new QqbotPluginWorkerRuntime(new RecordingRequestQueue(driver), {
    defaultTimeoutMs: 50,
    installationId: 'install-1',
    pluginKey: 'demo-plugin',
  });

  return { driver, runtime };
};

describe('QQBot plugin worker runtime', () => {
  it('serializes concurrent worker execution requests for one plugin runtime', async () => {
    const releaseFirst = createDeferred<void>();
    const releaseSecond = createDeferred<void>();
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestOrder: string[] = [];
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async (message) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        requestOrder.push(message.operationId || message.type);

        if (message.operationId === 'op-1') {
          await releaseFirst.promise;
        }
        if (message.operationId === 'op-2') {
          await releaseSecond.promise;
        }

        activeRequests -= 1;
        return {
          ok: true,
          operationId: message.operationId,
        };
      }),
    };
    const runtime = new QqbotPluginWorkerRuntime(new RecordingRequestQueue(driver), {
      defaultTimeoutMs: 100,
      installationId: 'install-serial',
      pluginKey: 'demo-plugin',
    });

    const first = runtime.executeOperation({
      input: { text: 'first' },
      operationId: 'op-1',
      operationKey: 'demo-plugin.echo',
    });
    const second = runtime.executeOperation({
      input: { text: 'second' },
      operationId: 'op-2',
      operationKey: 'demo-plugin.echo',
    });

    try {
      await waitUntil(() => requestOrder.includes('op-1'));
      expect(requestOrder).toEqual(['op-1']);

      releaseFirst.resolve();
      await expect(first).resolves.toMatchObject({ operationId: 'op-1' });

      await waitUntil(() => requestOrder.includes('op-2'));
      expect(maxActiveRequests).toBe(1);
      releaseSecond.resolve();
      await expect(second).resolves.toMatchObject({ operationId: 'op-2' });
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it('does not count queue wait time against a queued operation execution timeout', async () => {
    const requestOrder: string[] = [];
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async (message) => {
        requestOrder.push(message.operationId || message.type);
        await new Promise((resolve) =>
          setTimeout(resolve, message.operationId === 'op-1' ? 20 : 15),
        );
        return {
          ok: true,
          operationId: message.operationId,
        };
      }),
    };
    const runtime = new QqbotPluginWorkerRuntime(
      new TimeoutAwareRecordingRequestQueue(driver),
      {
        defaultTimeoutMs: 30,
        installationId: 'install-queue-wait',
        pluginKey: 'demo-plugin',
      },
    );

    const first = runtime.executeOperation({
      input: { text: 'first' },
      operationId: 'op-1',
      operationKey: 'demo-plugin.echo',
    });
    const second = runtime.executeOperation({
      input: { text: 'second' },
      operationId: 'op-2',
      operationKey: 'demo-plugin.echo',
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, operationId: 'op-1' },
      { ok: true, operationId: 'op-2' },
    ]);
    expect(requestOrder).toEqual(['op-1', 'op-2']);
    expect(driver.dispose).not.toHaveBeenCalled();
  });

  it('recovers a failed worker by reloading and activating it before the next request', async () => {
    const requestTypes: string[] = [];
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async (message) => {
        requestTypes.push(message.type);
        if (message.operationId === 'op-crash') {
          throw new Error('worker crashed');
        }
        return {
          ok: true,
          operationId: message.operationId,
          type: message.type,
        };
      }),
    };
    const runtime = new QqbotPluginWorkerRuntime(new RecordingRequestQueue(driver), {
      defaultTimeoutMs: 50,
      installationId: 'install-recover',
      pluginKey: 'demo-plugin',
    });
    const manifest = {
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    };

    await runtime.load(manifest);
    await runtime.activate();
    await expect(
      runtime.executeOperation({
        input: { text: 'boom' },
        operationId: 'op-crash',
        operationKey: 'demo-plugin.echo',
      }),
    ).rejects.toMatchObject({
      code: 'PLUGIN_WORKER_CRASH',
    });
    expect(runtime.status).toBe('failed');

    await expect(
      runtime.executeOperation({
        input: { text: 'after crash' },
        operationId: 'op-after-crash',
        operationKey: 'demo-plugin.echo',
      }),
    ).resolves.toMatchObject({ operationId: 'op-after-crash' });

    expect(driver.dispose).toHaveBeenCalled();
    expect(requestTypes).toEqual([
      'load',
      'activate',
      'executeOperation',
      'load',
      'activate',
      'executeOperation',
    ]);
    expect(runtime.status).toBe('active');
  });

  it('recovers before retrying requests that were already queued when a worker crashed', async () => {
    const requestTypes: string[] = [];
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(async (message) => {
        requestTypes.push(message.operationId || message.type);
        if (message.operationId === 'op-crash') {
          throw new Error('worker crashed');
        }
        return {
          ok: true,
          operationId: message.operationId,
          type: message.type,
        };
      }),
    };
    const runtime = new QqbotPluginWorkerRuntime(
      new GenerationAwareRequestQueue(driver),
      {
        defaultTimeoutMs: 50,
        installationId: 'install-stale-retry',
        pluginKey: 'demo-plugin',
      },
    );

    await runtime.load({
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    });
    await runtime.activate();

    const first = runtime
      .executeOperation({
        input: { text: 'boom' },
        operationId: 'op-crash',
        operationKey: 'demo-plugin.echo',
      })
      .catch((error) => error);
    const second = runtime.executeOperation({
      input: { text: 'after crash' },
      operationId: 'op-after-crash',
      operationKey: 'demo-plugin.echo',
    });

    await expect(first).resolves.toMatchObject({
      code: 'PLUGIN_WORKER_CRASH',
    });
    await expect(second).resolves.toMatchObject({
      operationId: 'op-after-crash',
    });
    expect(requestTypes).toEqual([
      'load',
      'activate',
      'op-crash',
      'load',
      'activate',
      'op-after-crash',
    ]);
    expect(runtime.status).toBe('active');
  });

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

  it('keeps plugin response errors from poisoning the worker runtime', async () => {
    const driver = new RecordingDriver(
      new Map([
        [
          'executeOperation',
          new QqbotPluginWorkerResponseError({
            message: '业务参数错误',
            name: 'PluginCommandError',
          }),
        ],
      ]),
    );
    const { runtime } = createRuntime(driver);

    await runtime.load({
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    });
    await runtime.activate();
    await expect(
      runtime.executeOperation({
        input: { text: 'bad input' },
        operationId: 'op-plugin-error',
        operationKey: 'demo-plugin.echo',
      }),
    ).rejects.toMatchObject({
      message: '业务参数错误',
      name: 'PluginCommandError',
    });

    expect(runtime.status).toBe('active');
    expect(driver.disposed).toBe(false);
    expect(runtime.listRuntimeEvents()).toEqual([]);
  });

  it('times out slow worker calls and disposes the driver boundary', async () => {
    const driver: QqbotPluginWorkerDriver = {
      dispose: jest.fn(async () => undefined),
      request: jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      ),
    };
    const runtime = new QqbotPluginWorkerRuntime(new RecordingRequestQueue(driver), {
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
    const runtime = new QqbotPluginWorkerRuntime(new RecordingRequestQueue(driver), {
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

async function waitUntil(
  condition: () => boolean,
  timeoutMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition was not met before timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

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

describe('QQBot plugin worker queue config', () => {
  it('requires an explicit Redis host for plugin worker queues', () => {
    const configService = createConfigService({});

    expect(() => resolveQqbotPluginQueueConnection(configService)).toThrow(
      'QQBot 插件队列缺少 Redis 主机配置',
    );
  });

  it('uses safe numeric defaults when optional Redis values are blank', () => {
    const options = createQqbotBullmqWorkerQueueOptions(
      createConfigService({
        QQBOT_PLUGIN_QUEUE_REDIS_DB: '',
        QQBOT_PLUGIN_QUEUE_REDIS_HOST: 'redis.local',
        QQBOT_PLUGIN_QUEUE_REDIS_PORT: '',
        QQBOT_PLUGIN_QUEUE_REDIS_PREFIX: '',
        QQBOT_PLUGIN_QUEUE_REMOVE_ON_FAIL: '',
        QQBOT_PLUGIN_QUEUE_WAIT_BUFFER_MS: '',
      }),
      'bangdream',
      'install-1',
    );

    expect(options).toMatchObject({
      connection: {
        db: 0,
        host: 'redis.local',
        port: 6379,
      },
      installationId: 'install-1',
      pluginKey: 'bangdream',
      prefix: 'kt:qqbot:plugin-worker',
      queueWaitTimeoutMs: 120_000,
      removeOnFailCount: 100,
      waitUntilFinishedBufferMs: 5_000,
      workerInstanceId: expect.any(String),
    });
    expect(options.workerInstanceId).toContain(':');
  });
});

function createConfigService(values: Record<string, string>): ConfigService {
  return {
    get: <T = string | undefined>(key: string) => values[key] as T,
  } as ConfigService;
}
