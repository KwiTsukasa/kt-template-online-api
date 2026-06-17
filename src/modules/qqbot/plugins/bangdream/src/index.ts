import {
  BangDreamCommandContext,
  type BangDreamCommandContextOptions,
} from './application/bangdream-command-context';
import {
  createBangDreamOperationLifecycleContext,
  createBangDreamOperationLogObserver,
  BangDreamOperationLifecycle,
} from './application/execution/operation-lifecycle';
import {
  configureBangDreamRuntimeIo,
  type BangDreamRuntimeIo,
} from './infrastructure/integration/runtime-io';
import { createBestdoriMainDataSyncTask } from './application/tasks/bestdori-main-data-sync.task';
import {
  getBangDreamOperationsByHandlerName,
  type BangDreamOperationModule,
} from './operations';
import type {
  BangDreamCommandInput,
  BangDreamCommandOutput,
  BangDreamOperationHandlerName,
  BangDreamOperationKey,
} from './domain/common/bangdream.types';
import { waitForBangDreamCatalogReady } from './application/catalog/bangdream-catalog-cache';
import { preloadBangDreamRenderAssets } from './application/render-assets';

type BangDreamPluginRuntimeOptions = BangDreamCommandContextOptions & {
  description?: string;
  io?: BangDreamRuntimeIo;
  legacyAliases?: string[];
  name?: string;
  normalizeError?: (error: unknown) => string;
  operations: BangDreamManifestOperation[];
  pluginKey?: string;
  version?: string;
};

type BangDreamManifestOperation = {
  aliases?: string[];
  description?: string;
  handlerName: BangDreamOperationHandlerName;
  inputSchema?: Record<string, any>;
  key: BangDreamOperationKey;
  name?: string;
  outputSchema?: Record<string, any>;
  timeoutMs?: number;
};

type BangDreamResolvedOperation = BangDreamManifestOperation & {
  catalogKeys?: BangDreamOperationModule['catalogKeys'];
  execute: BangDreamOperationModule['execute'];
};

/**
 * 创建 BangDream 插件对象或配置。
 * @param options - BangDream列表；使用 `io`、`operations`、`normalizeError`、`description` 字段生成结果。
 */
export function createPlugin(options: BangDreamPluginRuntimeOptions) {
  if (options.io) configureBangDreamRuntimeIo(options.io);
  const context = new BangDreamCommandContext(options);
  const lifecycle = new BangDreamOperationLifecycle([
    createBangDreamOperationLogObserver(),
  ]);
  const operationsByKey = resolveBangDreamOperations(options.operations);
  const tasks = [createBestdoriMainDataSyncTask()];
  const normalizeError =
    options.normalizeError ||
    ((error: unknown) =>
      (error instanceof Error ? error.message : `${error}`) ||
      'BangDream 命令执行失败');

  /**
   * 执行 BangDream 插件局部步骤。
   * @param operationKey - operationKey 输入；影响 executeOperation 的返回值。
   * @param input - input 输入；影响 executeOperation 的返回值。
   */
  const executeOperation = (
    operationKey: BangDreamOperationKey,
    input: BangDreamCommandInput,
  ) =>
    executeBangDreamOperation({
      context,
      lifecycle,
      input,
      normalizeError,
      operationKey,
      operationsByKey,
    });

  return {
    /**
     * 激活插件运行时。
     * @returns 插件处理结果。
     */
    activate: async () => {
      await Promise.all([
        context.refreshDictionaryCache(),
        preloadBangDreamRenderAssets(),
      ]);
    },
    description: options.description,
    /**
     * 释放插件运行时资源。
     * @returns 插件处理结果。
     */
    dispose: async () => undefined,
    executeOperation,
    /**
     * 执行 BangDream回调。
     */
    health: () => context.checkHealth(),
    /**
     * 执行 BangDream回调。
     */
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
      aliases: operation.aliases,
      cacheTtlMs: 60_000,
      description: operation.description,
      inputSchema: operation.inputSchema || getBangDreamInputSchema(),
      key: operation.key,
      name: operation.name || operation.key,
      outputSchema: operation.outputSchema || getBangDreamOutputSchema(),
      timeoutMs: operation.timeoutMs,
      /**
       * 执行插件操作处理器。
       * @param input - input 输入；驱动 `executeOperation()` 的 BangDream步骤。
       * @returns 插件处理结果。
       */
      execute: async (input: BangDreamCommandInput) =>
        await executeOperation(operation.key, input),
    })),
    tasks,
    version: options.version || '2.0.0',
  };
}

/**
 * 解析Bang Dream Operations。
 * @param operations - BangDream列表；转换 BangDream列表项。
 */
function resolveBangDreamOperations(operations: BangDreamManifestOperation[]) {
  const operationModules = getBangDreamOperationsByHandlerName();
  return new Map(
    operations.map((operation) => {
      const operationModule = operationModules.get(operation.handlerName);
      if (!operationModule) {
        throw new Error(`BangDream 插件执行器未实现：${operation.handlerName}`);
      }
      return [
        operation.key,
        {
          ...operation,
          catalogKeys: operationModule.catalogKeys,
          execute: operationModule.execute,
        },
      ] as const;
    }),
  );
}

/**
 * 执行Bang Dream Operation。
 * @param options - BangDream列表；使用 `operationKey`、`input`、`lifecycle`、`operationsByKey` 字段生成结果。
 * @returns 异步完成后的 BangDream 插件结果。
 */
async function executeBangDreamOperation(options: {
  context: BangDreamCommandContext;
  lifecycle: BangDreamOperationLifecycle;
  input: BangDreamCommandInput;
  normalizeError: (error: unknown) => string;
  operationKey: BangDreamOperationKey;
  operationsByKey: Map<BangDreamOperationKey, BangDreamResolvedOperation>;
}): Promise<BangDreamCommandOutput> {
  const operationContext = createBangDreamOperationLifecycleContext(
    options.operationKey,
    options.input,
  );
  await options.lifecycle.beforeParse(operationContext);

  try {
    operationContext.stage = 'operation';
    const operation = options.operationsByKey.get(options.operationKey);
    if (!operation) {
      throw new Error(`BangDream 插件能力不存在：${options.operationKey}`);
    }
    operationContext.handlerName = operation.handlerName;
    await options.lifecycle.afterResolve(operationContext);

    operationContext.stage = 'catalog';
    await waitForBangDreamCatalogReady(operation.catalogKeys);

    operationContext.stage = 'handler';
    await options.lifecycle.beforeRender(operationContext);
    const output = await operation.execute(options.input, options.context);

    operationContext.stage = 'output';
    operationContext.imageCount = output.imageCount;
    operationContext.query = output.query || operationContext.query;
    await options.lifecycle.afterOutput(operationContext);
    return output;
  } catch (error) {
    const message = options.normalizeError(error);
    await options.lifecycle.onError(operationContext, message);
    throw new Error(message);
  }
}

/**
 * 查询 BangDream 插件数据。
 */
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

/**
 * 查询 BangDream 插件数据。
 */
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

/**
 * 转换 BangDream 插件输入。
 * @param date - date 输入；执行 `date.getFullYear()`、`date.getMonth()`、`date.getDate()`、`date.getHours()` 对应的 BangDream步骤。
 */
function formatBangDreamCheckedAt(date: Date) {
  /**
   * 补齐 BangDream 插件展示文本。
   * @param input - input 输入；影响 pad 的返回值。
   */
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
