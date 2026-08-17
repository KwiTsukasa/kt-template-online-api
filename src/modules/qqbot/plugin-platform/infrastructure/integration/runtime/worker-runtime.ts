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
  message: (() => {
    if (error instanceof Error) {
      return error.message;
    }
    return `${error}`;
  })(),
  name: (() => {
    if (error instanceof Error) {
      return error.name;
    }
    return 'Error';
  })(),
  stack: (() => {
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  })(),
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

  /**
   * 按`manifest`读取`load` 对应结果；从受控资源来源加载所需数据（`request`）。
   * @param manifest - 决定`load` 对应结果内容、边界或目标的 `manifest` 值。
   * @returns `load` 对应。
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
   * 按当前运行态启动activate；从受控资源来源加载所需数据（`request`）。
   * @returns 工作进程确认激活请求后的结果；成功时运行时状态同步变为 `active`。
   */
  async activate() {
    const result = await this.request('activate');
    this.status = 'active';
    this.shouldRecoverActive = true;
    return result;
  }

  /**
   * 将插件能力标识、输入安全摘要与超时上限编码为工作进程请求，并返回执行结果。
   * @param request - 用于操作的当前 HTTP 请求，包含 `input`、`operationId`、`operationKey`、`timeoutMs` 字段。
   * @returns 操作。
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
   * 将插件事件键、载荷安全摘要与超时上限编码为工作进程请求，并返回分发结果。
   * @param request - 用于事件的当前 HTTP 请求，包含 `event`、`eventKey`、`timeoutMs` 字段。
   * @returns 事件。
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
   * 将插件任务标识、触发方式、输入安全摘要与超时上限编码为工作进程请求，并返回执行结果。
   * @param request - 用于任务的当前 HTTP 请求，包含 `input`、`taskHandlerName`、`taskId`、`taskKey` 字段。
   * @returns 任务。
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
   * 向插件工作进程发送健康检查请求，并返回运行时健康结果。
   * @returns 健康状态。
   */
  async health() {
    return this.request('health');
  }

  /**
   * 按当前运行态停止deactivate并清理该入口拥有的运行态资源；从受控资源来源加载所需数据（`request`）。
   * @returns 工作进程确认停用请求后的结果；成功时运行时状态同步变为 `stopped`。
   */
  async deactivate() {
    const result = await this.request('deactivate');
    this.status = 'stopped';
    this.shouldRecoverActive = false;
    return result;
  }

  /**
   * 按当前运行态移除dispose；从受控资源来源加载所需数据（`request`）。
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
   * 按当前运行态读取运行态事件流。
   * @returns 按输入顺序得到的运行态事件流列表；没有匹配项时为空数组。
   */
  listRuntimeEvents() {
    return [...this.runtimeEvents];
  }

  /**
   * 从内存队列一次取出全部插件运行时事件，并在返回时清空原队列。
   * @returns drain运行态事件流。
   */
  drainRuntimeEvents() {
    return this.runtimeEvents.splice(0);
  }

  /**
   * 通过 `recoverIfNeeded` 准备或恢复运行态。
   * @param type - 决定`request` 对应结果内容、边界或目标的 `type` 值。
   * @param payload - 待按当前协议校验并路由的事件载荷；省略时默认采用 `{}`。
   * @param timeoutMs - 用于`request` 对应结果超时、有效期或退避计算的毫秒数；省略时默认采用 `this.options.defaultTimeoutMs`。
   * @param control - 用于`request` 对应结果的领域对象，包含 `skipRecovery`、`retryStale` 字段；省略时默认采用 `{}`。
   * @returns `request` 对应。
   * @throws 当 `error instanceof QqbotPluginRuntimeError` 成立时重新抛出该入口捕获且决定公开的原异常；当 `error instanceof QqbotPluginWorkerExpiredRequestError || isNamedError(e…` 成立时拒绝当前输入并抛出 `runtimeError`；
   *   当 `error instanceof QqbotPluginWorkerResponseError` 成立时重新抛出该入口捕获且决定公开的原异常；当 `Promise.race` 调用失败时拒绝当前输入并抛出 `runtimeError`。
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
          message: (() => {
            if (error instanceof Error) {
              return error.message;
            }
            return `${error}`;
          })(),
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
   * 根据`type`、`message`、`timeoutMs`构造包含 `clear`、`promise` 字段的结果。
   * @param type - 决定包含 `clear`、`promise` 字段的结果内容、边界或目标的 `type` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `correlationId`、`operationId` 字段。
   * @param timeoutMs - 用于包含 `clear`、`promise` 字段的结果超时、有效期或退避计算的毫秒数。
   * @returns 包含 `clear`、`promise` 字段的包含 `clear`、`promise` 字段的。
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
      clear: () => {
        if (timer) clearTimeout(timer);
      },
      promise,
    };
  }

  /**
   * 在请求队列自行管理超时时，将非负的排队等待时间加到执行超时；否则保留原值。
   * @param timeoutMs - 用于在请求队列自行管理超时时，将非负的排队等待时间加到执行超时、有效期或退避计算的毫秒数。
   * @returns 在请求队列自行管理超时时，将非负的排队等待时间加到执行超时。
   */
  private getRequestTimeoutMs(timeoutMs: number) {
    if (!this.requestQueue.handlesRequestTimeout) return timeoutMs;

    const queueWaitTimeoutMs = Number(
      this.requestQueue.queueWaitTimeoutMs || 0,
    );
    return timeoutMs + Math.max(0, queueWaitTimeoutMs);
  }

  /**
   * 根据`triggerType`处理恢复If必要状态。
   * @param triggerType - 决定恢复If必要状态内容、边界或目标的 `triggerType` 值。
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
   * 根据`triggerType`处理恢复工作进程；从受控资源来源加载所需数据（`request`）。
   * @param triggerType - 决定恢复工作进程内容、边界或目标的 `triggerType` 值。
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
   * 将本次操作写入 `this.shouldRecoverActive`、`this.status`、`resetError` 状态。
   * @param eventType - 决定工作进程Failed内容、边界或目标的 `eventType` 值。
   * @param safeSummary - 决定工作进程Failed内容、边界或目标的 `safeSummary` 值。
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
      if (error instanceof Error) {
        resetError = error.message;
      } else {
        resetError = `${error}`;
      }
    }

    this.recordRuntimeEvent(eventType, {
      ...safeSummary,
      ...((() => {
        if (resetError) {
          return { resetError };
        }
        return {};
      })()),
    });
  }

  /**
   * 根据`eventType`、`safeSummary`、`level`处理记录运行态事件。
   * @param eventType - 决定记录运行态事件内容、边界或目标的 `eventType` 值。
   * @param safeSummary - 决定记录运行态事件内容、边界或目标的 `safeSummary` 值。
   * @param level - 决定记录运行态事件内容、边界或目标的 `level` 值；省略时默认采用 `'error'`。
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
