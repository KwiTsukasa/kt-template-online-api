import {
  BangDreamCommandContext,
  type BangDreamCommandContextOptions,
} from './application/bangdream-command-context';
import {
  createBangDreamHookContext,
  createBangDreamLogHook,
  BangDreamHookRegistry,
} from './application/hook/hook-registry';
import {
  configureBangDreamRuntimeIo,
  type BangDreamRuntimeIo,
} from './infrastructure/integration/runtime-io';
import {
  getBangDreamOperationsByHandlerName,
  type BangDreamOperationModule,
} from './operations';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationHandlerName,
  QqbotBangDreamOperationKey,
} from './domain/common/qqbot-bangdream.types';
import { waitForMainDataReady } from './application/main-data-store';

export type BangDreamPluginRuntimeOptions = BangDreamCommandContextOptions & {
  description?: string;
  io?: BangDreamRuntimeIo;
  legacyAliases?: string[];
  name?: string;
  normalizeError?: (error: unknown) => string;
  operations: BangDreamManifestOperation[];
  pluginKey?: string;
  version?: string;
};

export type BangDreamManifestOperation = {
  description?: string;
  handlerName: QqbotBangDreamOperationHandlerName;
  inputSchema?: Record<string, any>;
  key: QqbotBangDreamOperationKey;
  name?: string;
  outputSchema?: Record<string, any>;
};

type BangDreamResolvedOperation = BangDreamManifestOperation & {
  execute: BangDreamOperationModule['execute'];
};

export function createPlugin(options: BangDreamPluginRuntimeOptions) {
  if (options.io) configureBangDreamRuntimeIo(options.io);
  const context = new BangDreamCommandContext(options);
  const hookRegistry = new BangDreamHookRegistry([createBangDreamLogHook()]);
  const operationsByKey = resolveBangDreamOperations(options.operations);
  const normalizeError =
    options.normalizeError ||
    ((error: unknown) =>
      (error instanceof Error ? error.message : `${error}`) ||
      'BangDream 命令执行失败');

  const executeOperation = (
    operationKey: QqbotBangDreamOperationKey,
    input: QqbotBangDreamCommandInput,
  ) =>
    executeBangDreamOperation({
      context,
      hookRegistry,
      input,
      normalizeError,
      operationKey,
      operationsByKey,
    });

  return {
    activate: () => context.refreshDictionaryCache(),
    description: options.description,
    dispose: async () => undefined,
    executeOperation,
    health: () => context.checkHealth(),
    healthCheck: async () => {
      const checkedAt = formatBangDreamCheckedAt(new Date());
      try {
        await context.checkHealth();
        return {
          checkedAt,
          message: 'BangDream 插件可用',
          status: 'healthy',
        };
      } catch (error) {
        return {
          checkedAt,
          message: normalizeError(error) || 'BangDream 插件不可用',
          status: 'degraded',
        };
      }
    },
    key: options.pluginKey || 'bangdream',
    legacyKeys: options.legacyAliases,
    name: options.name || 'BangDream 查询',
    operations: options.operations.map((operation) => ({
      cacheTtlMs: 60_000,
      description: operation.description,
      inputSchema: operation.inputSchema || getBangDreamInputSchema(),
      key: operation.key,
      name: operation.name || operation.key,
      outputSchema: operation.outputSchema || getBangDreamOutputSchema(),
      execute: async (input: QqbotBangDreamCommandInput) =>
        await executeOperation(operation.key, input),
    })),
    version: options.version || '2.0.0',
  };
}

function resolveBangDreamOperations(operations: BangDreamManifestOperation[]) {
  const operationModules = getBangDreamOperationsByHandlerName();
  return new Map(
    operations.map((operation) => {
      const operationModule = operationModules.get(operation.handlerName);
      if (!operationModule) {
        throw new Error(
          `BangDream 插件执行器未实现：${operation.handlerName}`,
        );
      }
      return [
        operation.key,
        {
          ...operation,
          execute: operationModule.execute,
        },
      ] as const;
    }),
  );
}

async function executeBangDreamOperation(options: {
  context: BangDreamCommandContext;
  hookRegistry: BangDreamHookRegistry;
  input: QqbotBangDreamCommandInput;
  normalizeError: (error: unknown) => string;
  operationKey: QqbotBangDreamOperationKey;
  operationsByKey: Map<QqbotBangDreamOperationKey, BangDreamResolvedOperation>;
}): Promise<QqbotBangDreamCommandOutput> {
  const operationContext = createBangDreamHookContext(
    options.operationKey,
    options.input,
  );
  await options.hookRegistry.beforeParse(operationContext);

  try {
    operationContext.stage = 'mainData';
    await waitForMainDataReady();

    operationContext.stage = 'operation';
    const operation = options.operationsByKey.get(options.operationKey);
    if (!operation) {
      throw new Error(`BangDream 插件能力不存在：${options.operationKey}`);
    }
    operationContext.handlerName = operation.handlerName;
    await options.hookRegistry.afterResolve(operationContext);

    operationContext.stage = 'handler';
    await options.hookRegistry.beforeRender(operationContext);
    const output = await operation.execute(options.input, options.context);

    operationContext.stage = 'output';
    operationContext.imageCount = output.imageCount;
    operationContext.query = output.query || operationContext.query;
    await options.hookRegistry.afterOutput(operationContext);
    return output;
  } catch (error) {
    const message = options.normalizeError(error);
    await options.hookRegistry.onError(operationContext, message);
    throw new Error(message);
  }
}

export type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationHandlerName,
  QqbotBangDreamOperationKey,
} from './domain/common/qqbot-bangdream.types';

function getBangDreamInputSchema() {
  return {
    properties: {
      args: { description: '命令参数数组', type: 'array' },
      query: { description: '查询关键词', type: 'string' },
      raw: { description: '命令原始参数', type: 'string' },
      text: { description: '命令原始文本', type: 'string' },
    },
    type: 'object',
  };
}

function getBangDreamOutputSchema() {
  return {
    properties: {
      imageCount: { type: 'number' },
      operationKey: { type: 'string' },
      query: { type: 'string' },
      replyText: { type: 'string' },
      source: { type: 'string' },
    },
    type: 'object',
  };
}

function formatBangDreamCheckedAt(date: Date) {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}
