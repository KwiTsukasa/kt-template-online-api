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
  /**
   * Loads a descriptor entry and stores the plugin instance for later requests.
   * @param message - Load request carrying installation fallback metadata.
   */
  load: (message) => loadPlugin(message),
  /**
   * Activates the loaded plugin instance.
   */
  activate: async () => {
    await requirePlugin().activate?.();
    return { ok: true };
  },
  /**
   * Runs the loaded plugin health hook.
   */
  health: () => healthPlugin(),
  /**
   * Executes one manifest operation.
   * @param message - Operation request with operation key and input.
   */
  executeOperation: (message) => executeOperation(message),
  /**
   * Executes one manifest task.
   * @param message - Task request with task key and input.
   */
  executeTask: (message) => executeTask(message),
  /**
   * Dispatches one manifest event.
   * @param message - Event request with event key and payload.
   */
  handleEvent: (message) => handleEvent(message),
  /**
   * Marks the worker inactive without disposing the plugin instance.
   */
  deactivate: () => ({ ok: true }),
  /**
   * Disposes the loaded plugin instance and clears worker state.
   */
  dispose: async () => {
    await plugin?.dispose?.();
    plugin = undefined;
    return { ok: true };
  },
};

/**
 * Dynamically imports a plugin package entry and creates its runtime instance.
 * @param options - Descriptor, host facade, installation id, and config snapshot supplied by the worker factory.
 * @returns Plugin instance returned by the package `createPlugin` entry.
 */
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

/**
 * Handles a parent RPC or host-call response message inside the worker thread.
 * @param message - Parent message carrying a worker request or the response for a pending host call.
 */
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

/**
 * Dispatches a lifecycle or execution request to the loaded plugin instance.
 * @param message - Worker request produced by QqbotPluginWorkerRuntime.
 * @returns Plugin lifecycle, operation, task, or event result.
 */
async function handleWorkerRequest(message: QqbotPluginWorkerRequest) {
  return WORKER_REQUEST_HANDLERS[message.type](message);
}

/**
 * Creates and stores the plugin instance for subsequent worker requests.
 * @param message - Load request carrying the installation id fallback used by the worker runtime.
 * @returns Safe load summary for the parent runtime.
 */
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

/**
 * Runs the plugin health hook using either modern `health` or legacy `healthCheck`.
 * @returns Health payload produced by the plugin, or a generic healthy status.
 */
async function healthPlugin() {
  const loadedPlugin = requirePlugin();
  if (loadedPlugin.health) return loadedPlugin.health();
  if (loadedPlugin.healthCheck) return loadedPlugin.healthCheck();
  return { ok: true, status: 'healthy' };
}

/**
 * Executes one plugin operation through the generic instance contract.
 * @param message - Operation request with manifest operation key and user input payload.
 * @returns Operation output produced by the plugin.
 */
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

/**
 * Executes one plugin task through the generic instance contract.
 * @param message - Task request with task key, handler name, trigger type, and input payload.
 * @returns Task output produced by the plugin.
 */
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

/**
 * Dispatches one plugin event through the generic instance contract.
 * @param message - Event request with event key and normalized event payload.
 * @returns Event handling result produced by the plugin.
 */
async function handleEvent(message: QqbotPluginWorkerRequest) {
  const loadedPlugin = requirePlugin();
  const eventKey = requireRequestKey(
    message.eventKey,
    'QQBot 插件事件缺少 eventKey',
  );

  if (!loadedPlugin.handleEvent) return false;
  return loadedPlugin.handleEvent(eventKey, message.event);
}

/**
 * Creates a host facade whose methods proxy generic host capabilities to the parent process.
 * @returns Record of host capability functions passed to plugin package entries.
 */
function createHostFacade(): Record<string, unknown> {
  const host: Record<string, unknown> = {};
  for (const method of Object.keys(HOST_ARGUMENT_MAPPERS)) {
    host[method] = (...args: unknown[]) =>
      callHost(method, HOST_ARGUMENT_MAPPERS[method](...args));
  }

  return new Proxy(host, {
    /**
     * Resolves unknown host methods to generic RPC calls while keeping promise introspection stable.
     * @param target - Known host capability map.
     * @param property - Host method name requested by plugin package code.
     * @returns Existing method, generic method proxy, or `undefined` for non-method symbols.
     */
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (property in target) return target[property];
      if (property === 'then') return undefined;
      return (...args: unknown[]) =>
        callHost(property, normalizeHostArgs(args));
    },
  });
}

/**
 * Sends one host capability request to the parent process and waits for its response.
 * @param method - Generic host capability name.
 * @param args - Structured argument payload for the host bridge.
 * @returns Host bridge result value.
 */
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
      /**
       * Resolves a host response while preserving the generic result type requested by plugin code.
       * @param value - Raw host bridge response value sent by the parent process.
       */
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

/**
 * Resolves or rejects a pending host call from a parent host response message.
 * @param message - Host response carrying the original host-call request id.
 */
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

/**
 * Reads the workerData descriptor and rejects malformed worker startup state.
 * @returns Package descriptor supplied by QqbotPluginWorkerThreadDriver.
 */
function getWorkerDescriptor(): QqbotPluginPackageDescriptor {
  const descriptor = workerData?.descriptor;
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('QQBot 插件 worker 缺少 descriptor');
  }
  return descriptor as QqbotPluginPackageDescriptor;
}

/**
 * Reads the workerData config snapshot as a simple string map.
 * @returns Runtime config snapshot supplied by QqbotPluginWorkerThreadDriver.
 */
function getWorkerConfigSnapshot(): QqbotPluginRuntimeConfigSnapshot {
  const snapshot = workerData?.configSnapshot;
  return snapshot && typeof snapshot === 'object'
    ? (snapshot as QqbotPluginRuntimeConfigSnapshot)
    : {};
}

/**
 * Reads the installation id from workerData, falling back to the load request for recovery calls.
 * @param message - Load request that may carry the installation id from QqbotPluginWorkerRuntime.
 * @returns Installation id passed to the plugin runtime contract.
 */
function getWorkerInstallationId(message: QqbotPluginWorkerRequest) {
  const installationId = workerData?.installationId || message.installationId;
  return typeof installationId === 'string' ? installationId : '';
}

/**
 * Returns the currently loaded plugin instance or throws a worker-safe error.
 * @returns Plugin instance created during the load request.
 */
function requirePlugin() {
  if (!plugin) {
    throw new Error('QQBot 插件运行时未加载');
  }
  return plugin;
}

/**
 * Reads a required request key from a worker request.
 * @param value - Candidate request key from operation, task, or event payload.
 * @param message - Error message used when the key is absent.
 * @returns Non-empty request key.
 */
function requireRequestKey(value: unknown, message: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(message);
}

/**
 * Finds an executable operation or task from a manifest-shaped runtime summary.
 * @param items - Runtime operation or task list returned by plugin entry code.
 * @param key - Operation or task key requested by the platform.
 * @param handlerName - Optional handler name fallback for task execution.
 * @returns Callable runtime item when found.
 */
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

/**
 * Checks whether a runtime summary item exposes an executable function.
 * @param item - Unknown operation or task summary returned by plugin code.
 * @returns `true` when the item can execute worker input.
 */
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

/**
 * Normalizes unknown host arguments for unlisted host methods.
 * @param args - Positional arguments supplied by plugin package code.
 * @returns Record payload accepted by the parent host bridge.
 */
function normalizeHostArgs(args: unknown[]): Record<string, unknown> {
  if (args.length === 1 && isRecord(args[0])) return args[0];
  return { args };
}

/**
 * Checks whether a value can be passed as a structured host-call argument record.
 * @param value - Candidate host-call argument value.
 * @returns `true` when the value is a non-null object and not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Imports a plugin entry with a URL-based dynamic import and falls back to CommonJS loading in Jest/dev hooks.
 * @param moduleUrl - File URL produced from the descriptor entry path.
 * @param entryFile - Absolute descriptor entry file used only when the dynamic import host cannot resolve file URLs.
 * @returns Plugin entry module namespace.
 */
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

/**
 * Uses native dynamic import so Jest CommonJS transforms do not rewrite file URL imports.
 * @param moduleUrl - File URL pointing at the descriptor entry module.
 * @returns Plugin entry module namespace loaded by Node.
 */
function dynamicImportPluginEntry(
  moduleUrl: string,
): Promise<PluginEntryModule> {
  const importer = new Function('moduleUrl', 'return import(moduleUrl)') as (
    value: string,
  ) => Promise<PluginEntryModule>;
  return importer(moduleUrl);
}

/**
 * Detects Jest/ts-node resolution failures for URL imports while preserving real plugin errors.
 * @param error - Dynamic import error thrown by the runtime host.
 * @param moduleUrl - File URL attempted by the dynamic import.
 * @returns Whether CommonJS fallback is appropriate for the same entry file.
 */
function shouldFallbackToRequire(error: unknown, moduleUrl: string) {
  if (!moduleUrl.startsWith('file:')) return false;
  const message = error instanceof Error ? error.message : `${error}`;
  return (
    message.includes('Cannot find module') ||
    message.includes('dynamic import callback') ||
    message.includes('Unknown file extension')
  );
}

/**
 * Loads a CommonJS plugin entry directly from disk for Jest environments that cannot execute file URL imports.
 * @param entryFile - Absolute descriptor entry file compiled as CommonJS.
 * @returns Plugin entry module exports.
 */
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

/**
 * Normalizes plugin errors into stable text for package entry adapters.
 * @param error - Error or arbitrary thrown value from package code.
 * @param fallback - Message used when the thrown value has no useful text.
 * @returns Stable error message for plugin-visible health or execution output.
 */
function normalizeError(error: unknown, fallback = '插件执行失败') {
  if (error instanceof Error && error.message) return error.message;
  const message = `${error || ''}`.trim();
  return message || fallback;
}

/**
 * Serializes an error for parent-process worker responses.
 * @param error - Error or arbitrary thrown value from worker or plugin code.
 * @returns Worker-safe error payload with message, name, and stack when available.
 */
function serializeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : `${error}`,
    name: error instanceof Error ? error.name : 'Error',
    stack: error instanceof Error ? error.stack : undefined,
  };
}

/**
 * Deserializes a parent host-call error into an Error instance.
 * @param error - Serialized error payload from the parent host bridge.
 * @returns Error instance rejected to plugin host facade callers.
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
