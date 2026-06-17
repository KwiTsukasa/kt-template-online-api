import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import * as XLSX from 'xlsx';
import type {
  QqbotIntegrationPlugin,
  QqbotNormalizedMessage,
  QqbotPluginOperation,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';
import { createPlugin as createBangDreamPlugin } from '@/modules/qqbot/plugins/bangdream/src';
import type {
  BangDreamOperationHandlerName,
  BangDreamOperationKey,
} from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream.types';
import { BANGDREAM_TSUGU_ENV_KEYS } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-options';
import type { BangDreamRuntimeIo } from '@/modules/qqbot/plugins/bangdream/src/infrastructure/integration/runtime-io';
import { createPlugin as createFf14MarketPlugin } from '@/modules/qqbot/plugins/ff14-market/src';
import {
  buildFf14MarketCatalog,
  buildFf14MarketCatalogFromTree,
  isFf14LocationName,
  QQBOT_FF14_MARKET_DICT_CODES,
  splitFf14WorldPath,
} from '@/modules/qqbot/plugins/ff14-market/src/domain/ff14-worlds';
import type { Ff14MarketManifest } from '@/modules/qqbot/plugins/ff14-market/src/operations';
import { createPlugin as createFflogsPlugin } from '@/modules/qqbot/plugins/fflogs/src';
import type { FflogsManifest } from '@/modules/qqbot/plugins/fflogs/src/operations';
import { createPlugin as createRepeaterPlugin } from '@/modules/qqbot/plugins/repeater/src';
import type { RepeaterManifest } from '@/modules/qqbot/plugins/repeater/src/domain/repeater.types';
import type { QqbotPluginWorkerRequest } from './worker-runtime.types';

type RuntimeCommandPlugin = QqbotIntegrationPlugin & {
  activate?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  tasks?: Array<{
    execute(input: Record<string, unknown>): Promise<unknown> | unknown;
    handlerName: string;
    key: string;
  }>;
};

type RuntimeEventPlugin = {
  bind(selfId: string): Promise<boolean> | boolean;
  getDefinition(): {
    key: string;
    remark?: string;
    triggerType?: string;
  };
  handleMessage(message: QqbotNormalizedMessage): Promise<boolean> | boolean;
  unbind(selfId: string): Promise<boolean> | boolean;
};

type ParentMessage =
  | {
      message: QqbotPluginWorkerRequest;
      requestId: string;
      type: 'request';
    }
  | {
      ok: boolean;
      requestId: string;
      result?: unknown;
      error?: { message?: string; name?: string; stack?: string };
      type: 'hostResponse';
    };

type PendingHostCall = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type WorkerHttpRequestInput = {
  body?: Buffer | string;
  context?: string;
  failureMessage?: (statusCode: number) => string;
  headers?: Record<string, string>;
  invalidJsonMessage?: string;
  method?: string;
  timeoutMessage?: string;
  timeoutMs?: number;
  url: string | URL;
};

const HTTP_STATUS_PLACEHOLDER = 599;

const port = parentPort;
if (!port) {
  throw new Error('QQBot plugin worker must run inside worker_threads');
}

const pluginKey = `${workerData?.pluginKey || ''}`.trim();
const configCache = new Map<string, unknown>();
const pendingHostCalls = new Map<string, PendingHostCall>();
let commandPlugin: RuntimeCommandPlugin | undefined;
let eventPlugin: RuntimeEventPlugin | undefined;

port.on('message', (message: ParentMessage) => {
  void handleParentMessage(message);
});

/**
 * 处理Parent Message。
 * @param message - message 输入；使用 `type`、`requestId`、`ok`、`result` 字段生成结果。
 */
async function handleParentMessage(message: ParentMessage) {
  if (message.type === 'hostResponse') {
    const pending = pendingHostCalls.get(message.requestId);
    if (!pending) return;
    pendingHostCalls.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(deserializeError(message.error));
    return;
  }

  try {
    const result = await handleWorkerRequest(message.message);
    port?.postMessage({
      ok: true,
      requestId: message.requestId,
      result,
      type: 'response',
    });
  } catch (error) {
    port?.postMessage({
      error: serializeError(error),
      ok: false,
      requestId: message.requestId,
      type: 'response',
    });
  }
}

/**
 * 处理Worker Request。
 * @param message - message 输入；使用 `type` 字段生成结果。
 */
async function handleWorkerRequest(message: QqbotPluginWorkerRequest) {
  switch (message.type) {
    case 'load':
      return loadPlugin();
    case 'activate':
      await commandPlugin?.activate?.();
      return { ok: true };
    case 'health':
      return health();
    case 'executeOperation':
      return executeOperation(message);
    case 'executeTask':
      return executeTask(message);
    case 'handleEvent':
      return handleEvent(message);
    case 'deactivate':
      return { ok: true };
    case 'dispose':
      await commandPlugin?.dispose?.();
      return { ok: true };
    default:
      return assertNever(message.type);
  }
}

/**
 * 加载Plugin。
 */
async function loadPlugin() {
  await preloadHostConfig(getConfigKeysForPlugin(pluginKey));
  commandPlugin = createCommandPlugin(pluginKey);
  eventPlugin = commandPlugin ? undefined : createEventPlugin(pluginKey);

  if (!commandPlugin && !eventPlugin) {
    throw new Error(`QQBot 插件运行时不存在：${pluginKey}`);
  }

  return {
    ok: true,
    pluginKey,
    triggerMode: commandPlugin ? 'command' : 'event',
  };
}

/**
 * 执行 QQBot 插件平台流程。
 */
async function health() {
  if (commandPlugin?.healthCheck) {
    return commandPlugin.healthCheck();
  }
  if (eventPlugin) {
    return {
      message: eventPlugin.getDefinition().remark || '事件插件可用',
      status: 'healthy',
    };
  }
  throw new Error(`QQBot 插件运行时未加载：${pluginKey}`);
}

/**
 * 执行Operation。
 * @param message - message 输入；使用 `operationKey`、`input` 字段生成结果。
 */
async function executeOperation(message: QqbotPluginWorkerRequest) {
  const operation = commandPlugin?.operations.find(
    (item: QqbotPluginOperation) => item.key === message.operationKey,
  );
  if (!operation) {
    throw new Error(`QQBot 插件能力不存在：${message.operationKey}`);
  }
  return operation.execute(
    (message.input || {}) as Record<string, unknown>,
    {},
  );
}

/**
 * 执行Task。
 * @param message - message 输入；使用 `taskKey`、`taskHandlerName`、`input` 字段生成结果。
 */
async function executeTask(message: QqbotPluginWorkerRequest) {
  const task = commandPlugin?.tasks?.find(
    (item) =>
      item.key === message.taskKey ||
      item.handlerName === message.taskHandlerName,
  );
  if (!task) {
    throw new Error(`QQBot 插件定时任务不存在：${message.taskKey}`);
  }
  return task.execute((message.input || {}) as Record<string, unknown>);
}

/**
 * 处理Event。
 * @param message - message 输入；使用 `eventKey`、`event` 字段生成结果。
 */
async function handleEvent(message: QqbotPluginWorkerRequest) {
  if (!eventPlugin) return false;
  const definition = eventPlugin.getDefinition();
  if (
    message.eventKey &&
    message.eventKey !== definition.key &&
    message.eventKey !== definition.triggerType
  ) {
    return false;
  }
  if (definition.triggerType !== 'message') return false;
  return eventPlugin.handleMessage(
    (message.event || {}) as QqbotNormalizedMessage,
  );
}

/**
 * 创建 QQBot 插件平台对象或配置。
 * @param targetPluginKey - targetPluginKey 输入；生成 插件平台对象。
 */
function createCommandPlugin(targetPluginKey: string) {
  switch (targetPluginKey) {
    case 'bangdream':
      return createBangDreamCommandPlugin();
    case 'ff14-market':
      return createFf14MarketCommandPlugin();
    case 'fflogs':
      return createFflogsCommandPlugin();
    default:
      return undefined;
  }
}

/**
 * 创建 QQBot 插件平台对象或配置。
 * @param targetPluginKey - targetPluginKey 输入；决定 插件平台条件分支。
 */
function createEventPlugin(targetPluginKey: string) {
  if (targetPluginKey !== 'repeater') return undefined;
  const manifest = loadManifest<RepeaterManifest>('repeater');
  return createRepeaterPlugin({
    host: {
      /**
       * 维护 插件平台事件绑定。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       * @param targetPluginKey - targetPluginKey 输入；影响 bindEventPlugin 的返回值。
       */
      bindEventPlugin: (selfId, targetPluginKey) =>
        callHost('bindEventPlugin', { pluginKey: targetPluginKey, selfId }),
      /**
       * 读取 插件平台回调数据。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       */
      getBoundEventPluginKeys: (selfId) =>
        callHost<string[]>('getBoundEventPluginKeys', { selfId }),
      getConfig,
      /**
       * 发送 插件平台回调消息。
       * @param input - input 输入；影响 sendText 的返回值。
       */
      sendText: (input) => callHost('sendText', { input }),
      /**
       * 维护 插件平台事件绑定。
       * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
       * @param targetPluginKey - targetPluginKey 输入；影响 unbindEventPlugin 的返回值。
       */
      unbindEventPlugin: (selfId, targetPluginKey) =>
        callHost('unbindEventPlugin', { pluginKey: targetPluginKey, selfId }),
      /**
       * 记录 插件平台回调日志。
       * @param message - message 输入；影响 warn 的返回值。
       */
      warn: (message) => {
        void callHost('warn', { message });
      },
    },
    manifest,
  }) as RuntimeEventPlugin;
}

/**
 * 创建 QQBot 插件平台对象或配置。
 */
function createBangDreamCommandPlugin() {
  const manifest = loadManifest('bangdream');
  return createBangDreamPlugin({
    configReader: {
      get: getConfig,
    },
    description: manifest.description,
    dictionaryReader: {
      /**
       * 读取 插件平台回调数据。
       * @param dictCode - dictCode 输入；限定 插件平台查询范围。
       */
      getDictItemsByKey: (dictCode) =>
        callHost('getDictItemsByKey', { dictCode }),
    },
    io: createBangDreamRuntimeIo(),
    legacyAliases: manifest.legacyAliases,
    name: manifest.name,
    normalizeError: normalizeErrorMessage,
    operations: manifest.operations.map((operation) => ({
      aliases: operation.aliases,
      description: operation.description,
      handlerName: operation.handlerName as BangDreamOperationHandlerName,
      inputSchema: operation.inputSchema,
      key: operation.key as BangDreamOperationKey,
      name: operation.name,
      outputSchema: operation.outputSchema,
      timeoutMs: operation.timeoutMs,
    })),
    pluginKey: manifest.pluginKey,
    version: manifest.version,
  }) as RuntimeCommandPlugin;
}

/**
 * 创建 QQBot 插件平台对象或配置。
 */
function createFf14MarketCommandPlugin() {
  const manifest = loadManifest<Ff14MarketManifest>('ff14-market');
  return createFf14MarketPlugin({
    host: {
      getConfig,
      /**
       * 读取 插件平台回调数据。
       * @param dictCode - dictCode 输入；限定 插件平台查询范围。
       */
      getDictItemsByKey: (dictCode) =>
        callHost('getDictItemsByKey', { dictCode }),
      /**
       * 执行 插件平台回调。
       * @param input - input 输入；影响 relationTree 的返回值。
       */
      relationTree: (input) => callHost('relationTree', { input }),
      /**
       * 执行 插件平台回调。
       * @param options - 插件平台列表；驱动 `serializeHttpRequest()` 的 插件平台步骤。
       */
      requestJson: (options) =>
        callHost('requestJson', { options: serializeHttpRequest(options) }),
    },
    manifest,
    normalizeError: normalizeErrorMessage,
  }) as RuntimeCommandPlugin;
}

/**
 * 创建 QQBot 插件平台对象或配置。
 */
function createFflogsCommandPlugin() {
  const manifest = loadManifest<FflogsManifest>('fflogs');
  return createFflogsPlugin({
    host: {
      getConfig,
      /**
       * 读取 插件平台回调数据。
       * @param dictCode - dictCode 输入；限定 插件平台查询范围。
       */
      getDictByKey: (dictCode) => callHost('getDictByKey', { dictCode }),
      /**
       * 执行 插件平台回调。
       * @param options - 插件平台列表；驱动 `serializeHttpRequest()` 的 插件平台步骤。
       */
      requestJson: (options) =>
        callHost('requestJson', { options: serializeHttpRequest(options) }),
      resolveKnownWorld,
    },
    manifest,
    normalizeError: normalizeErrorMessage,
  }) as RuntimeCommandPlugin;
}

/**
 * 创建 QQBot 插件平台对象或配置。
 * @returns 创建后的 QQBot 插件平台对象或配置。
 */
function createBangDreamRuntimeIo(): BangDreamRuntimeIo {
  return {
    getConfig,
    /**
     * 执行 插件平台回调。
     * @param filePath - 插件平台路径；读取本地文件内容。
     */
    readAssetFile: async (filePath) => readFileSync(filePath),
    /**
     * 执行 插件平台回调。
     * @param filePath - 插件平台路径；驱动 `readExcelRows()` 的 插件平台步骤。
     */
    readExcelRows: async (filePath) => readExcelRows(filePath),
    /**
     * 执行 插件平台回调。
     * @param filePath - 插件平台路径；驱动 `readJsonFile()` 的 插件平台步骤。
     */
    readJsonFile: async (filePath) => readJsonFile(filePath),
    /**
     * 执行 插件平台回调。
     * @param filePath - 插件平台路径；驱动 `readJsonFile()` 的 插件平台步骤。
     */
    readJsonFileSync: (filePath) => readJsonFile(filePath),
    /**
     * 执行 插件平台回调。
     * @param from - from 输入；驱动 `renameSync()` 的 插件平台步骤。
     * @param to - to 输入；驱动 `mkdirSync()`、`renameSync()` 的 插件平台步骤。
     */
    renameFile: async (from, to) => {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    },
    /**
     * 执行 插件平台回调。
     * @param url - 访问地址；影响 requestArrayBuffer 的返回值。
     * @param options - 插件平台列表；影响 requestArrayBuffer 的返回值。
     */
    requestArrayBuffer: async (url, options) => ({
      body: Buffer.from(
        await callHost<Uint8Array>('requestBuffer', {
          options: serializeHttpRequest({
            context: 'BangDream 资源下载',
            /**
             * 执行 插件平台回调。
             * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
             */
            failureMessage: (statusCode: number) =>
              `BangDream 资源下载失败：${statusCode}`,
            headers: options?.headers,
            timeoutMessage: 'BangDream 资源下载超时',
            timeoutMs: options?.timeoutMs,
            url,
          }),
        }),
      ),
    }),
    /**
     * 执行 插件平台回调。
     * @param url - 访问地址；影响 requestJson 的返回值。
     * @param options - 插件平台列表；影响 requestJson 的返回值。
     */
    requestJson: async (url, options) => ({
      body: await callHost('bangdreamRequestJson', {
        options: serializeHttpRequest({
          context: 'BangDream 数据接口',
          /**
           * 执行 插件平台回调。
           * @param statusCode - statusCode 输入；影响 failureMessage 的返回值。
           */
          failureMessage: (statusCode: number) =>
            `BangDream 数据接口失败：${statusCode}`,
          headers: options?.headers,
          invalidJsonMessage: 'BangDream 数据接口返回不是合法 JSON',
          timeoutMessage: 'BangDream 数据接口请求超时',
          timeoutMs: options?.timeoutMs,
          url,
        }),
      }),
    }),
    /**
     * 执行 插件平台回调。
     * @param ms - 等待毫秒数；驱动 `Promise()` 的 插件平台步骤。
     */
    sleep: async (ms) =>
      await new Promise((resolve) => setTimeout(resolve, ms)),
    /**
     * 执行 插件平台回调。
     * @param filePath - 插件平台路径；驱动 `mkdirSync()`、`writeFileSync()` 的 插件平台步骤。
     * @param data - 业务数据；承载 插件平台新增、更新、导入或执行字段。
     */
    writeJsonFile: async (filePath, data) => {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data));
    },
  };
}

/**
 * 解析Known World。
 * @param candidate - candidate 输入；驱动 `splitFf14WorldPath()` 的 插件平台步骤。
 */
async function resolveKnownWorld(candidate: string) {
  const catalog = await loadFf14MarketCatalog();
  if (!isFf14LocationName(catalog, candidate)) return null;
  const worldPath = splitFf14WorldPath(candidate);
  return { serverSlug: worldPath.world || candidate };
}

/**
 * 加载Ff14 Market Catalog。
 */
async function loadFf14MarketCatalog() {
  const treeCatalog = buildFf14MarketCatalogFromTree(
    await callHost('relationTree', {
      input: {
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      },
    }),
  );
  if (treeCatalog.dataCenters.length > 0) return treeCatalog;

  const [regions, dataCenters, worlds] = await Promise.all([
    callHost('getDictItemsByKey', {
      dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
    }),
    callHost('getDictItemsByKey', {
      dictCode: QQBOT_FF14_MARKET_DICT_CODES.dataCenter,
    }),
    callHost('getDictItemsByKey', {
      dictCode: QQBOT_FF14_MARKET_DICT_CODES.world,
    }),
  ]);
  return buildFf14MarketCatalog({
    dataCenters,
    regions,
    worlds,
  });
}

/**
 * 加载Manifest。
 * @param targetPluginKey - targetPluginKey 输入；驱动 `resolvePluginRoot()` 的 插件平台步骤。
 */
function loadManifest<TManifest = QqbotPluginManifest>(
  targetPluginKey: string,
) {
  const pluginRoot = resolvePluginRoot(targetPluginKey);
  return parseQqbotPluginManifest(
    readJsonFile(join(pluginRoot, 'plugin.json')),
    { pluginRoot },
  ) as TManifest;
}

/**
 * 执行 QQBot 插件平台流程。
 * @param keys - 插件平台列表；筛选 插件平台列表项。
 */
async function preloadHostConfig(keys: readonly string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const entries = await Promise.all(
    uniqueKeys.map(
      async (key) => [key, await callHost('getConfig', { key })] as const,
    ),
  );
  configCache.clear();
  for (const [key, value] of entries) {
    configCache.set(key, value);
  }
}

/**
 * 查询 QQBot 插件平台数据。
 * @param key - 键名；驱动 `configCache.get()` 的 插件平台步骤。
 * @returns QQBot 插件平台查询结果。
 */
function getConfig<T = string>(key: string): T | undefined {
  const value = configCache.get(key);
  return value === undefined || value === null || value === ''
    ? undefined
    : (value as T);
}

/**
 * 查询 QQBot 插件平台数据。
 * @param targetPluginKey - targetPluginKey 输入；限定 插件平台查询范围。
 */
function getConfigKeysForPlugin(targetPluginKey: string) {
  switch (targetPluginKey) {
    case 'bangdream':
      return Object.values(BANGDREAM_TSUGU_ENV_KEYS);
    case 'ff14-market':
      return [
        'FF14_DEFAULT_WORLD',
        'FF14_UNIVERSALIS_BASE_URL',
        'FF14_XIVAPI_BASE_URL',
        'FF14_XIVAPI_CHS_BASE_URL',
      ];
    case 'fflogs':
      return [
        'FFLOGS_BASE_URL',
        'FFLOGS_CLIENT_ID',
        'FFLOGS_CLIENT_SECRET',
        'FFLOGS_DEFAULT_SERVER',
        'FFLOGS_DEFAULT_SERVER_REGION',
        'FFLOGS_GRAPHQL_URL',
        'FFLOGS_REQUEST_TIMEOUT_MS',
        'FFLOGS_TOKEN_URL',
        'FFLOGS_WEB_BASE_URL',
      ];
    case 'repeater':
      return [
        'QQBOT_REPEATER_CONFIG_CACHE_TTL_MS',
        'QQBOT_REPEATER_MAX_TEXT_LENGTH',
        'QQBOT_REPEATER_MIN_INTERVAL_MS',
        'QQBOT_REPEATER_STATE_TTL_MS',
        'QQBOT_REPEATER_THRESHOLD',
      ];
    default:
      return [];
  }
}

/**
 * 解析Plugin Root。
 * @param targetPluginKey - targetPluginKey 输入；影响 resolvePluginRoot 的返回值。
 */
function resolvePluginRoot(targetPluginKey: string) {
  const sourceRoot = join(
    process.cwd(),
    `src/modules/qqbot/plugins/${targetPluginKey}`,
  );
  if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
  return join(__dirname, `../../../../plugins/${targetPluginKey}`);
}

/**
 * 执行 QQBot 插件平台流程。
 * @param method - HTTP 方法名；影响 callHost 的返回值。
 * @param args - 插件平台列表；影响 callHost 的返回值。
 */
function callHost<TResult = any>(
  method: string,
  args: Record<string, unknown> = {},
) {
  const requestId = `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<TResult>((resolve, reject) => {
    pendingHostCalls.set(requestId, {
      reject,
      /**
       * 执行 插件平台回调。
       * @param value - 待转换值；驱动 `resolve()` 的 插件平台步骤。
       */
      resolve: (value) => resolve(value as TResult),
    });
    port?.postMessage({
      args,
      method,
      requestId,
      type: 'hostCall',
    });
  });
}

/**
 * 序列化Http Request。
 * @param input - input 输入；影响 serializeHttpRequest 的返回值。
 */
function serializeHttpRequest(input: WorkerHttpRequestInput) {
  const { failureMessage, url, ...rest } = input;
  return {
    ...rest,
    failureMessageTemplate: failureMessage
      ? failureMessage(HTTP_STATUS_PLACEHOLDER).replaceAll(
          `${HTTP_STATUS_PLACEHOLDER}`,
          '{statusCode}',
        )
      : undefined,
    url: url instanceof URL ? url.toString() : `${url}`,
  };
}

/**
 * 读取 QQBot 插件平台资源。
 * @param filePath - 插件平台路径；转换 JSON 文本。
 */
function readJsonFile<T = unknown>(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

/**
 * 读取 QQBot 插件平台资源。
 * @param filePath - 插件平台路径；驱动 `XLSX.readFile()` 的 插件平台步骤。
 */
function readExcelRows<T extends Record<string, unknown>>(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(worksheet);
}

/**
 * 转换 QQBot 插件平台输入。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 * @param fallback - 兜底值；影响 normalizeErrorMessage 的返回值。
 */
function normalizeErrorMessage(error: unknown, fallback = '插件执行失败') {
  if (error instanceof Error && error.message) return error.message;
  const message = `${error || ''}`.trim();
  return message || fallback;
}

/**
 * 序列化Error。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 */
function serializeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : `${error}`,
    name: error instanceof Error ? error.name : 'Error',
    stack: error instanceof Error ? error.stack : undefined,
  };
}

/**
 * 反序列化Error。
 * @param error - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 */
function deserializeError(error?: {
  message?: string;
  name?: string;
  stack?: string;
}) {
  const output = new Error(error?.message || '插件 Host 调用失败');
  if (error?.name) output.name = error.name;
  if (error?.stack) output.stack = error.stack;
  return output;
}

/**
 * 执行 QQBot 插件平台流程。
 * @param value - 待转换值；影响 assertNever 的返回值。
 */
function assertNever(value: never): never {
  throw new Error(`未知插件运行时请求：${value}`);
}
