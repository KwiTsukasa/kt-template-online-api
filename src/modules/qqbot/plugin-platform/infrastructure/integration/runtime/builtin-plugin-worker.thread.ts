import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

function createEventPlugin(targetPluginKey: string) {
  if (targetPluginKey !== 'repeater') return undefined;
  const manifest = loadManifest<RepeaterManifest>('repeater');
  return createRepeaterPlugin({
    host: {
      bindEventPlugin: (selfId, targetPluginKey) =>
        callHost('bindEventPlugin', { pluginKey: targetPluginKey, selfId }),
      getBoundEventPluginKeys: (selfId) =>
        callHost<string[]>('getBoundEventPluginKeys', { selfId }),
      getConfig,
      sendText: (input) => callHost('sendText', { input }),
      unbindEventPlugin: (selfId, targetPluginKey) =>
        callHost('unbindEventPlugin', { pluginKey: targetPluginKey, selfId }),
      warn: (message) => {
        void callHost('warn', { message });
      },
    },
    manifest,
  }) as RuntimeEventPlugin;
}

function createBangDreamCommandPlugin() {
  const manifest = loadManifest('bangdream');
  return createBangDreamPlugin({
    configReader: {
      get: getConfig,
    },
    description: manifest.description,
    dictionaryReader: {
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

function createFf14MarketCommandPlugin() {
  const manifest = loadManifest<Ff14MarketManifest>('ff14-market');
  return createFf14MarketPlugin({
    host: {
      getConfig,
      getDictItemsByKey: (dictCode) =>
        callHost('getDictItemsByKey', { dictCode }),
      relationTree: (input) => callHost('relationTree', { input }),
      requestJson: (options) =>
        callHost('requestJson', { options: serializeHttpRequest(options) }),
    },
    manifest,
    normalizeError: normalizeErrorMessage,
  }) as RuntimeCommandPlugin;
}

function createFflogsCommandPlugin() {
  const manifest = loadManifest<FflogsManifest>('fflogs');
  return createFflogsPlugin({
    host: {
      getConfig,
      getDictByKey: (dictCode) => callHost('getDictByKey', { dictCode }),
      requestJson: (options) =>
        callHost('requestJson', { options: serializeHttpRequest(options) }),
      resolveKnownWorld,
    },
    manifest,
    normalizeError: normalizeErrorMessage,
  }) as RuntimeCommandPlugin;
}

function createBangDreamRuntimeIo(): BangDreamRuntimeIo {
  return {
    getConfig,
    readAssetFile: async (filePath) => readFileSync(filePath),
    readExcelRows: async (filePath) => readExcelRows(filePath),
    readJsonFile: async (filePath) => readJsonFile(filePath),
    readJsonFileSync: (filePath) => readJsonFile(filePath),
    requestArrayBuffer: async (url, options) => ({
      body: Buffer.from(
        await callHost<Uint8Array>('requestBuffer', {
          options: serializeHttpRequest({
            context: 'BangDream 资源下载',
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
    requestJson: async (url, options) => ({
      body: await callHost('bangdreamRequestJson', {
        options: serializeHttpRequest({
          context: 'BangDream 数据接口',
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
    sleep: async (ms) =>
      await new Promise((resolve) => setTimeout(resolve, ms)),
    writeJsonFile: async (filePath, data) =>
      writeFileSync(filePath, JSON.stringify(data)),
  };
}

async function resolveKnownWorld(candidate: string) {
  const catalog = await loadFf14MarketCatalog();
  if (!isFf14LocationName(catalog, candidate)) return null;
  const worldPath = splitFf14WorldPath(candidate);
  return { serverSlug: worldPath.world || candidate };
}

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

function loadManifest<TManifest = QqbotPluginManifest>(
  targetPluginKey: string,
) {
  const pluginRoot = resolvePluginRoot(targetPluginKey);
  return parseQqbotPluginManifest(
    readJsonFile(join(pluginRoot, 'plugin.json')),
    { pluginRoot },
  ) as TManifest;
}

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

function getConfig<T = string>(key: string): T | undefined {
  const value = configCache.get(key);
  return value === undefined || value === null || value === ''
    ? undefined
    : (value as T);
}

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

function resolvePluginRoot(targetPluginKey: string) {
  const sourceRoot = join(
    process.cwd(),
    `src/modules/qqbot/plugins/${targetPluginKey}`,
  );
  if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
  return join(__dirname, `../../../../plugins/${targetPluginKey}`);
}

function callHost<TResult = any>(
  method: string,
  args: Record<string, unknown> = {},
) {
  const requestId = `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<TResult>((resolve, reject) => {
    pendingHostCalls.set(requestId, {
      reject,
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

function readJsonFile<T = unknown>(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readExcelRows<T extends Record<string, unknown>>(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<T>(worksheet);
}

function normalizeErrorMessage(error: unknown, fallback = '插件执行失败') {
  if (error instanceof Error && error.message) return error.message;
  const message = `${error || ''}`.trim();
  return message || fallback;
}

function serializeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : `${error}`,
    name: error instanceof Error ? error.name : 'Error',
    stack: error instanceof Error ? error.stack : undefined,
  };
}

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

function assertNever(value: never): never {
  throw new Error(`未知插件运行时请求：${value}`);
}
