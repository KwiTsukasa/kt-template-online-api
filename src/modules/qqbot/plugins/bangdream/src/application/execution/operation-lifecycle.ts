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

  async beforeParse(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeParse', context);
  }

  async afterResolve(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterResolve', context);
  }

  async beforeRender(context: BangDreamOperationLifecycleContext) {
    await this.emit('beforeRender', context);
  }

  async afterOutput(context: BangDreamOperationLifecycleContext) {
    await this.emit('afterOutput', context);
  }

  async onError(
    context: BangDreamOperationLifecycleContext,
    error: unknown,
  ) {
    for (const observer of this.observers) {
      await observer.onError?.(context, error);
    }
  }

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

function extractBangDreamInputText(input: BangDreamCommandInput) {
  const direct = `${input.query || input.text || input.raw || ''}`.trim();
  if (direct) return direct;
  return Array.isArray(input.args) ? input.args.join(' ').trim() : '';
}

function getOperationLifecycleErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return '';
  return `${error}`;
}
