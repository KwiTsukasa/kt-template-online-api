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

/**
 * Creates the BangDream plugin entry for package-local calls or the generic worker runtime.
 * @param options - Legacy BangDream runtime options or generic worker create context with manifest and config snapshot.
 * @returns BangDream command plugin instance exposing operations, health checks, and scheduled tasks.
 */
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

/**
 * Creates the BangDream plugin through the historical package-local option shape.
 * @param options - Package-local options carrying synchronous config, optional runtime IO, and manifest operations.
 * @returns BangDream command plugin used by package-local callers and tests.
 */
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
 * Creates the BangDream plugin from the generic worker contract while keeping adapters inside the package.
 * @param options - Generic worker context; config is read from the snapshot and IO calls delegate to host RPC methods.
 * @returns BangDream command plugin compatible with the generic worker runtime.
 */
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

/**
 * Checks whether a create call is using the generic worker runtime shape.
 * @param options - Unknown BangDream create options supplied by package-local callers or generic workers.
 * @returns `true` when the options include a runtime config snapshot.
 */
function isBangDreamGenericPluginCreateOptions(
  options: BangDreamPluginCreateOptions,
): options is QqbotGenericPluginCreateOptions {
  return (
    !!(options as QqbotGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as QqbotGenericPluginCreateOptions).manifest
  );
}

/**
 * Creates a synchronous BangDream config reader over the worker startup snapshot.
 * @param snapshot - Manifest-owned config key snapshot captured before the worker call.
 * @returns Config reader that never performs async host RPC during BangDream command execution.
 */
function createBangDreamGenericConfigReader(
  snapshot: Record<string, string | undefined>,
): BangDreamConfigReader {
  return {
    /**
     * Reads one BangDream config value from the immutable worker snapshot.
     * @param key - Runtime config key declared by the BangDream package manifest.
     * @returns Snapshot value cast to the requested BangDream config type.
     */
    get: <T = string>(key: string) => snapshot[key] as T | undefined,
  };
}

/**
 * Creates a dictionary reader that delegates BangDream dictionary lookups to the generic host.
 * @param host - Generic worker host facade with dictionary RPC methods.
 * @returns Dictionary reader used by BangDream command context cache refresh.
 */
function createBangDreamGenericDictionaryReader(
  host: Record<string, unknown>,
): BangDreamDictionaryReader {
  return {
    /**
     * Reads dictionary items through the worker host bridge.
     * @param dictCode - Admin dictionary code requested by BangDream alias/config lookup.
     * @returns Dictionary items normalized to label/value pairs by the command context.
     */
    getDictItemsByKey: async (dictCode) =>
      await callBangDreamGenericHost(host, 'getDictItemsByKey', dictCode),
  };
}

/**
 * Builds BangDream runtime IO adapters over generic worker host methods.
 * @param options - Generic worker context containing host RPC methods and config snapshot.
 * @param pathMapper - Converts BangDream absolute package paths into host-safe package-relative paths.
 * @param syncJsonCache - Preloaded JSON payloads available to synchronous BangDream readers.
 * @returns Runtime IO implementation consumed by BangDream package infrastructure.
 */
function createBangDreamGenericRuntimeIo(
  options: QqbotGenericPluginCreateOptions,
  pathMapper: BangDreamGenericPathMapper,
  syncJsonCache: Map<string, unknown>,
): BangDreamRuntimeIo {
  const { host, runtime } = options;
  return {
    /**
     * Reads a BangDream config value from the startup snapshot.
     * @param key - Runtime config key declared by the BangDream package manifest.
     * @returns Snapshot value or `undefined` when the key is not configured.
     */
    getConfig: (key) => runtime.configSnapshot[key],
    /**
     * Reads a package asset file through the generic host bridge.
     * @param filePath - Package-relative asset path requested by BangDream rendering or catalog code.
     * @returns Asset bytes from the package root.
     */
    readAssetFile: async (filePath) =>
      normalizeBangDreamHostBuffer(
        await callBangDreamGenericHost(
          host,
          'readAssetFile',
          pathMapper(filePath),
        ),
      ),
    /**
     * Reads Excel rows from a package-local workbook buffer through the generic host bridge.
     * @param filePath - Absolute or relative BangDream static workbook path requested by package code.
     * @returns First-sheet rows parsed from host-provided XLSX bytes.
     */
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
    /**
     * Reads a package-local JSON file through the generic host bridge.
     * @param filePath - Package-relative JSON path requested by BangDream storage or static data code.
     * @returns Parsed JSON payload returned by the host bridge.
     */
    readJsonFile: async <T = unknown>(filePath: string) =>
      await callBangDreamGenericHost<T>(
        host,
        'readJsonFile',
        pathMapper(filePath),
      ),
    /**
     * Reads preloaded package-local JSON synchronously for BangDream search/config modules.
     * @param filePath - Absolute or relative BangDream JSON path requested by synchronous package code.
     * @returns Cached JSON payload populated during generic plugin creation.
     */
    readJsonFileSync: <T = unknown>(filePath: string) => {
      const relativePath = pathMapper(filePath);
      if (!syncJsonCache.has(relativePath)) {
        throw new Error(
          `BangDream generic runtime JSON 未预加载：${relativePath}`,
        );
      }
      return syncJsonCache.get(relativePath) as T;
    },
    /**
     * Renames a package-local file through the generic host bridge.
     * @param from - Package-relative temporary path created by BangDream storage code.
     * @param to - Package-relative final path for the atomic write target.
     */
    renameFile: async (from, to) => {
      await callBangDreamGenericHost(
        host,
        'renameFile',
        pathMapper(from),
        pathMapper(to),
      );
    },
    /**
     * Requests binary HTTP content through the generic host bridge.
     * @param url - Absolute HTTP URL requested by BangDream external integrations.
     * @param requestOptions - Optional headers and timeout used for the host-mediated request.
     * @returns Buffer body wrapped in the BangDream runtime IO response shape.
     */
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
    /**
     * Requests JSON HTTP content through the generic host bridge.
     * @param url - Absolute HTTP URL requested by BangDream external integrations.
     * @param requestOptions - Optional headers and timeout used for the host-mediated request.
     * @returns JSON body wrapped in the BangDream runtime IO response shape.
     */
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
    /**
     * Sleeps through the generic host bridge so worker delays remain bounded by platform policy.
     * @param ms - Delay duration in milliseconds requested by BangDream retry logic.
     */
    sleep: async (ms) => {
      await callBangDreamGenericHost(host, 'sleep', ms);
    },
    /**
     * Writes a package-local JSON file through the generic host bridge.
     * @param filePath - Package-relative storage path requested by BangDream cache code.
     * @param data - JSON-serializable payload to persist in package storage.
     */
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

/**
 * Creates a BangDream package path mapper for generic host file calls.
 * @param installationId - Runtime installation id used to namespace package-external cache paths.
 * @returns Function converting absolute package paths to package-relative host paths with forward slashes.
 */
function createBangDreamGenericPathMapper(
  installationId: string,
): BangDreamGenericPathMapper {
  const packageRoot = path.resolve(bangDreamProjectRoot, '..');
  const runtimePrefix = `runtime/${normalizeBangDreamPathSegment(
    installationId || 'default',
  )}`;

  /**
   * Converts a BangDream runtime file path into a host-safe package-relative path.
   * @param filePath - Absolute package path, package-relative path, or package-external cache path from BangDream code.
   * @returns Forward-slash relative path accepted by the generic host bridge.
   */
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

/**
 * Preloads synchronous BangDream JSON files through async generic host methods before the plugin is returned.
 * @param host - Generic worker host facade used to read package JSON files.
 * @param pathMapper - Converts BangDream absolute paths to host-safe package-relative paths.
 * @returns Map keyed by normalized package-relative JSON paths for sync readers.
 */
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

/**
 * Parses rows from the first worksheet of a host-provided XLSX buffer.
 * @param buffer - Workbook bytes read through the generic host bridge.
 * @returns JSON rows from the first workbook sheet.
 */
function parseBangDreamExcelRows<T extends Record<string, unknown>>(
  buffer: Buffer,
): T[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<T>(workbook.Sheets[sheetName]);
}

/**
 * Normalizes a host path to forward-slash package-relative form.
 * @param filePath - Package-relative path with either Windows or POSIX separators.
 * @returns Forward-slash path without leading current-directory markers.
 */
function normalizeBangDreamHostPath(filePath: string) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

/**
 * Converts an absolute package-external path into a stable runtime storage key.
 * @param filePath - Absolute cache or storage path outside the BangDream package root.
 * @returns Forward-slash runtime storage suffix that is safe for package-local host APIs.
 */
function normalizeBangDreamExternalPath(filePath: string) {
  return normalizeBangDreamHostPath(
    filePath.replace(/^[A-Za-z]:/, (drive) => drive.slice(0, 1)),
  );
}

/**
 * Sanitizes one path segment used by generic runtime storage prefixes.
 * @param value - Installation id or other untrusted segment value.
 * @returns Path-safe segment with separators and punctuation collapsed.
 */
function normalizeBangDreamPathSegment(value: string) {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'
  );
}

/**
 * Calls one generic BangDream host capability and fails with a package-owned error when absent.
 * @param host - Generic worker host facade supplied to `createPlugin`.
 * @param method - Host capability name required by the BangDream adapter.
 * @param args - Positional arguments accepted by the host facade method.
 * @returns Host method result cast to the requested package-local type.
 */
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

/**
 * Converts a generic host binary response into a Node Buffer for BangDream render code.
 * @param value - Buffer, Uint8Array, or object containing a `body` field returned by the host bridge.
 * @returns Buffer instance safe for BangDream runtime IO consumers.
 */
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

/**
 * Normalizes generic worker errors to the legacy BangDream string error contract.
 * @param normalizeError - Generic worker error normalizer supplied by the platform runtime.
 * @param error - Error or arbitrary thrown value from BangDream package code.
 * @returns Error message consumed by BangDream lifecycle logging and thrown operation errors.
 */
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
