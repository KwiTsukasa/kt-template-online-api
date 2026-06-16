import {
  type QqbotPluginEventRequest,
  type QqbotPluginOperationRequest,
  type QqbotPluginRuntimeErrorCode,
  type QqbotPluginRuntimeEvent,
  type QqbotPluginRuntimeStatus,
  type QqbotPluginSafeInputSummary,
  type QqbotPluginWorkerDriver,
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

  status: QqbotPluginRuntimeStatus = 'stopped';

  constructor(
    private readonly driver: QqbotPluginWorkerDriver,
    private readonly options: QqbotPluginWorkerRuntimeOptions,
  ) {}

  async load(manifest: unknown) {
    const result = await this.request('load', {
      manifest,
    });
    this.status = 'loaded';
    return result;
  }

  async activate() {
    const result = await this.request('activate');
    this.status = 'active';
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

  async health() {
    return this.request('health');
  }

  async deactivate() {
    const result = await this.request('deactivate');
    this.status = 'stopped';
    return result;
  }

  async dispose() {
    try {
      await this.request('dispose');
    } finally {
      await this.driver.dispose();
      this.status = 'stopped';
    }
  }

  listRuntimeEvents() {
    return [...this.runtimeEvents];
  }

  private async request(
    type: QqbotPluginWorkerRequestType,
    payload: Partial<QqbotPluginWorkerRequest> = {},
    timeoutMs = this.options.defaultTimeoutMs,
  ) {
    const message: QqbotPluginWorkerRequest = {
      correlationId: createCorrelationId(),
      installationId: this.options.installationId,
      pluginKey: this.options.pluginKey,
      timeoutMs,
      type,
      ...payload,
    };

    const requestPromise = Promise.resolve().then(() =>
      this.driver.request(message),
    );
    requestPromise.catch(() => undefined);

    const timeout = this.createTimeoutPromise(type, message, timeoutMs);

    try {
      return await Promise.race([requestPromise, timeout.promise]);
    } catch (error) {
      if (error instanceof QqbotPluginRuntimeError) {
        throw error;
      }

      this.status = 'failed';
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
      this.recordRuntimeEvent('worker-crash', runtimeError.safeSummary);
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
        this.status = 'failed';
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
        this.recordRuntimeEvent('worker-timeout', error.safeSummary);

        try {
          await this.driver.dispose();
        } catch {
          // Timeout disposal is best-effort; the timeout error is the primary signal.
        }
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

  private recordRuntimeEvent(
    eventType: string,
    safeSummary: Record<string, unknown>,
  ) {
    this.runtimeEvents.push({
      eventType,
      level: 'error',
      pluginKey: this.options.pluginKey,
      safeSummary,
    });
  }
}
