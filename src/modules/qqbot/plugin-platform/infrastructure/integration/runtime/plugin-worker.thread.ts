import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import type {
  QqbotPluginPackageDescriptor,
  QqbotPluginRuntimeConfigSnapshot,
} from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package.types';
import type { QqbotPluginWorkerRequest } from './worker-runtime.types';
import type { QqbotPluginWorkerRequestType } from './worker-runtime.types';

export type QqbotWorkerCreatePluginOptions = {
  configSnapshot: QqbotPluginRuntimeConfigSnapshot;
  descriptor: QqbotPluginPackageDescriptor;
  host: Record<string, unknown>;
  installationId: string;
};

export type QqbotWorkerPluginInstance = {
  activate?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  executeOperation?: (
    operationKey: string,
    input: unknown,
  ) => Promise<unknown> | unknown;
  executeTask?: (
    taskKey: string,
    input: unknown,
    context?: unknown,
  ) => Promise<unknown> | unknown;
  handleEvent?: (
    eventKey: string,
    event: unknown,
  ) => Promise<unknown> | unknown;
  health?: () => Promise<unknown> | unknown;
  healthCheck?: () => Promise<unknown> | unknown;
  operations?: unknown[];
  tasks?: unknown[];
};

type PluginEntryModule = {
  createPlugin?: (input: {
    host: Record<string, unknown>;
    manifest: QqbotPluginPackageDescriptor['manifest'];
    normalizeError: (error: unknown, fallback?: string) => string;
    now: () => Date;
    runtime: {
      configSnapshot: QqbotPluginRuntimeConfigSnapshot;
      installationId: string;
    };
  }) => Promise<QqbotWorkerPluginInstance> | QqbotWorkerPluginInstance;
  default?: {
    createPlugin?: PluginEntryModule['createPlugin'];
  };
};

type ParentMessage =
  | {
      message: QqbotPluginWorkerRequest;
      requestId: string;
      type: 'request';
    }
  | {
      error?: { message?: string; name?: string; stack?: string };
      ok: boolean;
      requestId: string;
      result?: unknown;
      type: 'hostResponse';
    };

type PendingHostCall = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
};

type HostArgumentMapper = (...args: unknown[]) => Record<string, unknown>;

const HOST_ARGUMENT_MAPPERS: Record<string, HostArgumentMapper> = {
  bindEventPlugin: (selfId, pluginKey) => ({ pluginKey, selfId }),
  getBoundEventPluginKeys: (selfId) => ({ selfId }),
  getConfig: (key) => ({ key }),
  getConfigMany: (keys) => ({ keys }),
  getDictByKey: (dictCode) => ({ dictCode }),
  getDictItemsByKey: (dictCode) => ({ dictCode }),
  readAssetFile: (path) => ({ path }),
  readJsonFile: (path) => ({ path }),
  relationTree: (input) => ({ input }),
  renameFile: (from, to) => ({ from, to }),
  requestBuffer: (options) => ({ options }),
  requestJson: (options) => ({ options }),
  resolveRedirect: (input) => ({ input }),
  sendText: (input) => ({ input }),
  sleep: (ms) => ({ ms }),
  unbindEventPlugin: (selfId, pluginKey) => ({ pluginKey, selfId }),
  warn: (message) => ({ message }),
  writeJsonFile: (path, data) => ({ data, path }),
};

const port = parentPort;
const pendingHostCalls = new Map<string, PendingHostCall>();
const requireEntryModule = createRequire(__filename);
let plugin: QqbotWorkerPluginInstance | undefined;

const WORKER_REQUEST_HANDLERS: Record<
  QqbotPluginWorkerRequestType,
  (message: QqbotPluginWorkerRequest) => Promise<unknown> | unknown
> = {
  load: (message) => loadPlugin(message),
  activate: async () => {
    await requirePlugin().activate?.();
    return { ok: true };
  },
  health: () => healthPlugin(),
  executeOperation: (message) => executeOperation(message),
  executeTask: (message) => executeTask(message),
  handleEvent: (message) => handleEvent(message),
  deactivate: () => ({ ok: true }),
  dispose: async () => {
    await plugin?.dispose?.();
    plugin = undefined;
    return { ok: true };
  },
};

export async function createPluginFromDescriptor(
  options: QqbotWorkerCreatePluginOptions,
): Promise<QqbotWorkerPluginInstance> {
  const moduleUrl = pathToFileURL(options.descriptor.entryFile).href;
  const entryModule = await importPluginEntryModule(
    moduleUrl,
    options.descriptor.entryFile,
  );
  const createPlugin =
    entryModule.createPlugin || entryModule.default?.createPlugin;

  if (typeof createPlugin !== 'function') {
    throw new Error('Plugin entry must export createPlugin(options)');
  }

  return createPlugin({
    host: options.host,
    manifest: options.descriptor.manifest,
    normalizeError,
    now: () => new Date(),
    runtime: {
      configSnapshot: options.configSnapshot,
      installationId: options.installationId,
    },
  });
}

if (port) {
  port.on('message', (message: ParentMessage) => {
    void handleParentMessage(message);
  });
}

async function handleParentMessage(message: ParentMessage) {
  if (message.type === 'hostResponse') {
    settleHostResponse(message);
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
  return WORKER_REQUEST_HANDLERS[message.type](message);
}

async function loadPlugin(message: QqbotPluginWorkerRequest) {
  const descriptor = getWorkerDescriptor();
  plugin = await createPluginFromDescriptor({
    configSnapshot: getWorkerConfigSnapshot(),
    descriptor,
    host: createHostFacade(),
    installationId: getWorkerInstallationId(message),
  });

  return {
    ok: true,
    pluginKey: descriptor.pluginKey,
  };
}

async function healthPlugin() {
  const loadedPlugin = requirePlugin();
  if (loadedPlugin.health) return loadedPlugin.health();
  if (loadedPlugin.healthCheck) return loadedPlugin.healthCheck();
  return { ok: true, status: 'healthy' };
}

async function executeOperation(message: QqbotPluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const operationKey = requireRequestKey(
    message.operationKey || message.operationId,
    'QQBot 插件能力缺少 operationKey',
  );

  if (loadedPlugin.executeOperation) {
    return loadedPlugin.executeOperation(operationKey, message.input);
  }

  const operation = findRuntimeCallable(loadedPlugin.operations, operationKey);
  if (operation) {
    return operation.execute(message.input || {});
  }

  throw new Error(`QQBot 插件能力不存在：${operationKey}`);
}

async function executeTask(message: QqbotPluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const taskKey = requireRequestKey(
    message.taskKey || message.taskHandlerName,
    'QQBot 插件定时任务缺少 taskKey',
  );
  const context = {
    taskHandlerName: message.taskHandlerName,
    taskId: message.taskId,
    triggerType: message.triggerType,
  };

  if (loadedPlugin.executeTask) {
    return loadedPlugin.executeTask(taskKey, message.input, context);
  }

  const task = findRuntimeCallable(
    loadedPlugin.tasks,
    taskKey,
    message.taskHandlerName,
  );
  if (task) {
    return task.execute(message.input || {}, context);
  }

  throw new Error(`QQBot 插件定时任务不存在：${taskKey}`);
}

async function handleEvent(message: QqbotPluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const eventKey = requireRequestKey(
    message.eventKey,
    'QQBot 插件事件缺少 eventKey',
  );

  if (!loadedPlugin.handleEvent) return false;
  return loadedPlugin.handleEvent(eventKey, message.event);
}

function createHostFacade(): Record<string, unknown> {
  const host: Record<string, unknown> = {};
  for (const method of Object.keys(HOST_ARGUMENT_MAPPERS)) {
    host[method] = (...args: unknown[]) =>
      callHost(method, HOST_ARGUMENT_MAPPERS[method](...args));
  }

  return new Proxy(host, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (property in target) return target[property];
      if (property === 'then') return undefined;
      return (...args: unknown[]) =>
        callHost(property, normalizeHostArgs(args));
    },
  });
}

function callHost<TResult = unknown>(
  method: string,
  args: Record<string, unknown>,
): Promise<TResult> {
  if (!port) {
    return Promise.reject(
      new Error('QQBot plugin worker host port unavailable'),
    );
  }

  const requestId = `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<TResult>((resolve, reject) => {
    pendingHostCalls.set(requestId, {
      reject,
      resolve: (value) => resolve(value as TResult),
    });
    port.postMessage({
      args,
      method,
      requestId,
      type: 'hostCall',
    });
  });
}

function settleHostResponse(
  message: Extract<ParentMessage, { type: 'hostResponse' }>,
) {
  const pending = pendingHostCalls.get(message.requestId);
  if (!pending) return;
  pendingHostCalls.delete(message.requestId);

  if (message.ok) {
    pending.resolve(message.result);
    return;
  }

  pending.reject(deserializeError(message.error));
}

function getWorkerDescriptor(): QqbotPluginPackageDescriptor {
  const descriptor = workerData?.descriptor;
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('QQBot 插件 worker 缺少 descriptor');
  }
  return descriptor as QqbotPluginPackageDescriptor;
}

function getWorkerConfigSnapshot(): QqbotPluginRuntimeConfigSnapshot {
  const snapshot = workerData?.configSnapshot;
  return snapshot && typeof snapshot === 'object'
    ? (snapshot as QqbotPluginRuntimeConfigSnapshot)
    : {};
}

function getWorkerInstallationId(message: QqbotPluginWorkerRequest) {
  const installationId = workerData?.installationId || message.installationId;
  return typeof installationId === 'string' ? installationId : '';
}

function requirePlugin() {
  if (!plugin) {
    throw new Error('QQBot 插件运行时未加载');
  }
  return plugin;
}

function requireRequestKey(value: unknown, message: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(message);
}

function findRuntimeCallable(
  items: unknown[] | undefined,
  key: string,
  handlerName?: string,
) {
  return items
    ?.filter(isRuntimeCallable)
    .find(
      (item) =>
        item.key === key ||
        item.handlerName === key ||
        (!!handlerName && item.handlerName === handlerName),
    );
}

function isRuntimeCallable(item: unknown): item is {
  execute: (input: unknown, context?: unknown) => Promise<unknown> | unknown;
  handlerName?: string;
  key?: string;
} {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof (item as { execute?: unknown }).execute === 'function'
  );
}

function normalizeHostArgs(args: unknown[]): Record<string, unknown> {
  if (args.length === 1 && isRecord(args[0])) return args[0];
  return { args };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function importPluginEntryModule(moduleUrl: string, entryFile: string) {
  try {
    return await dynamicImportPluginEntry(moduleUrl);
  } catch (error) {
    if (!shouldFallbackToRequire(error, moduleUrl)) {
      throw error;
    }
    if (entryFile.endsWith('.js') || entryFile.endsWith('.cjs')) {
      return loadCommonJsEntryModule(entryFile);
    }
    return requireEntryModule(entryFile) as PluginEntryModule;
  }
}

function dynamicImportPluginEntry(
  moduleUrl: string,
): Promise<PluginEntryModule> {
  const importer = new Function('moduleUrl', 'return import(moduleUrl)') as (
    value: string,
  ) => Promise<PluginEntryModule>;
  return importer(moduleUrl);
}

function shouldFallbackToRequire(error: unknown, moduleUrl: string) {
  if (!moduleUrl.startsWith('file:')) return false;
  const message = error instanceof Error ? error.message : `${error}`;
  return (
    message.includes('Cannot find module') ||
    message.includes('dynamic import callback') ||
    message.includes('Unknown file extension')
  );
}

function loadCommonJsEntryModule(entryFile: string): PluginEntryModule {
  const nodeModule = requireEntryModule(
    'node:module',
  ) as typeof import('node:module');
  const moduleConstructor = nodeModule.Module as typeof nodeModule.Module & {
    _nodeModulePaths: (from: string) => string[];
  };
  const entryModule = new moduleConstructor(entryFile);
  entryModule.filename = entryFile;
  entryModule.paths = moduleConstructor._nodeModulePaths(dirname(entryFile));
  (
    entryModule as typeof entryModule & {
      _compile: (content: string, filename: string) => void;
    }
  )._compile(readFileSync(entryFile, 'utf8'), entryFile);
  return entryModule.exports as PluginEntryModule;
}

function normalizeError(error: unknown, fallback = '插件执行失败') {
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
