import * as path from 'path';
import * as XLSX from 'xlsx';

import {
  BangDreamCommandContext,
  type BangDreamCommandContextOptions,
  type BangDreamConfigReader,
  type BangDreamDictionaryReader,
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
import {
  fuzzySearchPath,
  projectRoot as bangDreamProjectRoot,
} from './config/runtime-config';

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

type BangDreamGenericManifest = {
  description?: string;
  entry?: string;
  events?: unknown[];
  key?: string;
  legacyAliases?: string[];
  name?: string;
  operations?: BangDreamManifestOperation[];
  pluginKey?: string;
  runtime?: Record<string, unknown>;
  tasks?: unknown[];
  version?: string;
};

type QqbotGenericPluginCreateOptions = {
  host: Record<string, unknown>;
  manifest: BangDreamGenericManifest;
  normalizeError: (error: unknown, fallback?: string) => string | Error;
  now: () => Date;
  runtime: {
    configSnapshot: Record<string, string | undefined>;
    installationId: string;
  };
};

type BangDreamPluginCreateOptions =
  | BangDreamPluginRuntimeOptions
  | QqbotGenericPluginCreateOptions;

type BangDreamCommandPlugin = ReturnType<
  typeof buildBangDreamRuntimePlugin
>;

type BangDreamGenericPathMapper = (filePath: string) => string;

export function createPlugin(
  options: BangDreamPluginRuntimeOptions,
): BangDreamCommandPlugin;
export function createPlugin(
  options: QqbotGenericPluginCreateOptions,
): Promise<BangDreamCommandPlugin>;
export function createPlugin(
  options: BangDreamPluginCreateOptions,
): BangDreamCommandPlugin | Promise<BangDreamCommandPlugin> {
  if (isBangDreamGenericPluginCreateOptions(options)) {
    return buildBangDreamGenericPlugin(options);
  }
  return buildBangDreamRuntimePlugin(options);
}

function buildBangDreamRuntimePlugin(
  options: BangDreamPluginRuntimeOptions,
) {
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

  const checkBangDreamHealth = async () => {
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
  };

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
    activate: async () => {
      await Promise.all([
        context.refreshDictionaryCache(),
        preloadBangDreamRenderAssets(),
      ]);
    },
    description: options.description,
    dispose: async () => undefined,
    executeOperation,
    health: checkBangDreamHealth,
    healthCheck: checkBangDreamHealth,
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
      execute: async (input: BangDreamCommandInput) =>
        await executeOperation(operation.key, input),
    })),
    tasks,
    version: options.version || '2.0.0',
  };
}

async function buildBangDreamGenericPlugin(
  options: QqbotGenericPluginCreateOptions,
): Promise<BangDreamCommandPlugin> {
  const manifest = options.manifest;
  const pathMapper = createBangDreamGenericPathMapper(
    options.runtime.installationId,
  );
  const syncJsonCache = await preloadBangDreamGenericSyncJson(
    options.host,
    pathMapper,
  );
  return buildBangDreamRuntimePlugin({
    configReader: createBangDreamGenericConfigReader(
      options.runtime.configSnapshot,
    ),
    description: manifest.description,
    dictionaryReader: createBangDreamGenericDictionaryReader(options.host),
    io: createBangDreamGenericRuntimeIo(options, pathMapper, syncJsonCache),
    legacyAliases: manifest.legacyAliases,
    name: manifest.name,
    normalizeError: (error) =>
      normalizeBangDreamGenericError(options.normalizeError, error),
    operations: manifest.operations || [],
    pluginKey: manifest.pluginKey || manifest.key || 'bangdream',
    version: manifest.version,
  });
}

function isBangDreamGenericPluginCreateOptions(
  options: BangDreamPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

function createBangDreamGenericConfigReader(
  snapshot: Record<string, string | undefined>,
): BangDreamConfigReader {
  return {
    get: <T = string>(key: string) => snapshot[key] as T | undefined,
  };
}

function createBangDreamGenericDictionaryReader(
  host: Record<string, unknown>,
): BangDreamDictionaryReader {
  return {
    getDictItemsByKey: async (dictCode) =>
      await callBangDreamGenericHost(host, 'getDictItemsByKey', dictCode),
  };
}

function createBangDreamGenericRuntimeIo(
  options: QqbotGenericPluginCreateOptions,
  pathMapper: BangDreamGenericPathMapper,
  syncJsonCache: Map<string, unknown>,
): BangDreamRuntimeIo {
  const { host, runtime } = options;
  return {
    getConfig: (key) => runtime.configSnapshot[key],
    readAssetFile: async (filePath) =>
      normalizeBangDreamHostBuffer(
        await callBangDreamGenericHost(
          host,
          'readAssetFile',
          pathMapper(filePath),
        ),
      ),
    readExcelRows: async <T extends Record<string, unknown>>(
      filePath: string,
    ) =>
      parseBangDreamExcelRows<T>(
        normalizeBangDreamHostBuffer(
          await callBangDreamGenericHost(
            host,
            'readAssetFile',
            pathMapper(filePath),
          ),
        ),
      ),
    readJsonFile: async <T = unknown>(filePath: string) =>
      await callBangDreamGenericHost<T>(
        host,
        'readJsonFile',
        pathMapper(filePath),
      ),
    readJsonFileSync: <T = unknown>(filePath: string) => {
      const relativePath = pathMapper(filePath);
      if (!syncJsonCache.has(relativePath)) {
        throw new Error(
          `BangDream generic runtime JSON 未预加载：${relativePath}`,
        );
      }
      return syncJsonCache.get(relativePath) as T;
    },
    renameFile: async (from, to) => {
      await callBangDreamGenericHost(
        host,
        'renameFile',
        pathMapper(from),
        pathMapper(to),
      );
    },
    requestArrayBuffer: async (url, requestOptions) => ({
      body: normalizeBangDreamHostBuffer(
        await callBangDreamGenericHost(host, 'requestBuffer', {
          context: 'BangDream 资源下载',
          failureMessageTemplate: 'BangDream 资源下载失败：{statusCode}',
          headers: requestOptions?.headers,
          timeoutMessage: 'BangDream 资源下载超时',
          timeoutMs: requestOptions?.timeoutMs,
          url,
        }),
      ),
    }),
    requestJson: async <T = unknown>(url: string, requestOptions) => ({
      body: await callBangDreamGenericHost<T>(host, 'requestJson', {
        context: 'BangDream 数据接口',
        failureMessageTemplate: 'BangDream 数据接口失败：{statusCode}',
        headers: requestOptions?.headers,
        invalidJsonMessage: 'BangDream 数据接口返回不是合法 JSON',
        timeoutMessage: 'BangDream 数据接口请求超时',
        timeoutMs: requestOptions?.timeoutMs,
        url,
      }),
    }),
    sleep: async (ms) => {
      await callBangDreamGenericHost(host, 'sleep', ms);
    },
    writeJsonFile: async (filePath, data) => {
      await callBangDreamGenericHost(
        host,
        'writeJsonFile',
        pathMapper(filePath),
        data,
      );
    },
  };
}

function createBangDreamGenericPathMapper(
  installationId: string,
): BangDreamGenericPathMapper {
  const packageRoot = path.resolve(bangDreamProjectRoot, '..');
  const runtimePrefix = `runtime/${normalizeBangDreamPathSegment(
    installationId || 'default',
  )}`;

  return (filePath: string) => {
    if (!path.isAbsolute(filePath)) {
      return normalizeBangDreamHostPath(filePath);
    }

    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(packageRoot, absolutePath);
    if (
      relativePath &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    ) {
      return normalizeBangDreamHostPath(relativePath);
    }

    return `${runtimePrefix}/${normalizeBangDreamExternalPath(absolutePath)}`;
  };
}

async function preloadBangDreamGenericSyncJson(
  host: Record<string, unknown>,
  pathMapper: BangDreamGenericPathMapper,
) {
  const cache = new Map<string, unknown>();
  if (typeof host.readJsonFile !== 'function') return cache;

  const fuzzyPath = pathMapper(fuzzySearchPath);
  cache.set(
    fuzzyPath,
    await callBangDreamGenericHost(host, 'readJsonFile', fuzzyPath),
  );
  return cache;
}

function parseBangDreamExcelRows<T extends Record<string, unknown>>(
  buffer: Buffer,
): T[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<T>(workbook.Sheets[sheetName]);
}

function normalizeBangDreamHostPath(filePath: string) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function normalizeBangDreamExternalPath(filePath: string) {
  return normalizeBangDreamHostPath(
    filePath.replace(/^[A-Za-z]:/, (drive) => drive.slice(0, 1)),
  );
}

function normalizeBangDreamPathSegment(value: string) {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'
  );
}

async function callBangDreamGenericHost<TResult = any>(
  host: Record<string, unknown>,
  method: string,
  ...args: unknown[]
): Promise<TResult> {
  const fn = host[method];
  if (typeof fn !== 'function') {
    throw new Error(`BangDream generic host 缺少 ${method}`);
  }
  return (await fn(...args)) as TResult;
}

function normalizeBangDreamHostBuffer(value: unknown): Buffer {
  const body =
    value && typeof value === 'object' && 'body' in value
      ? (value as { body?: unknown }).body
      : value;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (Array.isArray(body)) return Buffer.from(body);
  return Buffer.from([]);
}

function normalizeBangDreamGenericError(
  normalizeError: QqbotGenericPluginCreateOptions['normalizeError'],
  error: unknown,
) {
  const normalized = normalizeError(error, 'BangDream 命令执行失败');
  return normalized instanceof Error ? normalized.message : `${normalized}`;
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
