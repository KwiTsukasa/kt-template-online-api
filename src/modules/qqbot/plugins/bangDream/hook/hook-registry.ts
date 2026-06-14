import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.types';
import { logger } from '@/modules/qqbot/plugins/bangDream/shared/bangdream-logger';

export type TsuguExecutionStage =
  | 'handler'
  | 'mainData'
  | 'operation'
  | 'output'
  | 'start';

export type TsuguHookContext = {
  handlerName?: string;
  imageCount?: number;
  input: QqbotBangDreamCommandInput;
  operationKey: QqbotBangDreamOperationKey;
  query?: string;
  stage: TsuguExecutionStage;
  startedAt: number;
};

export type TsuguHook = {
  afterOutput?: (context: TsuguHookContext) => Promise<void> | void;
  afterResolve?: (context: TsuguHookContext) => Promise<void> | void;
  beforeParse?: (context: TsuguHookContext) => Promise<void> | void;
  beforeRender?: (context: TsuguHookContext) => Promise<void> | void;
  name: string;
  onError?: (context: TsuguHookContext, error: unknown) => Promise<void> | void;
  order?: number;
};

type TsuguSimpleHookMethod =
  | 'afterOutput'
  | 'afterResolve'
  | 'beforeParse'
  | 'beforeRender';

/**
 * 维护 Tsugu 命令执行生命周期 hook。
 */
export class TsuguHookRegistry {
  private readonly hooks: TsuguHook[];

  constructor(hooks: readonly TsuguHook[] = []) {
    this.hooks = [...hooks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async beforeParse(context: TsuguHookContext) {
    await this.emit('beforeParse', context);
  }

  async afterResolve(context: TsuguHookContext) {
    await this.emit('afterResolve', context);
  }

  async beforeRender(context: TsuguHookContext) {
    await this.emit('beforeRender', context);
  }

  async afterOutput(context: TsuguHookContext) {
    await this.emit('afterOutput', context);
  }

  async onError(context: TsuguHookContext, error: unknown) {
    for (const hook of this.hooks) {
      await hook.onError?.(context, error);
    }
  }

  private async emit(method: TsuguSimpleHookMethod, context: TsuguHookContext) {
    for (const hook of this.hooks) {
      const handler = hook[method];
      if (typeof handler === 'function') {
        await handler(context);
      }
    }
  }
}

/**
 * 创建命令执行上下文，供 hook 在全链路中共享。
 */
export function createTsuguHookContext(
  operationKey: QqbotBangDreamOperationKey,
  input: QqbotBangDreamCommandInput,
): TsuguHookContext {
  return {
    input,
    operationKey,
    query: extractTsuguInputText(input),
    stage: 'start',
    startedAt: Date.now(),
  };
}

/**
 * 创建默认日志 hook。
 */
export function createTsuguLogHook(): TsuguHook {
  return {
    afterOutput: (context) => {
      logger('operation', formatTsuguHookMessage('success', context));
    },
    beforeParse: (context) => {
      logger('operation', formatTsuguHookMessage('start', context));
    },
    name: 'TsuguLogHook',
    onError: (context, error) => {
      logger(
        'operation',
        `${formatTsuguHookMessage('error', context)} error=${getHookErrorMessage(error)}`,
      );
    },
  };
}

function formatTsuguHookMessage(
  status: 'error' | 'start' | 'success',
  context: TsuguHookContext,
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

function extractTsuguInputText(input: QqbotBangDreamCommandInput) {
  const direct = `${input.query || input.text || input.raw || ''}`.trim();
  if (direct) return direct;
  return Array.isArray(input.args) ? input.args.join(' ').trim() : '';
}

function getHookErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return '';
  return `${error}`;
}
