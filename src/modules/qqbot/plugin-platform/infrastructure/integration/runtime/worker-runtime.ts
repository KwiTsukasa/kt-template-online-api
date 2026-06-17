import {
  type QqbotPluginEventRequest,
  type QqbotPluginOperationRequest,
  type QqbotPluginRuntimeErrorCode,
  type QqbotPluginRuntimeEvent,
  type QqbotPluginRuntimeStatus,
  type QqbotPluginSafeInputSummary,
  type QqbotPluginTaskRequest,
  type QqbotPluginWorkerRequestQueue,
  type QqbotPluginWorkerRequest,
  type QqbotPluginWorkerRequestType,
  type QqbotPluginWorkerRuntimeOptions,
} from './worker-runtime.types';

export class QqbotPluginRuntimeError extends Error {
  constructor(
    readonly code: QqbotPluginRuntimeErrorCode,
    readonly pluginKey: string,
    message: string,
    readonly safeSummary: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'QqbotPluginRuntimeError';
  }
}

export type QqbotPluginWorkerResponseErrorInput = {
  message?: string;
  name?: string;
  stack?: string;
};

export class QqbotPluginWorkerResponseError extends Error {
  constructor(readonly serializedError: QqbotPluginWorkerResponseErrorInput) {
    super(serializedError.message || 'QQBot 插件 worker 请求失败');
    this.name = serializedError.name || 'QqbotPluginWorkerResponseError';
    if (serializedError.stack) this.stack = serializedError.stack;
  }
}

export const serializePluginWorkerResponseError = (
  error: unknown,
): QqbotPluginWorkerResponseErrorInput => ({
  message: error instanceof Error ? error.message : `${error}`,
  name: error instanceof Error ? error.name : 'Error',
  stack: error instanceof Error ? error.stack : undefined,
});

export class QqbotPluginWorkerStaleRequestError extends Error {
  constructor(message = 'QQBot 插件 worker 队列请求已过期，需要恢复后重试') {
    super(message);
    this.name = 'QqbotPluginWorkerStaleRequestError';
  }
}

export class QqbotPluginWorkerExpiredRequestError extends Error {
  constructor(message = 'QQBot 插件 worker 队列请求已超时') {
    super(message);
    this.name = 'QqbotPluginWorkerExpiredRequestError';
  }
}

const isNamedError = (error: unknown, name: string) => {
  return error instanceof Error && error.name === name;
};

const createCorrelationId = () => {
  return `qqbot-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const summarizeInput = (
  input: Record<string, unknown>,
): QqbotPluginSafeInputSummary => {
  return {
    fieldCount: Object.keys(input).length,
    keys: Object.keys(input).sort(),
  };
};

export class QqbotPluginWorkerRuntime {
  private readonly runtimeEvents: QqbotPluginRuntimeEvent[] = [];
  private manifestForRecovery?: unknown;
  private recoveryPromise?: Promise<void>;
  private shouldRecoverActive = false;

  status: QqbotPluginRuntimeStatus = 'stopped';

  constructor(
    private readonly requestQueue: QqbotPluginWorkerRequestQueue,
    private readonly options: QqbotPluginWorkerRuntimeOptions,
  ) {}

  async load(manifest: unknown) {
    this.manifestForRecovery = manifest;
    const result = await this.request(
      'load',
      {
        manifest,
      },
      undefined,
      { skipRecovery: true },
    );
    this.status = 'loaded';
    return result;
  }

  async activate() {
    const result = await this.request('activate');
    this.status = 'active';
    this.shouldRecoverActive = true;
    return result;
  }

  async executeOperation(request: QqbotPluginOperationRequest) {
    return this.request(
      'executeOperation',
      {
        input: request.input,
        operationId: request.operationId,
        operationKey: request.operationKey,
        safeInputSummary: summarizeInput(request.input),
      },
      request.timeoutMs,
    );
  }

  async handleEvent(request: QqbotPluginEventRequest) {
    return this.request(
      'handleEvent',
      {
        event: request.event,
        eventKey: request.eventKey,
        safeInputSummary: summarizeInput(request.event),
      },
      request.timeoutMs,
    );
  }

  async executeTask(request: QqbotPluginTaskRequest) {
    return this.request(
      'executeTask',
      {
        input: request.input,
        safeInputSummary: summarizeInput(request.input),
        taskHandlerName: request.taskHandlerName,
        taskId: request.taskId,
        taskKey: request.taskKey,
        triggerType: request.triggerType,
      },
      request.timeoutMs,
    );
  }

  async health() {
    return this.request('health');
  }

  async deactivate() {
    const result = await this.request('deactivate');
    this.status = 'stopped';
    this.shouldRecoverActive = false;
    return result;
  }

  async dispose() {
    try {
      await this.request('dispose', {}, undefined, { skipRecovery: true });
    } finally {
      await this.requestQueue.close();
      this.status = 'stopped';
      this.shouldRecoverActive = false;
    }
  }

  listRuntimeEvents() {
    return [...this.runtimeEvents];
  }

  drainRuntimeEvents() {
    return this.runtimeEvents.splice(0);
  }

  private async request(
    type: QqbotPluginWorkerRequestType,
    payload: Partial<QqbotPluginWorkerRequest> = {},
    timeoutMs = this.options.defaultTimeoutMs,
    control: { retryStale?: boolean; skipRecovery?: boolean } = {},
  ) {
    if (!control.skipRecovery) {
      await this.recoverIfNeeded(type);
    }

    const message: QqbotPluginWorkerRequest = {
      correlationId: createCorrelationId(),
      installationId: this.options.installationId,
      pluginKey: this.options.pluginKey,
      timeoutMs,
      type,
      ...payload,
    };

    const requestPromise = Promise.resolve().then(() =>
      this.requestQueue.request(message),
    );
    requestPromise.catch(() => undefined);

    const timeout = this.createTimeoutPromise(
      type,
      message,
      this.getRequestTimeoutMs(timeoutMs),
    );

    try {
      return await Promise.race([requestPromise, timeout.promise]);
    } catch (error) {
      if (error instanceof QqbotPluginRuntimeError) {
        throw error;
      }
      if (
        (error instanceof QqbotPluginWorkerStaleRequestError ||
          isNamedError(error, 'QqbotPluginWorkerStaleRequestError')) &&
        control.retryStale !== false
      ) {
        await this.markWorkerFailed('worker-stale-request', {
          correlationId: message.correlationId,
          operationId: message.operationId,
          type,
        });
        await this.recoverIfNeeded(type);
        return this.request(type, payload, timeoutMs, {
          retryStale: false,
          skipRecovery: true,
        });
      }
      if (
        error instanceof QqbotPluginWorkerExpiredRequestError ||
        isNamedError(error, 'QqbotPluginWorkerExpiredRequestError')
      ) {
        const safeSummary = {
          correlationId: message.correlationId,
          operationId: message.operationId,
          timeoutMs,
          type,
        };
        const runtimeError = new QqbotPluginRuntimeError(
          'PLUGIN_WORKER_TIMEOUT',
          this.options.pluginKey,
          'QQBot plugin worker queue request expired.',
          safeSummary,
        );
        await this.markWorkerFailed('worker-request-expired', safeSummary);
        throw runtimeError;
      }
      if (error instanceof QqbotPluginWorkerResponseError) {
        throw error;
      }

      const runtimeError = new QqbotPluginRuntimeError(
        'PLUGIN_WORKER_CRASH',
        this.options.pluginKey,
        'QQBot plugin worker crashed.',
        {
          correlationId: message.correlationId,
          message: error instanceof Error ? error.message : `${error}`,
          operationId: message.operationId,
          type,
        },
      );
      await this.markWorkerFailed('worker-crash', runtimeError.safeSummary);
      throw runtimeError;
    } finally {
      timeout.clear();
    }
  }

  private createTimeoutPromise(
    type: QqbotPluginWorkerRequestType,
    message: QqbotPluginWorkerRequest,
    timeoutMs: number,
  ) {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(async () => {
        const error = new QqbotPluginRuntimeError(
          'PLUGIN_WORKER_TIMEOUT',
          this.options.pluginKey,
          'QQBot plugin worker timed out.',
          {
            correlationId: message.correlationId,
            operationId: message.operationId,
            timeoutMs,
            type,
          },
        );
        await this.markWorkerFailed('worker-timeout', error.safeSummary);
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });
    return {
      clear: () => {
        if (timer) clearTimeout(timer);
      },
      promise,
    };
  }

  private getRequestTimeoutMs(timeoutMs: number) {
    if (!this.requestQueue.handlesRequestTimeout) return timeoutMs;

    const queueWaitTimeoutMs = Number(this.requestQueue.queueWaitTimeoutMs || 0);
    return timeoutMs + Math.max(0, queueWaitTimeoutMs);
  }

  private async recoverIfNeeded(triggerType: QqbotPluginWorkerRequestType) {
    if (this.status !== 'failed' || !this.manifestForRecovery) return;

    if (!this.recoveryPromise) {
      this.recoveryPromise = this.recoverWorker(triggerType).finally(() => {
        this.recoveryPromise = undefined;
      });
    }

    await this.recoveryPromise;
  }

  private async recoverWorker(triggerType: QqbotPluginWorkerRequestType) {
    this.recordRuntimeEvent(
      'worker-recover-started',
      {
        triggerType,
      },
      'warn',
    );

    await this.request(
      'load',
      {
        manifest: this.manifestForRecovery,
      },
      this.options.defaultTimeoutMs,
      { skipRecovery: true },
    );
    this.status = 'loaded';

    if (this.shouldRecoverActive) {
      await this.request(
        'activate',
        {},
        this.options.defaultTimeoutMs,
        { skipRecovery: true },
      );
      this.status = 'active';
    }

    this.recordRuntimeEvent(
      'worker-recovered',
      {
        status: this.status,
        triggerType,
      },
      'info',
    );
  }

  private async markWorkerFailed(
    eventType: string,
    safeSummary: Record<string, unknown>,
  ) {
    if (this.status === 'active') {
      this.shouldRecoverActive = true;
    }
    this.status = 'failed';

    let resetError: string | undefined;
    try {
      await this.requestQueue.reset();
    } catch (error) {
      resetError = error instanceof Error ? error.message : `${error}`;
    }

    this.recordRuntimeEvent(eventType, {
      ...safeSummary,
      ...(resetError ? { resetError } : {}),
    });
  }

  private recordRuntimeEvent(
    eventType: string,
    safeSummary: Record<string, unknown>,
    level: QqbotPluginRuntimeEvent['level'] = 'error',
  ) {
    this.runtimeEvents.push({
      eventType,
      level,
      pluginKey: this.options.pluginKey,
      safeSummary,
    });
  }
}
