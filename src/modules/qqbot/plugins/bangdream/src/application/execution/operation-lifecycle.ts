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

  constructor(observers: readonly BangDreamOperationLifecycleObserver[] = []) {
    this.observers = [...observers].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
  }

  /**
   * 在 BanG Dream 输入解析前发布生命周期事件，并等待全部监听器完成。
   * @param context - 决定before内容、边界或目标的 `context` 值。
   */
  async beforeParse(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeParse', context);
  }

  /**
   * 在 BanG Dream 领域数据解析后发布生命周期事件，并等待全部监听器完成。
   * @param context - 决定after内容、边界或目标的 `context` 值。
   */
  async afterResolve(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterResolve', context);
  }

  /**
   * 在 BanG Dream 结果渲染前发布生命周期事件，并等待全部监听器完成。
   * @param context - 决定before内容、边界或目标的 `context` 值。
   */
  async beforeRender(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeRender', context);
  }

  /**
   * 在 BanG Dream 结果输出后发布生命周期事件，并等待全部监听器完成。
   * @param context - 决定afterOutput内容、边界或目标的 `context` 值。
   */
  async afterOutput(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterOutput', context);
  }

  /**
   * 根据`context`、`error`处理错误；把当前结果通知给生命周期观察者（`observer.onError`）。
   * @param context - 决定错误内容、边界或目标的 `context` 值。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  async onError(context: BangDreamOperationLifecycleContext, error: unknown) {
    for (const observer of this.observers) {
      await observer.onError?.(context, error);
    }
  }

  /**
   * 通过 `handler` 交给领域处理器。
   * @param method - 决定emit内容、边界或目标的 `method` 值。
   * @param context - 决定emit内容、边界或目标的 `context` 值。
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
 * 将操作键与命令输入投影为起始生命周期上下文，并记录规范化查询文本和当前时间。
 * @param operationKey - 用于读取或更新BanGDream操作LifecycleContext的稳定键。
 * @param input - 用于BanGDream操作LifecycleContext的结构化输入。
 * @returns 包含 `input`、`operationKey`、`query`、`stage`、`startedAt` 字段的BanGDream操作LifecycleContext。
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
 * 根据当前运行态构造BanG Dream操作日志Observer。
 * @returns 包含 `afterOutput`、`beforeParse`、`name`、`onError` 字段的BanGDream操作日志Observer。
 */
export function createBangDreamOperationLogObserver(): BangDreamOperationLifecycleObserver {
  return {
    afterOutput: (context) => {
      logger(
        'operation',
        formatBangDreamOperationLifecycleObserverMessage('success', context),
      );
    },
    beforeParse: (context) => {
      logger(
        'operation',
        formatBangDreamOperationLifecycleObserverMessage('start', context),
      );
    },
    name: 'BangDreamOperationLogObserver',
    onError: (context, error) => {
      logger(
        'operation',
        `${formatBangDreamOperationLifecycleObserverMessage('error', context)} error=${getOperationLifecycleErrorMessage(error)}`,
      );
    },
  };
}

/**
 * 将操作状态、阶段、可选处理器与查询信息以及执行耗时编码为单行生命周期日志。
 * @param status - 当前操作处于开始、成功或失败阶段的状态标识。
 * @param context - 操作上下文；提供操作键、阶段、开始时间及可选处理器、查询和图片数量。
 * @returns 以空格分隔且省略未提供可选字段的结构化日志文本。
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
    (() => {
      if (context.handlerName) {
        return `handler=${context.handlerName}`;
      }
      return '';
    })(),
    (() => {
      if (context.query) {
        return `query=${context.query}`;
      }
      return '';
    })(),
    (() => {
      if (context.imageCount === undefined) {
        return '';
      }
      return `imageCount=${context.imageCount}`;
    })(),
    `durationMs=${durationMs}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 从`input`解析BanG Dream输入文本；当 `Array.isArray(input.args)` 成立时返回 `input.args.join(' ').trim()`。
 * @param input - 用于BanGDream输入文本的结构化输入，包含 `query`、`text`、`raw`、`args` 字段。
 * @returns 当前状态对应的BanGDream输入文本，取值为 `''`。
 */
function extractBangDreamInputText(input: BangDreamCommandInput) {
  const direct = `${input.query || input.text || input.raw || ''}`.trim();
  if (direct) return direct;
  if (Array.isArray(input.args)) {
    return input.args.join(' ').trim();
  }
  return '';
}

/**
 * 按 ``${error}`` 计算并返回结果。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 当前状态对应的操作Lifecycle错误消息，取值为 `''`。
 */
function getOperationLifecycleErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return '';
  return `${error}`;
}
