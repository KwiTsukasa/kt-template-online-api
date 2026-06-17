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
  /**
   * 初始化 QqbotPluginRuntimeError 实例。
   * @param code - 响应状态码；影响 constructor 的返回值。
   * @param pluginKey - pluginKey 输入；影响 constructor 的返回值。
   * @param message - message 输入；驱动 `super()` 的 插件平台步骤。
   * @param safeSummary - safeSummary 输入；影响 constructor 的返回值。
   */
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
  /**
   * 初始化 QqbotPluginWorkerResponseError 实例。
   * @param serializedError - serializedError 输入；使用 `message`、`name`、`stack` 字段生成结果。
   */
  constructor(readonly serializedError: QqbotPluginWorkerResponseErrorInput) {
    super(serializedError.message || 'QQBot 插件 worker 请求失败');
    this.name = serializedError.name || 'QqbotPluginWorkerResponseError';
    if (serializedError.stack) this.stack = serializedError.stack;
  }
}

/**
 * 序列化Plugin Worker Response Error。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 * @returns QQBot 插件平台产出的 QqbotPluginWorkerResponseErrorInput。
 */
export const serializePluginWorkerResponseError = (
  error: unknown,
): QqbotPluginWorkerResponseErrorInput => ({
  message: error instanceof Error ? error.message : `${error}`,
  name: error instanceof Error ? error.name : 'Error',
  stack: error instanceof Error ? error.stack : undefined,
});

export class QqbotPluginWorkerStaleRequestError extends Error {
  /**
   * 初始化 QqbotPluginWorkerStaleRequestError 实例。
   * @param message - message 输入；驱动 `super()` 的 插件平台步骤。
   */
  constructor(message = 'QQBot 插件 worker 队列请求已过期，需要恢复后重试') {
    super(message);
    this.name = 'QqbotPluginWorkerStaleRequestError';
  }
}

export class QqbotPluginWorkerExpiredRequestError extends Error {
  /**
   * 初始化 QqbotPluginWorkerExpiredRequestError 实例。
   * @param message - message 输入；驱动 `super()` 的 插件平台步骤。
   */
  constructor(message = 'QQBot 插件 worker 队列请求已超时') {
    super(message);
    this.name = 'QqbotPluginWorkerExpiredRequestError';
  }
}

/**
 * 判断 QQBot 插件平台条件。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 * @param name - 名称文本；计算 插件平台判断结果。
 */
const isNamedError = (error: unknown, name: string) => {
  return error instanceof Error && error.name === name;
};

/**
 * 创建 QQBot 插件平台对象或配置。
 */
const createCorrelationId = () => {
  return `qqbot-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * 执行 QQBot 插件平台流程。
 * @param input - input 输入；驱动 `Object.keys()` 的 插件平台步骤。
 * @returns QQBot 插件平台产出的 QqbotPluginSafeInputSummary。
 */
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

  /**
   * 初始化 QqbotPluginWorkerRuntime 实例。
   * @param requestQueue - requestQueue 输入；影响 constructor 的返回值。
   * @param options - 插件平台列表；影响 constructor 的返回值。
   */
  constructor(
    private readonly requestQueue: QqbotPluginWorkerRequestQueue,
    private readonly options: QqbotPluginWorkerRuntimeOptions,
  ) {}

  /**
   * 加载业务数据。
   * @param manifest - manifest 输入；影响 load 的返回值。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   */
  async activate() {
    const result = await this.request('activate');
    this.status = 'active';
    this.shouldRecoverActive = true;
    return result;
  }

  /**
   * 执行Operation。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
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

  /**
   * 处理Event。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
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

  /**
   * 执行Task。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   */
  async health() {
    return this.request('health');
  }

  /**
   * 执行 QQBot 插件平台流程。
   */
  async deactivate() {
    const result = await this.request('deactivate');
    this.status = 'stopped';
    this.shouldRecoverActive = false;
    return result;
  }

  /**
   * 执行 QQBot 插件平台流程。
   */
  async dispose() {
    try {
      await this.request('dispose', {}, undefined, { skipRecovery: true });
    } finally {
      await this.requestQueue.close();
      this.status = 'stopped';
      this.shouldRecoverActive = false;
    }
  }

  /**
   * 列出Runtime Events。
   */
  listRuntimeEvents() {
    return [...this.runtimeEvents];
  }

  /**
   * 执行 QQBot 插件平台流程。
   */
  drainRuntimeEvents() {
    return this.runtimeEvents.splice(0);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param type - type 输入；驱动 `this.recoverIfNeeded()`、`createCorrelationId()`、`this.createTimeoutPromise()`、`this.request()` 的 插件平台步骤。
   * @param payload - payload 输入；驱动 `createCorrelationId()`、`this.request()` 的 插件平台步骤。
   * @param timeoutMs - 插件平台列表；驱动 `createCorrelationId()`、`this.createTimeoutPromise()`、`this.request()` 的 插件平台步骤。
   * @param control - control 输入；使用 `skipRecovery`、`retryStale` 字段生成结果。
   */
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

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @param type - type 输入；生成 插件平台对象。
   * @param message - message 输入；使用 `correlationId`、`operationId` 字段生成结果。
   * @param timeoutMs - 插件平台列表；生成 插件平台对象。
   */
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
      /**
       * 清理 插件平台回调状态。
       */
      clear: () => {
        if (timer) clearTimeout(timer);
      },
      promise,
    };
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param timeoutMs - 插件平台列表；限定 插件平台查询范围。
   */
  private getRequestTimeoutMs(timeoutMs: number) {
    if (!this.requestQueue.handlesRequestTimeout) return timeoutMs;

    const queueWaitTimeoutMs = Number(
      this.requestQueue.queueWaitTimeoutMs || 0,
    );
    return timeoutMs + Math.max(0, queueWaitTimeoutMs);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param triggerType - triggerType 输入；驱动 `this.recoverWorker()` 的 插件平台步骤。
   */
  private async recoverIfNeeded(triggerType: QqbotPluginWorkerRequestType) {
    if (this.status !== 'failed' || !this.manifestForRecovery) return;

    if (!this.recoveryPromise) {
      this.recoveryPromise = this.recoverWorker(triggerType).finally(() => {
        this.recoveryPromise = undefined;
      });
    }

    await this.recoveryPromise;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param triggerType - triggerType 输入；影响 recoverWorker 的返回值。
   */
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
      await this.request('activate', {}, this.options.defaultTimeoutMs, {
        skipRecovery: true,
      });
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param eventType - eventType 输入；驱动 `this.recordRuntimeEvent()` 的 插件平台步骤。
   * @param safeSummary - safeSummary 输入；影响 markWorkerFailed 的返回值。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param eventType - eventType 输入；影响 recordRuntimeEvent 的返回值。
   * @param safeSummary - safeSummary 输入；影响 recordRuntimeEvent 的返回值。
   * @param level - level 输入；影响 recordRuntimeEvent 的返回值。
   */
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
