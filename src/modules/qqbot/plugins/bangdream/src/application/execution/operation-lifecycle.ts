import type {
  BangDreamCommandInput,
  BangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream.types';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';

export type BangDreamExecutionStage =
  | 'handler'
  | 'catalog'
  | 'operation'
  | 'output'
  | 'start';

export type BangDreamOperationLifecycleContext = {
  handlerName?: string;
  imageCount?: number;
  input: BangDreamCommandInput;
  operationKey: BangDreamOperationKey;
  query?: string;
  stage: BangDreamExecutionStage;
  startedAt: number;
};

export type BangDreamOperationLifecycleObserver = {
  afterOutput?: (
    context: BangDreamOperationLifecycleContext,
  ) => Promise<void> | void;
  afterResolve?: (
    context: BangDreamOperationLifecycleContext,
  ) => Promise<void> | void;
  beforeParse?: (
    context: BangDreamOperationLifecycleContext,
  ) => Promise<void> | void;
  beforeRender?: (
    context: BangDreamOperationLifecycleContext,
  ) => Promise<void> | void;
  name: string;
  onError?: (
    context: BangDreamOperationLifecycleContext,
    error: unknown,
  ) => Promise<void> | void;
  order?: number;
};

type BangDreamLifecycleObserverMethod =
  | 'afterOutput'
  | 'afterResolve'
  | 'beforeParse'
  | 'beforeRender';

export class BangDreamOperationLifecycle {
  private readonly observers: BangDreamOperationLifecycleObserver[];

  /**
   * 初始化 BangDreamOperationLifecycle 实例。
   * @param observers - 服务器列表；影响 constructor 的返回值。
   */
  constructor(observers: readonly BangDreamOperationLifecycleObserver[] = []) {
    this.observers = [...observers].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
  }

  /**
   * 执行 BangDream 插件流程。
   * @param context - context 输入；驱动 `this.emit()` 的 BangDream步骤。
   */
  async beforeParse(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeParse', context);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param context - context 输入；驱动 `this.emit()` 的 BangDream步骤。
   */
  async afterResolve(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterResolve', context);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param context - context 输入；驱动 `this.emit()` 的 BangDream步骤。
   */
  async beforeRender(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeRender', context);
  }

  /**
   * 执行 BangDream 插件流程。
   * @param context - context 输入；驱动 `this.emit()` 的 BangDream步骤。
   */
  async afterOutput(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterOutput', context);
  }

  /**
   * 处理Error。
   * @param context - context 输入；影响 onError 的返回值。
   * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  async onError(context: BangDreamOperationLifecycleContext, error: unknown) {
    for (const observer of this.observers) {
      await observer.onError?.(context, error);
    }
  }

  /**
   * 执行 BangDream 插件流程。
   * @param method - HTTP 方法名；影响 emit 的返回值。
   * @param context - context 输入；驱动 `handler()` 的 BangDream步骤。
   */
  private async emit(
    method: BangDreamLifecycleObserverMethod,
    context: BangDreamOperationLifecycleContext,
  ) {
    for (const observer of this.observers) {
      const handler = observer[method];
      if (typeof handler === 'function') {
        await handler(context);
      }
    }
  }
}

/**
 * 创建 BangDream 插件对象或配置。
 * @param operationKey - operationKey 输入；生成 BangDream对象。
 * @param input - input 输入；驱动 `extractBangDreamInputText()` 的 BangDream步骤。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
export function createBangDreamOperationLifecycleContext(
  operationKey: BangDreamOperationKey,
  input: BangDreamCommandInput,
): BangDreamOperationLifecycleContext {
  return {
    input,
    operationKey,
    query: extractBangDreamInputText(input),
    stage: 'start',
    startedAt: Date.now(),
  };
}

/**
 * 创建 BangDream 插件对象或配置。
 * @returns 创建后的 BangDream 插件对象或配置。
 */
export function createBangDreamOperationLogObserver(): BangDreamOperationLifecycleObserver {
  return {
    /**
     * 执行 BangDream回调。
     * @param context - context 输入；驱动 `logger()` 的 BangDream步骤。
     */
    afterOutput: (context) => {
      logger(
        'operation',
        formatBangDreamOperationLifecycleObserverMessage('success', context),
      );
    },
    /**
     * 执行 BangDream回调。
     * @param context - context 输入；驱动 `logger()` 的 BangDream步骤。
     */
    beforeParse: (context) => {
      logger(
        'operation',
        formatBangDreamOperationLifecycleObserverMessage('start', context),
      );
    },
    name: 'BangDreamOperationLogObserver',
    /**
     * 执行 BangDream回调。
     * @param context - context 输入；驱动 `formatBangDreamOperationLifecycleObserverMessage()` 的 BangDream步骤。
     * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
     */
    onError: (context, error) => {
      logger(
        'operation',
        `${formatBangDreamOperationLifecycleObserverMessage('error', context)} error=${getOperationLifecycleErrorMessage(error)}`,
      );
    },
  };
}

/**
 * 转换 BangDream 插件输入。
 * @param status - BangDream列表；影响 formatBangDreamOperationLifecycleObserverMessage 的返回值。
 * @param context - context 输入；使用 `startedAt`、`operationKey`、`stage`、`handlerName` 字段生成结果。
 */
function formatBangDreamOperationLifecycleObserverMessage(
  status: 'error' | 'start' | 'success',
  context: BangDreamOperationLifecycleContext,
) {
  const durationMs = Date.now() - context.startedAt;
  return [
    `status=${status}`,
    `operation=${context.operationKey}`,
    `stage=${context.stage}`,
    context.handlerName ? `handler=${context.handlerName}` : '',
    context.query ? `query=${context.query}` : '',
    context.imageCount === undefined ? '' : `imageCount=${context.imageCount}`,
    `durationMs=${durationMs}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 执行 BangDream 插件流程。
 * @param input - input 输入；使用 `query`、`text`、`raw`、`args` 字段生成结果。
 */
function extractBangDreamInputText(input: BangDreamCommandInput) {
  const direct = `${input.query || input.text || input.raw || ''}`.trim();
  if (direct) return direct;
  return Array.isArray(input.args) ? input.args.join(' ').trim() : '';
}

/**
 * 查询 BangDream 插件数据。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 */
function getOperationLifecycleErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return '';
  return `${error}`;
}
