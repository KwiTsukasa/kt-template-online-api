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

type PluginGenericPluginCreateOptions = {
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
  | PluginGenericPluginCreateOptions;

type BangDreamCommandPlugin = ReturnType<
  typeof buildBangDreamRuntimePlugin
>;

type BangDreamGenericPathMapper = (filePath: string) => string;

export function createPlugin(
  options: BangDreamPluginRuntimeOptions,
): BangDreamCommandPlugin;
export function createPlugin(
  options: PluginGenericPluginCreateOptions,
): Promise<BangDreamCommandPlugin>;
/**
 * 根据`options`构造BanG Dream 运行时插件；当 `isBangDreamGenericPluginCreateOptions(options)` 成立时返回 `buildBangDreamGenericPlugin(options)`。
 * @param options - 控制BanG Dream 运行时插件筛选、缓存或输出方式的可选项。
 * @returns 返回按运行时选项构建的插件实例。
 */
export function createPlugin(
  options: BangDreamPluginCreateOptions,
): BangDreamCommandPlugin | Promise<BangDreamCommandPlugin> {
  if (isBangDreamGenericPluginCreateOptions(options)) {
    return buildBangDreamGenericPlugin(options);
  }
  return buildBangDreamRuntimePlugin(options);
}

/**
 * 根据`options`构造BanG Dream运行态插件。
 * @param options - 控制BanGDream运行态插件筛选、缓存或输出方式的可选项，包含 `io`、`operations`、`normalizeError`、`description` 字段。
 * @returns 包含 `activate`、`description`、`dispose`、`executeOperation`、`health` 字段的BanGDream运行态插件。
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
      ((() => {
        if (error instanceof Error) {
          return error.message;
        }
        return `${error}`;
      })()) ||
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

/**
 * 根据`options`构造BanG Dream通用插件。
 * @param options - 控制BanGDream通用插件筛选、缓存或输出方式的可选项，包含 `manifest`、`runtime`、`host`、`normalizeError` 字段。
 * @returns BanGDream通用插件。
 */
async function buildBangDreamGenericPlugin(
  options: PluginGenericPluginCreateOptions,
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
 * 根据`options`与当前约束判定BanG Dream通用插件创建选项。
 * @param options - 控制BanGDream通用插件创建选项筛选、缓存或输出方式的可选项。
 * @returns 满足BanGDream通用插件创建选项约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isBangDreamGenericPluginCreateOptions(
  options: BangDreamPluginCreateOptions,
): options is PluginGenericPluginCreateOptions {
  return (
    !!(options as PluginGenericPluginCreateOptions).runtime?.configSnapshot &&
    !!(options as PluginGenericPluginCreateOptions).manifest
  );
}

/**
 * 创建BanGDream通用配置读取器，并输出固定投影 `get` 字段。
 * @param snapshot - 用于BanGDream配置Reader的领域对象，包含 `key` 字段。
 * @returns 包含 `get` 字段的BanGDream配置Reader；没有可用结果或提前结束时为 `undefined`。
 */
function createBangDreamGenericConfigReader(
  snapshot: Record<string, string | undefined>,
): BangDreamConfigReader {
  return {
    get: <T = string>(key: string) => snapshot[key] as T | undefined,
  };
}

/**
 * 创建BanGDream通用字典读取器，并输出固定投影 `getDictItemsByKey` 字段。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @returns 包含 `getDictItemsByKey` 字段的BanGDreamDictionaryReader。
 */
function createBangDreamGenericDictionaryReader(
  host: Record<string, unknown>,
): BangDreamDictionaryReader {
  return {
    getDictItemsByKey: async (dictCode) =>
      await callBangDreamGenericHost(host, 'getDictItemsByKey', dictCode),
  };
}

/**
 * 创建BanGDream通用运行态I/O，并输出固定投影 `getConfig`、`readAssetFile`、`readExcelRows`、`readJsonFile`、`readJsonFileSync` 字段。
 * @param options - 控制BanGDream运行态Io筛选、缓存或输出方式的可选项。
 * @param pathMapper - 决定BanGDream运行态Io内容、边界或目标的 `pathMapper` 值。
 * @param syncJsonCache - 用于BanGDream运行态Io的领域对象，包含 `has`、`get` 字段。
 * @returns 包含 `getConfig`、`readAssetFile`、`readExcelRows`、`readJsonFile`、`readJsonFileSync` 字段的BanGDream运行态Io。
 */
function createBangDreamGenericRuntimeIo(
  options: PluginGenericPluginCreateOptions,
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

/**
 * 根据`installationId`构造BanG Dream通用路径映射器。
 * @param installationId - 用于精确定位安装记录的标识。
 * @returns BanGDream通用路径映射器。
 */
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

/**
 * 根据`host`、`pathMapper`处理BanG Dream通用同步JSON；同步更新对应缓存或去重状态（`cache.set`）。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param pathMapper - 负责完成BanGDream通用同步JSON外部交互的受控能力。
 * @returns BanGDream通用同步JSON。
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
 * 从`buffer`解析BanG DreamExcel行；从 `XLSX.read` 读取BanG DreamExcel行。
 * @param buffer - 决定BanGDreamExcel行内容、边界或目标的 `buffer` 值。
 * @returns 按输入顺序得到的BanGDreamExcel行列表；没有匹配项时为空数组。
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
 * 将`filePath`规范为BanG Dream主机路径，使等价输入得到一致表示。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDream主机路径。
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
 * 将`filePath`规范为BanG Dream外部路径，使等价输入得到一致表示。
 * @param filePath - 必须保持在受控根目录内的文件路径。
 * @returns BanGDream外部路径。
 */
function normalizeBangDreamExternalPath(filePath: string) {
  return normalizeBangDreamHostPath(
    filePath.replace(/^[A-Za-z]:/, (drive) => drive.slice(0, 1)),
  );
}

/**
 * 将`value`规范为BanG Dream路径分段，使等价输入得到一致表示。
 * @param value - 待转换为BanGDream路径分段的原始值。
 * @returns 规范化后的BanGDream路径分段；主值为空时采用 `'default'` 兜底。
 */
function normalizeBangDreamPathSegment(value: string) {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'
  );
}

/**
 * 执行 BanG Dream 宿主回调，并把非 `Error` 拒绝值规范为带稳定消息的异常。
 * @param host - 可能包含认证信息或端口的外部服务地址。
 * @param method - 决定调用BanGDream宿主内容、边界或目标的 `method` 值。
 * @param args - 决定调用BanGDream宿主内容、边界或目标的 `args` 值；按调用方给定的顺序传递全部剩余实参。
 * @returns 调用BanGDream宿主。
 * @throws 当 `typeof fn !== 'function'` 成立时拒绝当前输入并抛出 `Error`。
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
 * 将`value`规范为BanG Dream主机缓冲区，使等价输入得到一致表示。
 * @param value - 待转换为BanGDream主机缓冲区的原始值。
 * @returns BanGDream主机缓冲区。
 */
function normalizeBangDreamHostBuffer(value: unknown): Buffer {
  const body =
    (() => {
      if (value && typeof value === 'object' && 'body' in value) {
        return (value as { body?: unknown }).body;
      }
      return value;
    })();
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (Array.isArray(body)) return Buffer.from(body);
  return Buffer.from([]);
}

/**
 * 将`normalizeError`、`error`规范为BanG Dream通用错误，使等价输入得到一致表示；当 `normalized instanceof Error` 成立时返回 `normalized.message`。
 * @param normalizeError - 负责完成BanGDream通用错误外部交互的受控能力。
 * @param error - 待转换为稳定业务错误或日志文本的未知异常。
 * @returns 按参数编码并拼接完成的BanGDream通用错误。
 */
function normalizeBangDreamGenericError(
  normalizeError: PluginGenericPluginCreateOptions['normalizeError'],
  error: unknown,
) {
  const normalized = normalizeError(error, 'BangDream 命令执行失败');
  if (normalized instanceof Error) {
    return normalized.message;
  }
  return `${normalized}`;
}

/**
 * 从`operations`解析BanG Dream操作集合；从 `getBangDreamOperationsByHandlerName` 读取BanG Dream操作集合。
 * @param operations - 按原有顺序参与BanGDream操作集合筛选、合并或汇总的集合。
 * @returns 按稳定键索引的BanGDream操作集合映射；没有输入项时为空映射。
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
 * 根据`options`处理BanG Dream操作；把当前结果通知给生命周期观察者（`options.lifecycle.onError`）。
 * @param options - 控制BanGDream操作筛选、缓存或输出方式的可选项，包含 `operationKey`、`input`、`lifecycle`、`operationsByKey` 字段。
 * @returns BanGDream操作。
 * @throws 当 `!operation` 成立时拒绝当前输入并抛出 `Error`；当 `options.operationsByKey.get` 或 `options.lifecycle.afterResolve` 调用失败时拒绝当前输入并抛出 `Error`。
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
 * 按当前运行态读取包含 `properties`、`type` 字段的结果。
 * @returns 包含 `properties`、`type` 字段的包含 `properties`、`type` 字段的。
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
 * 按当前运行态读取包含 `properties`、`type` 字段的结果。
 * @returns 包含 `properties`、`type` 字段的包含 `properties`、`type` 字段的。
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
 * 将日期按本地时区格式化为补零的秒级检查时间，供插件状态摘要展示。
 * @param date - 要显示的检查时间，按其本地年月日与时分秒读取。
 * @returns `YYYY-MM-DD HH:mm:ss` 格式的本地时间文本。
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
