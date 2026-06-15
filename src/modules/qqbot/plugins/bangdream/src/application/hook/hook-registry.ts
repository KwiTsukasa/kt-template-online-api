import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/qqbot-bangdream.types';
import { logger } from '@/modules/qqbot/plugins/bangdream/src/application/bangdream-logger';

export type BangDreamExecutionStage =
  | 'handler'
  | 'mainData'
  | 'operation'
  | 'output'
  | 'start';

export type BangDreamHookContext = {
  handlerName?: string;
  imageCount?: number;
  input: QqbotBangDreamCommandInput;
  operationKey: QqbotBangDreamOperationKey;
  query?: string;
  stage: BangDreamExecutionStage;
  startedAt: number;
};

export type BangDreamHook = {
  afterOutput?: (context: BangDreamHookContext) => Promise<void> | void;
  afterResolve?: (context: BangDreamHookContext) => Promise<void> | void;
  beforeParse?: (context: BangDreamHookContext) => Promise<void> | void;
  beforeRender?: (context: BangDreamHookContext) => Promise<void> | void;
  name: string;
  onError?: (
    context: BangDreamHookContext,
    error: unknown,
  ) => Promise<void> | void;
  order?: number;
};

type BangDreamSimpleHookMethod =
  | 'afterOutput'
  | 'afterResolve'
  | 'beforeParse'
  | 'beforeRender';

export class BangDreamHookRegistry {
  private readonly hooks: BangDreamHook[];

  constructor(hooks: readonly BangDreamHook[] = []) {
    this.hooks = [...hooks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async beforeParse(context: BangDreamHookContext) {
    await this.emit('beforeParse', context);
  }

  async afterResolve(context: BangDreamHookContext) {
    await this.emit('afterResolve', context);
  }

  async beforeRender(context: BangDreamHookContext) {
    await this.emit('beforeRender', context);
  }

  async afterOutput(context: BangDreamHookContext) {
    await this.emit('afterOutput', context);
  }

  async onError(context: BangDreamHookContext, error: unknown) {
    for (const hook of this.hooks) {
      await hook.onError?.(context, error);
    }
  }

  private async emit(
    method: BangDreamSimpleHookMethod,
    context: BangDreamHookContext,
  ) {
    for (const hook of this.hooks) {
      const handler = hook[method];
      if (typeof handler === 'function') {
        await handler(context);
      }
    }
  }
}

export function createBangDreamHookContext(
  operationKey: QqbotBangDreamOperationKey,
  input: QqbotBangDreamCommandInput,
): BangDreamHookContext {
  return {
    input,
    operationKey,
    query: extractBangDreamInputText(input),
    stage: 'start',
    startedAt: Date.now(),
  };
}

export function createBangDreamLogHook(): BangDreamHook {
  return {
    afterOutput: (context) => {
      logger('operation', formatBangDreamHookMessage('success', context));
    },
    beforeParse: (context) => {
      logger('operation', formatBangDreamHookMessage('start', context));
    },
    name: 'BangDreamLogHook',
    onError: (context, error) => {
      logger(
        'operation',
        `${formatBangDreamHookMessage('error', context)} error=${getHookErrorMessage(error)}`,
      );
    },
  };
}

function formatBangDreamHookMessage(
  status: 'error' | 'start' | 'success',
  context: BangDreamHookContext,
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

function extractBangDreamInputText(input: QqbotBangDreamCommandInput) {
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
